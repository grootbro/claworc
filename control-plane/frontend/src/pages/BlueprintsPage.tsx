import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, Search, Sparkles, Wand2 } from "lucide-react";
import { useBlueprints, useApplyInstanceBlueprint, useCaptureInstanceBlueprint } from "@/hooks/useBlueprints";
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

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export default function BlueprintsPage() {
  const { data: blueprints = [], isLoading, error } = useBlueprints();
  const { data: instances = [] } = useInstances();
  const captureMutation = useCaptureInstanceBlueprint();
  const applyMutation = useApplyInstanceBlueprint();
  const [searchParams, setSearchParams] = useSearchParams();
  const [instanceSearch, setInstanceSearch] = useState("");
  const [blueprintSearch, setBlueprintSearch] = useState("");
  const [captureName, setCaptureName] = useState("");
  const [captureSummary, setCaptureSummary] = useState("");

  const deferredInstanceSearch = useDeferredValue(instanceSearch);
  const deferredBlueprintSearch = useDeferredValue(blueprintSearch);
  const selectedId = Number(searchParams.get("instance") || 0);

  const sortedInstances = useMemo(() => sortInstances(instances), [instances]);
  const filteredInstances = useMemo(() => {
    const query = deferredInstanceSearch.trim().toLowerCase();
    if (!query) {
      return sortedInstances;
    }
    return sortedInstances.filter((instance) =>
      `${instance.display_name} ${instance.name} ${instance.status}`.toLowerCase().includes(query),
    );
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

  useEffect(() => {
    if (!selectedInstance) {
      return;
    }
    setCaptureName((current) => current || `${selectedInstance.display_name} Blueprint`);
    setCaptureSummary((current) =>
      current || `Reusable bot profile captured from ${selectedInstance.display_name}. Apply it to new or existing bots without hand-editing packs one by one.`,
    );
  }, [selectedInstance]);

  const filteredBlueprints = useMemo(() => {
    const query = deferredBlueprintSearch.trim().toLowerCase();
    if (!query) {
      return blueprints;
    }
    return blueprints.filter((blueprint) => {
      const haystack = [
        blueprint.name,
        blueprint.slug,
        blueprint.summary,
        blueprint.source_instance_name,
        ...blueprint.packs.map((pack) => `${pack.name} ${pack.category} ${pack.summary}`),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [blueprints, deferredBlueprintSearch]);

  const runningCount = instances.filter((instance) => instance.status === "running").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-700">
            <Sparkles size={13} />
            Blueprints
          </div>
          <h1 className="mt-3 text-2xl font-semibold text-gray-900">Reusable bot profiles</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">
            Capture a live bot as a reusable blueprint, then apply the same pack stack to another bot during create or after it is already running.
            Secrets stay masked on purpose, so channel tokens remain bot-specific.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">Blueprints</div>
            <div className="mt-2 text-lg font-semibold text-gray-900">{blueprints.length}</div>
          </div>
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
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Working bot</h2>
              <p className="mt-1 text-xs leading-5 text-gray-500">
                Pick the bot you want to capture from right now, or the bot you want to apply a saved blueprint to.
              </p>
            </div>

            <label className="mt-4 block space-y-1">
              <div className="text-xs font-medium text-gray-600">Search instances</div>
              <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
                <Search size={16} className="text-gray-400" />
                <input
                  value={instanceSearch}
                  onChange={(event) => setInstanceSearch(event.target.value)}
                  placeholder="NeoDome, ravefox, sales..."
                  className="w-full border-none bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-400"
                />
              </div>
            </label>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
            {filteredInstances.length === 0 ? (
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

        <section className="space-y-5">
          {selectedInstance && (
            <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold text-gray-900">{selectedInstance.display_name}</h2>
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${statusClasses(selectedInstance.status)}`}>
                      {selectedInstance.status}
                    </span>
                  </div>
                  <div className="mt-1 text-sm text-gray-500">{selectedInstance.name}</div>
                  <p className="mt-3 max-w-3xl text-sm text-gray-600">
                    Save the current live state of this bot as a reusable blueprint, then reapply it elsewhere without rebuilding the pack stack from scratch.
                  </p>
                </div>

                <Link
                  to={`/instances/${selectedInstance.id}#features`}
                  className="inline-flex items-center justify-center rounded-xl border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                >
                  Open bot features
                </Link>
              </div>

              <div className="mt-5 rounded-2xl border border-gray-200 bg-gray-50 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                  <Wand2 size={16} className="text-blue-500" />
                  Save current bot as blueprint
                </div>
                <div className="mt-2 text-sm text-gray-600">
                  This captures the active pack stack and current inputs from the live bot. Secrets stay masked and must be entered per target bot later.
                </div>

                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <label className="space-y-1.5">
                    <div className="text-sm font-medium text-gray-800">Blueprint name</div>
                    <input
                      value={captureName}
                      onChange={(event) => setCaptureName(event.target.value)}
                      className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    />
                  </label>
                  <label className="space-y-1.5">
                    <div className="text-sm font-medium text-gray-800">Slug</div>
                    <input
                      value={slugify(captureName)}
                      readOnly
                      className="w-full rounded-xl border border-gray-200 bg-gray-100 px-3 py-2.5 text-sm text-gray-500"
                    />
                  </label>
                </div>

                <label className="mt-4 block space-y-1.5">
                  <div className="text-sm font-medium text-gray-800">Summary</div>
                  <textarea
                    rows={3}
                    value={captureSummary}
                    onChange={(event) => setCaptureSummary(event.target.value)}
                    className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </label>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="text-xs leading-5 text-gray-500">
                    Use this for NeoDome-style thematic bots, then tweak only the bot-specific channel tokens or manager ids afterward.
                  </div>
                  <button
                    type="button"
                    disabled={selectedInstance.status !== "running" || captureMutation.isPending || !captureName.trim()}
                    onClick={() =>
                      captureMutation.mutate({
                        id: selectedInstance.id,
                        payload: {
                          name: captureName.trim(),
                          summary: captureSummary.trim(),
                          slug: slugify(captureName),
                        },
                      })
                    }
                    className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {captureMutation.isPending ? "Saving..." : "Save blueprint"}
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Blueprint catalog</h3>
                <p className="mt-1 text-sm text-gray-600">
                  Apply one of these saved profiles to the selected bot, or pick one during create when you want a new bot to boot straight into a known personality and workflow.
                </p>
              </div>

              <label className="space-y-1">
                <div className="text-xs font-medium text-gray-600">Search blueprints</div>
                <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
                  <Search size={16} className="text-gray-400" />
                  <input
                    value={blueprintSearch}
                    onChange={(event) => setBlueprintSearch(event.target.value)}
                    placeholder="NeoDome, VK sales, trust..."
                    className="w-full min-w-[240px] border-none bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-400"
                  />
                </div>
              </label>
            </div>

            <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
              Applying a blueprint uses the same safe feature-pack engine underneath. That means backups still happen automatically, and secrets remain per bot instead of being silently copied around.
            </div>

            {isLoading ? (
              <div className="mt-4 rounded-xl border border-dashed border-gray-300 px-4 py-8 text-sm text-gray-500">
                Loading blueprints...
              </div>
            ) : error ? (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                Failed to load blueprints.
              </div>
            ) : filteredBlueprints.length === 0 ? (
              <div className="mt-4 rounded-xl border border-dashed border-gray-300 px-4 py-8 text-sm text-gray-500">
                Save your first live bot as a blueprint, and it will show up here.
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                {filteredBlueprints.map((blueprint) => (
                  <article key={blueprint.slug} className="rounded-2xl border border-gray-200 bg-gray-50/60 p-4">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="text-base font-semibold text-gray-900">{blueprint.name}</h4>
                          <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-gray-600 border border-gray-200">
                            {blueprint.pack_count} pack{blueprint.pack_count === 1 ? "" : "s"}
                          </span>
                          {blueprint.requires_secrets && (
                            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700">
                              secrets need re-entry
                            </span>
                          )}
                        </div>
                        {blueprint.summary && (
                          <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">{blueprint.summary}</p>
                        )}
                        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                          <span>v{blueprint.version}</span>
                          {blueprint.source_instance_name && <span>Captured from {blueprint.source_instance_name}</span>}
                          <span>Updated {new Date(blueprint.updated_at).toLocaleString()}</span>
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2">
                          {blueprint.packs.map((pack) => (
                            <span
                              key={`${blueprint.slug}-${pack.slug}`}
                              className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-600"
                            >
                              {pack.name}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div className="flex shrink-0 flex-col gap-2 lg:w-52">
                        <button
                          type="button"
                          disabled={!selectedInstance || selectedInstance.status !== "running" || applyMutation.isPending}
                          onClick={() => selectedInstance && applyMutation.mutate({ id: selectedInstance.id, slug: blueprint.slug })}
                          className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {applyMutation.isPending && applyMutation.variables?.slug === blueprint.slug
                            ? "Applying..."
                            : selectedInstance
                              ? `Apply to ${selectedInstance.display_name}`
                              : "Choose bot first"}
                        </button>
                        <Link
                          to={`/instances/new?blueprint=${encodeURIComponent(blueprint.slug)}`}
                          className="inline-flex items-center justify-center rounded-xl border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                        >
                          Use during create
                        </Link>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
