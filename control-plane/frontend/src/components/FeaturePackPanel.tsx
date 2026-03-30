import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Bot,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  Clock3,
  LockKeyhole,
  MessageSquareText,
  RefreshCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { useApplyInstanceFeaturePack, useInstanceFeaturePacks } from "@/hooks/useInstances";
import type { FeaturePackInput, FeaturePackModule, InstanceFeaturePack } from "@/types/instance";

interface FeaturePackPanelProps {
  instanceId: number;
  enabled?: boolean;
}

type PackFilter = "all" | "applied" | "available" | "overrides";

function inputDefault(pack: InstanceFeaturePack, input: FeaturePackInput): string {
  if (input.type === "secret") {
    return "";
  }
  return pack.current_inputs?.[input.key] ?? input.default_value ?? (input.type === "boolean" ? "false" : "");
}

function hasConfiguredSecret(pack: InstanceFeaturePack, input: FeaturePackInput): boolean {
  return input.type === "secret" && pack.current_inputs?.[input.key] === "__configured__";
}

function humanizeCategory(category: string): string {
  return category
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function categoryIcon(category: string) {
  if (category.includes("access")) {
    return ShieldCheck;
  }
  if (category.includes("channel") || category.includes("messenger")) {
    return MessageSquareText;
  }
  if (category.includes("sales") || category.includes("oracle") || category.includes("agent")) {
    return Bot;
  }
  return Boxes;
}

function normalizePreview(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= 44) {
    return compact;
  }
  return `${compact.slice(0, 41)}...`;
}

function hasRuntimeOverrides(pack: InstanceFeaturePack): boolean {
  return Object.keys(pack.runtime_overrides ?? {}).length > 0;
}

function inputPreview(
  pack: InstanceFeaturePack,
  values?: Record<string, string>,
  options: { includeEmpty?: boolean } = {},
): string[] {
  if (!values) {
    return [];
  }
  const preview: string[] = [];
  for (const input of pack.inputs) {
    if (!Object.prototype.hasOwnProperty.call(values, input.key)) {
      continue;
    }
    const current = values[input.key];
    if (input.type === "secret") {
      if (current === "__configured__") {
        preview.push(`${input.label}: configured`);
      } else if (options.includeEmpty) {
        preview.push(`${input.label}: not configured`);
      }
      continue;
    }
    if (current == null || current === "") {
      if (options.includeEmpty) {
        preview.push(`${input.label}: none`);
      }
      continue;
    }
    if (input.type === "boolean") {
      preview.push(`${input.label}: ${current === "true" ? "enabled" : "disabled"}`);
      continue;
    }
    preview.push(`${input.label}: ${normalizePreview(current)}`);
  }
  return preview;
}

interface InputSectionGroup {
  key: string;
  label: string;
  description?: string;
  inputs: FeaturePackInput[];
}

function inputSections(pack: InstanceFeaturePack): InputSectionGroup[] {
  const sections = new Map<string, InputSectionGroup>();
  for (const input of pack.inputs) {
    const sectionKey = (input.section ?? "General").trim() || "General";
    if (!sections.has(sectionKey)) {
      sections.set(sectionKey, {
        key: sectionKey.toLowerCase().replace(/\s+/g, "-"),
        label: sectionKey,
        description: input.section_description,
        inputs: [],
      });
    }
    const section = sections.get(sectionKey)!;
    if (!section.description && input.section_description) {
      section.description = input.section_description;
    }
    section.inputs.push(input);
  }
  return Array.from(sections.values());
}

function moduleAccentClasses(index: number): { border: string; bg: string; icon: string } {
  const palette = [
    { border: "border-blue-200", bg: "bg-blue-50/70", icon: "text-blue-700" },
    { border: "border-emerald-200", bg: "bg-emerald-50/70", icon: "text-emerald-700" },
    { border: "border-amber-200", bg: "bg-amber-50/70", icon: "text-amber-700" },
    { border: "border-violet-200", bg: "bg-violet-50/70", icon: "text-violet-700" },
  ] as const;
  return palette[index % palette.length] ?? palette[0];
}

function filterMatches(pack: InstanceFeaturePack, query: string): boolean {
  if (!query) {
    return true;
  }
  const haystack = [
    pack.name,
    pack.slug,
    pack.summary,
    pack.category,
    ...(pack.notes ?? []),
    ...pack.inputs.map((input) => `${input.label} ${input.description} ${input.key}`),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

function statusBadge(pack: InstanceFeaturePack, isAvailable: boolean): { label: string; className: string } {
  if (pack.applied) {
    if (hasRuntimeOverrides(pack)) {
      return { label: "Installed with overrides", className: "bg-amber-50 text-amber-700" };
    }
    if (pack.state_source === "live-state") {
      return { label: "Detected on this bot", className: "bg-amber-50 text-amber-700" };
    }
    return { label: "Installed on this bot", className: "bg-emerald-50 text-emerald-700" };
  }
  if (!isAvailable) {
    return { label: "Coming soon", className: "bg-gray-100 text-gray-600" };
  }
  return { label: "Ready to install", className: "bg-blue-50 text-blue-700" };
}

export default function FeaturePackPanel({ instanceId, enabled = true }: FeaturePackPanelProps) {
  const { data: packs = [], isLoading, error } = useInstanceFeaturePacks(instanceId, enabled);
  const applyMutation = useApplyInstanceFeaturePack();

  const [formValues, setFormValues] = useState<Record<string, Record<string, string>>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [searchInput, setSearchInput] = useState("");
  const [filter, setFilter] = useState<PackFilter>("all");
  const [category, setCategory] = useState("all");

  const deferredSearch = useDeferredValue(searchInput);

  useEffect(() => {
    if (!packs.length) {
      return;
    }
    setFormValues((current) => {
      const next = { ...current };
      let changed = false;
      for (const pack of packs) {
        if (next[pack.slug]) {
          continue;
        }
        next[pack.slug] = Object.fromEntries(
          pack.inputs.map((input) => [input.key, inputDefault(pack, input)]),
        );
        changed = true;
      }
      return changed ? next : current;
    });

    setExpanded((current) => {
      const next = { ...current };
      let changed = false;
      const hasAppliedOpen = packs.some((pack) => pack.applied && current[pack.slug]);
      for (const pack of packs) {
        if (next[pack.slug] !== undefined) {
          continue;
        }
        if ((!hasAppliedOpen && pack.applied) || (!packs.some((item) => current[item.slug] !== undefined) && packs[0]?.slug === pack.slug)) {
          next[pack.slug] = true;
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [packs]);

  const orderedPacks = useMemo(
    () => [...packs].sort((a, b) => Number(b.applied) - Number(a.applied) || a.category.localeCompare(b.category) || a.name.localeCompare(b.name)),
    [packs],
  );

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const pack of orderedPacks) {
      counts.set(pack.category, (counts.get(pack.category) ?? 0) + 1);
    }
    return counts;
  }, [orderedPacks]);

  const categoryOptions = useMemo(
    () => ["all", ...Array.from(categoryCounts.keys()).sort()],
    [categoryCounts],
  );

  useEffect(() => {
    if (category !== "all" && !categoryCounts.has(category)) {
      setCategory("all");
    }
  }, [category, categoryCounts]);

  const filteredPacks = useMemo(() => {
    const query = deferredSearch.trim().toLowerCase();
    return orderedPacks.filter((pack) => {
      if (filter === "applied" && !pack.applied) {
        return false;
      }
      if (filter === "available" && pack.applied) {
        return false;
      }
      if (filter === "overrides" && !hasRuntimeOverrides(pack)) {
        return false;
      }
      if (category !== "all" && pack.category !== category) {
        return false;
      }
      return filterMatches(pack, query);
    });
  }, [category, deferredSearch, filter, orderedPacks]);

  const activePacks = useMemo(() => filteredPacks.filter((pack) => pack.applied), [filteredPacks]);

  const catalogGroups = useMemo(() => {
    const groups = new Map<string, InstanceFeaturePack[]>();
    for (const pack of filteredPacks) {
      if (pack.applied) {
        continue;
      }
      if (!groups.has(pack.category)) {
        groups.set(pack.category, []);
      }
      groups.get(pack.category)?.push(pack);
    }
    return Array.from(groups.entries());
  }, [filteredPacks]);

  const totalCount = packs.length;
  const appliedCount = packs.filter((pack) => pack.applied).length;
  const availableCount = packs.filter((pack) => pack.available !== false && !pack.applied).length;
  const overrideCount = packs.filter((pack) => hasRuntimeOverrides(pack)).length;

  const handleChange = (slug: string, key: string, value: string) => {
    setFormValues((current) => ({
      ...current,
      [slug]: {
        ...(current[slug] ?? {}),
        [key]: value,
      },
    }));
  };

  const handleApply = (pack: InstanceFeaturePack) => {
    applyMutation.mutate(
      {
        id: instanceId,
        slug: pack.slug,
        inputs: formValues[pack.slug] ?? {},
      },
      {
        onSuccess: () => {
          setExpanded((current) => ({ ...current, [pack.slug]: true }));
          setFormValues((current) => {
            const nextValues = { ...(current[pack.slug] ?? {}) };
            let changed = false;
            for (const input of pack.inputs) {
              if (input.type !== "secret") {
                continue;
              }
              if ((nextValues[input.key] ?? "") === "") {
                continue;
              }
              nextValues[input.key] = "";
              changed = true;
            }
            if (!changed) {
              return current;
            }
            return {
              ...current,
              [pack.slug]: nextValues,
            };
          });
        },
      },
    );
  };

  const toggleExpanded = (slug: string) => {
    setExpanded((current) => ({
      ...current,
      [slug]: !current[slug],
    }));
  };

  return (
    <section className="overflow-hidden rounded-[30px] border border-gray-200 bg-white/95 shadow-[0_24px_64px_rgba(15,23,42,0.08)]">
      <div className="border-b border-gray-200 bg-[linear-gradient(135deg,rgba(37,99,235,0.08),transparent_38%),linear-gradient(180deg,rgba(248,250,252,0.9),rgba(255,255,255,0.96))] px-5 py-5 sm:px-6">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-700">
                <Sparkles size={13} />
                Feature Packs
              </div>
              <h3 className="mt-3 text-xl font-semibold text-gray-900">Capability control room</h3>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">
                See what is already shaping this bot, what differs from the saved baseline, and what you can add next without digging
                through config files by hand.
              </p>
            </div>

            <div className="flex flex-col gap-3 xl:items-end">
              <Link
                to={`/blueprints?instance=${instanceId}`}
                className="inline-flex items-center justify-center rounded-2xl border border-gray-300 bg-white/90 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                Open reusable blueprints
              </Link>
              <div className="max-w-sm text-xs leading-5 text-gray-500 xl:text-right">
                Capture this bot as a reusable template, then apply the same capability stack to a fresh bot during create or later.
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
              <CheckCircle2 size={14} />
              {appliedCount} active
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700">
              <CircleDashed size={14} />
              {availableCount} ready to add
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
              <RefreshCcw size={14} />
              {overrideCount} overrides
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600">
              <Boxes size={14} />
              {totalCount} packs in catalog
            </div>
          </div>
        </div>
      </div>

      <div className="border-b border-gray-200 px-5 py-4 sm:px-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <label className="space-y-1 xl:min-w-[24rem] xl:max-w-[32rem] xl:flex-1">
            <div className="text-xs font-medium uppercase tracking-[0.16em] text-gray-500">Search</div>
            <div className="flex items-center gap-2 rounded-2xl border border-gray-200 bg-gray-50 px-3 py-3 shadow-sm">
              <Search size={16} className="text-gray-400" />
              <input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Search by name, category, effect, or setting"
                className="w-full border-none bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-400"
              />
            </div>
          </label>

          <div className="flex flex-col gap-2 xl:items-end">
            <div className="text-xs font-medium uppercase tracking-[0.16em] text-gray-500">View</div>
            <div className="flex flex-wrap gap-2">
              {([
                { id: "all", label: "All packs" },
                { id: "applied", label: "Active now" },
                { id: "overrides", label: "Needs review" },
                { id: "available", label: "Ready to add" },
              ] as const).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setFilter(option.id)}
                  className={`rounded-full px-3 py-2 text-xs font-medium transition-colors ${
                    filter === option.id
                      ? "bg-gray-900 text-white"
                      : "border border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
            <SlidersHorizontal size={13} />
            Categories
          </div>
          {categoryOptions.map((option) => {
            const isSelected = category === option;
            const count = option === "all" ? totalCount : categoryCounts.get(option) ?? 0;
            return (
              <button
                key={option}
                type="button"
                onClick={() => setCategory(option)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  isSelected
                    ? "border-blue-200 bg-blue-50 text-blue-700"
                    : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50"
                }`}
              >
                {option === "all" ? "All categories" : humanizeCategory(option)} · {count}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-8 px-5 py-5 sm:px-6">
        {isLoading && (
          <div className="rounded-2xl border border-dashed border-gray-300 px-4 py-10 text-sm text-gray-500">
            Loading feature packs...
          </div>
        )}

        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Failed to load feature packs.
          </div>
        )}

        {!isLoading && !error && filteredPacks.length === 0 && (
          <div className="rounded-2xl border border-dashed border-gray-300 px-4 py-10 text-sm text-gray-500">
            No packs match this filter yet.
          </div>
        )}

        {!isLoading && !error && activePacks.length > 0 && (
          <section className="space-y-4">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">Active on this bot</div>
                <h4 className="mt-1 text-lg font-semibold text-gray-900">What is shaping the live bot right now</h4>
              </div>
              <div className="text-sm text-gray-500">
                {activePacks.length} active pack{activePacks.length === 1 ? "" : "s"}
              </div>
            </div>

            <div className="space-y-4">
              {activePacks.map((pack) => {
                const values = formValues[pack.slug] ?? {};
                const isPending = applyMutation.isPending && applyMutation.variables?.slug === pack.slug;
                const isAvailable = pack.available !== false;
                const badge = statusBadge(pack, isAvailable);
                const isExpanded = expanded[pack.slug] ?? false;
                const previews = inputPreview(pack, pack.current_inputs);
                const managedPreviews = inputPreview(pack, pack.managed_inputs);
                const runtimeOverridePreviews = inputPreview(pack, pack.runtime_overrides, { includeEmpty: true });
                const sections = inputSections(pack);
                const modules: FeaturePackModule[] = pack.modules ?? [];
                const PackIcon = categoryIcon(pack.category);
                const hasAsideColumn = managedPreviews.length > 0 || runtimeOverridePreviews.length > 0 || Boolean(pack.notes?.length);

                return (
                  <article
                    key={pack.slug}
                    className="overflow-hidden rounded-[28px] border border-blue-200/80 bg-[linear-gradient(180deg,rgba(239,246,255,0.52),rgba(255,255,255,0.96))] shadow-[0_18px_48px_rgba(37,99,235,0.08)]"
                  >
                    <div className="p-5 sm:p-6">
                      <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-start gap-3">
                            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-blue-200 bg-white text-blue-700 shadow-sm">
                              <PackIcon size={19} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <h5 className="text-lg font-semibold text-gray-900">{pack.name}</h5>
                                <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${badge.className}`}>{badge.label}</span>
                                <span className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-600">
                                  {humanizeCategory(pack.category)}
                                </span>
                                {runtimeOverridePreviews.length > 0 && (
                                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700">
                                    {runtimeOverridePreviews.length} override{runtimeOverridePreviews.length === 1 ? "" : "s"}
                                  </span>
                                )}
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                                <span>v{pack.version}</span>
                                {pack.state_source === "live-state" && (
                                  <span className="inline-flex items-center gap-1 text-amber-700">
                                    <LockKeyhole size={12} />
                                    Detected from live bot state
                                  </span>
                                )}
                                {pack.restarts_gateway && (
                                  <span className="inline-flex items-center gap-1">
                                    <RefreshCcw size={12} />
                                    Restarts gateway after real changes
                                  </span>
                                )}
                                {pack.applied_at && (
                                  <span className="inline-flex items-center gap-1">
                                    <Clock3 size={12} />
                                    Last applied {new Date(pack.applied_at).toLocaleString()}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <p className="mt-4 max-w-3xl text-sm leading-6 text-gray-600">{pack.summary}</p>

                          {modules.length > 0 && (
                            <div className="mt-4">
                              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">Inside this pack</div>
                              <div className="mt-3 grid gap-2 xl:grid-cols-2">
                                {modules.map((module, index) => {
                                  const accent = moduleAccentClasses(index);
                                  return (
                                    <div key={module.key} className={`rounded-2xl border px-3 py-3 ${accent.border} ${accent.bg}`}>
                                      <div className={`text-sm font-semibold ${accent.icon}`}>{module.name}</div>
                                      <div className="mt-1 text-xs leading-5 text-gray-600">{module.summary}</div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {previews.length > 0 && (
                            <div className="mt-4">
                              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">Live effective setup</div>
                              <div className="mt-2 flex flex-wrap gap-2">
                                {previews.slice(0, 7).map((preview) => (
                                  <span key={preview} className="rounded-full border border-blue-200 bg-white px-3 py-1 text-xs text-gray-700">
                                    {preview}
                                  </span>
                                ))}
                                {previews.length > 7 && (
                                  <span className="rounded-full border border-blue-200 bg-white px-3 py-1 text-xs text-gray-500">
                                    +{previews.length - 7} more
                                  </span>
                                )}
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="flex shrink-0 flex-col gap-2 xl:w-44">
                          <button
                            onClick={() => handleApply(pack)}
                            disabled={isPending || !isAvailable}
                            className="rounded-2xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isPending ? "Applying..." : "Reapply pack"}
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleExpanded(pack.slug)}
                            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                          >
                            {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                            {isExpanded ? "Hide details" : "Open settings"}
                          </button>
                        </div>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="border-t border-blue-100 bg-white/90 px-5 py-5 sm:px-6">
                        <div className={`grid gap-5 ${hasAsideColumn ? "xl:grid-cols-[320px_minmax(0,1fr)]" : ""}`}>
                          {hasAsideColumn && (
                            <div className="space-y-3">
                              {managedPreviews.length > 0 && (
                                <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4">
                                  <div className="flex items-center gap-2 text-sm font-semibold text-emerald-900">
                                    <ShieldCheck size={16} className="text-emerald-600" />
                                    Pack-managed settings
                                  </div>
                                  <div className="mt-3 flex flex-wrap gap-2">
                                    {managedPreviews.map((preview) => (
                                      <span key={`managed-${preview}`} className="rounded-full border border-emerald-200 bg-white px-3 py-1 text-xs text-emerald-700">
                                        {preview}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {runtimeOverridePreviews.length > 0 && (
                                <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
                                  <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
                                    <RefreshCcw size={16} className="text-amber-600" />
                                    Runtime overrides
                                  </div>
                                  <div className="mt-2 text-sm leading-6 text-amber-900/80">
                                    The live bot currently differs from the last saved baseline. Reapply if you want today’s live state to become the managed default.
                                  </div>
                                  <div className="mt-3 flex flex-wrap gap-2">
                                    {runtimeOverridePreviews.map((preview) => (
                                      <span key={`override-${preview}`} className="rounded-full border border-amber-200 bg-white px-3 py-1 text-xs text-amber-800">
                                        {preview}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {pack.notes && pack.notes.length > 0 && (
                                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                                  <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                                    <Sparkles size={16} className="text-blue-500" />
                                    What this pack changes
                                  </div>
                                  <div className="mt-3 space-y-2">
                                    {pack.notes.map((note) => (
                                      <div key={note} className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600">
                                        {note}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              <div className="rounded-2xl border border-gray-200 bg-white p-4">
                                <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                                  <LockKeyhole size={16} className="text-gray-500" />
                                  Input behavior
                                </div>
                                <div className="mt-3 space-y-2 text-sm leading-6 text-gray-600">
                                  <div>Secrets stay hidden and can be left blank on reapply to keep the current value.</div>
                                  <div>Any overwritten workspace files are backed up before the pack is applied.</div>
                                </div>
                              </div>
                            </div>
                          )}

                          <div className="rounded-[24px] border border-gray-200 bg-white p-4 shadow-sm">
                            <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                              <SlidersHorizontal size={16} className="text-gray-500" />
                              Configure {pack.name}
                            </div>

                            {pack.inputs.length === 0 ? (
                              <div className="mt-4 rounded-2xl border border-dashed border-gray-300 px-4 py-5 text-sm text-gray-500">
                                This pack does not need per-instance inputs.
                              </div>
                            ) : (
                              <div className="mt-4 space-y-4">
                                {sections.map((section) => (
                                  <div key={section.key} className="rounded-2xl border border-gray-200 bg-gray-50/70 p-4">
                                    <div className="text-sm font-semibold text-gray-900">{section.label}</div>
                                    {section.description && <div className="mt-1 text-xs leading-5 text-gray-500">{section.description}</div>}

                                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                                      {section.inputs.map((input) => (
                                        <label key={input.key} className={`space-y-1.5 ${input.type === "textarea" ? "md:col-span-2" : ""}`}>
                                          <div className="flex items-center gap-2">
                                            <div className="text-sm font-medium text-gray-800">{input.label}</div>
                                            {input.required && (
                                              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-700">
                                                Required
                                              </span>
                                            )}
                                          </div>
                                          <div className="text-xs leading-5 text-gray-500">{input.description}</div>
                                          {hasConfiguredSecret(pack, input) && (
                                            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-medium text-emerald-700">
                                              Secret is already configured. Leave blank to keep the current value.
                                            </div>
                                          )}

                                          {input.type === "textarea" ? (
                                            <textarea
                                              rows={4}
                                              value={values[input.key] ?? inputDefault(pack, input)}
                                              onChange={(event) => handleChange(pack.slug, input.key, event.target.value)}
                                              placeholder={input.placeholder}
                                              className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                                            />
                                          ) : input.type === "boolean" ? (
                                            <div className="flex items-center justify-between rounded-xl border border-gray-300 bg-white px-3 py-3">
                                              <div>
                                                <div className="text-sm font-medium text-gray-800">Enabled</div>
                                                <div className="text-xs text-gray-500">Toggle this behavior for the selected bot.</div>
                                              </div>
                                              <input
                                                type="checkbox"
                                                checked={(values[input.key] ?? inputDefault(pack, input)) === "true"}
                                                onChange={(event) => handleChange(pack.slug, input.key, event.target.checked ? "true" : "false")}
                                                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                              />
                                            </div>
                                          ) : (
                                            <input
                                              type={input.type === "secret" ? "password" : "text"}
                                              value={values[input.key] ?? inputDefault(pack, input)}
                                              onChange={(event) => handleChange(pack.slug, input.key, event.target.value)}
                                              placeholder={input.placeholder}
                                              className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                                            />
                                          )}
                                        </label>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {!isLoading && !error && catalogGroups.length > 0 && (
          <section className="space-y-5">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">Catalog</div>
                <h4 className="mt-1 text-lg font-semibold text-gray-900">Add more capabilities when this bot needs them</h4>
              </div>
              <div className="text-sm text-gray-500">
                {filteredPacks.filter((pack) => !pack.applied).length} pack{filteredPacks.filter((pack) => !pack.applied).length === 1 ? "" : "s"} available in this view
              </div>
            </div>

            <div className="space-y-6">
              {catalogGroups.map(([group, groupPacks]) => {
                const GroupIcon = categoryIcon(group);
                return (
                  <section key={group} className="space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-gray-200 bg-gray-50 text-gray-700">
                        <GroupIcon size={18} />
                      </div>
                      <div>
                        <h5 className="text-sm font-semibold text-gray-900">{humanizeCategory(group)}</h5>
                        <p className="text-xs text-gray-500">{groupPacks.length} pack{groupPacks.length === 1 ? "" : "s"}</p>
                      </div>
                    </div>

                    <div className="grid gap-4">
                      {groupPacks.map((pack) => {
                        const values = formValues[pack.slug] ?? {};
                        const isPending = applyMutation.isPending && applyMutation.variables?.slug === pack.slug;
                        const isAvailable = pack.available !== false;
                        const badge = statusBadge(pack, isAvailable);
                        const isExpanded = expanded[pack.slug] ?? false;
                        const previews = inputPreview(pack, pack.current_inputs);
                        const sections = inputSections(pack);
                        const modules: FeaturePackModule[] = pack.modules ?? [];
                        const PackIcon = categoryIcon(pack.category);

                        return (
                          <article key={pack.slug} className="overflow-hidden rounded-[26px] border border-gray-200 bg-white shadow-sm">
                            <div className="p-5">
                              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-start gap-3">
                                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-gray-200 bg-gray-50 text-gray-700">
                                      <PackIcon size={19} />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <h5 className="text-base font-semibold text-gray-900">{pack.name}</h5>
                                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${badge.className}`}>{badge.label}</span>
                                        <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] font-medium text-gray-600">
                                          {humanizeCategory(pack.category)}
                                        </span>
                                      </div>
                                      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                                        <span>v{pack.version}</span>
                                        {pack.restarts_gateway && (
                                          <span className="inline-flex items-center gap-1">
                                            <RefreshCcw size={12} />
                                            Restarts gateway after real changes
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  </div>

                                  <p className="mt-4 max-w-3xl text-sm leading-6 text-gray-600">{pack.summary}</p>

                                  {modules.length > 0 && (
                                    <div className="mt-4 grid gap-2 xl:grid-cols-2">
                                      {modules.map((module, index) => {
                                        const accent = moduleAccentClasses(index);
                                        return (
                                          <div key={module.key} className={`rounded-2xl border px-3 py-3 ${accent.border} ${accent.bg}`}>
                                            <div className={`text-sm font-semibold ${accent.icon}`}>{module.name}</div>
                                            <div className="mt-1 text-xs leading-5 text-gray-600">{module.summary}</div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}

                                  {previews.length > 0 && (
                                    <div className="mt-4 flex flex-wrap gap-2">
                                      {previews.slice(0, 5).map((preview) => (
                                        <span key={preview} className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs text-gray-600">
                                          {preview}
                                        </span>
                                      ))}
                                    </div>
                                  )}

                                  {!isAvailable && pack.availability_note && (
                                    <div className="mt-4 rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-3 py-3 text-sm text-gray-600">
                                      {pack.availability_note}
                                    </div>
                                  )}
                                </div>

                                <div className="flex shrink-0 flex-col gap-2 xl:w-44">
                                  <button
                                    onClick={() => handleApply(pack)}
                                    disabled={isPending || !isAvailable}
                                    className="rounded-2xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    {!isAvailable ? "Coming soon" : isPending ? "Applying..." : "Apply pack"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => toggleExpanded(pack.slug)}
                                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                                  >
                                    {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                    {isExpanded ? "Hide details" : "Configure"}
                                  </button>
                                </div>
                              </div>
                            </div>

                            {isExpanded && (
                              <div className="border-t border-gray-200 px-5 py-5">
                                <div className="rounded-[24px] border border-gray-200 bg-white p-4 shadow-sm">
                                  <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                                    <SlidersHorizontal size={16} className="text-gray-500" />
                                    Configure {pack.name}
                                  </div>

                                  {pack.inputs.length === 0 ? (
                                    <div className="mt-4 rounded-2xl border border-dashed border-gray-300 px-4 py-5 text-sm text-gray-500">
                                      This pack does not need per-instance inputs.
                                    </div>
                                  ) : (
                                    <div className="mt-4 space-y-4">
                                      {sections.map((section) => (
                                        <div key={section.key} className="rounded-2xl border border-gray-200 bg-gray-50/70 p-4">
                                          <div className="text-sm font-semibold text-gray-900">{section.label}</div>
                                          {section.description && <div className="mt-1 text-xs leading-5 text-gray-500">{section.description}</div>}

                                          <div className="mt-4 grid gap-4 md:grid-cols-2">
                                            {section.inputs.map((input) => (
                                              <label key={input.key} className={`space-y-1.5 ${input.type === "textarea" ? "md:col-span-2" : ""}`}>
                                                <div className="flex items-center gap-2">
                                                  <div className="text-sm font-medium text-gray-800">{input.label}</div>
                                                  {input.required && (
                                                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-700">
                                                      Required
                                                    </span>
                                                  )}
                                                </div>
                                                <div className="text-xs leading-5 text-gray-500">{input.description}</div>
                                                {hasConfiguredSecret(pack, input) && (
                                                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-medium text-emerald-700">
                                                    Secret is already configured. Leave blank to keep the current value.
                                                  </div>
                                                )}

                                                {input.type === "textarea" ? (
                                                  <textarea
                                                    rows={4}
                                                    value={values[input.key] ?? inputDefault(pack, input)}
                                                    onChange={(event) => handleChange(pack.slug, input.key, event.target.value)}
                                                    placeholder={input.placeholder}
                                                    className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                                                  />
                                                ) : input.type === "boolean" ? (
                                                  <div className="flex items-center justify-between rounded-xl border border-gray-300 bg-white px-3 py-3">
                                                    <div>
                                                      <div className="text-sm font-medium text-gray-800">Enabled</div>
                                                      <div className="text-xs text-gray-500">Toggle this behavior for the selected bot.</div>
                                                    </div>
                                                    <input
                                                      type="checkbox"
                                                      checked={(values[input.key] ?? inputDefault(pack, input)) === "true"}
                                                      onChange={(event) => handleChange(pack.slug, input.key, event.target.checked ? "true" : "false")}
                                                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                                    />
                                                  </div>
                                                ) : (
                                                  <input
                                                    type={input.type === "secret" ? "password" : "text"}
                                                    value={values[input.key] ?? inputDefault(pack, input)}
                                                    onChange={(event) => handleChange(pack.slug, input.key, event.target.value)}
                                                    placeholder={input.placeholder}
                                                    className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                                                  />
                                                )}
                                              </label>
                                            ))}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </section>
  );
}
