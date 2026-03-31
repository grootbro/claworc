import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  Bot,
  Boxes,
  CheckCircle2,
  Download,
  Radio,
  RefreshCw,
  Search,
  Shield,
  Sparkles,
  Upload,
  Volume2,
  Wand2,
} from "lucide-react";
import { exportBlueprint } from "@/api/blueprints";
import { useBlueprints, useApplyInstanceBlueprint, useCaptureInstanceBlueprint, useImportBlueprint } from "@/hooks/useBlueprints";
import { useInstanceFeaturePacks, useInstances } from "@/hooks/useInstances";
import type { Blueprint } from "@/types/blueprint";
import { errorToast } from "@/utils/toast";

type BlueprintView = "all" | "ready" | "aligned" | "secrets";
type FitKind = "select" | "source" | "aligned" | "partial" | "fresh";

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

function packTone(category: string) {
  switch (category) {
    case "sales-oracle":
      return "border-violet-200 bg-violet-50 text-violet-700";
    case "access-control":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "channel-behavior":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "channel-integration":
      return "border-cyan-200 bg-cyan-50 text-cyan-700";
    case "voice-tts":
      return "border-amber-200 bg-amber-50 text-amber-700";
    default:
      return "border-gray-200 bg-gray-50 text-gray-700";
  }
}

function fitTone(kind: FitKind) {
  switch (kind) {
    case "source":
    case "aligned":
      return {
        shell: "border-emerald-200 bg-emerald-50 text-emerald-900",
        chip: "bg-emerald-600 text-white",
      };
    case "partial":
      return {
        shell: "border-amber-200 bg-amber-50 text-amber-900",
        chip: "bg-amber-500 text-white",
      };
    case "fresh":
      return {
        shell: "border-violet-200 bg-violet-50 text-violet-900",
        chip: "bg-violet-600 text-white",
      };
    default:
      return {
        shell: "border-gray-200 bg-gray-50 text-gray-800",
        chip: "bg-gray-800 text-white",
      };
  }
}

function detectSignals(blueprint: Blueprint) {
  const slugs = blueprint.packs.map((pack) => pack.slug);
  return [
    slugs.some((slug) => slug.includes("core")) && { key: "core", label: "Brand core", icon: Bot },
    slugs.some((slug) => slug.includes("access") || slug.includes("trust")) && {
      key: "trust",
      label: "Trust",
      icon: Shield,
    },
    slugs.some((slug) => slug.includes("vk") || slug.includes("telegram") || slug.includes("max")) && {
      key: "channels",
      label: "Channels",
      icon: Radio,
    },
    slugs.some((slug) => slug.includes("voice") || slug.includes("elevenlabs")) && {
      key: "voice",
      label: "Voice",
      icon: Volume2,
    },
  ].filter(Boolean) as Array<{ key: string; label: string; icon: typeof Bot }>;
}

function getBlueprintFit(
  blueprint: Blueprint,
  selectedInstance: { id: number; display_name: string } | undefined,
  activePackSlugs: Set<string>,
) {
  if (!selectedInstance) {
    return {
      kind: "select" as const,
      title: "Choose a target bot",
      detail: "Pick the exact bot first, then Claworc can show what already matches and what this blueprint would still add.",
      missing: blueprint.pack_count,
    };
  }

  if (blueprint.source_instance_id && blueprint.source_instance_id === selectedInstance.id) {
    return {
      kind: "source" as const,
      title: "Captured from this bot",
      detail: "This is already the source profile. Refresh it here whenever you intentionally improve the live bot.",
      missing: 0,
    };
  }

  const blueprintSlugs = blueprint.packs.map((pack) => pack.slug);
  const overlap = blueprintSlugs.filter((slug) => activePackSlugs.has(slug)).length;
  const missing = blueprintSlugs.length - overlap;

  if (missing === 0) {
    return {
      kind: "aligned" as const,
      title: "Already aligned",
      detail: "The full pack stack from this blueprint is already active on the selected bot.",
      missing,
    };
  }

  if (overlap === 0) {
    return {
      kind: "fresh" as const,
      title: "Fresh stack",
      detail: `This will layer ${blueprintSlugs.length} packs onto ${selectedInstance.display_name} from scratch.`,
      missing,
    };
  }

  return {
    kind: "partial" as const,
    title: `Adds ${missing} pack${missing === 1 ? "" : "s"}`,
    detail: `${overlap}/${blueprintSlugs.length} packs are already present on ${selectedInstance.display_name}.`,
    missing,
  };
}

export default function BlueprintsPage() {
  const { data: blueprints = [], isLoading, error } = useBlueprints();
  const { data: instances = [] } = useInstances();
  const captureMutation = useCaptureInstanceBlueprint();
  const applyMutation = useApplyInstanceBlueprint();
  const importMutation = useImportBlueprint();
  const [searchParams, setSearchParams] = useSearchParams();
  const [instanceSearch, setInstanceSearch] = useState("");
  const [blueprintSearch, setBlueprintSearch] = useState("");
  const [view, setView] = useState<BlueprintView>("all");
  const [captureName, setCaptureName] = useState("");
  const [captureSummary, setCaptureSummary] = useState("");
  const importInputRef = useRef<HTMLInputElement | null>(null);

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
    if (!sortedInstances.length || selectedId || !defaultInstanceId) {
      return;
    }
    setSearchParams({ instance: String(defaultInstanceId) }, { replace: true });
  }, [defaultInstanceId, selectedId, setSearchParams, sortedInstances.length]);

  const selectedInstance =
    sortedInstances.find((instance) => instance.id === selectedId) ??
    sortedInstances.find((instance) => instance.id === defaultInstanceId);

  const { data: selectedFeaturePacks = [] } = useInstanceFeaturePacks(selectedInstance?.id ?? 0, Boolean(selectedInstance));

  useEffect(() => {
    if (!selectedInstance) {
      return;
    }
    setCaptureName((current) => current || `${selectedInstance.display_name} Blueprint`);
    setCaptureSummary((current) =>
      current ||
      `Reusable studio profile captured from ${selectedInstance.display_name}. Reapply it to new or existing bots without rebuilding the same pack chain by hand.`,
    );
  }, [selectedInstance]);

  const selectedActivePackSlugs = useMemo(
    () => new Set(selectedFeaturePacks.filter((pack) => pack.applied).map((pack) => pack.slug)),
    [selectedFeaturePacks],
  );

  const selectedPackSummary = useMemo(() => {
    const applied = selectedFeaturePacks.filter((pack) => pack.applied);
    const categories = new Set(applied.map((pack) => pack.category));
    return {
      appliedCount: applied.length,
      categories: categories.size,
      hasVoice: applied.some((pack) => pack.slug.includes("voice") || pack.slug.includes("elevenlabs")),
      hasTrust: applied.some((pack) => pack.slug.includes("access") || pack.slug.includes("trust")),
      hasChannels: applied.some((pack) => pack.category === "channel-integration" || pack.category === "channel-behavior"),
    };
  }, [selectedFeaturePacks]);

  const blueprintEntries = useMemo(() => {
    return blueprints.map((blueprint) => {
      const fit = getBlueprintFit(blueprint, selectedInstance, selectedActivePackSlugs);
      const signals = detectSignals(blueprint);
      return {
        blueprint,
        fit,
        signals,
        secretsCount: blueprint.packs.filter((pack) => pack.requires_secret_inputs).length,
      };
    });
  }, [blueprints, selectedActivePackSlugs, selectedInstance]);

  const filteredBlueprints = useMemo(() => {
    const query = deferredBlueprintSearch.trim().toLowerCase();

    return blueprintEntries.filter(({ blueprint, fit, signals }) => {
      if (view === "ready" && (fit.kind === "aligned" || fit.kind === "source" || fit.kind === "select")) {
        return false;
      }
      if (view === "aligned" && fit.kind !== "aligned" && fit.kind !== "source") {
        return false;
      }
      if (view === "secrets" && !blueprint.requires_secrets) {
        return false;
      }

      if (!query) {
        return true;
      }

      const haystack = [
        blueprint.name,
        blueprint.slug,
        blueprint.summary,
        blueprint.source_instance_name,
        ...signals.map((signal) => signal.label),
        ...blueprint.packs.map((pack) => `${pack.name} ${pack.category} ${pack.summary}`),
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [blueprintEntries, deferredBlueprintSearch, view]);

  const runningCount = instances.filter((instance) => instance.status === "running").length;
  const secretsBlueprintCount = blueprints.filter((blueprint) => blueprint.requires_secrets).length;
  const readyNowCount = blueprintEntries.filter(({ fit }) => fit.kind === "partial" || fit.kind === "fresh").length;

  const handleExport = async (slug: string) => {
    try {
      const { blob, filename } = await exportBlueprint(slug);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      errorToast("Failed to export blueprint", error);
    }
  };

  const handleImport = async (file: File | null) => {
    if (!file) {
      return;
    }
    await importMutation.mutateAsync(file);
  };

  return (
    <div className="blueprint-studio space-y-6">
      <section className="overflow-hidden rounded-[28px] border border-slate-800 bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.18),_transparent_30%),radial-gradient(circle_at_top_right,_rgba(245,158,11,0.18),_transparent_28%),linear-gradient(135deg,#0b1220_0%,#101827_48%,#162032_100%)] p-6 text-white shadow-[0_24px_80px_rgba(15,23,42,0.35)]">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-4xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-200">
              <Sparkles size={13} />
              Blueprint Studio
            </div>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white">Reusable branded bot systems</h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300">
              Save a known-good live bot as a reusable studio blueprint, compare it against the selected target, and roll it out without rebuilding the same
              trust, voice, channel, and oracle stack by hand.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 xl:min-w-[420px]">
            <div className="rounded-2xl border border-white/10 bg-white/8 px-4 py-4 backdrop-blur">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Library</div>
              <div className="mt-2 text-2xl font-semibold text-white">{blueprints.length}</div>
              <div className="mt-1 text-xs text-slate-400">Saved studio profiles</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/8 px-4 py-4 backdrop-blur">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Ready now</div>
              <div className="mt-2 text-2xl font-semibold text-white">{readyNowCount}</div>
              <div className="mt-1 text-xs text-slate-400">Useful for the selected bot</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/8 px-4 py-4 backdrop-blur">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Secrets</div>
              <div className="mt-2 flex items-center gap-2 text-2xl font-semibold text-white">
                <CheckCircle2 size={18} className="text-amber-300" />
                {secretsBlueprintCount}
              </div>
              <div className="mt-1 text-xs text-slate-400">Need bot-specific tokens</div>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
          <div className="app-studio-panel rounded-[26px] border border-slate-200 p-4 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Bot size={16} className="text-emerald-600" />
              Source or target bot
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              Pick the live bot you want to capture now, or the target bot you want to compare and apply a saved blueprint to.
            </p>

            <label className="mt-4 block space-y-1">
              <div className="text-xs font-medium text-slate-600">Search bots</div>
              <div className="app-studio-input-shell flex items-center gap-2 rounded-2xl border border-slate-200 px-3 py-2.5">
                <Search size={16} className="text-slate-400" />
                <input
                  value={instanceSearch}
                  onChange={(event) => setInstanceSearch(event.target.value)}
                  placeholder="NeoDome, Shirokov, ravefox..."
                  className="w-full border-none bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
                />
              </div>
            </label>
          </div>

          <div className="app-studio-panel rounded-[26px] border border-slate-200 p-3 shadow-sm">
            {filteredInstances.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-sm text-slate-500">No bots match this search.</div>
            ) : (
              <div className="space-y-2">
                {filteredInstances.map((instance) => {
                  const isSelected = selectedInstance?.id === instance.id;
                  return (
                    <button
                      key={instance.id}
                      type="button"
                      onClick={() => setSearchParams({ instance: String(instance.id) })}
                      className={`w-full rounded-[22px] border px-3 py-3 text-left transition-all ${
                        isSelected
                          ? "border-emerald-200 bg-emerald-50 shadow-sm"
                          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-slate-900">{instance.display_name}</div>
                          <div className="mt-1 truncate text-xs text-slate-500">{instance.name}</div>
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
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Studio notes</div>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-emerald-900">
              <li>Blueprints replay packs in order, so the same safe backup and restart rules still apply.</li>
              <li>Secrets stay masked on purpose. Re-enter bot-specific tokens only where needed.</li>
              <li>Capture again after deliberate improvements so your reusable baseline stays fresh.</li>
            </ul>
          </div>
        </aside>

        <section className="space-y-5">
          {selectedInstance && (
            <div className="app-studio-panel overflow-hidden rounded-[28px] border border-slate-200 shadow-sm">
              <div className="app-studio-warm-header border-b border-slate-200 px-5 py-5">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold text-slate-900">{selectedInstance.display_name}</h2>
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${statusClasses(selectedInstance.status)}`}>
                        {selectedInstance.status}
                      </span>
                    </div>
                    <div className="mt-1 text-sm text-slate-500">{selectedInstance.name}</div>
                    <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
                      This is the working bot currently in focus. Capture it as a reusable blueprint or use it as the target when you want to compare what a
                      saved studio profile would change.
                    </p>
                  </div>

                  <Link
                    to={`/instances/${selectedInstance.id}#features`}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-white"
                  >
                    Open bot features
                    <ArrowRight size={15} />
                  </Link>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-4">
                  <div className="rounded-2xl border border-white/70 bg-white/80 px-4 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Running bots</div>
                    <div className="mt-2 text-lg font-semibold text-slate-900">{runningCount}</div>
                  </div>
                  <div className="rounded-2xl border border-white/70 bg-white/80 px-4 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Active packs</div>
                    <div className="mt-2 text-lg font-semibold text-slate-900">{selectedPackSummary.appliedCount}</div>
                  </div>
                  <div className="rounded-2xl border border-white/70 bg-white/80 px-4 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Pack families</div>
                    <div className="mt-2 text-lg font-semibold text-slate-900">{selectedPackSummary.categories}</div>
                  </div>
                  <div className="rounded-2xl border border-white/70 bg-white/80 px-4 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Live stack</div>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                      {selectedPackSummary.hasTrust && <span className="rounded-full bg-emerald-100 px-2 py-1 text-emerald-700">Trust</span>}
                      {selectedPackSummary.hasChannels && <span className="rounded-full bg-sky-100 px-2 py-1 text-sky-700">Channels</span>}
                      {selectedPackSummary.hasVoice && <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-700">Voice</span>}
                      {!selectedPackSummary.hasTrust && !selectedPackSummary.hasChannels && !selectedPackSummary.hasVoice && (
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">Base only</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid gap-5 px-5 py-5 xl:grid-cols-[minmax(0,1fr)_360px]">
                <div className="app-studio-soft rounded-[24px] border border-slate-200 p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <Wand2 size={16} className="text-violet-500" />
                    Capture this bot as a studio blueprint
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    Save the current pack chain and live inputs from this bot, then reuse the same structure during create or on another existing bot.
                  </p>

                  <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    <label className="space-y-1.5">
                      <div className="text-sm font-medium text-slate-800">Blueprint name</div>
                      <input
                        value={captureName}
                        onChange={(event) => setCaptureName(event.target.value)}
                        className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/15"
                      />
                    </label>
                    <label className="space-y-1.5">
                      <div className="text-sm font-medium text-slate-800">Slug</div>
                      <input
                        value={slugify(captureName)}
                        readOnly
                        className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-500"
                      />
                    </label>
                  </div>

                  <label className="mt-4 block space-y-1.5">
                    <div className="text-sm font-medium text-slate-800">Summary</div>
                    <textarea
                      rows={3}
                      value={captureSummary}
                      onChange={(event) => setCaptureSummary(event.target.value)}
                      className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/15"
                    />
                  </label>
                </div>

                <div className="app-studio-panel rounded-[24px] border border-slate-200 p-4">
                  <div className="text-sm font-semibold text-slate-900">Capture guidance</div>
                  <div className="mt-3 space-y-3 text-sm leading-6 text-slate-600">
                    <p>Best for mature branded bots like NeoDome, Shirokov, or future client assistants that already have the right voice, trust, and channel stack.</p>
                    <p>Do not rely on a blueprint to silently copy secrets. Tokens stay bot-specific and should still be reviewed after apply.</p>
                    <p>Re-capture after meaningful improvements instead of stacking one-off live hotfixes forever.</p>
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
                    className="mt-5 w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {captureMutation.isPending ? "Saving blueprint..." : "Save blueprint"}
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="app-studio-panel overflow-hidden rounded-[28px] border border-slate-200 shadow-sm">
            <div className="border-b border-slate-200 px-5 py-5">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-violet-700">
                    <Boxes size={13} />
                    Library
                  </div>
                  <h3 className="mt-3 text-xl font-semibold text-slate-900">Blueprint library</h3>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                    Compare saved templates against the selected bot, spot what already matches, and apply only when the target really needs that branded stack.
                  </p>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <label className="space-y-1">
                    <div className="text-xs font-medium text-slate-600">Search blueprints</div>
                    <div className="app-studio-input-shell flex items-center gap-2 rounded-2xl border border-slate-200 px-3 py-2.5">
                      <Search size={16} className="text-slate-400" />
                      <input
                        value={blueprintSearch}
                        onChange={(event) => setBlueprintSearch(event.target.value)}
                        placeholder="NeoDome, trust, VK, voice..."
                        className="w-full min-w-[240px] border-none bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
                      />
                    </div>
                  </label>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {[
                  { key: "all", label: "All studio profiles" },
                  { key: "ready", label: "Ready for this bot" },
                  { key: "aligned", label: "Already aligned" },
                  { key: "secrets", label: "Need secret review" },
                ].map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => setView(option.key as BlueprintView)}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                      view === option.key
                        ? "bg-slate-900 text-white"
                        : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => importInputRef.current?.click()}
                  disabled={importMutation.isPending}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Upload size={13} />
                  {importMutation.isPending ? "Importing..." : "Import blueprint"}
                </button>
                <input
                  ref={importInputRef}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    void handleImport(file);
                    event.currentTarget.value = "";
                  }}
                />
              </div>
            </div>

            <div className="px-5 py-5">
              {isLoading ? (
                <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-sm text-slate-500">Loading blueprints...</div>
              ) : error ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">Failed to load blueprints.</div>
              ) : filteredBlueprints.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-sm text-slate-500">
                  No blueprints match this view yet. Capture a live bot, or change the filter to see the rest of the studio library.
                </div>
              ) : (
                <div className="space-y-5">
                  {filteredBlueprints.map(({ blueprint, fit, signals, secretsCount }) => {
                    const fitStyle = fitTone(fit.kind);

                    return (
                      <article key={blueprint.slug} className="app-studio-panel overflow-hidden rounded-[26px] border border-slate-200 shadow-sm">
                        <div className="app-studio-lilac-header border-b border-slate-200 px-5 py-5">
                          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <h4 className="text-lg font-semibold text-slate-900">{blueprint.name}</h4>
                                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600">
                                  {blueprint.pack_count} pack{blueprint.pack_count === 1 ? "" : "s"}
                                </span>
                                {blueprint.requires_secrets && (
                                  <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700">
                                    {secretsCount} secret-aware input{secretsCount === 1 ? "" : "s"}
                                  </span>
                                )}
                              </div>

                              {blueprint.summary && <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">{blueprint.summary}</p>}

                              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                                <span>v{blueprint.version}</span>
                                {blueprint.source_instance_name && <span>Captured from {blueprint.source_instance_name}</span>}
                                <span>Updated {new Date(blueprint.updated_at).toLocaleString()}</span>
                              </div>
                            </div>

                            <div className={`rounded-[22px] border px-4 py-3 ${fitStyle.shell} xl:w-[300px]`}>
                              <div className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${fitStyle.chip}`}>
                                {fit.title}
                              </div>
                              <p className="mt-3 text-sm leading-6">{fit.detail}</p>
                            </div>
                          </div>

                          <div className="mt-4 flex flex-wrap gap-2">
                            {signals.map((signal) => {
                              const Icon = signal.icon;
                              return (
                                <span
                                  key={`${blueprint.slug}-${signal.key}`}
                                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700"
                                >
                                  <Icon size={13} />
                                  {signal.label}
                                </span>
                              );
                            })}
                            {signals.length === 0 && (
                              <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-500">General stack</span>
                            )}
                          </div>
                        </div>

                        <div className="grid gap-5 px-5 py-5 xl:grid-cols-[minmax(0,1fr)_290px]">
                          <div className="space-y-4">
                            <div className="app-studio-soft rounded-[22px] border border-slate-200 p-4">
                              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Pack chain</div>
                              <div className="mt-3 flex flex-wrap gap-2">
                                {blueprint.packs.map((pack, index) => (
                                  <span
                                    key={`${blueprint.slug}-${pack.slug}`}
                                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${packTone(pack.category)}`}
                                  >
                                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/80 text-[10px] font-semibold text-slate-700">
                                      {index + 1}
                                    </span>
                                    {pack.name}
                                  </span>
                                ))}
                              </div>
                            </div>

                            <div className="grid gap-3 sm:grid-cols-2">
                              <div className="app-studio-panel rounded-[22px] border border-slate-200 p-4">
                                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Best use</div>
                                <p className="mt-3 text-sm leading-6 text-slate-600">
                                  Use this when you want a repeatable branded starting point instead of rebuilding trust, voice, and channel behavior manually.
                                </p>
                              </div>
                              <div className="app-studio-panel rounded-[22px] border border-slate-200 p-4">
                                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Operator note</div>
                                <p className="mt-3 text-sm leading-6 text-slate-600">
                                  Apply here for an existing bot, or use it during create when you want the new bot to boot directly into a known-good stack.
                                </p>
                              </div>
                            </div>
                          </div>

                          <div className="space-y-3">
                            <div className="app-studio-soft rounded-[22px] border border-slate-200 p-4">
                              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Apply path</div>
                              <div className="mt-3 space-y-2 text-sm text-slate-600">
                                <div>1. Compare against the selected bot.</div>
                                <div>2. Re-enter only bot-specific secrets if needed.</div>
                                <div>3. Let the feature-pack engine write and restart safely.</div>
                              </div>
                            </div>

                            <button
                              type="button"
                              disabled={!selectedInstance || selectedInstance.status !== "running" || applyMutation.isPending || fit.kind === "source"}
                              onClick={() => selectedInstance && applyMutation.mutate({ id: selectedInstance.id, slug: blueprint.slug })}
                              className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {applyMutation.isPending && applyMutation.variables?.slug === blueprint.slug
                                ? "Applying blueprint..."
                                : fit.kind === "aligned"
                                  ? `Reapply to ${selectedInstance?.display_name}`
                                  : selectedInstance
                                    ? `Apply to ${selectedInstance.display_name}`
                                    : "Choose target bot"}
                            </button>
                            {selectedInstance && blueprint.source_instance_id === selectedInstance.id && (
                              <button
                                type="button"
                                disabled={captureMutation.isPending}
                                onClick={() =>
                                  captureMutation.mutate({
                                    id: selectedInstance.id,
                                    payload: {
                                      name: blueprint.name,
                                      summary: blueprint.summary || "",
                                      slug: blueprint.slug,
                                    },
                                  })
                                }
                                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                <RefreshCw size={15} />
                                {captureMutation.isPending ? "Refreshing..." : "Refresh from this bot"}
                              </button>
                            )}
                            <Link
                              to={`/instances/new?blueprint=${encodeURIComponent(blueprint.slug)}`}
                              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                            >
                              Use during create
                              <ArrowRight size={15} />
                            </Link>
                            <button
                              type="button"
                              onClick={() => void handleExport(blueprint.slug)}
                              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                            >
                              <Download size={15} />
                              Export JSON bundle
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
