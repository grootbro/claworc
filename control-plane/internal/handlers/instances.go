package handlers

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gluk-w/claworc/control-plane/internal/config"
	"github.com/gluk-w/claworc/control-plane/internal/database"
	"github.com/gluk-w/claworc/control-plane/internal/llmgateway"
	"github.com/gluk-w/claworc/control-plane/internal/middleware"
	"github.com/gluk-w/claworc/control-plane/internal/orchestrator"
	"github.com/gluk-w/claworc/control-plane/internal/sshproxy"
	"github.com/gluk-w/claworc/control-plane/internal/utils"
	"github.com/go-chi/chi/v5"
)

// In-memory status messages for instance creation progress.
var statusMessages sync.Map

func setStatusMessage(id uint, msg string) { statusMessages.Store(id, msg) }
func clearStatusMessage(id uint)           { statusMessages.Delete(id) }
func getStatusMessage(id uint) string {
	if v, ok := statusMessages.Load(id); ok {
		return v.(string)
	}
	return ""
}

type modelsConfig struct {
	Disabled []string `json:"disabled"`
	Extra    []string `json:"extra"`
}

var recommendedDefaultModels = []string{
	"gemini/gemini-3-flash-preview",
	"gemini/gemini-2.5-flash",
	"openai/gpt-5.2",
}

type instanceCreateRequest struct {
	DisplayName      string            `json:"display_name"`
	CPURequest       string            `json:"cpu_request"`
	CPULimit         string            `json:"cpu_limit"`
	MemoryRequest    string            `json:"memory_request"`
	MemoryLimit      string            `json:"memory_limit"`
	StorageHomebrew  string            `json:"storage_homebrew"`
	StorageHome      string            `json:"storage_home"`
	BraveAPIKey      *string           `json:"brave_api_key"`
	APIKeys          map[string]string `json:"api_keys"`
	Models           *modelsConfig     `json:"models"`
	DefaultModel     string            `json:"default_model"`
	ContainerImage   *string           `json:"container_image"`
	VNCResolution    *string           `json:"vnc_resolution"`
	Timezone         *string           `json:"timezone"`
	UserAgent        *string           `json:"user_agent"`
	EnabledProviders []uint            `json:"enabled_providers"`
}

type modelsResponse struct {
	Effective        []string `json:"effective"`
	DisabledDefaults []string `json:"disabled_defaults"`
	Extra            []string `json:"extra"`
}

type instanceResponse struct {
	ID                    uint            `json:"id"`
	Name                  string          `json:"name"`
	DisplayName           string          `json:"display_name"`
	Status                string          `json:"status"`
	OwnerUserID           *uint           `json:"owner_user_id"`
	CPURequest            string          `json:"cpu_request"`
	CPULimit              string          `json:"cpu_limit"`
	MemoryRequest         string          `json:"memory_request"`
	MemoryLimit           string          `json:"memory_limit"`
	StorageHomebrew       string          `json:"storage_homebrew"`
	StorageHome           string          `json:"storage_home"`
	HasBraveOverride      bool            `json:"has_brave_override"`
	APIKeyOverrides       []string        `json:"api_key_overrides"`
	Models                *modelsResponse `json:"models"`
	DefaultModel          string          `json:"default_model"`
	ContainerImage        *string         `json:"container_image"`
	HasImageOverride      bool            `json:"has_image_override"`
	VNCResolution         *string         `json:"vnc_resolution"`
	HasResolutionOverride bool            `json:"has_resolution_override"`
	Timezone              *string         `json:"timezone"`
	HasTimezoneOverride   bool            `json:"has_timezone_override"`
	UserAgent             *string         `json:"user_agent"`
	HasUserAgentOverride  bool            `json:"has_user_agent_override"`
	LiveImageInfo         *string         `json:"live_image_info,omitempty"`
	StatusMessage         string          `json:"status_message,omitempty"`
	AllowedSourceIPs      string          `json:"allowed_source_ips"`
	EnabledProviders      []uint          `json:"enabled_providers"`
	ControlURL            string          `json:"control_url"`
	GatewayToken          string          `json:"gateway_token"`
	SortOrder             int             `json:"sort_order"`
	CreatedAt             string          `json:"created_at"`
	UpdatedAt             string          `json:"updated_at"`
}

type inspectImageRequest struct {
	ContainerImage string `json:"container_image"`
}

type imageContractInspectionResponse struct {
	ImageRef           string   `json:"image_ref"`
	Mode               string   `json:"mode"`
	OpenClawUser       string   `json:"open_claw_user"`
	OpenClawHome       string   `json:"open_claw_home"`
	BrowserMetricsPath string   `json:"browser_metrics_path"`
	PrebuiltReady      bool     `json:"prebuilt_ready"`
	Notes              []string `json:"notes"`
}

type archiveImageImportResponse struct {
	GeneratedImageRef  string   `json:"generated_image_ref"`
	BaseImage          string   `json:"base_image"`
	DetectedRoot       string   `json:"detected_root"`
	DetectedLayout     string   `json:"detected_layout"`
	Mode               string   `json:"mode"`
	OpenClawUser       string   `json:"open_claw_user"`
	OpenClawHome       string   `json:"open_claw_home"`
	BrowserMetricsPath string   `json:"browser_metrics_path"`
	PrebuiltReady      bool     `json:"prebuilt_ready"`
	Notes              []string `json:"notes"`
}

func canSelfProvision(user *database.User) bool {
	return user != nil && (user.Role == "admin" || user.CanCreateInstances)
}

func canManageOwnedInstance(user *database.User, inst database.Instance) bool {
	if user == nil {
		return false
	}
	if user.Role == "admin" {
		return true
	}
	return inst.OwnerUserID != nil && *inst.OwnerUserID == user.ID
}

func generateName(displayName string) string {
	name := strings.ToLower(displayName)
	name = regexp.MustCompile(`[\s_]+`).ReplaceAllString(name, "-")
	name = regexp.MustCompile(`[^a-z0-9-]`).ReplaceAllString(name, "")
	name = strings.Trim(name, "-")
	name = "bot-" + name
	if len(name) > 63 {
		name = name[:63]
	}
	return name
}

func generateToken() string {
	b := make([]byte, 32)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func formatTimestamp(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format("2006-01-02T15:04:05Z")
}

func getInstanceAPIKeyNames(instanceID uint) []string {
	var keys []database.InstanceAPIKey
	database.DB.Where("instance_id = ?", instanceID).Find(&keys)
	names := make([]string, 0, len(keys))
	for _, k := range keys {
		names = append(names, k.KeyName)
	}
	return names
}

func parseModelsConfig(raw string) modelsConfig {
	var mc modelsConfig
	if raw != "" {
		json.Unmarshal([]byte(raw), &mc)
	}
	if mc.Disabled == nil {
		mc.Disabled = []string{}
	}
	if mc.Extra == nil {
		mc.Extra = []string{}
	}
	return mc
}

func getDefaultModels() []string {
	defaultModelsJSON, _ := database.GetSetting("default_models")
	var defaults []string
	if defaultModelsJSON != "" {
		json.Unmarshal([]byte(defaultModelsJSON), &defaults)
	}
	defaults = dedupeStrings(defaults)
	if len(defaults) == 0 {
		return append([]string(nil), recommendedDefaultModels...)
	}
	return defaults
}

func computeEffectiveModels(mc modelsConfig) []string {
	defaults := getDefaultModels()

	disabledSet := make(map[string]bool)
	for _, d := range mc.Disabled {
		disabledSet[d] = true
	}

	var effective []string
	for _, m := range defaults {
		if !disabledSet[m] {
			effective = append(effective, m)
		}
	}
	effective = append(effective, mc.Extra...)
	if effective == nil {
		effective = []string{}
	}
	return effective
}

func dedupeStrings(values []string) []string {
	if len(values) == 0 {
		return []string{}
	}
	seen := make(map[string]struct{}, len(values))
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	if out == nil {
		return []string{}
	}
	return out
}

func normalizeModelsConfig(mc modelsConfig, defaultModel string) modelsConfig {
	mc.Disabled = dedupeStrings(mc.Disabled)
	mc.Extra = dedupeStrings(mc.Extra)

	if defaultModel != "" && !slices.Contains(getDefaultModels(), defaultModel) && !slices.Contains(mc.Extra, defaultModel) {
		mc.Extra = append([]string{defaultModel}, mc.Extra...)
	}

	return mc
}

func normalizeEnabledProviders(enabled []uint, selectedModels []string) []uint {
	set := make(map[uint]struct{}, len(enabled))
	result := make([]uint, 0, len(enabled))
	for _, id := range enabled {
		if _, ok := set[id]; ok {
			continue
		}
		set[id] = struct{}{}
		result = append(result, id)
	}

	providerKeys := make(map[string]struct{})
	for _, model := range selectedModels {
		providerKey, _, ok := strings.Cut(model, "/")
		if !ok || providerKey == "" {
			continue
		}
		providerKeys[providerKey] = struct{}{}
	}
	if len(providerKeys) == 0 {
		return result
	}

	keys := make([]string, 0, len(providerKeys))
	for key := range providerKeys {
		keys = append(keys, key)
	}

	var providers []database.LLMProvider
	database.DB.Where("key IN ?", keys).Find(&providers)
	extraIDs := make([]uint, 0, len(providers))
	for _, provider := range providers {
		if _, ok := set[provider.ID]; ok {
			continue
		}
		set[provider.ID] = struct{}{}
		extraIDs = append(extraIDs, provider.ID)
	}
	slices.Sort(extraIDs)
	result = append(result, extraIDs...)

	return result
}

// GatewayProvider holds the virtual auth key, API type, and models for a gateway provider.
type GatewayProvider struct {
	Key        string
	APIType    string
	Models     []database.ProviderModel
	CatalogKey string // non-empty for catalog-backed providers (e.g. "openai", "anthropic")
}

// resolveGatewayProviders builds the providerKey→GatewayProvider map for an instance's enabled
// providers. Each entry includes the virtual auth key, API type, and stored model list.
func resolveGatewayProviders(inst database.Instance) map[string]GatewayProvider {
	enabledIDs := parseEnabledProviders(inst.EnabledProviders)
	if len(enabledIDs) == 0 {
		return nil
	}
	gatewayKeys := llmgateway.GetInstanceGatewayKeys(inst.ID)
	var providers []database.LLMProvider
	database.DB.Where("id IN ?", enabledIDs).Find(&providers)

	result := make(map[string]GatewayProvider, len(providers))
	for _, p := range providers {
		gk, ok := gatewayKeys[p.ID]
		if !ok {
			continue
		}
		result[p.Key] = GatewayProvider{
			Key:        gk,
			APIType:    p.APIType,
			Models:     database.ParseProviderModels(p.Models),
			CatalogKey: p.Provider,
		}
	}
	return result
}

// resolveInstanceModels builds the effective model list for pushing to the running instance.
// If DefaultModel is set and present in the list, it is moved to the front so it becomes the primary model.
func resolveInstanceModels(inst database.Instance) []string {
	mc := parseModelsConfig(inst.ModelsConfig)
	models := computeEffectiveModels(mc)

	if inst.DefaultModel != "" {
		for i, m := range models {
			if m == inst.DefaultModel {
				models = append([]string{m}, append(models[:i:i], models[i+1:]...)...)
				break
			}
		}
	}
	return models
}

func parseEnabledProviders(raw string) []uint {
	if raw == "" || raw == "[]" {
		return []uint{}
	}
	var ids []uint
	json.Unmarshal([]byte(raw), &ids)
	if ids == nil {
		return []uint{}
	}
	return ids
}

func instanceToResponse(inst database.Instance, status string) instanceResponse {
	var containerImage *string
	if inst.ContainerImage != "" {
		containerImage = &inst.ContainerImage
	}
	var vncResolution *string
	if inst.VNCResolution != "" {
		vncResolution = &inst.VNCResolution
	}
	var timezone *string
	if inst.Timezone != "" {
		timezone = &inst.Timezone
	}
	var userAgent *string
	if inst.UserAgent != "" {
		userAgent = &inst.UserAgent
	}
	var gatewayToken string
	if inst.GatewayToken != "" {
		gatewayToken, _ = utils.Decrypt(inst.GatewayToken)
	}

	apiKeyOverrides := getInstanceAPIKeyNames(inst.ID)
	enabledProviders := parseEnabledProviders(inst.EnabledProviders)

	mc := parseModelsConfig(inst.ModelsConfig)
	effective := computeEffectiveModels(mc)

	return instanceResponse{
		ID:                    inst.ID,
		Name:                  inst.Name,
		DisplayName:           inst.DisplayName,
		Status:                status,
		OwnerUserID:           inst.OwnerUserID,
		StatusMessage:         getStatusMessage(inst.ID),
		CPURequest:            inst.CPURequest,
		CPULimit:              inst.CPULimit,
		MemoryRequest:         inst.MemoryRequest,
		MemoryLimit:           inst.MemoryLimit,
		StorageHomebrew:       inst.StorageHomebrew,
		StorageHome:           inst.StorageHome,
		HasBraveOverride:      inst.BraveAPIKey != "",
		APIKeyOverrides:       apiKeyOverrides,
		Models:                &modelsResponse{Effective: effective, DisabledDefaults: mc.Disabled, Extra: mc.Extra},
		DefaultModel:          inst.DefaultModel,
		ContainerImage:        containerImage,
		HasImageOverride:      inst.ContainerImage != "",
		VNCResolution:         vncResolution,
		HasResolutionOverride: inst.VNCResolution != "",
		Timezone:              timezone,
		HasTimezoneOverride:   inst.Timezone != "",
		UserAgent:             userAgent,
		HasUserAgentOverride:  inst.UserAgent != "",
		AllowedSourceIPs:      inst.AllowedSourceIPs,
		EnabledProviders:      enabledProviders,
		ControlURL:            fmt.Sprintf("/openclaw/%d/", inst.ID),
		GatewayToken:          gatewayToken,
		SortOrder:             inst.SortOrder,
		CreatedAt:             formatTimestamp(inst.CreatedAt),
		UpdatedAt:             formatTimestamp(inst.UpdatedAt),
	}
}

func sanitizeInstanceResponseForUser(resp *instanceResponse, user *database.User) {
	if user == nil {
		resp.ControlURL = ""
		resp.GatewayToken = ""
		return
	}
	if user.Role == "admin" || user.CanLaunchControlUI {
		return
	}
	resp.ControlURL = ""
	resp.GatewayToken = ""
}

func resolveStatus(inst *database.Instance, orchStatus string) string {
	if inst.Status == "stopping" {
		if orchStatus == "stopped" {
			database.DB.Model(inst).Updates(map[string]interface{}{
				"status":     "stopped",
				"updated_at": time.Now().UTC(),
			})
			return "stopped"
		}
		return "stopping"
	}

	if inst.Status == "error" && orchStatus == "stopped" {
		return "failed"
	}

	if inst.Status == "creating" {
		return "creating"
	}

	if inst.Status != "restarting" {
		return orchStatus
	}

	if orchStatus != "running" {
		return "restarting"
	}

	if !inst.UpdatedAt.IsZero() {
		if time.Since(inst.UpdatedAt) < 15*time.Second {
			return "restarting"
		}
	}

	database.DB.Model(inst).Updates(map[string]interface{}{
		"status":     "running",
		"updated_at": time.Now().UTC(),
	})
	return "running"
}

func getEffectiveImage(inst database.Instance) string {
	if inst.ContainerImage != "" {
		return inst.ContainerImage
	}
	val, err := database.GetSetting("default_container_image")
	if err == nil && val != "" {
		return val
	}
	return ""
}

func getEffectiveResolution(inst database.Instance) string {
	if inst.VNCResolution != "" {
		return inst.VNCResolution
	}
	val, err := database.GetSetting("default_vnc_resolution")
	if err == nil && val != "" {
		return val
	}
	return "1920x1080"
}

func getEffectiveTimezone(inst database.Instance) string {
	if inst.Timezone != "" {
		return inst.Timezone
	}
	val, err := database.GetSetting("default_timezone")
	if err == nil && val != "" {
		return val
	}
	return "America/New_York"
}

func getEffectiveUserAgent(inst database.Instance) string {
	if inst.UserAgent != "" {
		return inst.UserAgent
	}
	val, err := database.GetSetting("default_user_agent")
	if err == nil && val != "" {
		return val
	}
	return ""
}

func getEffectiveOpenClawUser(inst database.Instance) string {
	contract := orchestrator.NormalizeImageContract(orchestrator.ImageContract{
		OpenClawUser: inst.OpenClawUser,
		OpenClawHome: inst.OpenClawHome,
	})
	return contract.OpenClawUser
}

func getEffectiveOpenClawHome(inst database.Instance) string {
	contract := orchestrator.NormalizeImageContract(orchestrator.ImageContract{
		OpenClawUser: inst.OpenClawUser,
		OpenClawHome: inst.OpenClawHome,
	})
	return contract.OpenClawHome
}

func resolveImageContract(ctx context.Context, orch orchestrator.ContainerOrchestrator, image string) orchestrator.ImageContract {
	contract, err := orch.ResolveImageContract(ctx, image)
	if err != nil {
		log.Printf("Failed to resolve image contract for %s: %v", utils.SanitizeForLog(image), err)
		return orchestrator.NormalizeImageContract(orchestrator.ImageContract{})
	}
	return orchestrator.NormalizeImageContract(contract)
}

func persistImageContract(instanceID uint, contract orchestrator.ImageContract) {
	contract = orchestrator.NormalizeImageContract(contract)
	if err := database.DB.Model(&database.Instance{}).Where("id = ?", instanceID).Updates(map[string]interface{}{
		"open_claw_user": contract.OpenClawUser,
		"open_claw_home": contract.OpenClawHome,
		"updated_at":     time.Now().UTC(),
	}).Error; err != nil {
		log.Printf("Failed to persist image contract for instance %d: %v", instanceID, err)
	}
}

func buildImageContractInspectionResponse(imageRef string, contract orchestrator.ImageContract) imageContractInspectionResponse {
	contract = orchestrator.NormalizeImageContract(contract)
	notes := []string{}

	if contract.Mode == "prebuilt" {
		notes = append(notes, "Image explicitly declares prebuilt mode, so Claworc will keep its baked OpenClaw runtime contract.")
	} else {
		notes = append(notes, "Image does not explicitly declare prebuilt mode. Claworc can still run it, but baked OpenClaw homes are safer with explicit labels.")
	}

	if contract.OpenClawUser == orchestrator.DefaultOpenClawUser && contract.OpenClawHome == orchestrator.DefaultOpenClawHome {
		notes = append(notes, "Resolved runtime matches the default Claworc contract.")
	} else {
		notes = append(notes, fmt.Sprintf("Resolved non-default runtime: user %q with home %q.", contract.OpenClawUser, contract.OpenClawHome))
	}

	if contract.Mode != "prebuilt" {
		notes = append(notes, "Recommended labels: io.claworc.image-mode, io.claworc.openclaw-user, io.claworc.openclaw-home.")
	}

	return imageContractInspectionResponse{
		ImageRef:           imageRef,
		Mode:               contract.Mode,
		OpenClawUser:       contract.OpenClawUser,
		OpenClawHome:       contract.OpenClawHome,
		BrowserMetricsPath: contract.BrowserMetricsPath,
		PrebuiltReady:      contract.Mode == "prebuilt",
		Notes:              notes,
	}
}

func humanizeArchiveImportError(err error) string {
	if err == nil {
		return "Failed to build image from archive"
	}

	msg := strings.TrimSpace(err.Error())
	switch {
	case strings.Contains(msg, "archive must contain a .openclaw directory"):
		return "Archive is missing an OpenClaw home. Put .openclaw at the archive root, or wrap everything in one top-level folder that contains .openclaw."
	case strings.Contains(msg, "multiple possible OpenClaw homes"):
		return "Archive contains more than one possible OpenClaw home. Keep exactly one .openclaw root in the export."
	case strings.Contains(msg, "archive symlinks are not supported"), strings.Contains(msg, "symlinks are not supported in imported archives"):
		return "Archive contains symlinks. Repack it with real files only, without symbolic links."
	case strings.Contains(msg, "unsupported archive format"):
		return "Unsupported archive format. Use .zip, .tar, .tar.gz, or .tgz."
	case strings.Contains(msg, "invalid zip archive"), strings.Contains(msg, "invalid gzip archive"), strings.Contains(msg, "read tar archive"):
		return "Archive could not be read cleanly. Re-export it as .zip, .tar, .tar.gz, or .tgz and try again."
	default:
		return msg
	}
}

func humanizeBackupExportError(err error) string {
	if err == nil {
		return "Failed to export instance backup"
	}

	msg := strings.TrimSpace(err.Error())
	switch {
	case strings.Contains(msg, "unsupported archive format"):
		return "Unsupported backup format. Use zip or tgz."
	case strings.Contains(msg, "instance home volume not found"):
		return "This bot does not have a readable home volume on the current server."
	case strings.Contains(msg, "does not contain a .openclaw directory"):
		return "This bot home is missing .openclaw, so Claworc cannot build a restore-ready backup from it yet."
	case strings.Contains(msg, "export staging failed"):
		return "Claworc could not stage the bot home for backup. Try again in a moment, or restart the instance if its filesystem is mid-change."
	default:
		return msg
	}
}

func InspectImageContract(w http.ResponseWriter, r *http.Request) {
	var req inspectImageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	imageRef := strings.TrimSpace(req.ContainerImage)
	if imageRef == "" {
		writeError(w, http.StatusBadRequest, "Container image is required")
		return
	}

	orch := orchestrator.Get()
	if orch == nil || !orch.IsAvailable(r.Context()) {
		writeError(w, http.StatusServiceUnavailable, "Orchestrator unavailable")
		return
	}

	contract, err := orch.ResolveImageContract(r.Context(), imageRef)
	if err != nil {
		log.Printf("Failed to inspect image contract for %s: %v", utils.SanitizeForLog(imageRef), err)
		writeError(w, http.StatusBadRequest, "Failed to inspect image. Verify that the reference exists and the server can pull it.")
		return
	}

	writeJSON(w, http.StatusOK, buildImageContractInspectionResponse(imageRef, contract))
}

func ImportArchiveImage(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUser(r)
	if user == nil {
		writeError(w, http.StatusUnauthorized, "Authentication required")
		return
	}
	if user.Role != "admin" {
		writeError(w, http.StatusForbidden, "Only admins can import archive images")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 512<<20)
	if err := r.ParseMultipartForm(512 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "Archive too large or invalid form")
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "Missing archive file")
		return
	}
	defer file.Close()

	tmpFile, err := os.CreateTemp("", "claworc-archive-import-*")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to create temporary file")
		return
	}
	tmpPath := tmpFile.Name()
	defer os.Remove(tmpPath)

	if _, err := io.Copy(tmpFile, file); err != nil {
		tmpFile.Close()
		writeError(w, http.StatusBadRequest, "Failed to read uploaded archive")
		return
	}
	if err := tmpFile.Close(); err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to finalize uploaded archive")
		return
	}

	baseImage := strings.TrimSpace(r.FormValue("base_image"))
	displayName := strings.TrimSpace(r.FormValue("display_name"))

	orch := orchestrator.Get()
	if orch == nil || !orch.IsAvailable(r.Context()) {
		writeError(w, http.StatusServiceUnavailable, "Orchestrator unavailable")
		return
	}

	result, err := orch.BuildArchiveImage(r.Context(), orchestrator.ArchiveImageBuildParams{
		DisplayName: displayName,
		BaseImage:   baseImage,
		ArchiveName: header.Filename,
		ArchivePath: tmpPath,
	})
	if err != nil {
		log.Printf("Failed to import archive image %s: %v", utils.SanitizeForLog(header.Filename), err)
		writeError(w, http.StatusBadRequest, humanizeArchiveImportError(err))
		return
	}

	inspection := buildImageContractInspectionResponse(result.ImageRef, result.Contract)
	notes := append([]string{}, result.Notes...)
	notes = append(notes, inspection.Notes...)

	writeJSON(w, http.StatusOK, archiveImageImportResponse{
		GeneratedImageRef:  result.ImageRef,
		BaseImage:          result.BaseImage,
		DetectedRoot:       result.DetectedRoot,
		DetectedLayout:     result.DetectedLayout,
		Mode:               inspection.Mode,
		OpenClawUser:       inspection.OpenClawUser,
		OpenClawHome:       inspection.OpenClawHome,
		BrowserMetricsPath: inspection.BrowserMetricsPath,
		PrebuiltReady:      inspection.PrebuiltReady,
		Notes:              notes,
	})
}

func ExportInstanceBackup(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "Invalid instance ID")
		return
	}

	var inst database.Instance
	if err := database.DB.First(&inst, id).Error; err != nil {
		writeError(w, http.StatusNotFound, "Instance not found")
		return
	}

	if !middleware.CanAccessInstance(r, inst.ID) {
		writeError(w, http.StatusForbidden, "Access denied")
		return
	}
	user := middleware.GetUser(r)
	if !canManageOwnedInstance(user, inst) {
		writeError(w, http.StatusForbidden, "Only the owner or an admin can export this instance backup")
		return
	}

	orch := orchestrator.Get()
	if orch == nil || !orch.IsAvailable(r.Context()) {
		writeError(w, http.StatusServiceUnavailable, "Orchestrator unavailable")
		return
	}

	format := strings.TrimSpace(r.URL.Query().Get("format"))
	if format == "" {
		format = "zip"
	}

	result, err := orch.ExportInstanceBackup(r.Context(), orchestrator.InstanceArchiveExportParams{
		Name:        inst.Name,
		DisplayName: inst.DisplayName,
		Format:      format,
	})
	if err != nil {
		log.Printf("Failed to export backup for instance %d (%s): %v", inst.ID, utils.SanitizeForLog(inst.Name), err)
		writeError(w, http.StatusBadRequest, humanizeBackupExportError(err))
		return
	}
	defer os.RemoveAll(result.CleanupPath)

	file, err := os.Open(result.ArchivePath)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to open generated backup archive")
		return
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to inspect generated backup archive")
		return
	}

	contentType := "application/zip"
	if result.Format == "tgz" {
		contentType = "application/gzip"
	}

	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, result.ArchiveName))
	w.Header().Set("Content-Length", strconv.FormatInt(info.Size(), 10))
	w.Header().Set("X-Claworc-Archive-Root", result.RootDirectory)
	w.Header().Set("X-Claworc-Archive-Format", result.Format)
	http.ServeContent(w, r, result.ArchiveName, info.ModTime(), file)
}

func ListInstances(w http.ResponseWriter, r *http.Request) {
	var instances []database.Instance
	user := middleware.GetUser(r)

	query := database.DB.Order("sort_order ASC, id ASC")
	if user != nil && user.Role != "admin" {
		assignedIDs, err := database.GetUserInstances(user.ID)
		if err != nil {
			writeJSON(w, http.StatusOK, []instanceResponse{})
			return
		}
		if len(assignedIDs) == 0 {
			query = query.Where("owner_user_id = ?", user.ID)
		} else {
			query = query.Where("owner_user_id = ? OR id IN ?", user.ID, assignedIDs)
		}
	}

	if err := query.Find(&instances).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to list instances")
		return
	}

	orch := orchestrator.Get()
	responses := make([]instanceResponse, 0, len(instances))
	for i := range instances {
		orchStatus := "stopped"
		if orch != nil {
			s, _ := orch.GetInstanceStatus(r.Context(), instances[i].Name)
			orchStatus = s
		}
		status := resolveStatus(&instances[i], orchStatus)
		resp := instanceToResponse(instances[i], status)
		sanitizeInstanceResponseForUser(&resp, user)
		responses = append(responses, resp)
	}

	writeJSON(w, http.StatusOK, responses)
}

func saveInstanceAPIKeys(instanceID uint, apiKeys map[string]string) error {
	for keyName, keyValue := range apiKeys {
		if keyValue == "" {
			// Delete the key
			database.DB.Where("instance_id = ? AND key_name = ?", instanceID, keyName).Delete(&database.InstanceAPIKey{})
			continue
		}
		encrypted, err := utils.Encrypt(keyValue)
		if err != nil {
			return fmt.Errorf("encrypt key %s: %w", keyName, err)
		}
		var existing database.InstanceAPIKey
		result := database.DB.Where("instance_id = ? AND key_name = ?", instanceID, keyName).First(&existing)
		if result.Error != nil {
			// Create new
			if err := database.DB.Create(&database.InstanceAPIKey{
				InstanceID: instanceID,
				KeyName:    keyName,
				KeyValue:   encrypted,
			}).Error; err != nil {
				return err
			}
		} else {
			// Update existing
			database.DB.Model(&existing).Update("key_value", encrypted)
		}
	}
	return nil
}

func CreateInstance(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUser(r)
	if user == nil {
		writeError(w, http.StatusUnauthorized, "Authentication required")
		return
	}

	var body instanceCreateRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if body.DisplayName == "" {
		writeError(w, http.StatusBadRequest, "display_name is required")
		return
	}

	if user.Role != "admin" {
		if !canSelfProvision(user) {
			writeError(w, http.StatusForbidden, "Self-service instance creation is disabled for this account")
			return
		}
		if user.MaxInstances > 0 {
			ownedCount, err := database.CountOwnedInstances(user.ID)
			if err != nil {
				writeError(w, http.StatusInternalServerError, "Failed to check instance quota")
				return
			}
			if ownedCount >= int64(user.MaxInstances) {
				writeError(w, http.StatusForbidden, fmt.Sprintf("Instance quota reached (%d/%d)", ownedCount, user.MaxInstances))
				return
			}
		}
		if body.ContainerImage != nil && strings.TrimSpace(*body.ContainerImage) != "" {
			writeError(w, http.StatusForbidden, "Only admins can override the agent image")
			return
		}
		if body.VNCResolution != nil && strings.TrimSpace(*body.VNCResolution) != "" {
			writeError(w, http.StatusForbidden, "Only admins can override the VNC resolution")
			return
		}
		if body.CPURequest != "" || body.CPULimit != "" || body.MemoryRequest != "" || body.MemoryLimit != "" || body.StorageHomebrew != "" || body.StorageHome != "" {
			writeError(w, http.StatusForbidden, "Only admins can override container resource limits")
			return
		}
	}

	// Set defaults
	if body.CPURequest == "" {
		body.CPURequest = "500m"
	}
	if body.CPULimit == "" {
		body.CPULimit = "2000m"
	}
	if body.MemoryRequest == "" {
		body.MemoryRequest = "1Gi"
	}
	if body.MemoryLimit == "" {
		body.MemoryLimit = "4Gi"
	}
	if body.StorageHomebrew == "" {
		body.StorageHomebrew = "10Gi"
	}
	if body.StorageHome == "" {
		body.StorageHome = "10Gi"
	}

	name := generateName(body.DisplayName)

	// Check uniqueness
	var count int64
	database.DB.Model(&database.Instance{}).Where("name = ?", name).Count(&count)
	if count > 0 {
		writeError(w, http.StatusConflict, fmt.Sprintf("Instance name '%s' already exists", name))
		return
	}

	// Encrypt Brave API key (stays as fixed field)
	var encBraveKey string
	if body.BraveAPIKey != nil && *body.BraveAPIKey != "" {
		var err error
		encBraveKey, err = utils.Encrypt(*body.BraveAPIKey)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Failed to encrypt API key")
			return
		}
	}

	// Generate gateway token
	gatewayTokenPlain := generateToken()
	encGatewayToken, err := utils.Encrypt(gatewayTokenPlain)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to encrypt gateway token")
		return
	}

	var containerImage string
	if body.ContainerImage != nil {
		containerImage = *body.ContainerImage
	}
	var vncResolution string
	if body.VNCResolution != nil {
		vncResolution = *body.VNCResolution
	}
	var timezone string
	if body.Timezone != nil {
		timezone = *body.Timezone
	}
	var userAgent string
	if body.UserAgent != nil {
		userAgent = *body.UserAgent
	}

	mc := modelsConfig{}
	if body.Models != nil {
		mc = *body.Models
	}
	mc = normalizeModelsConfig(mc, body.DefaultModel)
	modelsConfigJSONBytes, _ := json.Marshal(mc)
	modelsConfigJSON := string(modelsConfigJSONBytes)

	enabledProviders := normalizeEnabledProviders(body.EnabledProviders, computeEffectiveModels(mc))
	enabledProvidersJSON, _ := json.Marshal(enabledProviders)

	// Compute next sort_order
	var maxSortOrder int
	database.DB.Model(&database.Instance{}).Select("COALESCE(MAX(sort_order), 0)").Scan(&maxSortOrder)

	inst := database.Instance{
		Name:             name,
		DisplayName:      body.DisplayName,
		Status:           "creating",
		OwnerUserID:      nil,
		CPURequest:       body.CPURequest,
		CPULimit:         body.CPULimit,
		MemoryRequest:    body.MemoryRequest,
		MemoryLimit:      body.MemoryLimit,
		StorageHomebrew:  body.StorageHomebrew,
		StorageHome:      body.StorageHome,
		BraveAPIKey:      encBraveKey,
		ContainerImage:   containerImage,
		VNCResolution:    vncResolution,
		Timezone:         timezone,
		UserAgent:        userAgent,
		GatewayToken:     encGatewayToken,
		ModelsConfig:     modelsConfigJSON,
		DefaultModel:     body.DefaultModel,
		EnabledProviders: string(enabledProvidersJSON),
		SortOrder:        maxSortOrder + 1,
	}
	if user.Role != "admin" {
		inst.OwnerUserID = &user.ID
	}

	if err := database.DB.Create(&inst).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to create instance")
		return
	}

	if inst.OwnerUserID != nil {
		if err := database.AddUserInstance(*inst.OwnerUserID, inst.ID); err != nil {
			log.Printf("Failed to assign owner %d to instance %d: %v", *inst.OwnerUserID, inst.ID, err)
		}
	}

	// Save API keys to the new table
	allAPIKeys := make(map[string]string)
	for k, v := range body.APIKeys {
		allAPIKeys[k] = v
	}
	if len(allAPIKeys) > 0 {
		if err := saveInstanceAPIKeys(inst.ID, allAPIKeys); err != nil {
			log.Printf("Failed to save API keys for instance %d: %v", inst.ID, err)
		}
	}

	effectiveImage := getEffectiveImage(inst)
	effectiveResolution := getEffectiveResolution(inst)
	effectiveTimezone := getEffectiveTimezone(inst)
	effectiveUserAgent := getEffectiveUserAgent(inst)

	// Launch container creation asynchronously (image pull can take minutes)
	go func() {
		ctx := context.Background()
		orch := orchestrator.Get()
		if orch == nil {
			setStatusMessage(inst.ID, "Failed: no orchestrator available")
			database.DB.Model(&inst).Update("status", "error")
			return
		}

		envVars := map[string]string{}
		if gatewayTokenPlain != "" {
			envVars["OPENCLAW_GATEWAY_TOKEN"] = gatewayTokenPlain
		}

		err := orch.CreateInstance(ctx, orchestrator.CreateParams{
			Name:            name,
			CPURequest:      body.CPURequest,
			CPULimit:        body.CPULimit,
			MemoryRequest:   body.MemoryRequest,
			MemoryLimit:     body.MemoryLimit,
			StorageHomebrew: body.StorageHomebrew,
			StorageHome:     body.StorageHome,
			ContainerImage:  effectiveImage,
			VNCResolution:   effectiveResolution,
			Timezone:        effectiveTimezone,
			UserAgent:       effectiveUserAgent,
			EnvVars:         envVars,
			OnProgress:      func(msg string) { setStatusMessage(inst.ID, msg) },
		})
		if err != nil {
			log.Printf("Failed to create container resources for %s: %s", utils.SanitizeForLog(name), utils.SanitizeForLog(err.Error()))
			setStatusMessage(inst.ID, fmt.Sprintf("Failed: %v", err))
			database.DB.Model(&inst).Update("status", "error")
			return
		}
		clearStatusMessage(inst.ID)
		database.DB.Model(&inst).Updates(map[string]interface{}{
			"status":     "running",
			"updated_at": time.Now().UTC(),
		})

		contract := resolveImageContract(ctx, orch, effectiveImage)
		persistImageContract(inst.ID, contract)

		// Push models, API keys, and gateway providers to the instance (waits for container ready)
		database.DB.First(&inst, inst.ID)
		if err := llmgateway.EnsureKeysForInstance(inst.ID, enabledProviders); err != nil {
			log.Printf("Failed to ensure LLM gateway keys for instance %d: %s", inst.ID, utils.SanitizeForLog(err.Error()))
		}
		models := resolveInstanceModels(inst)
		gatewayProviders := resolveGatewayProviders(inst)
		sshClient, err := SSHMgr.WaitForSSH(ctx, inst.ID, 120*time.Second)
		if err != nil {
			log.Printf("Failed to get SSH connection for instance %d during configure: %v", inst.ID, err)
			return
		}
		ConfigureInstance(ctx, orch, sshproxy.NewSSHInstance(sshClient, getEffectiveOpenClawUser(inst)), name, models, gatewayProviders, config.Cfg.LLMGatewayPort)
	}()

	resp := instanceToResponse(inst, "creating")
	sanitizeInstanceResponseForUser(&resp, user)
	writeJSON(w, http.StatusCreated, resp)
}

func GetInstance(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "Invalid instance ID")
		return
	}

	var inst database.Instance
	if err := database.DB.First(&inst, id).Error; err != nil {
		writeError(w, http.StatusNotFound, "Instance not found")
		return
	}

	if !middleware.CanAccessInstance(r, inst.ID) {
		writeError(w, http.StatusForbidden, "Access denied")
		return
	}

	orch := orchestrator.Get()
	orchStatus := "stopped"
	if orch != nil {
		orchStatus, _ = orch.GetInstanceStatus(r.Context(), inst.Name)
	}
	status := resolveStatus(&inst, orchStatus)
	resp := instanceToResponse(inst, status)
	sanitizeInstanceResponseForUser(&resp, middleware.GetUser(r))
	if orch != nil {
		if info, err := orch.GetInstanceImageInfo(r.Context(), inst.Name); err == nil && info != "" {
			resp.LiveImageInfo = &info
		}
	}
	writeJSON(w, http.StatusOK, resp)
}

type instanceUpdateRequest struct {
	APIKeys          map[string]*string `json:"api_keys"` // null value = delete
	BraveAPIKey      *string            `json:"brave_api_key"`
	Models           *modelsConfig      `json:"models"`
	DefaultModel     *string            `json:"default_model"`
	Timezone         *string            `json:"timezone"`
	UserAgent        *string            `json:"user_agent"`
	AllowedSourceIPs *string            `json:"allowed_source_ips"` // admin only: comma-separated IPs/CIDRs
	EnabledProviders *[]uint            `json:"enabled_providers"`  // admin only: LLM gateway provider IDs
	DisplayName      *string            `json:"display_name"`       // admin only
	CPURequest       *string            `json:"cpu_request"`        // admin only
	CPULimit         *string            `json:"cpu_limit"`          // admin only
	MemoryRequest    *string            `json:"memory_request"`     // admin only
	MemoryLimit      *string            `json:"memory_limit"`       // admin only
	VNCResolution    *string            `json:"vnc_resolution"`     // admin only
}

var (
	cpuRegex        = regexp.MustCompile(`^(\d+m|\d+(\.\d+)?)$`)
	memoryRegex     = regexp.MustCompile(`^\d+(Ki|Mi|Gi)$`)
	resolutionRegex = regexp.MustCompile(`^\d+x\d+$`)
)

func cpuToMillicores(s string) int64 {
	if strings.HasSuffix(s, "m") {
		n, _ := strconv.ParseInt(s[:len(s)-1], 10, 64)
		return n
	}
	f, _ := strconv.ParseFloat(s, 64)
	return int64(f * 1000)
}

func memoryToBytes(s string) int64 {
	unitMap := map[string]int64{"Ki": 1024, "Mi": 1024 * 1024, "Gi": 1024 * 1024 * 1024}
	for suffix, multiplier := range unitMap {
		if strings.HasSuffix(s, suffix) {
			n, _ := strconv.ParseInt(s[:len(s)-len(suffix)], 10, 64)
			return n * multiplier
		}
	}
	n, _ := strconv.ParseInt(s, 10, 64)
	return n
}

func UpdateInstance(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "Invalid instance ID")
		return
	}

	var inst database.Instance
	if err := database.DB.First(&inst, id).Error; err != nil {
		writeError(w, http.StatusNotFound, "Instance not found")
		return
	}

	if !middleware.CanAccessInstance(r, inst.ID) {
		writeError(w, http.StatusForbidden, "Access denied")
		return
	}

	var body instanceUpdateRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	// Update API keys
	if body.APIKeys != nil {
		for keyName, keyVal := range body.APIKeys {
			if keyVal == nil || *keyVal == "" {
				// Delete
				database.DB.Where("instance_id = ? AND key_name = ?", inst.ID, keyName).Delete(&database.InstanceAPIKey{})
			} else {
				encrypted, err := utils.Encrypt(*keyVal)
				if err != nil {
					writeError(w, http.StatusInternalServerError, "Failed to encrypt API key")
					return
				}
				var existing database.InstanceAPIKey
				result := database.DB.Where("instance_id = ? AND key_name = ?", inst.ID, keyName).First(&existing)
				if result.Error != nil {
					database.DB.Create(&database.InstanceAPIKey{
						InstanceID: inst.ID,
						KeyName:    keyName,
						KeyValue:   encrypted,
					})
				} else {
					database.DB.Model(&existing).Update("key_value", encrypted)
				}
			}
		}
	}

	// Update Brave API key
	if body.BraveAPIKey != nil {
		if *body.BraveAPIKey != "" {
			encrypted, err := utils.Encrypt(*body.BraveAPIKey)
			if err != nil {
				writeError(w, http.StatusInternalServerError, "Failed to encrypt API key")
				return
			}
			database.DB.Model(&inst).Update("brave_api_key", encrypted)
		} else {
			database.DB.Model(&inst).Update("brave_api_key", "")
		}
	}

	nextModels := parseModelsConfig(inst.ModelsConfig)
	if body.Models != nil {
		nextModels = *body.Models
	}
	nextDefaultModel := inst.DefaultModel
	if body.DefaultModel != nil {
		nextDefaultModel = *body.DefaultModel
	}
	nextModels = normalizeModelsConfig(nextModels, nextDefaultModel)
	effectiveModels := computeEffectiveModels(nextModels)

	// Update default model
	if body.DefaultModel != nil {
		database.DB.Model(&inst).Update("default_model", nextDefaultModel)
	}

	// Update timezone
	if body.Timezone != nil {
		database.DB.Model(&inst).Update("timezone", *body.Timezone)
	}

	// Update user agent
	if body.UserAgent != nil {
		database.DB.Model(&inst).Update("user_agent", *body.UserAgent)
	}

	// Update allowed source IPs (admin only)
	if body.AllowedSourceIPs != nil {
		user := middleware.GetUser(r)
		if user == nil || user.Role != "admin" {
			writeError(w, http.StatusForbidden, "Only admins can configure source IP restrictions")
			return
		}
		// Validate the IP list before saving
		if *body.AllowedSourceIPs != "" {
			if _, err := sshproxy.ParseIPRestrictions(*body.AllowedSourceIPs); err != nil {
				writeError(w, http.StatusBadRequest, fmt.Sprintf("Invalid source IP restriction: %v", err))
				return
			}
		}
		database.DB.Model(&inst).Update("allowed_source_ips", *body.AllowedSourceIPs)
	}

	// Update models config
	if body.Models != nil || body.DefaultModel != nil {
		b, _ := json.Marshal(nextModels)
		database.DB.Model(&inst).Update("models_config", string(b))
	}

	// Update enabled providers (admin only)
	if body.EnabledProviders != nil {
		user := middleware.GetUser(r)
		if user == nil || user.Role != "admin" {
			writeError(w, http.StatusForbidden, "Only admins can configure LLM gateway providers")
			return
		}
		normalizedProviders := normalizeEnabledProviders(*body.EnabledProviders, effectiveModels)
		b, _ := json.Marshal(normalizedProviders)
		database.DB.Model(&inst).Update("enabled_providers", string(b))
		if err := llmgateway.EnsureKeysForInstance(inst.ID, normalizedProviders); err != nil {
			log.Printf("Failed to ensure LLM gateway keys for instance %d: %s", inst.ID, utils.SanitizeForLog(err.Error()))
		}
	}

	// Update display name (admin only)
	if body.DisplayName != nil {
		user := middleware.GetUser(r)
		if user == nil || user.Role != "admin" {
			writeError(w, http.StatusForbidden, "Only admins can rename instances")
			return
		}
		trimmed := strings.TrimSpace(*body.DisplayName)
		if trimmed == "" {
			writeError(w, http.StatusBadRequest, "Display name cannot be empty")
			return
		}
		database.DB.Model(&inst).Update("display_name", trimmed)
	}

	// Update CPU/memory resources (admin only)
	resourcesChanged := false
	if body.CPURequest != nil || body.CPULimit != nil || body.MemoryRequest != nil || body.MemoryLimit != nil {
		user := middleware.GetUser(r)
		if user == nil || user.Role != "admin" {
			writeError(w, http.StatusForbidden, "Only admins can change resource limits")
			return
		}

		cpuReq := inst.CPURequest
		cpuLim := inst.CPULimit
		memReq := inst.MemoryRequest
		memLim := inst.MemoryLimit

		if body.CPURequest != nil {
			if !cpuRegex.MatchString(*body.CPURequest) {
				writeError(w, http.StatusBadRequest, "Invalid CPU request format (e.g., 500m or 0.5)")
				return
			}
			cpuReq = *body.CPURequest
		}
		if body.CPULimit != nil {
			if !cpuRegex.MatchString(*body.CPULimit) {
				writeError(w, http.StatusBadRequest, "Invalid CPU limit format (e.g., 2000m or 2)")
				return
			}
			cpuLim = *body.CPULimit
		}
		if body.MemoryRequest != nil {
			if !memoryRegex.MatchString(*body.MemoryRequest) {
				writeError(w, http.StatusBadRequest, "Invalid memory request format (e.g., 1Gi or 512Mi)")
				return
			}
			memReq = *body.MemoryRequest
		}
		if body.MemoryLimit != nil {
			if !memoryRegex.MatchString(*body.MemoryLimit) {
				writeError(w, http.StatusBadRequest, "Invalid memory limit format (e.g., 4Gi or 2048Mi)")
				return
			}
			memLim = *body.MemoryLimit
		}

		if cpuToMillicores(cpuReq) > cpuToMillicores(cpuLim) {
			writeError(w, http.StatusBadRequest, "CPU request cannot exceed CPU limit")
			return
		}
		if memoryToBytes(memReq) > memoryToBytes(memLim) {
			writeError(w, http.StatusBadRequest, "Memory request cannot exceed memory limit")
			return
		}

		database.DB.Model(&inst).Updates(map[string]interface{}{
			"cpu_request":    cpuReq,
			"cpu_limit":      cpuLim,
			"memory_request": memReq,
			"memory_limit":   memLim,
		})
		resourcesChanged = true
	}

	// Update VNC resolution (admin only)
	if body.VNCResolution != nil {
		user := middleware.GetUser(r)
		if user == nil || user.Role != "admin" {
			writeError(w, http.StatusForbidden, "Only admins can change VNC resolution")
			return
		}
		if *body.VNCResolution != "" && !resolutionRegex.MatchString(*body.VNCResolution) {
			writeError(w, http.StatusBadRequest, "Invalid resolution format (e.g., 1920x1080)")
			return
		}
		database.DB.Model(&inst).Update("vnc_resolution", *body.VNCResolution)
	}

	// Re-fetch
	database.DB.First(&inst, inst.ID)

	// Push updated config to the running instance
	orch := orchestrator.Get()
	orchStatus := "stopped"
	if orch != nil {
		orchStatus, _ = orch.GetInstanceStatus(r.Context(), inst.Name)
	}

	// Apply resource changes to running container
	if resourcesChanged && orch != nil && orchStatus == "running" {
		if err := orch.UpdateResources(r.Context(), inst.Name, orchestrator.UpdateResourcesParams{
			CPURequest:    inst.CPURequest,
			CPULimit:      inst.CPULimit,
			MemoryRequest: inst.MemoryRequest,
			MemoryLimit:   inst.MemoryLimit,
		}); err != nil {
			log.Printf("Failed to update resources for instance %d: %v", inst.ID, err)
		}
	}
	if orch != nil && orchStatus == "running" {
		models := resolveInstanceModels(inst)
		gatewayProviders := resolveGatewayProviders(inst)
		instID := inst.ID
		instName := inst.Name
		go func() {
			bgCtx := context.Background()
			sshClient, err := SSHMgr.WaitForSSH(bgCtx, instID, 30*time.Second)
			if err != nil {
				log.Printf("Failed to get SSH connection for instance %d during configure: %v", instID, err)
				return
			}
			ConfigureInstance(bgCtx, orch, sshproxy.NewSSHInstance(sshClient, getEffectiveOpenClawUser(inst)), instName, models, gatewayProviders, config.Cfg.LLMGatewayPort)
		}()
	}

	status := resolveStatus(&inst, orchStatus)
	resp := instanceToResponse(inst, status)
	sanitizeInstanceResponseForUser(&resp, middleware.GetUser(r))
	if orch != nil {
		if info, err := orch.GetInstanceImageInfo(r.Context(), inst.Name); err == nil && info != "" {
			resp.LiveImageInfo = &info
		}
	}
	writeJSON(w, http.StatusOK, resp)
}

func GetInstanceStats(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "Invalid instance ID")
		return
	}

	var inst database.Instance
	if err := database.DB.First(&inst, id).Error; err != nil {
		writeError(w, http.StatusNotFound, "Instance not found")
		return
	}

	if !middleware.CanAccessInstance(r, inst.ID) {
		writeError(w, http.StatusForbidden, "Access denied")
		return
	}

	orch := orchestrator.Get()
	if orch == nil {
		writeError(w, http.StatusServiceUnavailable, "No orchestrator available")
		return
	}

	stats, err := orch.GetContainerStats(r.Context(), inst.Name)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "Stats unavailable")
		return
	}

	writeJSON(w, http.StatusOK, stats)
}

func UpdateInstanceImage(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUser(r)
	if user == nil || user.Role != "admin" {
		writeError(w, http.StatusForbidden, "Only admins can update instance images")
		return
	}

	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "Invalid instance ID")
		return
	}

	var inst database.Instance
	if err := database.DB.First(&inst, id).Error; err != nil {
		writeError(w, http.StatusNotFound, "Instance not found")
		return
	}

	if !middleware.CanAccessInstance(r, inst.ID) {
		writeError(w, http.StatusForbidden, "Access denied")
		return
	}

	orch := orchestrator.Get()
	if orch == nil {
		writeError(w, http.StatusServiceUnavailable, "No orchestrator available")
		return
	}

	orchStatus, _ := orch.GetInstanceStatus(r.Context(), inst.Name)
	if orchStatus != "running" {
		writeError(w, http.StatusBadRequest, "Instance must be running to update image")
		return
	}

	effectiveImage := getEffectiveImage(inst)
	if effectiveImage == "" {
		writeError(w, http.StatusBadRequest, "No container image configured")
		return
	}
	if strings.Contains(effectiveImage, "@sha256:") {
		writeError(w, http.StatusBadRequest, "Cannot update a digest-pinned image; use a tag-based image instead")
		return
	}

	// Set status to restarting
	database.DB.Model(&inst).Updates(map[string]interface{}{
		"status":     "restarting",
		"updated_at": time.Now().UTC(),
	})

	// Stop SSH tunnels before update; they will be recreated by the background manager
	if SSHMgr != nil {
		SSHMgr.CancelReconnection(inst.ID)
	}
	if TunnelMgr != nil {
		if err := TunnelMgr.StopTunnelsForInstance(inst.ID); err != nil {
			log.Printf("Failed to stop tunnels for instance %d: %v", inst.ID, err)
		}
	}

	effectiveResolution := getEffectiveResolution(inst)
	effectiveTimezone := getEffectiveTimezone(inst)
	effectiveUserAgent := getEffectiveUserAgent(inst)

	// Decrypt gateway token for env vars
	envVars := map[string]string{}
	if inst.GatewayToken != "" {
		if plain, err := utils.Decrypt(inst.GatewayToken); err == nil {
			envVars["OPENCLAW_GATEWAY_TOKEN"] = plain
		}
	}

	instID := inst.ID
	instName := inst.Name
	go func() {
		ctx := context.Background()
		err := orch.UpdateImage(ctx, instName, orchestrator.CreateParams{
			Name:           instName,
			CPURequest:     inst.CPURequest,
			CPULimit:       inst.CPULimit,
			MemoryRequest:  inst.MemoryRequest,
			MemoryLimit:    inst.MemoryLimit,
			ContainerImage: effectiveImage,
			VNCResolution:  effectiveResolution,
			Timezone:       effectiveTimezone,
			UserAgent:      effectiveUserAgent,
			EnvVars:        envVars,
		})
		if err != nil {
			log.Printf("Failed to update image for instance %d: %v", instID, err)
			database.DB.Model(&database.Instance{}).Where("id = ?", instID).Updates(map[string]interface{}{
				"status":         "error",
				"status_message": fmt.Sprintf("Image update failed: %v", err),
				"updated_at":     time.Now().UTC(),
			})
			return
		}
		log.Printf("Image updated successfully for instance %d", instID)
		contract := resolveImageContract(ctx, orch, effectiveImage)
		persistImageContract(instID, contract)
		database.DB.Model(&database.Instance{}).Where("id = ?", instID).Updates(map[string]interface{}{
			"status":     "running",
			"updated_at": time.Now().UTC(),
		})
	}()

	writeJSON(w, http.StatusAccepted, map[string]string{"status": "restarting"})
}

func DeleteInstance(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "Invalid instance ID")
		return
	}

	var inst database.Instance
	if err := database.DB.First(&inst, id).Error; err != nil {
		writeError(w, http.StatusNotFound, "Instance not found")
		return
	}
	if !middleware.CanAccessInstance(r, inst.ID) {
		writeError(w, http.StatusForbidden, "Access denied")
		return
	}
	if !canManageOwnedInstance(middleware.GetUser(r), inst) {
		writeError(w, http.StatusForbidden, "Only the owner or an admin can delete this instance")
		return
	}

	// Stop SSH tunnels and close connection before deleting
	if SSHMgr != nil {
		SSHMgr.CancelReconnection(inst.ID)
	}
	if TunnelMgr != nil {
		if err := TunnelMgr.StopTunnelsForInstance(inst.ID); err != nil {
			log.Printf("Failed to stop tunnels for instance %d: %v", inst.ID, err)
		}
	}

	if orch := orchestrator.Get(); orch != nil {
		if err := orch.DeleteInstance(r.Context(), inst.Name); err != nil {
			log.Printf("Failed to delete container resources for %s – proceeding with DB cleanup: %v", utils.SanitizeForLog(inst.Name), err)
		}
	}

	// Delete associated API keys and gateway keys
	database.DB.Where("instance_id = ?", inst.ID).Delete(&database.UserInstance{})
	database.DB.Where("instance_id = ?", inst.ID).Delete(&database.InstanceAPIKey{})
	database.DB.Where("instance_id = ?", inst.ID).Delete(&database.LLMGatewayKey{})
	database.DB.Delete(&inst)
	w.WriteHeader(http.StatusNoContent)
}

func StartInstance(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "Invalid instance ID")
		return
	}

	var inst database.Instance
	if err := database.DB.First(&inst, id).Error; err != nil {
		writeError(w, http.StatusNotFound, "Instance not found")
		return
	}

	if !middleware.CanAccessInstance(r, inst.ID) {
		writeError(w, http.StatusForbidden, "Access denied")
		return
	}

	if orch := orchestrator.Get(); orch != nil {
		if err := orch.StartInstance(r.Context(), inst.Name); err != nil {
			writeError(w, http.StatusInternalServerError, fmt.Sprintf("Failed to start instance: %v", err))
			return
		}
	}

	database.DB.Model(&inst).Updates(map[string]interface{}{
		"status":     "running",
		"updated_at": time.Now().UTC(),
	})
	writeJSON(w, http.StatusOK, map[string]string{"status": "running"})
}

func StopInstance(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "Invalid instance ID")
		return
	}

	var inst database.Instance
	if err := database.DB.First(&inst, id).Error; err != nil {
		writeError(w, http.StatusNotFound, "Instance not found")
		return
	}

	if !middleware.CanAccessInstance(r, inst.ID) {
		writeError(w, http.StatusForbidden, "Access denied")
		return
	}

	// Stop SSH tunnels and close connection for this instance
	if SSHMgr != nil {
		SSHMgr.CancelReconnection(inst.ID)
	}
	if TunnelMgr != nil {
		if err := TunnelMgr.StopTunnelsForInstance(inst.ID); err != nil {
			log.Printf("Failed to stop tunnels for instance %d: %v", inst.ID, err)
		}
	}

	if orch := orchestrator.Get(); orch != nil {
		if err := orch.StopInstance(r.Context(), inst.Name); err != nil {
			writeError(w, http.StatusInternalServerError, fmt.Sprintf("Failed to stop instance: %v", err))
			return
		}
	}

	database.DB.Model(&inst).Updates(map[string]interface{}{
		"status":     "stopping",
		"updated_at": time.Now().UTC(),
	})
	writeJSON(w, http.StatusOK, map[string]string{"status": "stopping"})
}

func RestartInstance(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "Invalid instance ID")
		return
	}

	var inst database.Instance
	if err := database.DB.First(&inst, id).Error; err != nil {
		writeError(w, http.StatusNotFound, "Instance not found")
		return
	}

	if !middleware.CanAccessInstance(r, inst.ID) {
		writeError(w, http.StatusForbidden, "Access denied")
		return
	}

	// Stop SSH tunnels and close connection before restart; they will be recreated by the background manager
	if SSHMgr != nil {
		SSHMgr.CancelReconnection(inst.ID)
	}
	if TunnelMgr != nil {
		if err := TunnelMgr.StopTunnelsForInstance(inst.ID); err != nil {
			log.Printf("Failed to stop tunnels for instance %d: %v", inst.ID, err)
		}
	}

	orch := orchestrator.Get()
	if orch != nil {
		if err := orch.RestartInstance(r.Context(), inst.Name); err != nil {
			writeError(w, http.StatusInternalServerError, fmt.Sprintf("Failed to restart instance: %v", err))
			return
		}
	}

	database.DB.Model(&inst).Updates(map[string]interface{}{
		"status":     "restarting",
		"updated_at": time.Now().UTC(),
	})

	if orch != nil {
		instID := inst.ID
		instName := inst.Name
		go func() {
			bgCtx := context.Background()
			deadline := time.Now().Add(2 * time.Minute)
			for time.Now().Before(deadline) {
				status, err := orch.GetInstanceStatus(bgCtx, instName)
				if err == nil && status == "running" {
					if TunnelMgr != nil {
						if err := TunnelMgr.StartTunnelsForInstance(bgCtx, instID, orch); err != nil {
							log.Printf("Restart recovery pending for instance %d: %v", instID, err)
							time.Sleep(2 * time.Second)
							continue
						}
					}
					database.DB.Model(&database.Instance{}).Where("id = ?", instID).Updates(map[string]interface{}{
						"status":     "running",
						"updated_at": time.Now().UTC(),
					})
					return
				}
				time.Sleep(2 * time.Second)
			}
			log.Printf("Restart recovery timed out for instance %d", instID)
		}()
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "restarting"})
}

func GetInstanceConfig(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "Invalid instance ID")
		return
	}

	var inst database.Instance
	if err := database.DB.First(&inst, id).Error; err != nil {
		writeError(w, http.StatusNotFound, "Instance not found")
		return
	}

	if !middleware.CanAccessInstance(r, inst.ID) {
		writeError(w, http.StatusForbidden, "Access denied")
		return
	}

	orch := orchestrator.Get()
	if orch == nil {
		writeError(w, http.StatusServiceUnavailable, "No orchestrator available")
		return
	}

	if SSHMgr == nil {
		writeError(w, http.StatusServiceUnavailable, "SSH manager not initialized")
		return
	}

	client, err := SSHMgr.EnsureConnectedWithIPCheck(r.Context(), inst.ID, orch, inst.AllowedSourceIPs)
	if err != nil {
		log.Printf("Failed to get SSH connection for instance %d: %v", inst.ID, err)
		writeError(w, http.StatusBadGateway, fmt.Sprintf("SSH connection failed: %v", err))
		return
	}

	content, err := sshproxy.ReadFile(client, orchestrator.OpenClawConfigPath(getEffectiveOpenClawHome(inst)))
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "Instance must be running to read config")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"config": string(content)})
}

func UpdateInstanceConfig(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "Invalid instance ID")
		return
	}

	var body struct {
		Config string `json:"config"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	// Validate JSON
	if !json.Valid([]byte(body.Config)) {
		writeError(w, http.StatusBadRequest, "Invalid JSON in config")
		return
	}

	var inst database.Instance
	if err := database.DB.First(&inst, id).Error; err != nil {
		writeError(w, http.StatusNotFound, "Instance not found")
		return
	}

	if !middleware.CanAccessInstance(r, inst.ID) {
		writeError(w, http.StatusForbidden, "Access denied")
		return
	}

	if SSHMgr == nil {
		writeError(w, http.StatusServiceUnavailable, "SSH manager not initialized")
		return
	}

	orch := orchestrator.Get()
	if orch == nil {
		writeError(w, http.StatusServiceUnavailable, "No orchestrator available")
		return
	}

	client, err := SSHMgr.EnsureConnectedWithIPCheck(r.Context(), inst.ID, orch, inst.AllowedSourceIPs)
	if err != nil {
		log.Printf("Failed to get SSH connection for instance %d: %v", inst.ID, err)
		writeError(w, http.StatusBadGateway, fmt.Sprintf("SSH connection failed: %v", err))
		return
	}

	if err := sshproxy.WriteFile(client, orchestrator.OpenClawConfigPath(getEffectiveOpenClawHome(inst)), []byte(body.Config)); err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("Failed to write config: %v", err))
		return
	}

	instanceConn := sshproxy.NewSSHInstance(client, getEffectiveOpenClawUser(inst))
	if _, stderr, code, err := instanceConn.ExecOpenclaw(r.Context(), "gateway", "stop"); err != nil || code != 0 {
		log.Printf("Failed to restart gateway for instance %d: %v %s", inst.ID, err, stderr)
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"config":    body.Config,
		"restarted": true,
	})
}

func RunInstanceDoctor(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "Invalid instance ID")
		return
	}

	var inst database.Instance
	if err := database.DB.First(&inst, id).Error; err != nil {
		writeError(w, http.StatusNotFound, "Instance not found")
		return
	}

	if !middleware.CanAccessInstance(r, inst.ID) {
		writeError(w, http.StatusForbidden, "Access denied")
		return
	}

	var body struct {
		Fix bool `json:"fix"`
	}
	if r.Body != nil {
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil && !errors.Is(err, io.EOF) {
			writeError(w, http.StatusBadRequest, "Invalid request body")
			return
		}
	}

	if body.Fix {
		user := middleware.GetUser(r)
		if user == nil || user.Role != "admin" {
			writeError(w, http.StatusForbidden, "Only admins can apply doctor fixes")
			return
		}
	}

	orch := orchestrator.Get()
	if orch == nil {
		writeError(w, http.StatusServiceUnavailable, "No orchestrator available")
		return
	}

	orchStatus, _ := orch.GetInstanceStatus(r.Context(), inst.Name)
	if orchStatus != "running" {
		writeError(w, http.StatusBadRequest, "Instance must be running to run doctor")
		return
	}

	doctorArgs := []string{"doctor", "--non-interactive"}
	if body.Fix {
		doctorArgs = append(doctorArgs, "--fix")
	}
	commandText := "openclaw " + strings.Join(doctorArgs, " ")
	shellCommand := fmt.Sprintf(
		"export HOME=%s XDG_CONFIG_HOME=%s/.config NO_COLOR=1 TERM=dumb COLUMNS=120; su - %s -c %s",
		sshproxy.ShellQuote(getEffectiveOpenClawHome(inst)),
		sshproxy.ShellQuote(getEffectiveOpenClawHome(inst)),
		sshproxy.ShellQuote(getEffectiveOpenClawUser(inst)),
		sshproxy.ShellQuote(commandText),
	)

	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	stdout, stderr, exitCode, err := orch.ExecInInstance(ctx, inst.Name, []string{"sh", "-lc", shellCommand})
	if err != nil {
		writeError(w, http.StatusBadGateway, fmt.Sprintf("Doctor exec failed: %v", err))
		return
	}

	combined := stdout
	if stderr != "" {
		if combined != "" && !strings.HasSuffix(combined, "\n") {
			combined += "\n"
		}
		combined += stderr
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"command":         commandText,
		"stdout":          stdout,
		"stderr":          stderr,
		"combined_output": combined,
		"exit_code":       exitCode,
		"fix_applied":     body.Fix,
	})
}

func CloneInstance(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "Invalid instance ID")
		return
	}

	var src database.Instance
	if err := database.DB.First(&src, id).Error; err != nil {
		writeError(w, http.StatusNotFound, "Instance not found")
		return
	}
	if !middleware.CanAccessInstance(r, src.ID) {
		writeError(w, http.StatusForbidden, "Access denied")
		return
	}
	user := middleware.GetUser(r)
	if !canManageOwnedInstance(user, src) {
		writeError(w, http.StatusForbidden, "Only the owner or an admin can clone this instance")
		return
	}
	if user != nil && user.Role != "admin" {
		if !canSelfProvision(user) {
			writeError(w, http.StatusForbidden, "Self-service instance creation is disabled for this account")
			return
		}
		if user.MaxInstances > 0 {
			ownedCount, err := database.CountOwnedInstances(user.ID)
			if err != nil {
				writeError(w, http.StatusInternalServerError, "Failed to check instance quota")
				return
			}
			if ownedCount >= int64(user.MaxInstances) {
				writeError(w, http.StatusForbidden, fmt.Sprintf("Instance quota reached (%d/%d)", ownedCount, user.MaxInstances))
				return
			}
		}
	}

	// Generate clone display name and K8s-safe name
	cloneDisplayName := src.DisplayName + " (Copy)"
	cloneName := generateName(cloneDisplayName)

	// Ensure name uniqueness
	var count int64
	database.DB.Model(&database.Instance{}).Where("name = ?", cloneName).Count(&count)
	if count > 0 {
		suffix := hex.EncodeToString(func() []byte { b := make([]byte, 3); rand.Read(b); return b }())
		cloneName = cloneName + "-" + suffix
		if len(cloneName) > 63 {
			cloneName = cloneName[:63]
		}
	}

	// Generate new gateway token
	gatewayTokenPlain := generateToken()
	encGatewayToken, err := utils.Encrypt(gatewayTokenPlain)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to encrypt gateway token")
		return
	}

	// Compute next sort_order
	var maxSortOrder int
	database.DB.Model(&database.Instance{}).Select("COALESCE(MAX(sort_order), 0)").Scan(&maxSortOrder)

	inst := database.Instance{
		Name:            cloneName,
		DisplayName:     cloneDisplayName,
		Status:          "creating",
		OwnerUserID:     src.OwnerUserID,
		CPURequest:      src.CPURequest,
		CPULimit:        src.CPULimit,
		MemoryRequest:   src.MemoryRequest,
		MemoryLimit:     src.MemoryLimit,
		StorageHomebrew: src.StorageHomebrew,
		StorageHome:     src.StorageHome,
		BraveAPIKey:     src.BraveAPIKey,
		ContainerImage:  src.ContainerImage,
		OpenClawUser:    src.OpenClawUser,
		OpenClawHome:    src.OpenClawHome,
		VNCResolution:   src.VNCResolution,
		Timezone:        src.Timezone,
		UserAgent:       src.UserAgent,
		GatewayToken:    encGatewayToken,
		ModelsConfig:    src.ModelsConfig,
		DefaultModel:    src.DefaultModel,
		SortOrder:       maxSortOrder + 1,
	}

	if err := database.DB.Create(&inst).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to create cloned instance")
		return
	}
	if inst.OwnerUserID != nil {
		if err := database.AddUserInstance(*inst.OwnerUserID, inst.ID); err != nil {
			log.Printf("Failed to assign owner %d to cloned instance %d: %v", *inst.OwnerUserID, inst.ID, err)
		}
	}

	// Copy API keys from source instance
	var srcKeys []database.InstanceAPIKey
	database.DB.Where("instance_id = ?", src.ID).Find(&srcKeys)
	for _, k := range srcKeys {
		database.DB.Create(&database.InstanceAPIKey{
			InstanceID: inst.ID,
			KeyName:    k.KeyName,
			KeyValue:   k.KeyValue,
		})
	}

	// Run the full clone operation asynchronously
	go func() {
		ctx := context.Background()
		orch := orchestrator.Get()
		if orch == nil {
			setStatusMessage(inst.ID, "Failed: no orchestrator available")
			database.DB.Model(&inst).Update("status", "error")
			return
		}

		effectiveImage := getEffectiveImage(inst)
		effectiveResolution := getEffectiveResolution(inst)
		effectiveTimezone := getEffectiveTimezone(inst)
		effectiveUserAgent := getEffectiveUserAgent(inst)

		envVars := map[string]string{}
		if gatewayTokenPlain != "" {
			envVars["OPENCLAW_GATEWAY_TOKEN"] = gatewayTokenPlain
		}

		// Create container/deployment with empty volumes
		err := orch.CreateInstance(ctx, orchestrator.CreateParams{
			Name:            cloneName,
			CPURequest:      inst.CPURequest,
			CPULimit:        inst.CPULimit,
			MemoryRequest:   inst.MemoryRequest,
			MemoryLimit:     inst.MemoryLimit,
			StorageHomebrew: inst.StorageHomebrew,
			StorageHome:     inst.StorageHome,
			ContainerImage:  effectiveImage,
			VNCResolution:   effectiveResolution,
			Timezone:        effectiveTimezone,
			UserAgent:       effectiveUserAgent,
			EnvVars:         envVars,
			OnProgress:      func(msg string) { setStatusMessage(inst.ID, msg) },
		})
		if err != nil {
			log.Printf("Failed to create container for clone %s: %v", cloneName, err)
			setStatusMessage(inst.ID, fmt.Sprintf("Failed: %v", err))
			database.DB.Model(&inst).Update("status", "error")
			return
		}

		// Clone volume data from source
		setStatusMessage(inst.ID, "Cloning volumes...")
		if err := orch.CloneVolumes(ctx, src.Name, cloneName); err != nil {
			log.Printf("Failed to clone volumes from %s to %s: %v", src.Name, cloneName, err)
			// Continue anyway – instance is created, just without cloned data
		}

		clearStatusMessage(inst.ID)
		database.DB.Model(&inst).Updates(map[string]interface{}{
			"status":     "running",
			"updated_at": time.Now().UTC(),
		})

		// Push models and API keys to the running instance
		// Re-fetch to get latest state
		database.DB.First(&inst, inst.ID)
		// Don't carry over gateway keys from source — the clone gets its own instance ID
		models := resolveInstanceModels(inst)
		sshClient, err := SSHMgr.WaitForSSH(ctx, inst.ID, 120*time.Second)
		if err != nil {
			log.Printf("Failed to get SSH connection for clone %d during configure: %v", inst.ID, err)
			return
		}
		ConfigureInstance(ctx, orch, sshproxy.NewSSHInstance(sshClient, getEffectiveOpenClawUser(inst)), cloneName, models, nil, config.Cfg.LLMGatewayPort)
	}()

	resp := instanceToResponse(inst, "creating")
	sanitizeInstanceResponseForUser(&resp, middleware.GetUser(r))
	writeJSON(w, http.StatusCreated, resp)
}

func ReorderInstances(w http.ResponseWriter, r *http.Request) {
	var body struct {
		OrderedIDs []uint `json:"ordered_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	if len(body.OrderedIDs) == 0 {
		writeError(w, http.StatusBadRequest, "ordered_ids is required")
		return
	}

	tx := database.DB.Begin()
	for i, id := range body.OrderedIDs {
		if err := tx.Model(&database.Instance{}).Where("id = ?", id).Update("sort_order", i+1).Error; err != nil {
			tx.Rollback()
			writeError(w, http.StatusInternalServerError, "Failed to reorder instances")
			return
		}
	}
	tx.Commit()
	w.WriteHeader(http.StatusNoContent)
}

// ConfigureInstance sets the model configuration and gateway providers on a running instance
// via openclaw CLI over SSH through inst.
//
// gatewayProviders (optional) maps provider key → gateway auth key for configuring
// models.providers in OpenClaw to route through the internal LLM gateway.
// gatewayPort is the port the LLM gateway listens on (typically 40001).
func ConfigureInstance(ctx context.Context, ops orchestrator.ContainerOrchestrator, inst sshproxy.Instance, name string, models []string, gatewayProviders map[string]GatewayProvider, gatewayPort int) {
	if len(models) == 0 && len(gatewayProviders) == 0 {
		return
	}

	// Wait for instance to become running
	if !waitForRunning(ctx, ops, name, 120*time.Second) {
		log.Printf("Timed out waiting for %s to start; models not configured", utils.SanitizeForLog(name))
		return
	}

	// Set model config via openclaw config set
	if len(models) > 0 {
		modelConfig := map[string]interface{}{
			"primary": models[0],
		}
		if len(models) > 1 {
			modelConfig["fallbacks"] = models[1:]
		} else {
			modelConfig["fallbacks"] = []string{}
		}
		modelJSON, err := json.Marshal(modelConfig)
		if err != nil {
			log.Printf("Error marshaling model config for %s: %v", utils.SanitizeForLog(name), err)
			return
		}
		_, stderr, code, err := inst.ExecOpenclaw(ctx, "config", "set", "agents.defaults.model", string(modelJSON), "--json")
		if err != nil {
			log.Printf("Error setting model config for %s: %v", utils.SanitizeForLog(name), err)
			return
		}
		if code != 0 {
			log.Printf("Failed to set model config for %s: %s", utils.SanitizeForLog(name), utils.SanitizeForLog(stderr))
			// continue — providers must still be configured even if model config failed
		}
	}

	// Set gateway providers via openclaw CLI.
	if len(gatewayProviders) > 0 && gatewayPort > 0 {
		type providerCfg struct {
			BaseURL string                   `json:"baseUrl"`
			API     string                   `json:"api"`
			APIKey  string                   `json:"apiKey"`
			Models  []database.ProviderModel `json:"models"`
		}
		// Build lookup set of effective model IDs in "providerKey/modelId" format.
		// Used to filter catalog providers to only selected models.
		effectiveSet := make(map[string]struct{}, len(models))
		for _, m := range models {
			effectiveSet[m] = struct{}{}
		}

		providers := make(map[string]providerCfg, len(gatewayProviders))
		for providerKey, gp := range gatewayProviders {
			apiType := gp.APIType
			if apiType == "" {
				apiType = "openai-completions"
			}
			var gpModels []database.ProviderModel
			if gp.CatalogKey != "" {
				// Catalog provider: filter to only the models the user selected.
				// Use cached models if available, otherwise fetch from catalog.
				var allModels []database.ProviderModel
				if len(gp.Models) > 0 {
					allModels = gp.Models
				} else {
					allModels = getCatalogModels(gp.CatalogKey)
				}
				for _, m := range allModels {
					if _, ok := effectiveSet[providerKey+"/"+m.ID]; ok {
						gpModels = append(gpModels, m)
					}
				}
			} else if len(gp.Models) > 0 {
				// Custom provider: all models are enabled as a unit.
				gpModels = gp.Models
			}
			if gpModels == nil {
				gpModels = []database.ProviderModel{}
			}
			providers[providerKey] = providerCfg{
				BaseURL: fmt.Sprintf("http://127.0.0.1:%d", gatewayPort),
				API:     apiType,
				APIKey:  gp.Key,
				Models:  gpModels,
			}
		}
		providersJSON, err := json.Marshal(providers)
		if err != nil {
			log.Printf("Error marshaling gateway providers for %s: %v", utils.SanitizeForLog(name), err)
		} else {
			stdout, stderr, code, err := inst.ExecOpenclaw(ctx, "config", "set", "models.providers", string(providersJSON), "--json")
			if err != nil {
				log.Printf("Error setting gateway providers for %s: %v", utils.SanitizeForLog(name), err)
			} else if code != 0 {
				log.Printf("Failed to set gateway providers for %s: stdout=%q stderr=%q",
					utils.SanitizeForLog(name), utils.SanitizeForLog(stdout), utils.SanitizeForLog(stderr))
			}
		}
	}

	// Restart gateway so it picks up new env vars and config
	stdout, stderr, code, err := inst.ExecOpenclaw(ctx, "gateway", "stop")
	if err != nil {
		log.Printf("Error restarting gateway for %s: %v", utils.SanitizeForLog(name), err)
		return
	}
	if code != 0 {
		log.Printf("Failed to restart gateway for %s: stdout=%q stderr=%q", utils.SanitizeForLog(name), utils.SanitizeForLog(stdout), utils.SanitizeForLog(stderr))
		return
	}
	log.Printf("Models and providers configured for %s", utils.SanitizeForLog(name))
}

func waitForRunning(ctx context.Context, ops orchestrator.ContainerOrchestrator, name string, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		status, err := ops.GetInstanceStatus(ctx, name)
		if err == nil && status == "running" {
			return true
		}
		select {
		case <-ctx.Done():
			return false
		case <-time.After(2 * time.Second):
		}
	}
	return false
}
