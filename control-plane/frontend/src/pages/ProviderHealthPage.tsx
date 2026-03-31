import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Activity, CheckCircle2, Radio, Search, ShieldAlert } from "lucide-react";
import ProviderHealthPanel from "@/components/ProviderHealthPanel";
import { useInstances } from "@/hooks/useInstances";

function statusClasses(status: string) {
  switch (status) {
    case "running":
      return "bg-emerald-50 text-emerald-700";
    case "creating":
    case "restarting":
    case "restoring":
      return "bg-amber-50 text-amber-700";
    case "stopped":
      return "bg-gray-100 text-gray-600";
    case "error":
      return "bg-red-50 text-red-700";
    default:
      return "bg-gray-100 text-gray-600";
  }
}

function sortInstances<T extends { status: string; display_name: string }>(instances: T[]): T[] {
  const rank = (status: string) => {
    switch (status) {
      case "running":
        return 0;
      case "creating":
      case "restarting":
      case "restoring":
        return 1;
      case "stopped":
        return 2;
      case "error":
        return 3;
      default:
        return 4;
    }
  };

  return [...instances].sort((a, b) => rank(a.status) - rank(b.status) || a.display_name.localeCompare(b.display_name));
}

export default function ProviderHealthPage() {
  const { data: instances = [], isLoading } = useInstances();
  const [searchParams, setSearchParams] = useSearchParams();
  const [instanceSearch, setInstanceSearch] = useState("");
  const [lookbackHours, setLookbackHours] = useState(24);

  const deferredInstanceSearch = useDeferredValue(instanceSearch);
  const selectedId = Number(searchParams.get("instance") || 0);

  const sortedInstances = useMemo(() => sortInstances(instances), [instances]);
  const filteredInstances = useMemo(() => {
    const query = deferredInstanceSearch.trim().toLowerCase();
    if (!query) {
      return sortedInstances;
    }
    return sortedInstances.filter((instance) => {
      const haystack = `${instance.display_name} ${instance.name} ${instance.status}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [deferredInstanceSearch, sortedInstances]);

  const defaultInstanceId = useMemo(() => {
    const running = sortedInstances.find((instance) => instance.status === "running");
    return running?.id ?? sortedInstances[0]?.id ?? 0;
  }, [sortedInstances]);

  useEffect(() => {
    if (!sortedInstances.length || selectedId || !defaultInstanceId) {
      return;
    }
    setSearchParams({ instance: String(defaultInstanceId) }, { replace: true });
  }, [defaultInstanceId, selectedId, setSearchParams, sortedInstances.length]);

  const selectedInstance =
    sortedInstances.find((instance) => instance.id === selectedId) ??
    sortedInstances.find((instance) => instance.id === defaultInstanceId);

  const runningCount = instances.filter((instance) => instance.status === "running").length;

  return (
    <div className="provider-health-studio space-y-6">
      <section className="overflow-hidden rounded-[30px] border border-slate-800 bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.2),_transparent_24%),radial-gradient(circle_at_top_right,_rgba(248,113,113,0.16),_transparent_24%),linear-gradient(135deg,#07111f_0%,#0b1628_48%,#111f33_100%)] p-6 text-white shadow-[0_24px_80px_rgba(15,23,42,0.35)]">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-4xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-200">
              <Activity size={13} />
              Provider Health
            </div>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white">Operational studio for live model traffic</h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300">
              Watch latency drift, timeout bursts, and provider failover behavior per bot. This page is for how the bot is
              actually behaving right now, not just how its packs are configured on paper.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 xl:min-w-[430px]">
            <div className="rounded-2xl border border-white/10 bg-white/8 px-4 py-4 backdrop-blur">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Instances</div>
              <div className="mt-2 text-2xl font-semibold text-white">{instances.length}</div>
              <div className="mt-1 text-xs text-slate-400">Bots observed in studio</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/8 px-4 py-4 backdrop-blur">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Running</div>
              <div className="mt-2 flex items-center gap-2 text-2xl font-semibold text-white">
                <CheckCircle2 size={18} className="text-emerald-300" />
                {runningCount}
              </div>
              <div className="mt-1 text-xs text-slate-400">Collecting gateway signals</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/8 px-4 py-4 backdrop-blur">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Focus</div>
              <div className="mt-2 flex items-center gap-2 text-2xl font-semibold text-white">
                <Radio size={18} className="text-sky-300" />
                Live
              </div>
              <div className="mt-1 text-xs text-slate-400">Latency, errors, recovery</div>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
          <div className="app-studio-panel rounded-[26px] border border-gray-200 p-4 shadow-sm">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Choose bot</h2>
              <p className="mt-1 text-xs leading-5 text-gray-500">
                Pick the exact bot you want to inspect. Health is aggregated per live instance.
              </p>
            </div>

            <label className="mt-4 block space-y-1">
              <div className="text-xs font-medium text-gray-600">Search instances</div>
              <div className="app-studio-input-shell flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2">
                <Search size={16} className="text-gray-400" />
                <input
                  value={instanceSearch}
                  onChange={(event) => setInstanceSearch(event.target.value)}
                  placeholder="NeoDome, ravefox, Shirokov..."
                  className="w-full border-none bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-400"
                />
              </div>
            </label>
          </div>

          <div className="app-studio-panel rounded-[26px] border border-gray-200 p-3 shadow-sm">
            {isLoading ? (
              <div className="rounded-xl border border-dashed border-gray-300 px-4 py-8 text-sm text-gray-500">
                Loading instances...
              </div>
            ) : filteredInstances.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-300 px-4 py-8 text-sm text-gray-500">
                No instances match this search.
              </div>
            ) : (
              <div className="space-y-2">
                {filteredInstances.map((instance) => {
                  const isSelected = selectedInstance?.id === instance.id;
                  return (
                    <button
                      key={instance.id}
                      type="button"
                      onClick={() => setSearchParams({ instance: String(instance.id) })}
                      className={`w-full rounded-2xl border px-3 py-3 text-left transition-colors ${
                        isSelected
                          ? "border-blue-200 bg-blue-50 shadow-sm"
                          : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-gray-900">{instance.display_name}</div>
                          <div className="mt-1 truncate text-xs text-gray-500">{instance.name}</div>
                        </div>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${statusClasses(instance.status)}`}>
                          {instance.status}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="app-studio-note rounded-[26px] border border-cyan-200 p-4 shadow-sm">
            <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">
              <ShieldAlert size={13} />
              Why this page exists
            </div>
            <div className="mt-3 space-y-3 text-sm leading-6 text-cyan-950">
              <div>
                <span className="font-semibold">Feature Packs</span> shape what should be installed.
              </div>
              <div>
                <span className="font-semibold">Provider Health</span> shows whether the model stack is actually staying fast,
                stable, and resilient under live traffic.
              </div>
            </div>
          </div>
        </aside>

        <section className="min-w-0 space-y-4">
          {!selectedInstance ? (
            <div className="app-studio-panel rounded-2xl border border-dashed border-gray-300 px-4 py-8 text-sm text-gray-500">
              Pick an instance to inspect live provider health.
            </div>
          ) : (
            <>
              <div className="app-studio-panel overflow-hidden rounded-[28px] border border-gray-200 shadow-sm">
                <div className="app-studio-header px-5 py-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-lg font-semibold text-gray-900">{selectedInstance.display_name}</h2>
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${statusClasses(selectedInstance.status)}`}>
                          {selectedInstance.status}
                        </span>
                      </div>
                      <div className="mt-1 text-sm text-gray-500">{selectedInstance.name}</div>
                      <p className="mt-3 max-w-3xl text-sm leading-6 text-gray-600">
                        Watch request latency, timeout bursts, and whether the active model profile is recovering cleanly or
                        pushing users into a slow perceived response.
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Link
                        to={`/feature-packs?instance=${selectedInstance.id}`}
                        className="inline-flex items-center justify-center rounded-xl border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                      >
                        Feature Packs
                      </Link>
                      <Link
                        to={`/instances/${selectedInstance.id}`}
                        className="inline-flex items-center justify-center rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100"
                      >
                        Open bot
                      </Link>
                    </div>
                  </div>

                  {selectedInstance.status !== "running" && (
                    <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                      This bot is not running right now. Health history can still load, but live responsiveness will not update until the
                      instance is running again.
                    </div>
                  )}
                </div>
              </div>

              <ProviderHealthPanel
                instanceId={selectedInstance.id}
                enabled
                showLookbackControls
                lookbackHours={lookbackHours}
                onLookbackChange={setLookbackHours}
              />
            </>
          )}
        </section>
      </div>
    </div>
  );
}
