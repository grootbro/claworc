import { Activity, AlertTriangle, ArrowRight, Clock3, Loader2, TimerReset, Zap } from "lucide-react";
import { useInstanceProviderHealth } from "@/hooks/useInstances";

interface ProviderHealthPanelProps {
  instanceId: number;
  enabled?: boolean;
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

function formatMs(value: number) {
  if (!value) {
    return "0 ms";
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)} s`;
  }
  return `${value} ms`;
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

export default function ProviderHealthPanel({ instanceId, enabled = true }: ProviderHealthPanelProps) {
  const { data, isLoading, isError, refetch, isFetching } = useInstanceProviderHealth(instanceId, 24, enabled);

  return (
    <div className="app-studio-panel rounded-[28px] border border-gray-200 p-6 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-700">
            <Activity size={13} />
            Provider Health
          </div>
          <h3 className="mt-3 text-base font-semibold text-gray-900">Live provider latency and failover signals</h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">
            Read-only operational view from recent shared gateway logs. This shows how the bot is actually behaving right now,
            not just what its packs and model profile say on paper.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void refetch()}
          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
        >
          <TimerReset size={15} />
          {isFetching ? "Refreshing..." : "Refresh live view"}
        </button>
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
              <div className="mt-2 text-lg font-semibold text-gray-900">{data.lookback_hours}h</div>
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

          {data.notes && data.notes.length > 0 && (
            <div className="mt-4 space-y-1 text-sm text-gray-600">
              {data.notes.map((note) => (
                <div key={note}>• {note}</div>
              ))}
            </div>
          )}

          {data.recent_events && data.recent_events.length > 0 && (
            <div className="mt-5 rounded-[24px] border border-gray-200 bg-white/70 p-4">
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
                <div key={`${item.provider_id}:${item.model_id}`} className="app-studio-soft rounded-[22px] border border-gray-200 p-4">
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
