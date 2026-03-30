package blueprints

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/gluk-w/claworc/control-plane/internal/config"
	"github.com/gluk-w/claworc/control-plane/internal/featurepacks"
)

type PackBinding struct {
	Slug   string            `json:"slug"`
	Inputs map[string]string `json:"inputs,omitempty"`
}

type Blueprint struct {
	Slug               string        `json:"slug"`
	Name               string        `json:"name"`
	Summary            string        `json:"summary,omitempty"`
	Version            string        `json:"version"`
	SourceInstanceID   *uint         `json:"source_instance_id,omitempty"`
	SourceInstanceName string        `json:"source_instance_name,omitempty"`
	CreatedAt          string        `json:"created_at"`
	UpdatedAt          string        `json:"updated_at"`
	Packs              []PackBinding `json:"packs"`
}

type PackStatus struct {
	Slug                 string            `json:"slug"`
	Name                 string            `json:"name"`
	Summary              string            `json:"summary"`
	Category             string            `json:"category"`
	Inputs               map[string]string `json:"inputs,omitempty"`
	RequiresSecretInputs bool              `json:"requires_secret_inputs"`
}

type Status struct {
	Slug               string       `json:"slug"`
	Name               string       `json:"name"`
	Summary            string       `json:"summary,omitempty"`
	Version            string       `json:"version"`
	SourceInstanceID   *uint        `json:"source_instance_id,omitempty"`
	SourceInstanceName string       `json:"source_instance_name,omitempty"`
	PackCount          int          `json:"pack_count"`
	RequiresSecrets    bool         `json:"requires_secrets"`
	CreatedAt          string       `json:"created_at"`
	UpdatedAt          string       `json:"updated_at"`
	Packs              []PackStatus `json:"packs"`
}

type ApplyResult struct {
	Slug         string                     `json:"slug"`
	Name         string                     `json:"name"`
	AppliedAt    string                     `json:"applied_at"`
	AppliedPacks int                        `json:"applied_packs"`
	Restarted    bool                       `json:"restarted"`
	PackResults  []featurepacks.ApplyResult `json:"pack_results"`
	Notes        []string                   `json:"notes,omitempty"`
}

func storageDir() string {
	return filepath.Join(config.Cfg.DataPath, "blueprints")
}

func ensureStorageDir() error {
	return os.MkdirAll(storageDir(), 0o755)
}

func filePath(slug string) string {
	return filepath.Join(storageDir(), slug+".json")
}

func List() ([]Status, error) {
	if err := ensureStorageDir(); err != nil {
		return nil, err
	}

	entries, err := os.ReadDir(storageDir())
	if err != nil {
		return nil, err
	}

	statuses := make([]Status, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		bp, err := read(entry.Name())
		if err != nil {
			return nil, err
		}
		statuses = append(statuses, toStatus(bp))
	}

	sort.Slice(statuses, func(i, j int) bool {
		return statuses[i].Name < statuses[j].Name
	})
	return statuses, nil
}

func Get(slug string) (*Blueprint, error) {
	bp, err := read(slug + ".json")
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	return bp, nil
}

func Save(bp Blueprint) (*Blueprint, error) {
	if err := ensureStorageDir(); err != nil {
		return nil, err
	}

	bp.Slug = slugify(bp.Slug, bp.Name)
	if bp.Slug == "" {
		return nil, fmt.Errorf("blueprint slug is required")
	}
	if strings.TrimSpace(bp.Name) == "" {
		return nil, fmt.Errorf("blueprint name is required")
	}
	if len(bp.Packs) == 0 {
		return nil, fmt.Errorf("blueprint must contain at least one feature pack")
	}
	if strings.TrimSpace(bp.Version) == "" {
		bp.Version = "1"
	}

	now := time.Now().UTC().Format(time.RFC3339)
	if existing, err := Get(bp.Slug); err == nil && existing != nil {
		bp.CreatedAt = existing.CreatedAt
	} else if bp.CreatedAt == "" {
		bp.CreatedAt = now
	}
	bp.UpdatedAt = now

	raw, err := json.MarshalIndent(bp, "", "  ")
	if err != nil {
		return nil, err
	}
	raw = append(raw, '\n')

	if err := os.WriteFile(filePath(bp.Slug), raw, 0o644); err != nil {
		return nil, err
	}

	return &bp, nil
}

func Capture(rt *featurepacks.Runtime, slug, name, summary string) (*Blueprint, error) {
	statuses, err := featurepacks.ListStatuses(rt)
	if err != nil {
		return nil, err
	}

	packs := make([]PackBinding, 0, len(statuses))
	for _, status := range statuses {
		if !status.Applied {
			continue
		}
		packs = append(packs, PackBinding{
			Slug:   status.Slug,
			Inputs: copyInputs(status.CurrentInputs),
		})
	}
	if len(packs) == 0 {
		return nil, fmt.Errorf("this bot does not have any active feature packs to capture yet")
	}

	instanceID := rt.Instance.ID
	return Save(Blueprint{
		Slug:               slug,
		Name:               name,
		Summary:            summary,
		Version:            "1",
		SourceInstanceID:   &instanceID,
		SourceInstanceName: rt.Instance.DisplayName,
		Packs:              packs,
	})
}

func Apply(ctx context.Context, rt *featurepacks.Runtime, slug string) (*ApplyResult, error) {
	bp, err := Get(slug)
	if err != nil {
		return nil, err
	}
	if bp == nil {
		return nil, fmt.Errorf("blueprint not found")
	}

	results := make([]featurepacks.ApplyResult, 0, len(bp.Packs))
	restarted := false
	notes := []string{}
	requiresSecrets := false

	for _, binding := range bp.Packs {
		def, ok := featurepacks.Get(binding.Slug)
		if !ok {
			return nil, fmt.Errorf("feature pack %q is no longer available", binding.Slug)
		}
		if bindingRequiresSecrets(def, binding.Inputs) {
			requiresSecrets = true
		}

		result, err := featurepacks.Apply(ctx, rt, binding.Slug, binding.Inputs)
		if err != nil {
			return nil, fmt.Errorf("apply %s: %w", binding.Slug, err)
		}
		results = append(results, *result)
		if result.Restarted {
			restarted = true
		}
	}

	if requiresSecrets {
		notes = append(notes, "Blueprint secrets stay masked. Re-enter bot-specific tokens after apply if this target does not already have them.")
	}

	return &ApplyResult{
		Slug:         bp.Slug,
		Name:         bp.Name,
		AppliedAt:    time.Now().UTC().Format(time.RFC3339),
		AppliedPacks: len(results),
		Restarted:    restarted,
		PackResults:  results,
		Notes:        notes,
	}, nil
}

func read(name string) (*Blueprint, error) {
	raw, err := os.ReadFile(filepath.Join(storageDir(), name))
	if err != nil {
		return nil, err
	}
	var bp Blueprint
	if err := json.Unmarshal(raw, &bp); err != nil {
		return nil, err
	}
	return &bp, nil
}

func toStatus(bp *Blueprint) Status {
	packs := make([]PackStatus, 0, len(bp.Packs))
	requiresSecrets := false
	for _, binding := range bp.Packs {
		def, ok := featurepacks.Get(binding.Slug)
		pack := PackStatus{
			Slug:   binding.Slug,
			Inputs: copyInputs(binding.Inputs),
		}
		if ok {
			pack.Name = def.Name
			pack.Summary = def.Summary
			pack.Category = def.Category
			pack.RequiresSecretInputs = bindingRequiresSecrets(def, binding.Inputs)
		}
		requiresSecrets = requiresSecrets || pack.RequiresSecretInputs
		packs = append(packs, pack)
	}

	return Status{
		Slug:               bp.Slug,
		Name:               bp.Name,
		Summary:            bp.Summary,
		Version:            bp.Version,
		SourceInstanceID:   bp.SourceInstanceID,
		SourceInstanceName: bp.SourceInstanceName,
		PackCount:          len(packs),
		RequiresSecrets:    requiresSecrets,
		CreatedAt:          bp.CreatedAt,
		UpdatedAt:          bp.UpdatedAt,
		Packs:              packs,
	}
}

func bindingRequiresSecrets(def featurepacks.Definition, inputs map[string]string) bool {
	for _, input := range def.Inputs {
		if input.Type != featurepacks.InputTypeSecret {
			continue
		}
		if featurepacks.IsConfiguredSecretValue(inputs[input.Key]) {
			return true
		}
	}
	return false
}

func copyInputs(src map[string]string) map[string]string {
	if len(src) == 0 {
		return map[string]string{}
	}
	dst := make(map[string]string, len(src))
	for key, value := range src {
		dst[key] = value
	}
	return dst
}

func slugify(explicit, fallback string) string {
	raw := strings.TrimSpace(explicit)
	if raw == "" {
		raw = strings.TrimSpace(fallback)
	}
	raw = strings.ToLower(raw)
	var b strings.Builder
	lastDash := false
	for _, r := range raw {
		isLetter := r >= 'a' && r <= 'z'
		isNumber := r >= '0' && r <= '9'
		if isLetter || isNumber {
			b.WriteRune(r)
			lastDash = false
			continue
		}
		if lastDash {
			continue
		}
		b.WriteRune('-')
		lastDash = true
	}
	slug := strings.Trim(b.String(), "-")
	return slug
}
