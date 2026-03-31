import { useMemo, useState } from "react";
import { Activity, AlertTriangle, ArrowRight, Clock3, Loader2, TimerReset, TrendingUp, Zap } from "lucide-react";
import { useInstanceProviderHealth } from "@/hooks/useInstances";
import type { InstanceProviderHealthSeriesPoint } from "@/types/instance";

const LOOKBACK_OPTIONS = [
  { label: "1h", hours: 1 },
  { label: "6h", hours: 6 },
  { label: "24h", hours: 24 },
  { label: "7d", hours: 168 },
] as const;

interface ProviderHealthPanelProps {
  instanceId: number;
  enabled?: boolean;
  lookbackHours?: number;
  onLookbackChange?: (hours: number) => void;
  showLookbackControls?: boolean;
}

function healthTone(health: string) {
  switch (health) {
    case "healthy":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "degraded":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "failing":
      return "border-red-200 bg-red-50 text-red-700";
    default:
      return "border-slate-200 bg-slate-100 text-slate-600";
  }
}

function eventTone(kind: string) {
  switch (kind) {
    case "timeout":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "error":
      return "border-red-200 bg-red-50 text-red-800";
    case "slow":
      return "border-blue-200 bg-blue-50 text-blue-800";
    case "recovery":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    default:
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
}

function formatMs(value: number) {
  if (!value) {
    return "0 ms";
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)} s`;
  }
  return `${value} ms`;
}

function buildSparkline(series: InstanceProviderHealthSeriesPoint[]) {
  const width = 520;
  const height = 180;
  const paddingX = 12;
  const paddingY = 18;
  const activeSeries = series.length > 0 ? series : [{ bucket_start: "", avg_latency_ms: 0, request_count: 0 }];
  const maxLatency = Math.max(...activeSeries.map((point) => point.avg_latency_ms), 1);
  const drawWidth = width - paddingX * 2;
  const drawHeight = height - paddingY * 2;

  const points = activeSeries.map((point, index) => {
    const x = paddingX + (drawWidth * index) / Math.max(activeSeries.length - 1, 1);
    const y = height - paddingY - (point.avg_latency_ms / maxLatency) * drawHeight;
    return { x, y, point };
  });

  return {
    width,
    height,
    maxLatency,
    points,
    polyline: points.map(({ x, y }) => `${x},${y}`).join(" "),
  };
}

export default function ProviderHealthPanel({
  instanceId,
  enabled = true,
  lookbackHours,
  onLookbackChange,
  showLookbackControls = false,
}: ProviderHealthPanelProps) {
  const [internalLookback, setInternalLookback] = useState(24);
  const resolvedLookback = lookbackHours ?? internalLookback;
  const { data, isLoading, isError, refetch, isFetching } = useInstanceProviderHealth(instanceId, resolvedLookback, enabled);

  const latencySeries = data?.latency_series ?? [];
  const sparkline = useMemo(() => buildSparkline(latencySeries), [latencySeries]);
  const latencyInsight = useMemo(() => {
    if (!latencySeries.length) {
      return {
        latest: null as InstanceProviderHealthSeriesPoint | null,
        peak: null as InstanceProviderHealthSeriesPoint | null,
        busiest: null as InstanceProviderHealthSeriesPoint | null,
      };
    }

    const active = latencySeries.filter((point) => point.request_count > 0);
    const latest = [...active].pop() ?? latencySeries[latencySeries.length - 1];
    const peak =
      active.reduce<InstanceProviderHealthSeriesPoint | null>(
        (best, point) => (!best || point.avg_latency_ms > best.avg_latency_ms ? point : best),
        null,
      ) ?? null;
    const busiest =
      active.reduce<InstanceProviderHealthSeriesPoint | null>(
        (best, point) => (!best || point.request_count > best.request_count ? point : best),
        null,
      ) ?? null;

    return { latest, peak, busiest };
  }, [latencySeries]);

  const handleLookbackChange = (hours: number) => {
    if (lookbackHours === undefined) {
      setInternalLookback(hours);
    }
    onLookbackChange?.(hours);
  };

  return (
    <div className="app-studio-panel rounded-[30px] border border-gray-200 p-6 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-700">
            <Activity size={13} />
            Provider Health
          </div>
          <h3 className="mt-3 text-lg font-semibold text-gray-900">Live provider health, latency drift, and failover pressure</h3>
          <p className="mt-2 text-sm leading-6 text-gray-600">
            Operational view from real gateway logs. Packs tell you what should be installed; this panel shows what the bot is
            actually doing under load right now.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
          {showLookbackControls && (
            <div className="inline-flex flex-wrap rounded-2xl border border-gray-200 bg-white/80 p-1">
              {LOOKBACK_OPTIONS.map((option) => {
                const active = resolvedLookback === option.hours;
                return (
                  <button
                    key={option.hours}
                    type="button"
                    onClick={() => handleLookbackChange(option.hours)}
                    className={`rounded-xl px-3 py-2 text-xs font-semibold transition-colors ${
                      active ? "bg-blue-600 text-white shadow-sm" : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          )}

          <button
            type="button"
            onClick={() => void refetch()}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            <TimerReset size={15} />
            {isFetching ? "Refreshing..." : "Refresh live view"}
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="mt-5 rounded-2xl border border-dashed border-gray-300 px-4 py-8 text-sm text-gray-500">
          <div className="inline-flex items-center gap-2">
            <Loader2 size={15} className="animate-spin" />
            Loading provider health...
          </div>
        </div>
      ) : isError || !data ? (
        <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">
          Failed to load provider health.
        </div>
      ) : (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-5">
            <div className="rounded-2xl border border-gray-200 bg-white/80 px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">Lookback</div>
              <div className="mt-2 text-lg font-semibold text-gray-900">{data.lookback_hours >= 168 ? "7d" : `${data.lookback_hours}h`}</div>
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-700">Healthy</div>
              <div className="mt-2 text-lg font-semibold text-emerald-900">{data.summary.healthy_providers}</div>
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-700">Degraded</div>
              <div className="mt-2 text-lg font-semibold text-amber-900">{data.summary.degraded_providers}</div>
            </div>
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-red-700">Failing</div>
              <div className="mt-2 text-lg font-semibold text-red-900">{data.summary.failing_providers}</div>
            </div>
            <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-700">Requests</div>
              <div className="mt-2 text-lg font-semibold text-blue-900">{data.summary.total_requests}</div>
            </div>
          </div>

          <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(280px,0.9fr)]">
            <div className="app-studio-detail rounded-[26px] border border-gray-200 p-4">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">Latency trend</div>
                  <div className="mt-1 text-sm font-semibold text-gray-900">Average gateway latency across the selected window</div>
                </div>
                <div className="text-xs text-gray-500">
                  {data.window_start} → {data.window_end}
                </div>
              </div>

              {latencySeries.length === 0 ? (
                <div className="mt-4 rounded-2xl border border-dashed border-gray-300 px-4 py-8 text-sm text-gray-500">
                  No recent latency samples for this window yet.
                </div>
              ) : (
                <>
                  <div className="mt-4 overflow-hidden rounded-[22px] border border-gray-200 bg-white/80 p-3">
                    <svg viewBox={`0 0 ${sparkline.width} ${sparkline.height}`} className="h-44 w-full" preserveAspectRatio="none">
                      <defs>
                        <linearGradient id={`provider-health-line-${instanceId}`} x1="0%" x2="100%" y1="0%" y2="0%">
                          <stop offset="0%" stopColor="#38bdf8" />
                          <stop offset="50%" stopColor="#60a5fa" />
                          <stop offset="100%" stopColor="#22c55e" />
                        </linearGradient>
                      </defs>
                      {[0.25, 0.5, 0.75].map((ratio) => {
                        const y = 18 + (sparkline.height - 36) * ratio;
                        return <line key={ratio} x1="12" x2={sparkline.width - 12} y1={y} y2={y} stroke="rgba(148,163,184,0.18)" strokeDasharray="4 5" />;
                      })}
                      <polyline
                        fill="none"
                        stroke={`url(#provider-health-line-${instanceId})`}
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        points={sparkline.polyline}
                      />
                      {sparkline.points.map(({ x, y, point }) => (
                        <circle
                          key={`${point.bucket_start}-${x}`}
                          cx={x}
                          cy={y}
                          r={point.request_count > 0 ? 3.5 : 2}
                          fill={point.request_count > 0 ? "#60a5fa" : "rgba(148,163,184,0.28)"}
                        />
                      ))}
                    </svg>
                  </div>

                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl border border-gray-200 bg-white/70 px-4 py-3">
                      <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">
                        <TrendingUp size={12} />
                        Latest bucket
                      </div>
                      <div className="mt-2 text-base font-semibold text-gray-900">
                        {latencyInsight.latest ? formatMs(latencyInsight.latest.avg_latency_ms) : "No data"}
                      </div>
                      <div className="mt-1 text-xs text-gray-500">
                        {latencyInsight.latest?.request_count ?? 0} request{latencyInsight.latest?.request_count === 1 ? "" : "s"}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-gray-200 bg-white/70 px-4 py-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">Peak avg</div>
                      <div className="mt-2 text-base font-semibold text-gray-900">
                        {latencyInsight.peak ? formatMs(latencyInsight.peak.avg_latency_ms) : "No data"}
                      </div>
                      <div className="mt-1 text-xs text-gray-500">
                        {latencyInsight.peak?.bucket_start ?? "No active bucket"}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-gray-200 bg-white/70 px-4 py-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">Busiest bucket</div>
                      <div className="mt-2 text-base font-semibold text-gray-900">
                        {latencyInsight.busiest ? `${latencyInsight.busiest.request_count} req` : "No data"}
                      </div>
                      <div className="mt-1 text-xs text-gray-500">
                        {latencyInsight.busiest ? formatMs(latencyInsight.busiest.avg_latency_ms) : "No active bucket"}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="space-y-4">
              <div className="app-studio-soft rounded-[26px] border border-gray-200 p-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">What matters</div>
                <div className="mt-2 text-sm leading-6 text-gray-700">
                  Watch for rising P95, clusters of timeout events, and recovery hops between provider/model pairs. That usually means
                  the bot is still answering, but users will feel the lag before they feel a hard outage.
                </div>
              </div>

              {data.notes && data.notes.length > 0 && (
                <div className="app-studio-soft rounded-[26px] border border-gray-200 p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">Operational notes</div>
                  <div className="mt-3 space-y-2 text-sm leading-6 text-gray-600">
                    {data.notes.map((note) => (
                      <div key={note}>• {note}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {data.recent_events && data.recent_events.length > 0 && (
            <div className="mt-5 rounded-[26px] border border-gray-200 bg-white/70 p-4">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">Recent signals</div>
                  <div className="mt-1 text-sm font-semibold text-gray-900">Timeout, error, slow, and recovery timeline</div>
                </div>
                <div className="text-xs text-gray-500">Newest first · live from gateway logs</div>
              </div>

              <div className="mt-4 space-y-3">
                {data.recent_events.map((event, index) => (
                  <div key={`${event.requested_at}-${event.provider_key}-${event.model_id}-${index}`} className="flex gap-3">
                    <div className="flex w-7 shrink-0 flex-col items-center">
                      <div className={`flex h-7 w-7 items-center justify-center rounded-full border ${eventTone(event.kind)}`}>
                        {event.kind === "recovery" ? <ArrowRight size={14} /> : event.kind === "slow" ? <Zap size={14} /> : <AlertTriangle size={14} />}
                      </div>
                      {index !== (data.recent_events?.length ?? 0) - 1 && <div className="mt-1 h-full w-px bg-gray-200" />}
                    </div>

                    <div className="min-w-0 flex-1 rounded-2xl border border-gray-200 bg-white p-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${eventTone(event.kind)}`}>
                              {event.title}
                            </span>
                            <span className="text-sm font-semibold text-gray-900">{event.provider_name}</span>
                            <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] text-gray-600">
                              {event.model_id}
                            </span>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                            <span>{event.requested_at}</span>
                            <span>Status {event.status_code || "n/a"}</span>
                            <span>{formatMs(event.latency_ms)}</span>
                          </div>
                        </div>
                      </div>

                      {event.detail && <div className="mt-3 text-sm leading-6 text-gray-600">{event.detail}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.providers.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-gray-300 px-4 py-8 text-sm text-gray-500">
              No provider calls were recorded for this bot in the current window yet.
            </div>
          ) : (
            <div className="mt-5 grid gap-4">
              {data.providers.map((item) => (
                <div key={`${item.provider_id}:${item.model_id}`} className="app-studio-soft rounded-[24px] border border-gray-200 p-4">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-semibold text-gray-900">{item.provider_name}</div>
                        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${healthTone(item.health)}`}>
                          {item.health}
                        </span>
                        <span className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-600">
                          {item.model_id}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                        <span>{item.provider_key}</span>
                        <span className="inline-flex items-center gap-1">
                          <Clock3 size={12} />
                          Last call {item.last_requested_at}
                        </span>
                        <span>Last status {item.last_status_code || "n/a"}</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:min-w-[430px]">
                      <div className="rounded-xl border border-gray-200 bg-white px-3 py-2">
                        <div className="text-[11px] uppercase tracking-[0.14em] text-gray-500">Avg</div>
                        <div className="mt-1 text-sm font-semibold text-gray-900">{formatMs(item.avg_latency_ms)}</div>
                      </div>
                      <div className="rounded-xl border border-gray-200 bg-white px-3 py-2">
                        <div className="text-[11px] uppercase tracking-[0.14em] text-gray-500">P95</div>
                        <div className="mt-1 text-sm font-semibold text-gray-900">{formatMs(item.p95_latency_ms)}</div>
                      </div>
                      <div className="rounded-xl border border-gray-200 bg-white px-3 py-2">
                        <div className="text-[11px] uppercase tracking-[0.14em] text-gray-500">Success</div>
                        <div className="mt-1 text-sm font-semibold text-emerald-700">{item.success_requests}</div>
                      </div>
                      <div className="rounded-xl border border-gray-200 bg-white px-3 py-2">
                        <div className="text-[11px] uppercase tracking-[0.14em] text-gray-500">Errors</div>
                        <div className="mt-1 text-sm font-semibold text-red-700">{item.error_requests}</div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full border border-gray-200 bg-white px-3 py-1 text-gray-700">
                      {item.total_requests} total requests
                    </span>
                    {item.timeout_requests > 0 && (
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-amber-800">
                        {item.timeout_requests} timeout{item.timeout_requests === 1 ? "" : "s"}
                      </span>
                    )}
                    {item.last_cost_usd > 0 && (
                      <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-blue-800">
                        Last cost ${item.last_cost_usd.toFixed(4)}
                      </span>
                    )}
                  </div>

                  {item.last_error_message && (
                    <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                      <div className="inline-flex items-center gap-2 font-medium">
                        <AlertTriangle size={15} />
                        Latest issue
                      </div>
                      <div className="mt-2">{item.last_error_message}</div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
