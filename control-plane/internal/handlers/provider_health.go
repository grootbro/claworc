package handlers

import (
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gluk-w/claworc/control-plane/internal/database"
	"github.com/gluk-w/claworc/control-plane/internal/middleware"
	"github.com/go-chi/chi/v5"
)

type providerHealthItem struct {
	ProviderID       uint    `json:"provider_id"`
	ProviderKey      string  `json:"provider_key"`
	ProviderName     string  `json:"provider_name"`
	ModelID          string  `json:"model_id"`
	Health           string  `json:"health"`
	TotalRequests    int     `json:"total_requests"`
	SuccessRequests  int     `json:"success_requests"`
	ErrorRequests    int     `json:"error_requests"`
	TimeoutRequests  int     `json:"timeout_requests"`
	AvgLatencyMs     int64   `json:"avg_latency_ms"`
	P95LatencyMs     int64   `json:"p95_latency_ms"`
	LastStatusCode   int     `json:"last_status_code"`
	LastErrorMessage string  `json:"last_error_message,omitempty"`
	LastRequestedAt  string  `json:"last_requested_at"`
	LastCostUSD      float64 `json:"last_cost_usd"`
}

type providerHealthSummary struct {
	TotalRequests     int `json:"total_requests"`
	HealthyProviders  int `json:"healthy_providers"`
	DegradedProviders int `json:"degraded_providers"`
	FailingProviders  int `json:"failing_providers"`
	IdleProviders     int `json:"idle_providers"`
}

type providerHealthEvent struct {
	Kind         string `json:"kind"`
	Title        string `json:"title"`
	ProviderID   uint   `json:"provider_id"`
	ProviderKey  string `json:"provider_key"`
	ProviderName string `json:"provider_name"`
	ModelID      string `json:"model_id"`
	RequestedAt  string `json:"requested_at"`
	StatusCode   int    `json:"status_code"`
	LatencyMs    int64  `json:"latency_ms"`
	Detail       string `json:"detail,omitempty"`
}

type instanceProviderHealthResponse struct {
	InstanceID    uint                  `json:"instance_id"`
	LookbackHours int                   `json:"lookback_hours"`
	WindowStart   string                `json:"window_start"`
	WindowEnd     string                `json:"window_end"`
	Summary       providerHealthSummary `json:"summary"`
	Providers     []providerHealthItem  `json:"providers"`
	RecentEvents  []providerHealthEvent `json:"recent_events,omitempty"`
	Notes         []string              `json:"notes,omitempty"`
}

type providerHealthAggregate struct {
	ProviderID       uint
	ProviderKey      string
	ProviderName     string
	ModelID          string
	TotalRequests    int
	SuccessRequests  int
	ErrorRequests    int
	TimeoutRequests  int
	LatencyTotalMs   int64
	Latencies        []int64
	LastStatusCode   int
	LastErrorMessage string
	LastRequestedAt  time.Time
	LastCostUSD      float64
}

func providerDisplayName(providerKey string) string {
	if providerKey == "" {
		return "Unknown"
	}

	parts := strings.Fields(strings.ReplaceAll(providerKey, "-", " "))
	for i, part := range parts {
		if part == "" {
			continue
		}
		parts[i] = strings.ToUpper(part[:1]) + part[1:]
	}
	if len(parts) == 0 {
		return "Unknown"
	}
	return strings.Join(parts, " ")
}

func providerMeta(providerKeys map[uint]struct{ Key, Name string }, providerID uint) (string, string) {
	meta := providerKeys[providerID]
	providerKey := meta.Key
	if providerKey == "" {
		providerKey = "unknown"
	}
	providerName := meta.Name
	if providerName == "" {
		providerName = providerDisplayName(providerKey)
	}
	return providerKey, providerName
}

func classifyProviderHealth(total, errors, timeouts int, avgLatencyMs, p95LatencyMs int64) string {
	if total == 0 {
		return "idle"
	}
	errorRate := float64(errors) / float64(total)
	timeoutRate := float64(timeouts) / float64(total)
	switch {
	case errorRate >= 0.5 || (timeouts > 0 && timeoutRate >= 0.34) || (errors == total && total >= 2):
		return "failing"
	case errorRate >= 0.15 || timeouts > 0 || avgLatencyMs >= 7000 || p95LatencyMs >= 12000:
		return "degraded"
	default:
		return "healthy"
	}
}

func p95Latency(latencies []int64) int64 {
	if len(latencies) == 0 {
		return 0
	}
	clone := append([]int64(nil), latencies...)
	sort.Slice(clone, func(i, j int) bool { return clone[i] < clone[j] })
	index := int(math.Ceil(float64(len(clone))*0.95)) - 1
	if index < 0 {
		index = 0
	}
	if index >= len(clone) {
		index = len(clone) - 1
	}
	return clone[index]
}

func classifyNotableEvent(entry database.LLMRequestLog, providerKey, providerName string) (providerHealthEvent, bool) {
	lowerError := strings.ToLower(strings.TrimSpace(entry.ErrorMessage))
	switch {
	case strings.Contains(lowerError, "timeout"):
		return providerHealthEvent{
			Kind:         "timeout",
			Title:        "Timeout",
			ProviderID:   entry.ProviderID,
			ProviderKey:  providerKey,
			ProviderName: providerName,
			ModelID:      entry.ModelID,
			RequestedAt:  formatTimestamp(entry.RequestedAt),
			StatusCode:   entry.StatusCode,
			LatencyMs:    entry.LatencyMs,
			Detail:       entry.ErrorMessage,
		}, true
	case strings.TrimSpace(entry.ErrorMessage) != "" || entry.StatusCode >= 400:
		detail := entry.ErrorMessage
		if strings.TrimSpace(detail) == "" {
			detail = "Gateway returned a non-success status."
		}
		return providerHealthEvent{
			Kind:         "error",
			Title:        "Provider error",
			ProviderID:   entry.ProviderID,
			ProviderKey:  providerKey,
			ProviderName: providerName,
			ModelID:      entry.ModelID,
			RequestedAt:  formatTimestamp(entry.RequestedAt),
			StatusCode:   entry.StatusCode,
			LatencyMs:    entry.LatencyMs,
			Detail:       detail,
		}, true
	case entry.LatencyMs >= 8000:
		return providerHealthEvent{
			Kind:         "slow",
			Title:        "Slow response",
			ProviderID:   entry.ProviderID,
			ProviderKey:  providerKey,
			ProviderName: providerName,
			ModelID:      entry.ModelID,
			RequestedAt:  formatTimestamp(entry.RequestedAt),
			StatusCode:   entry.StatusCode,
			LatencyMs:    entry.LatencyMs,
			Detail:       "High latency in the live gateway path.",
		}, true
	default:
		return providerHealthEvent{}, false
	}
}

func GetInstanceProviderHealth(w http.ResponseWriter, r *http.Request) {
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

	lookbackHours := 24
	if raw := strings.TrimSpace(r.URL.Query().Get("lookback_hours")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil {
			switch {
			case parsed < 1:
				lookbackHours = 1
			case parsed > 168:
				lookbackHours = 168
			default:
				lookbackHours = parsed
			}
		}
	}

	windowEnd := time.Now().UTC()
	windowStart := windowEnd.Add(-time.Duration(lookbackHours) * time.Hour)

	var logs []database.LLMRequestLog
	if err := database.LogsDB.
		Where("instance_id = ? AND requested_at >= ?", inst.ID, windowStart).
		Order("requested_at DESC").
		Limit(5000).
		Find(&logs).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to load provider health")
		return
	}

	providerKeys := map[uint]struct{ Key, Name string }{}
	var providers []database.LLMProvider
	if err := database.DB.Find(&providers).Error; err == nil {
		for _, provider := range providers {
			providerKeys[provider.ID] = struct{ Key, Name string }{
				Key:  provider.Key,
				Name: provider.Name,
			}
		}
	}

	aggregates := map[string]*providerHealthAggregate{}
	summary := providerHealthSummary{}
	for _, entry := range logs {
		key := strconv.FormatUint(uint64(entry.ProviderID), 10) + "::" + entry.ModelID
		agg := aggregates[key]
		if agg == nil {
			providerKey, providerName := providerMeta(providerKeys, entry.ProviderID)
			agg = &providerHealthAggregate{
				ProviderID:   entry.ProviderID,
				ProviderKey:  providerKey,
				ProviderName: providerName,
				ModelID:      entry.ModelID,
			}
			aggregates[key] = agg
		}
		agg.TotalRequests++
		summary.TotalRequests++
		if entry.StatusCode >= 200 && entry.StatusCode < 400 && strings.TrimSpace(entry.ErrorMessage) == "" {
			agg.SuccessRequests++
		} else {
			agg.ErrorRequests++
		}
		if strings.Contains(strings.ToLower(entry.ErrorMessage), "timeout") {
			agg.TimeoutRequests++
		}
		agg.LatencyTotalMs += entry.LatencyMs
		agg.Latencies = append(agg.Latencies, entry.LatencyMs)
		if entry.RequestedAt.After(agg.LastRequestedAt) {
			agg.LastRequestedAt = entry.RequestedAt
			agg.LastStatusCode = entry.StatusCode
			agg.LastErrorMessage = entry.ErrorMessage
			agg.LastCostUSD = entry.CostUSD
		}
	}

	chronologicalLogs := append([]database.LLMRequestLog(nil), logs...)
	sort.Slice(chronologicalLogs, func(i, j int) bool {
		return chronologicalLogs[i].RequestedAt.Before(chronologicalLogs[j].RequestedAt)
	})

	recentEvents := make([]providerHealthEvent, 0, 12)
	var previousNotable *database.LLMRequestLog
	for _, entry := range chronologicalLogs {
		providerKey, providerName := providerMeta(providerKeys, entry.ProviderID)
		if notable, ok := classifyNotableEvent(entry, providerKey, providerName); ok {
			recentEvents = append(recentEvents, notable)
			entryCopy := entry
			previousNotable = &entryCopy
			continue
		}

		if previousNotable == nil {
			continue
		}

		isSuccess := entry.StatusCode >= 200 && entry.StatusCode < 400 && strings.TrimSpace(entry.ErrorMessage) == ""
		if !isSuccess {
			continue
		}

		recoveryWindow := entry.RequestedAt.Sub(previousNotable.RequestedAt)
		if recoveryWindow < 0 || recoveryWindow > 45*time.Second {
			continue
		}
		if previousNotable.ProviderID == entry.ProviderID && previousNotable.ModelID == entry.ModelID {
			continue
		}

		recentEvents = append(recentEvents, providerHealthEvent{
			Kind:         "recovery",
			Title:        "Possible failover recovery",
			ProviderID:   entry.ProviderID,
			ProviderKey:  providerKey,
			ProviderName: providerName,
			ModelID:      entry.ModelID,
			RequestedAt:  formatTimestamp(entry.RequestedAt),
			StatusCode:   entry.StatusCode,
			LatencyMs:    entry.LatencyMs,
			Detail:       "Successful response shortly after a failure on a different provider/model.",
		})
		previousNotable = nil
	}

	items := make([]providerHealthItem, 0, len(aggregates))
	for _, agg := range aggregates {
		avgLatency := int64(0)
		if agg.TotalRequests > 0 {
			avgLatency = agg.LatencyTotalMs / int64(agg.TotalRequests)
		}
		p95 := p95Latency(agg.Latencies)
		health := classifyProviderHealth(agg.TotalRequests, agg.ErrorRequests, agg.TimeoutRequests, avgLatency, p95)
		switch health {
		case "healthy":
			summary.HealthyProviders++
		case "degraded":
			summary.DegradedProviders++
		case "failing":
			summary.FailingProviders++
		default:
			summary.IdleProviders++
		}
		items = append(items, providerHealthItem{
			ProviderID:       agg.ProviderID,
			ProviderKey:      agg.ProviderKey,
			ProviderName:     agg.ProviderName,
			ModelID:          agg.ModelID,
			Health:           health,
			TotalRequests:    agg.TotalRequests,
			SuccessRequests:  agg.SuccessRequests,
			ErrorRequests:    agg.ErrorRequests,
			TimeoutRequests:  agg.TimeoutRequests,
			AvgLatencyMs:     avgLatency,
			P95LatencyMs:     p95,
			LastStatusCode:   agg.LastStatusCode,
			LastErrorMessage: agg.LastErrorMessage,
			LastRequestedAt:  formatTimestamp(agg.LastRequestedAt),
			LastCostUSD:      agg.LastCostUSD,
		})
	}

	sort.Slice(items, func(i, j int) bool {
		rank := func(health string) int {
			switch health {
			case "failing":
				return 0
			case "degraded":
				return 1
			case "healthy":
				return 2
			default:
				return 3
			}
		}
		if rank(items[i].Health) != rank(items[j].Health) {
			return rank(items[i].Health) < rank(items[j].Health)
		}
		if items[i].LastRequestedAt != items[j].LastRequestedAt {
			return items[i].LastRequestedAt > items[j].LastRequestedAt
		}
		return items[i].ProviderKey < items[j].ProviderKey
	})

	sort.Slice(recentEvents, func(i, j int) bool {
		return recentEvents[i].RequestedAt > recentEvents[j].RequestedAt
	})
	if len(recentEvents) > 10 {
		recentEvents = recentEvents[:10]
	}

	notes := []string{
		"Health is inferred from recent shared gateway logs, not from declared pack settings.",
		"Degraded usually means timeouts, elevated latency, or a non-trivial error rate in the selected window.",
		"Recent events are operational signals from logs; failover recovery is inferred, not directly emitted by the provider.",
	}
	if len(items) == 0 {
		notes = append(notes, "No recent gateway requests for this bot in the selected lookback window yet.")
	}

	writeJSON(w, http.StatusOK, instanceProviderHealthResponse{
		InstanceID:    inst.ID,
		LookbackHours: lookbackHours,
		WindowStart:   formatTimestamp(windowStart),
		WindowEnd:     formatTimestamp(windowEnd),
		Summary:       summary,
		Providers:     items,
		RecentEvents:  recentEvents,
		Notes:         notes,
	})
}
