import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Activity, CheckCircle2, Layers3, Search, Sparkles, Wand2 } from "lucide-react";
import FeaturePackPanel from "@/components/FeaturePackPanel";
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

export default function FeaturePacksPage() {
  const { data: instances = [], isLoading } = useInstances();
  const [searchParams, setSearchParams] = useSearchParams();
  const [instanceSearch, setInstanceSearch] = useState("");

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
    if (!sortedInstances.length || selectedId) {
      return;
    }
    if (!defaultInstanceId) {
      return;
    }
    setSearchParams({ instance: String(defaultInstanceId) }, { replace: true });
  }, [defaultInstanceId, selectedId, setSearchParams, sortedInstances.length]);

  const selectedInstance =
    sortedInstances.find((instance) => instance.id === selectedId) ??
    sortedInstances.find((instance) => instance.id === defaultInstanceId);

  const runningCount = instances.filter((instance) => instance.status === "running").length;

  return (
    <div className="feature-pack-index space-y-6">
      <section className="overflow-hidden rounded-[28px] border border-slate-800 bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.18),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(16,185,129,0.14),_transparent_24%),linear-gradient(135deg,#081220_0%,#0f1728_48%,#162033_100%)] p-6 text-white shadow-[0_24px_80px_rgba(15,23,42,0.35)]">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-4xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-blue-200">
              <Sparkles size={13} />
              Feature Packs
            </div>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white">Capability control studio</h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300">
              Feature Packs are the modular building blocks for live OpenClaw bots: channels, trust, voice, sales flow,
              responsiveness, and brand behavior. Pick the bot, see what is already shaping it, and install the next capability
              without hand-editing workspace files.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 xl:min-w-[420px]">
            <div className="rounded-2xl border border-white/10 bg-white/8 px-4 py-4 backdrop-blur">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Instances</div>
              <div className="mt-2 text-2xl font-semibold text-white">{instances.length}</div>
              <div className="mt-1 text-xs text-slate-400">Bots in this workspace</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/8 px-4 py-4 backdrop-blur">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Running</div>
              <div className="mt-2 flex items-center gap-2 text-2xl font-semibold text-white">
                <CheckCircle2 size={18} className="text-emerald-300" />
                {runningCount}
              </div>
              <div className="mt-1 text-xs text-slate-400">Ready for pack apply</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/8 px-4 py-4 backdrop-blur">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Mode</div>
              <div className="mt-2 flex items-center gap-2 text-2xl font-semibold text-white">
                <Layers3 size={18} className="text-blue-300" />
                Per bot
              </div>
              <div className="mt-1 text-xs text-slate-400">Modular capability layers</div>
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
                Packs are applied per instance. Pick the exact bot you want to configure.
              </p>
            </div>

            <label className="mt-4 block space-y-1">
              <div className="text-xs font-medium text-gray-600">Search instances</div>
              <div className="app-studio-input-shell flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2">
                <Search size={16} className="text-gray-400" />
                <input
                  value={instanceSearch}
                  onChange={(event) => setInstanceSearch(event.target.value)}
                  placeholder="NeoDome, ravefox, VK..."
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

              <div className="app-studio-note rounded-[26px] border border-emerald-200 p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Pack vs blueprint</div>
            <div className="mt-3 space-y-3 text-sm leading-6 text-emerald-950">
              <div>
                <span className="font-semibold">Feature Pack</span>: one reusable capability such as Trust, VK, Voice, or Responsiveness.
              </div>
              <div>
                <span className="font-semibold">Blueprint</span>: a saved composition of several packs that defines a full branded bot setup.
              </div>
              <Link
                to={selectedInstance ? `/blueprints?instance=${selectedInstance.id}` : "/blueprints"}
                className="inline-flex items-center gap-2 rounded-full border border-emerald-300 bg-white/80 px-3 py-1.5 text-xs font-medium text-emerald-800 transition-colors hover:bg-white"
              >
                <Wand2 size={13} />
                Open Blueprint Studio
              </Link>
            </div>
          </div>

          <div className="app-studio-panel rounded-[26px] border border-gray-200 p-4 shadow-sm">
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-700">
              <Activity size={13} />
              Operational layer
            </div>
            <div className="mt-3 text-sm font-semibold text-gray-900">Live provider health belongs next to packs</div>
            <div className="mt-2 text-sm leading-6 text-gray-600">
              Feature Packs show what the bot should be. Provider Health shows what the bot is actually doing right now: latency,
              errors, timeouts, and failover pressure from recent gateway logs.
            </div>
          </div>
        </aside>

        <section className="min-w-0 space-y-4">
          {!selectedInstance ? (
            <div className="app-studio-panel rounded-2xl border border-dashed border-gray-300 px-4 py-8 text-sm text-gray-500">
              Pick an instance to manage its feature packs.
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
                    <p className="mt-3 max-w-3xl text-sm text-gray-600">
                      Use packs here to layer channel support, access policy, sales workflows, or workspace behavior onto this
                      bot without editing its files by hand.
                    </p>
                  </div>

                  <Link
                    to={`/instances/${selectedInstance.id}#features`}
                    className="inline-flex items-center justify-center rounded-xl border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    Open instance workspace
                  </Link>
                </div>

                {selectedInstance.status !== "running" && (
                  <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    Feature packs need the bot to be running first, because `claworc` applies them over SSH inside the live OpenClaw home.
                  </div>
                )}
                </div>
              </div>

              {selectedInstance.status === "running" ? (
                <div className="space-y-4">
                  <ProviderHealthPanel instanceId={selectedInstance.id} enabled />
                  <FeaturePackPanel instanceId={selectedInstance.id} enabled />
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-amber-300 bg-amber-50 px-4 py-8 text-sm text-amber-800">
                  Start this bot first, then the pack catalog will become fully interactive.
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
