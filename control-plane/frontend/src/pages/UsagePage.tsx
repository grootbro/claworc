import { useSearchParams } from "react-router-dom";
import { useUsageStats, useResetUsageLogs } from "@/hooks/useProviders";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

function formatCost(v: number) {
  return `$${v.toFixed(2)}`;
}

function asNumber(value: unknown): number {
  if (Array.isArray(value)) {
    return asNumber(value[0]);
  }
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value) || 0;
  return 0;
}

function formatTokens(v: number) {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return String(v);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export default function UsagePage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const startDate = searchParams.get("start") ?? daysAgo(30);
  const endDate = searchParams.get("end") ?? today();
  const source = searchParams.get("source") ?? "agent";
  const instanceId = searchParams.get("instance") ? Number(searchParams.get("instance")) : undefined;
  const providerKey = searchParams.get("provider") || undefined;

  function updateParams(updates: Record<string, string | undefined>) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(updates)) {
        if (v === undefined || v === "") next.delete(k);
        else next.set(k, v);
      }
      return next;
    }, { replace: true });
  }

  const resetMutation = useResetUsageLogs();

  const { data: stats, isLoading } = useUsageStats({
    start_date: startDate,
    end_date: endDate,
    source,
    instance_id: instanceId,
    provider_key: providerKey,
  });

  const granularity = stats?.granularity ?? "day";
  const meta = stats?.meta;
  const total = stats?.total;
  const timeSeries = stats?.time_series ?? [];
  const byInstance = (stats?.by_instance ?? []).map((s) => ({
    ...s,
    _label: s.instance_display_name || s.instance_name,
  }));
  const byProvider = (stats?.by_provider ?? []).map((s) => ({
    ...s,
    _label: s.provider_name || s.provider_key,
  }));
  const byModel = (stats?.by_model ?? []).slice(0, 10);
  const activityLabel = (meta?.count_label ?? "Total Requests").replace(/^Total\s+/i, "") || "Requests";
  const sourceLabel = meta?.source_label ?? (source === "gateway" ? "Gateway Logs" : "Agent Sessions");
  const notes = meta?.notes ?? [];
  const coverage = meta?.coverage;
  const skippedPreview = coverage?.skipped?.slice(0, 3) ?? [];

  function formatTimeLabel(label: string): string {
    if (granularity === "minute") return label.slice(11);
    if (granularity === "hour") return `${label.slice(5, 10)} ${label.slice(11)}:00`;
    return label.slice(5);
  }

  function formatTimeTooltip(label: string): string {
    if (granularity === "minute") return `${label.replace("T", " ")}:00`;
    if (granularity === "hour") return `${label.replace("T", " ")}:00`;
    return `Date: ${label}`;
  }

  const formatCostAxis = (value: unknown) => formatCost(asNumber(value));
  const formatTooltipValue = (value: unknown, label: string) => [asNumber(value).toLocaleString(), label] as [string, string];
  const formatCostTooltipValue = (value: unknown) => [formatCost(asNumber(value)), "Cost"] as [string, string];
  const formatTokenTooltipValue = (value: unknown, label?: unknown) => [
    formatTokens(asNumber(value)),
    typeof label === "string" ? label : "",
  ] as [string, string];
  const formatTooltipLabel = (label: unknown) => formatTimeTooltip(String(label ?? ""));

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">AI Usage</h1>
        <p className="text-sm text-gray-500 mt-1">
          Switch between agent session summaries and raw gateway logs so the numbers mean exactly what they say.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-4 bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">From</label>
          <input
            type="date"
            value={startDate}
            max={endDate}
            onChange={(e) => updateParams({ start: e.target.value })}
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">To</label>
          <input
            type="date"
            value={endDate}
            min={startDate}
            onChange={(e) => updateParams({ end: e.target.value })}
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Source</label>
          <select
            value={source}
            onChange={(e) => updateParams({ source: e.target.value })}
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="agent">Agent sessions (recommended)</option>
            <option value="gateway">Gateway logs</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Instance</label>
          <select
            value={instanceId ?? ""}
            onChange={(e) => updateParams({ instance: e.target.value || undefined })}
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All instances</option>
            {(stats?.instances ?? []).map((inst) => (
              <option key={inst.id} value={inst.id}>
                {inst.display_name || inst.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Provider</label>
          <select
            value={providerKey ?? ""}
            onChange={(e) => updateParams({ provider: e.target.value || undefined })}
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All providers</option>
            {(stats?.providers ?? []).map((p) => (
              <option key={`${p.id}-${p.key}`} value={p.key}>
                {p.name || p.key}
              </option>
            ))}
          </select>
        </div>
        {(meta?.resettable ?? source === "gateway") ? (
          <span className="relative group self-end ml-auto">
            <button
              onClick={() => {
                if (window.confirm("Delete all gateway usage logs? This cannot be undone.")) {
                  resetMutation.mutate();
                }
              }}
              disabled={resetMutation.isPending}
              className="px-3 py-1.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-md"
            >
              Reset
            </button>
            <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 whitespace-nowrap rounded bg-gray-900 px-2.5 py-1.5 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100 z-50">
              Delete the shared gateway usage log
            </span>
          </span>
        ) : (
          <div className="ml-auto text-xs text-gray-500 max-w-xs text-right">
            Session usage is read-only. Change source to Gateway logs if you need to clear raw request logs.
          </div>
        )}
      </div>

      <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Data Source</div>
            <div className="text-lg font-semibold text-slate-900 mt-1">{sourceLabel}</div>
            <div className="text-sm text-slate-600 mt-1">
              {source === "agent"
                ? "Recommended for real usage: reads per-agent OpenClaw session summaries over SSH."
                : "Diagnostic view: reads only the central claworc gateway request log."}
            </div>
          </div>
          {coverage ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div className="rounded-md bg-white border border-slate-200 px-3 py-2">
                <div className="text-xs text-slate-500">Visible instances</div>
                <div className="font-semibold text-slate-900">{coverage.total_instances}</div>
              </div>
              <div className="rounded-md bg-white border border-slate-200 px-3 py-2">
                <div className="text-xs text-slate-500">Reachable</div>
                <div className="font-semibold text-slate-900">{coverage.accessible_instances}</div>
              </div>
              <div className="rounded-md bg-white border border-slate-200 px-3 py-2">
                <div className="text-xs text-slate-500">Collected</div>
                <div className="font-semibold text-slate-900">{coverage.collected_instances}</div>
              </div>
              <div className="rounded-md bg-white border border-slate-200 px-3 py-2">
                <div className="text-xs text-slate-500">Skipped</div>
                <div className="font-semibold text-slate-900">{coverage.skipped_instances}</div>
              </div>
            </div>
          ) : null}
        </div>
        {notes.length > 0 ? (
          <div className="flex flex-col gap-1 text-sm text-slate-600">
            {notes.map((note) => (
              <div key={note}>• {note}</div>
            ))}
          </div>
        ) : null}
        {skippedPreview.length > 0 ? (
          <div className="text-sm text-amber-700">
            Skipped instances: {skippedPreview.join(" · ")}
            {coverage && coverage.skipped_instances > skippedPreview.length ? ` · +${coverage.skipped_instances - skippedPreview.length} more` : ""}
          </div>
        ) : null}
      </div>

      {isLoading ? (
        <div className="text-sm text-gray-500">Loading...</div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            {[
              { label: meta?.count_label ?? "Total Requests", value: total?.total_requests.toLocaleString() ?? "0" },
              { label: "Input Tokens", value: formatTokens(total?.input_tokens ?? 0) },
              { label: "Cached Input Tokens", value: formatTokens(total?.cached_input_tokens ?? 0) },
              { label: "Output Tokens", value: formatTokens(total?.output_tokens ?? 0) },
              { label: "Total Cost", value: formatCost(total?.cost_usd ?? 0) },
            ].map(({ label, value }) => (
              <div key={label} className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
                <div className="text-xs font-medium text-gray-500">{label}</div>
                <div className="text-2xl font-semibold text-gray-900 mt-1">{value}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">
                {meta?.time_series_label ?? "Requests Over Time"}
              </h2>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={timeSeries}>
                  <defs>
                    <linearGradient id="reqGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={formatTimeLabel} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={(value) => formatTooltipValue(value, activityLabel)}
                    labelFormatter={formatTooltipLabel}
                  />
                  <Area
                    type="monotone"
                    dataKey="total_requests"
                    stroke="#3b82f6"
                    fill="url(#reqGrad)"
                    name={activityLabel}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Cost Over Time (USD)</h2>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={timeSeries}>
                  <defs>
                    <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={formatTimeLabel} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={formatCostAxis} />
                  <Tooltip formatter={formatCostTooltipValue} labelFormatter={formatTooltipLabel} />
                  <Area
                    type="monotone"
                    dataKey="cost_usd"
                    stroke="#10b981"
                    fill="url(#costGrad)"
                    name="Cost (USD)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Cost By Instance (USD)</h2>
              {byInstance.length === 0 ? (
                <div className="text-sm text-gray-400 py-8 text-center">No data</div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={byInstance} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={formatCostAxis} />
                    <YAxis type="category" dataKey="_label" tick={{ fontSize: 11 }} width={120} />
                    <Tooltip formatter={formatCostTooltipValue} />
                    <Bar dataKey="cost_usd" fill="#6366f1" name="Cost (USD)" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Cost By Provider (USD)</h2>
              {byProvider.length === 0 ? (
                <div className="text-sm text-gray-400 py-8 text-center">No data</div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={byProvider} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={formatCostAxis} />
                    <YAxis type="category" dataKey="_label" tick={{ fontSize: 11 }} width={120} />
                    <Tooltip formatter={formatCostTooltipValue} />
                    <Bar dataKey="cost_usd" fill="#f59e0b" name="Cost (USD)" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm xl:col-span-2">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Tokens By Model — Top 10</h2>
              {byModel.length === 0 ? (
                <div className="text-sm text-gray-400 py-8 text-center">No data</div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={byModel} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={formatTokens} />
                    <YAxis type="category" dataKey="model_id" tick={{ fontSize: 10 }} width={180} />
                    <Tooltip formatter={formatTokenTooltipValue} />
                    <Legend />
                    <Bar dataKey="input_tokens" stackId="a" fill="#2563eb" name="Input tokens" />
                    <Bar dataKey="cached_input_tokens" stackId="a" fill="#60a5fa" name="Cached input tokens" />
                    <Bar dataKey="output_tokens" stackId="a" fill="#818cf8" name="Output tokens" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
