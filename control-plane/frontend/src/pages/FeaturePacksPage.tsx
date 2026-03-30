import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Bot, CheckCircle2, CircleDashed, Search, Sparkles } from "lucide-react";
import FeaturePackPanel from "@/components/FeaturePackPanel";
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
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-700">
            <Sparkles size={13} />
            Feature Packs
          </div>
          <h1 className="mt-3 text-2xl font-semibold text-gray-900">Capability catalog for live OpenClaw bots</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">
            Browse the reusable packs once, then apply them to the right bot with a clear setup flow.
            This page is optimized for “what is active, what does it do, and what should I install next”.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">Instances</div>
            <div className="mt-2 text-lg font-semibold text-gray-900">{instances.length}</div>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">Running</div>
            <div className="mt-2 flex items-center gap-2 text-lg font-semibold text-gray-900">
              <CheckCircle2 size={18} className="text-emerald-500" />
              {runningCount}
            </div>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">Setup mode</div>
            <div className="mt-2 flex items-center gap-2 text-lg font-semibold text-gray-900">
              <Bot size={18} className="text-blue-500" />
              Per bot
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Choose bot</h2>
              <p className="mt-1 text-xs leading-5 text-gray-500">
                Packs are applied per instance. Pick the exact bot you want to configure.
              </p>
            </div>

            <label className="mt-4 block space-y-1">
              <div className="text-xs font-medium text-gray-600">Search instances</div>
              <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
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

          <div className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
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
        </aside>

        <section className="min-w-0 space-y-4">
          {!selectedInstance ? (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-4 py-8 text-sm text-gray-500">
              Pick an instance to manage its feature packs.
            </div>
          ) : (
            <>
              <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
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

              {selectedInstance.status === "running" ? (
                <FeaturePackPanel instanceId={selectedInstance.id} enabled />
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
