package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/gluk-w/claworc/control-plane/internal/blueprints"
	"github.com/gluk-w/claworc/control-plane/internal/database"
	"github.com/gluk-w/claworc/control-plane/internal/featurepacks"
	"github.com/gluk-w/claworc/control-plane/internal/middleware"
	"github.com/gluk-w/claworc/control-plane/internal/orchestrator"
	"github.com/go-chi/chi/v5"
)

type captureBlueprintRequest struct {
	Name    string `json:"name"`
	Summary string `json:"summary"`
	Slug    string `json:"slug"`
}

func ListBlueprints(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUser(r)
	if user == nil {
		writeError(w, http.StatusUnauthorized, "Authentication required")
		return
	}
	if user.Role != "admin" {
		writeError(w, http.StatusForbidden, "Only admins can manage blueprints")
		return
	}

	items, err := blueprints.List()
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("Failed to list blueprints: %v", err))
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"blueprints": items,
	})
}

func CaptureInstanceBlueprint(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUser(r)
	if user == nil {
		writeError(w, http.StatusUnauthorized, "Authentication required")
		return
	}
	if user.Role != "admin" {
		writeError(w, http.StatusForbidden, "Only admins can manage blueprints")
		return
	}

	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "Invalid instance ID")
		return
	}

	var body captureBlueprintRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	if strings.TrimSpace(body.Name) == "" {
		writeError(w, http.StatusBadRequest, "Blueprint name is required")
		return
	}

	var inst database.Instance
	if err := database.DB.First(&inst, id).Error; err != nil {
		writeError(w, http.StatusNotFound, "Instance not found")
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
		log.Printf("Failed to get SSH connection for instance %d while capturing blueprint: %v", inst.ID, err)
		writeError(w, http.StatusBadGateway, fmt.Sprintf("SSH connection failed: %v", err))
		return
	}

	item, err := blueprints.Capture(featurepacks.NewRuntime(client, inst), body.Slug, body.Name, body.Summary)
	if err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("Failed to capture blueprint: %v", err))
		return
	}

	writeJSON(w, http.StatusOK, item)
}

func ApplyInstanceBlueprint(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUser(r)
	if user == nil {
		writeError(w, http.StatusUnauthorized, "Authentication required")
		return
	}
	if user.Role != "admin" {
		writeError(w, http.StatusForbidden, "Only admins can manage blueprints")
		return
	}

	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "Invalid instance ID")
		return
	}
	slug := strings.TrimSpace(chi.URLParam(r, "slug"))
	if slug == "" {
		writeError(w, http.StatusBadRequest, "Blueprint slug is required")
		return
	}

	var inst database.Instance
	if err := database.DB.First(&inst, id).Error; err != nil {
		writeError(w, http.StatusNotFound, "Instance not found")
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
		log.Printf("Failed to get SSH connection for instance %d while applying blueprint %s: %v", inst.ID, slug, err)
		writeError(w, http.StatusBadGateway, fmt.Sprintf("SSH connection failed: %v", err))
		return
	}

	result, err := blueprints.Apply(r.Context(), featurepacks.NewRuntime(client, inst), slug)
	if err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("Failed to apply blueprint: %v", err))
		return
	}

	writeJSON(w, http.StatusOK, result)
}
