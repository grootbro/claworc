package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/gluk-w/claworc/control-plane/internal/database"
	"github.com/gluk-w/claworc/control-plane/internal/middleware"
	"github.com/gluk-w/claworc/control-plane/internal/orchestrator"
	"github.com/gluk-w/claworc/control-plane/internal/sshproxy"
	"golang.org/x/crypto/ssh"
)

type agentSessionSummary struct {
	UpdatedAt         int64   `json:"updatedAt"`
	FirstActivity     int64   `json:"firstActivity"`
	LastActivity      int64   `json:"lastActivity"`
	Model             string  `json:"model"`
	ModelProvider     string  `json:"modelProvider"`
	InputTokens       int64   `json:"inputTokens"`
	CachedInputTokens int64   `json:"cachedInputTokens"`
	OutputTokens      int64   `json:"outputTokens"`
	TotalTokens       int64   `json:"totalTokens"`
	EstimatedCostUSD  float64 `json:"estimatedCostUsd"`
	LastChannel       string  `json:"lastChannel"`
	DeliveryContext   struct {
		Channel string `json:"channel"`
	} `json:"deliveryContext"`
}

type usageProviderMatch struct {
	id   uint
	key  string
	name string
}

type usageAggregate struct {
	requests     int
	inputTokens  int64
	cachedTokens int64
	outputTokens int64
	costUSD      float64
}

func normalizeUsageProviderKey(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func usageProviderDisplayName(key string) string {
	if key == "" {
		return "Unknown"
	}
	parts := strings.FieldsFunc(key, func(r rune) bool {
		return r == '-' || r == '_' || r == ' '
	})
	for i, part := range parts {
		if part == "" {
			continue
		}
		parts[i] = strings.ToUpper(part[:1]) + part[1:]
	}
	if len(parts) == 0 {
		return key
	}
	return strings.Join(parts, " ")
}

func listAccessibleInstances(r *http.Request) ([]database.Instance, error) {
	var instances []database.Instance
	if err := database.DB.Order("sort_order ASC, id ASC").Find(&instances).Error; err != nil {
		return nil, err
	}
	filtered := make([]database.Instance, 0, len(instances))
	for _, inst := range instances {
		if middleware.CanAccessInstance(r, inst.ID) {
			filtered = append(filtered, inst)
		}
	}
	return filtered, nil
}

func appendUintInFilter(baseWhere string, baseArgs []interface{}, column string, ids []uint) (string, []interface{}) {
	if len(ids) == 0 {
		return baseWhere + " AND 1=0", baseArgs
	}
	placeholders := strings.TrimRight(strings.Repeat("?,", len(ids)), ",")
	baseWhere += " AND " + column + " IN (" + placeholders + ")"
	for _, id := range ids {
		baseArgs = append(baseArgs, id)
	}
	return baseWhere, baseArgs
}

func providerMatchesFilter(providerValue, filterKey string, providerLookup map[string]usageProviderMatch) bool {
	if filterKey == "" {
		return true
	}
	normalized := normalizeUsageProviderKey(providerValue)
	if normalized == "" {
		return false
	}
	if normalized == filterKey {
		return true
	}
	if match, ok := providerLookup[normalized]; ok {
		return match.key == filterKey
	}
	return false
}

func resolveUsageProvider(providerValue string, providerLookup map[string]usageProviderMatch) usageProviderMatch {
	normalized := normalizeUsageProviderKey(providerValue)
	if normalized == "" {
		return usageProviderMatch{key: "unknown", name: "Unknown"}
	}
	if match, ok := providerLookup[normalized]; ok {
		return match
	}
	return usageProviderMatch{
		key:  normalized,
		name: usageProviderDisplayName(normalized),
	}
}

func buildUsageProviderLookup(providers []database.LLMProvider) (map[string]usageProviderMatch, []UsageProviderInfo) {
	lookup := make(map[string]usageProviderMatch, len(providers)*3)
	infos := make([]UsageProviderInfo, 0, len(providers))
	for _, provider := range providers {
		match := usageProviderMatch{
			id:   provider.ID,
			key:  normalizeUsageProviderKey(provider.Key),
			name: provider.Name,
		}
		aliases := []string{
			normalizeUsageProviderKey(provider.Key),
			normalizeUsageProviderKey(provider.Provider),
			normalizeUsageProviderKey(provider.Name),
		}
		for _, alias := range aliases {
			if alias == "" {
				continue
			}
			lookup[alias] = match
		}
		if match.key != "" {
			infos = append(infos, UsageProviderInfo{
				ID:   provider.ID,
				Key:  match.key,
				Name: provider.Name,
			})
		}
	}
	sort.Slice(infos, func(i, j int) bool {
		return infos[i].Name < infos[j].Name
	})
	return lookup, infos
}

func matchedUsageProviderIDs(providers []database.LLMProvider, filterKey string) []uint {
	normalized := normalizeUsageProviderKey(filterKey)
	if normalized == "" {
		return nil
	}
	ids := make([]uint, 0, 1)
	seen := make(map[uint]struct{})
	for _, provider := range providers {
		aliases := []string{
			normalizeUsageProviderKey(provider.Key),
			normalizeUsageProviderKey(provider.Provider),
			normalizeUsageProviderKey(provider.Name),
		}
		for _, alias := range aliases {
			if alias == "" || alias != normalized {
				continue
			}
			if _, ok := seen[provider.ID]; ok {
				break
			}
			seen[provider.ID] = struct{}{}
			ids = append(ids, provider.ID)
			break
		}
	}
	return ids
}

func aggregateAgentSessionUsage(
	r *http.Request,
	startDate string,
	endDate string,
	instanceFilter *uint,
	providerFilterKey string,
	granularity string,
) (UsageStatsResponse, error) {
	instances, err := listAccessibleInstances(r)
	if err != nil {
		return UsageStatsResponse{}, err
	}

	var providers []database.LLMProvider
	if err := database.DB.Order("id ASC").Find(&providers).Error; err != nil {
		return UsageStatsResponse{}, err
	}

	providerLookup, providerInfos := buildUsageProviderLookup(providers)
	resp := UsageStatsResponse{
		ByInstance:  make([]InstanceUsageStat, 0),
		ByProvider:  make([]ProviderUsageStat, 0),
		ByModel:     make([]ModelUsageStat, 0),
		TimeSeries:  make([]UsageTimePoint, 0),
		Instances:   make([]UsageInstanceInfo, 0, len(instances)),
		Providers:   providerInfos,
		Granularity: granularity,
		Meta: UsageStatsMeta{
			Source:          "agent",
			SourceLabel:     "Agent Sessions",
			CountLabel:      "Total Sessions",
			TimeSeriesLabel: "Session Activity Over Time",
			Resettable:      false,
			Notes: []string{
				"Counts come from each agent's OpenClaw session summaries over SSH.",
				"Time series is grouped by session activity timestamp, not raw gateway request time.",
			},
		},
	}

	for _, inst := range instances {
		resp.Instances = append(resp.Instances, UsageInstanceInfo{
			ID:          inst.ID,
			Name:        inst.Name,
			DisplayName: inst.DisplayName,
		})
	}

	if providerFilterKey != "" {
		providerFilterKey = normalizeUsageProviderKey(providerFilterKey)
	}

	startDay, err := time.Parse("2006-01-02", startDate)
	if err != nil {
		return UsageStatsResponse{}, fmt.Errorf("parse start_date: %w", err)
	}
	endDay, err := time.Parse("2006-01-02", endDate)
	if err != nil {
		return UsageStatsResponse{}, fmt.Errorf("parse end_date: %w", err)
	}
	endDay = endDay.Add(24 * time.Hour)

	coverage := UsageCoverage{
		TotalInstances: len(instances),
	}

	byInstance := make(map[uint]*usageAggregate)
	byProvider := make(map[string]*usageAggregate)
	byModel := make(map[string]*usageAggregate)
	byDate := make(map[string]*usageAggregate)
	providerNames := make(map[string]usageProviderMatch)

	orch := orchestrator.Get()
	for _, inst := range instances {
		if instanceFilter != nil && inst.ID != *instanceFilter {
			continue
		}
		if inst.Status != "running" {
			coverage.Skipped = append(coverage.Skipped, fmt.Sprintf("%s: not running", inst.DisplayName))
			continue
		}
		coverage.AccessibleInstances++

		var sshClient *ssh.Client
		if SSHMgr != nil {
			if existing, ok := SSHMgr.GetConnection(inst.ID); ok {
				sshClient = existing
			} else if orch != nil {
				ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
				client, connectErr := SSHMgr.EnsureConnectedWithIPCheck(ctx, inst.ID, orch, inst.AllowedSourceIPs)
				cancel()
				if connectErr == nil {
					sshClient = client
				}
			}
		}
		if sshClient == nil {
			coverage.Skipped = append(coverage.Skipped, fmt.Sprintf("%s: no SSH connection", inst.DisplayName))
			continue
		}

		content, readErr := sshproxy.ReadFile(sshClient, "/home/claworc/.openclaw/agents/main/sessions/sessions.json")
		if readErr != nil {
			coverage.Skipped = append(coverage.Skipped, fmt.Sprintf("%s: sessions unavailable", inst.DisplayName))
			continue
		}

		var sessions map[string]agentSessionSummary
		if err := json.Unmarshal(content, &sessions); err != nil {
			coverage.Skipped = append(coverage.Skipped, fmt.Sprintf("%s: invalid sessions.json", inst.DisplayName))
			continue
		}
		coverage.CollectedInstances++

		for _, session := range sessions {
			if session.InputTokens == 0 &&
				session.CachedInputTokens == 0 &&
				session.OutputTokens == 0 &&
				session.EstimatedCostUSD == 0 {
				continue
			}

			timestampMs := session.LastActivity
			if timestampMs == 0 {
				timestampMs = session.UpdatedAt
			}
			if timestampMs == 0 {
				continue
			}
			timestamp := time.UnixMilli(timestampMs).UTC()
			if timestamp.Before(startDay) || !timestamp.Before(endDay) {
				continue
			}

			if !providerMatchesFilter(session.ModelProvider, providerFilterKey, providerLookup) {
				continue
			}
			providerInfo := resolveUsageProvider(session.ModelProvider, providerLookup)
			providerNames[providerInfo.key] = providerInfo

			instanceAgg := byInstance[inst.ID]
			if instanceAgg == nil {
				instanceAgg = &usageAggregate{}
				byInstance[inst.ID] = instanceAgg
			}
			providerAgg := byProvider[providerInfo.key]
			if providerAgg == nil {
				providerAgg = &usageAggregate{}
				byProvider[providerInfo.key] = providerAgg
			}
			modelKey := providerInfo.key + "::" + session.Model
			modelAgg := byModel[modelKey]
			if modelAgg == nil {
				modelAgg = &usageAggregate{}
				byModel[modelKey] = modelAgg
			}
			dateKey := formatUsageDateKey(timestamp, granularity)
			dateAgg := byDate[dateKey]
			if dateAgg == nil {
				dateAgg = &usageAggregate{}
				byDate[dateKey] = dateAgg
			}

			for _, agg := range []*usageAggregate{instanceAgg, providerAgg, modelAgg, dateAgg} {
				agg.requests++
				agg.inputTokens += session.InputTokens
				agg.cachedTokens += session.CachedInputTokens
				agg.outputTokens += session.OutputTokens
				agg.costUSD += session.EstimatedCostUSD
			}
		}
	}

	coverage.SkippedInstances = len(coverage.Skipped)
	resp.Meta.Coverage = &coverage

	for _, inst := range instances {
		if instanceFilter != nil && inst.ID != *instanceFilter {
			continue
		}
		agg := byInstance[inst.ID]
		if agg == nil {
			continue
		}
		resp.ByInstance = append(resp.ByInstance, InstanceUsageStat{
			InstanceID:          inst.ID,
			InstanceName:        inst.Name,
			InstanceDisplayName: inst.DisplayName,
			TotalRequests:       agg.requests,
			InputTokens:         agg.inputTokens,
			CachedInputTokens:   agg.cachedTokens,
			OutputTokens:        agg.outputTokens,
			CostUSD:             agg.costUSD,
		})
		resp.Total.TotalRequests += agg.requests
		resp.Total.InputTokens += agg.inputTokens
		resp.Total.CachedInputTokens += agg.cachedTokens
		resp.Total.OutputTokens += agg.outputTokens
		resp.Total.CostUSD += agg.costUSD
	}

	for providerKey, agg := range byProvider {
		info := providerNames[providerKey]
		resp.ByProvider = append(resp.ByProvider, ProviderUsageStat{
			ProviderID:        info.id,
			ProviderKey:       providerKey,
			ProviderName:      info.name,
			TotalRequests:     agg.requests,
			InputTokens:       agg.inputTokens,
			CachedInputTokens: agg.cachedTokens,
			OutputTokens:      agg.outputTokens,
			CostUSD:           agg.costUSD,
		})
	}

	for key, agg := range byModel {
		providerKey, modelID, _ := strings.Cut(key, "::")
		info := providerNames[providerKey]
		resp.ByModel = append(resp.ByModel, ModelUsageStat{
			ModelID:           modelID,
			ProviderID:        info.id,
			ProviderKey:       providerKey,
			TotalRequests:     agg.requests,
			InputTokens:       agg.inputTokens,
			CachedInputTokens: agg.cachedTokens,
			OutputTokens:      agg.outputTokens,
			CostUSD:           agg.costUSD,
		})
	}

	timeKeys := make([]string, 0, len(byDate))
	for key := range byDate {
		timeKeys = append(timeKeys, key)
	}
	sort.Strings(timeKeys)
	for _, key := range timeKeys {
		agg := byDate[key]
		resp.TimeSeries = append(resp.TimeSeries, UsageTimePoint{
			Date:              key,
			TotalRequests:     agg.requests,
			InputTokens:       agg.inputTokens,
			CachedInputTokens: agg.cachedTokens,
			OutputTokens:      agg.outputTokens,
			CostUSD:           agg.costUSD,
		})
	}

	sort.Slice(resp.ByInstance, func(i, j int) bool {
		return resp.ByInstance[i].CostUSD > resp.ByInstance[j].CostUSD
	})
	sort.Slice(resp.ByProvider, func(i, j int) bool {
		return resp.ByProvider[i].CostUSD > resp.ByProvider[j].CostUSD
	})
	sort.Slice(resp.ByModel, func(i, j int) bool {
		left := resp.ByModel[i].InputTokens + resp.ByModel[i].CachedInputTokens + resp.ByModel[i].OutputTokens
		right := resp.ByModel[j].InputTokens + resp.ByModel[j].CachedInputTokens + resp.ByModel[j].OutputTokens
		if left == right {
			return resp.ByModel[i].CostUSD > resp.ByModel[j].CostUSD
		}
		return left > right
	})

	if coverage.CollectedInstances == 0 {
		resp.Meta.Notes = append(resp.Meta.Notes, "No running instances exposed readable session summaries over SSH.")
	}

	return resp, nil
}

func formatUsageDateKey(ts time.Time, granularity string) string {
	switch granularity {
	case "minute":
		return ts.Format("2006-01-02T15:04")
	case "hour":
		return ts.Format("2006-01-02T15")
	default:
		return ts.Format("2006-01-02")
	}
}
