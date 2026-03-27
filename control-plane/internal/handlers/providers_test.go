package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/gluk-w/claworc/control-plane/internal/database"
	"github.com/go-chi/chi/v5"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func setupProviderTestDB(t *testing.T) {
	t.Helper()

	var err error
	database.DB, err = gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	if err := database.DB.AutoMigrate(
		&database.Instance{},
		&database.Setting{},
		&database.LLMProvider{},
		&database.LLMGatewayKey{},
	); err != nil {
		t.Fatalf("auto-migrate test db: %v", err)
	}
}

func withCatalogTestServer(t *testing.T, rootBody string, fn func()) {
	t.Helper()

	origBaseURL := catalogBaseURL
	origHTTPClient := catalogHTTPClient
	catalogCacheMu.Lock()
	origCache := catalogCache
	catalogCache = map[string]*catalogCacheEntry{}
	catalogCacheMu.Unlock()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if _, err := w.Write([]byte(rootBody)); err != nil {
			t.Fatalf("write catalog response: %v", err)
		}
	}))
	defer server.Close()

	catalogBaseURL = server.URL
	catalogHTTPClient = server.Client()

	t.Cleanup(func() {
		catalogBaseURL = origBaseURL
		catalogHTTPClient = origHTTPClient
		catalogCacheMu.Lock()
		catalogCache = origCache
		catalogCacheMu.Unlock()
	})

	fn()
}

func providerByID(t *testing.T, id uint) database.LLMProvider {
	t.Helper()
	var provider database.LLMProvider
	if err := database.DB.First(&provider, id).Error; err != nil {
		t.Fatalf("load provider %d: %v", id, err)
	}
	return provider
}

func findModelByID(t *testing.T, models []database.ProviderModel, id string) database.ProviderModel {
	t.Helper()
	for _, model := range models {
		if model.ID == id {
			return model
		}
	}
	t.Fatalf("model %q not found in %#v", id, models)
	return database.ProviderModel{}
}

func TestMergeCatalogEntries_LocalGeminiOverrideWins(t *testing.T) {
	merged := mergeCatalogEntries([]catalogRootEntry{
		{
			Name:      "gemini",
			Label:     "Gemini",
			APIFormat: "google-generative-ai",
			BaseURL:   "https://wrong.example/v1beta",
			Models: []catalogRootModel{
				{
					ModelID:    "gemini-3-flash-preview",
					ModelName:  "Gemini 3 Flash Preview",
					InputCost:  0,
					OutputCost: 0,
				},
			},
		},
	})

	if len(merged) == 0 {
		t.Fatal("expected merged catalog entries")
	}

	var gemini catalogRootEntry
	found := false
	for _, entry := range merged {
		if entry.Name == "gemini" {
			gemini = entry
			found = true
			break
		}
	}
	if !found {
		t.Fatal("merged catalog does not contain gemini")
	}
	if gemini.BaseURL != "https://generativelanguage.googleapis.com/v1beta" {
		t.Fatalf("gemini base URL = %q, want official Google endpoint", gemini.BaseURL)
	}
	model := catalogModelToProviderModel(gemini.Models[0])
	if model.Cost == nil || model.Cost.Input != 0.50 || model.Cost.Output != 3.00 {
		t.Fatalf("gemini local override cost = %#v, want 0.50/3.00", model.Cost)
	}
}

func TestSyncProviderModels_AdoptsLegacyGeminiCatalogProvider(t *testing.T) {
	setupProviderTestDB(t)

	legacyModels, err := json.Marshal([]database.ProviderModel{
		{
			ID:   "gemini-3-flash-preview",
			Name: "Gemini 3 Flash Preview",
			Cost: &database.ProviderModelCost{},
		},
	})
	if err != nil {
		t.Fatalf("marshal legacy models: %v", err)
	}

	provider := database.LLMProvider{
		Key:      "gemini",
		Provider: "",
		Name:     "Gemini",
		BaseURL:  "https://generativelanguage.googleapis.com/v1beta",
		APIType:  "google-generative-ai",
		Models:   string(legacyModels),
	}
	if err := database.DB.Create(&provider).Error; err != nil {
		t.Fatalf("create provider: %v", err)
	}

	withCatalogTestServer(t, "[]", func() {
		req := httptest.NewRequest(http.MethodPost, "/providers/1/sync-models", nil)
		rctx := chi.NewRouteContext()
		rctx.URLParams.Add("id", strconv.Itoa(int(provider.ID)))
		req = req.WithContext(contextWithRoute(req, rctx))

		w := httptest.NewRecorder()
		SyncProviderModels(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("sync provider status = %d, body = %s", w.Code, w.Body.String())
		}
	})

	updated := providerByID(t, provider.ID)
	if updated.Provider != "gemini" {
		t.Fatalf("provider.catalog = %q, want gemini", updated.Provider)
	}
	models := database.ParseProviderModels(updated.Models)
	if len(models) != 2 {
		t.Fatalf("expected 2 gemini models after sync, got %d", len(models))
	}
	flash := findModelByID(t, models, "gemini-3-flash-preview")
	if flash.Cost == nil || flash.Cost.Input != 0.50 || flash.Cost.Output != 3.00 || flash.Cost.CacheRead != 0.05 {
		t.Fatalf("gemini-3-flash-preview cost = %#v, want official pricing", flash.Cost)
	}
}

func TestSyncAllProviderModels_AdoptsLegacyGeminiCatalogProvider(t *testing.T) {
	setupProviderTestDB(t)

	provider := database.LLMProvider{
		Key:      "gemini",
		Provider: "",
		Name:     "Gemini",
		BaseURL:  "https://generativelanguage.googleapis.com/v1beta",
		APIType:  "google-generative-ai",
		Models:   "[]",
	}
	if err := database.DB.Create(&provider).Error; err != nil {
		t.Fatalf("create provider: %v", err)
	}

	withCatalogTestServer(t, "[]", func() {
		req := httptest.NewRequest(http.MethodPost, "/providers/sync-all-models", nil)
		w := httptest.NewRecorder()
		SyncAllProviderModels(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("sync all status = %d, body = %s", w.Code, w.Body.String())
		}
	})

	updated := providerByID(t, provider.ID)
	if updated.Provider != "gemini" {
		t.Fatalf("provider.catalog = %q, want gemini", updated.Provider)
	}
	models := database.ParseProviderModels(updated.Models)
	flash25 := findModelByID(t, models, "gemini-2.5-flash")
	if flash25.Cost == nil || flash25.Cost.Input != 0.30 || flash25.Cost.Output != 2.50 || flash25.Cost.CacheRead != 0.03 {
		t.Fatalf("gemini-2.5-flash cost = %#v, want official pricing", flash25.Cost)
	}
}

func contextWithRoute(req *http.Request, rctx *chi.Context) context.Context {
	return context.WithValue(req.Context(), chi.RouteCtxKey, rctx)
}
