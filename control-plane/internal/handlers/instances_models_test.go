package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/gluk-w/claworc/control-plane/internal/database"
	"github.com/gluk-w/claworc/control-plane/internal/middleware"
	"github.com/go-chi/chi/v5"
)

func buildJSONRequest(t *testing.T, method, url string, body any, user *database.User, chiParams map[string]string) *http.Request {
	t.Helper()

	payload, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal request body: %v", err)
	}

	req := httptest.NewRequest(method, url, bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")

	rctx := chi.NewRouteContext()
	for k, v := range chiParams {
		rctx.URLParams.Add(k, v)
	}
	ctx := context.WithValue(req.Context(), chi.RouteCtxKey, rctx)
	if user != nil {
		ctx = middleware.WithUser(ctx, user)
	}
	return req.WithContext(ctx)
}

func TestUpdateInstance_AutoEnablesProvidersRequiredByModels(t *testing.T) {
	setupTestDB(t)
	if err := database.DB.AutoMigrate(&database.LLMProvider{}, &database.LLMGatewayKey{}); err != nil {
		t.Fatalf("auto-migrate provider tables: %v", err)
	}

	user := createTestUser(t, "user")
	openai := database.LLMProvider{Key: "openai", Name: "OpenAI", APIType: "openai-completions"}
	gemini := database.LLMProvider{Key: "gemini", Name: "Gemini", APIType: "google-generative-ai"}
	if err := database.DB.Create(&openai).Error; err != nil {
		t.Fatalf("create openai provider: %v", err)
	}
	if err := database.DB.Create(&gemini).Error; err != nil {
		t.Fatalf("create gemini provider: %v", err)
	}

	initialProviders, _ := json.Marshal([]uint{gemini.ID})
	inst := database.Instance{
		Name:             "bot-model-sync",
		DisplayName:      "Model Sync",
		Status:           "running",
		OwnerUserID:      &user.ID,
		ModelsConfig:     `{"disabled":[],"extra":["gemini/gemini-3-flash-preview"]}`,
		DefaultModel:     "gemini/gemini-3-flash-preview",
		EnabledProviders: string(initialProviders),
	}
	if err := database.DB.Create(&inst).Error; err != nil {
		t.Fatalf("create instance: %v", err)
	}

	body := map[string]any{
		"models": map[string]any{
			"disabled": []string{},
			"extra":    []string{"gemini/gemini-3-flash-preview", "openai/gpt-5.2"},
		},
		"default_model": "openai/gpt-5.2",
	}
	req := buildJSONRequest(
		t,
		http.MethodPut,
		"/api/v1/instances/"+strconv.Itoa(int(inst.ID)),
		body,
		user,
		map[string]string{"id": strconv.Itoa(int(inst.ID))},
	)
	w := httptest.NewRecorder()

	UpdateInstance(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d (body: %s)", w.Code, w.Body.String())
	}

	var updated database.Instance
	if err := database.DB.First(&updated, inst.ID).Error; err != nil {
		t.Fatalf("reload instance: %v", err)
	}

	enabled := parseEnabledProviders(updated.EnabledProviders)
	if len(enabled) != 2 {
		t.Fatalf("enabled providers = %v, want both gemini and openai", enabled)
	}

	enabledSet := map[uint]bool{}
	for _, id := range enabled {
		enabledSet[id] = true
	}
	if !enabledSet[openai.ID] || !enabledSet[gemini.ID] {
		t.Fatalf("enabled providers = %v, want openai=%d and gemini=%d", enabled, openai.ID, gemini.ID)
	}

	var keys []database.LLMGatewayKey
	if err := database.DB.Where("instance_id = ?", inst.ID).Find(&keys).Error; err != nil {
		t.Fatalf("load gateway keys: %v", err)
	}
	if len(keys) != 2 {
		t.Fatalf("gateway keys = %d, want 2", len(keys))
	}
}
