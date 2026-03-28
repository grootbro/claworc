package handlers

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gluk-w/claworc/control-plane/internal/database"
	"github.com/gluk-w/claworc/control-plane/internal/middleware"
	"github.com/gluk-w/claworc/control-plane/internal/orchestrator"
	"github.com/go-chi/chi/v5"
)

func buildDoctorRequest(t *testing.T, user *database.User, id uint, body string) *http.Request {
	t.Helper()

	req := httptest.NewRequest("POST", fmt.Sprintf("/api/v1/instances/%d/doctor", id), strings.NewReader(body))
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", fmt.Sprintf("%d", id))
	ctx := context.WithValue(req.Context(), chi.RouteCtxKey, rctx)
	if user != nil {
		ctx = middleware.WithUser(ctx, user)
	}
	return req.WithContext(ctx)
}

func TestRunInstanceDoctor_Success(t *testing.T) {
	setupTestDB(t)

	mock := &mockOrchestrator{
		execStdout: "doctor stdout",
		execStderr: "doctor stderr",
		execCode:   7,
	}
	orchestrator.Set(mock)
	defer orchestrator.Set(nil)

	inst := createTestInstance(t, "bot-doctor", "Doctor Test")
	user := createTestUser(t, "admin")

	req := buildDoctorRequest(t, user, inst.ID, "{}")
	w := httptest.NewRecorder()

	RunInstanceDoctor(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d (body: %s)", w.Code, w.Body.String())
	}

	result := parseResponse(t, w)
	if result["command"] != "openclaw doctor --non-interactive" {
		t.Fatalf("unexpected command: %v", result["command"])
	}
	if result["stdout"] != "doctor stdout" {
		t.Fatalf("unexpected stdout: %v", result["stdout"])
	}
	if result["stderr"] != "doctor stderr" {
		t.Fatalf("unexpected stderr: %v", result["stderr"])
	}
	if result["combined_output"] != "doctor stdout\ndoctor stderr" {
		t.Fatalf("unexpected combined_output: %v", result["combined_output"])
	}
	if result["fix_applied"] != false {
		t.Fatalf("expected fix_applied=false, got %v", result["fix_applied"])
	}
	if code, ok := result["exit_code"].(float64); !ok || int(code) != 7 {
		t.Fatalf("unexpected exit_code: %v", result["exit_code"])
	}
	if mock.lastExecName != inst.Name {
		t.Fatalf("expected exec in %s, got %s", inst.Name, mock.lastExecName)
	}
	if len(mock.lastExecCmd) != 3 {
		t.Fatalf("unexpected exec cmd length: %v", mock.lastExecCmd)
	}
	if got := strings.Join(mock.lastExecCmd, " "); !strings.Contains(got, "HOME=/home/claworc") || !strings.Contains(got, "XDG_CONFIG_HOME=/home/claworc/.config") {
		t.Fatalf("expected HOME/XDG_CONFIG_HOME in exec cmd, got %q", got)
	}
	if got := strings.Join(mock.lastExecCmd, " "); !strings.Contains(got, "openclaw doctor --non-interactive") {
		t.Fatalf("expected doctor command in exec cmd, got %q", got)
	}
}

func TestRunInstanceDoctor_FixRequiresAdmin(t *testing.T) {
	setupTestDB(t)

	mock := &mockOrchestrator{}
	orchestrator.Set(mock)
	defer orchestrator.Set(nil)

	inst := createTestInstance(t, "bot-doctor", "Doctor Test")
	user := createTestUser(t, "user")

	req := buildDoctorRequest(t, user, inst.ID, `{"fix":true}`)
	w := httptest.NewRecorder()

	RunInstanceDoctor(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected status 403, got %d (body: %s)", w.Code, w.Body.String())
	}
	if len(mock.lastExecCmd) != 0 {
		t.Fatalf("expected no exec when fix is forbidden, got %v", mock.lastExecCmd)
	}
}
