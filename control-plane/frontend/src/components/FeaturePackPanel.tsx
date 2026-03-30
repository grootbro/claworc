import { useDeferredValue, useEffect, useMemo, useState } from "react";
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
import type { FeaturePackInput, InstanceFeaturePack } from "@/types/instance";

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

  const groupedPacks = useMemo(() => {
    const groups = new Map<string, InstanceFeaturePack[]>();
    for (const pack of filteredPacks) {
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
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-700">
              <Sparkles size={13} />
              Feature Packs
            </div>
            <h3 className="mt-3 text-lg font-semibold text-gray-900">Turn capabilities on without hand-editing the bot</h3>
            <p className="mt-1 max-w-3xl text-sm text-gray-600">
              Packs bundle workspace guidance, scripts, config patches, and runtime plugins into one safe install flow.
              Active packs stay visible here, with a compact preview of what is already configured on this bot even if it was set up before the pack engine existed.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">Active</div>
              <div className="mt-2 flex items-center gap-2 text-lg font-semibold text-gray-900">
                <CheckCircle2 size={18} className="text-emerald-500" />
                {appliedCount}
              </div>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">Ready</div>
              <div className="mt-2 flex items-center gap-2 text-lg font-semibold text-gray-900">
                <CircleDashed size={18} className="text-blue-500" />
                {availableCount}
              </div>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">Overrides</div>
              <div className="mt-2 flex items-center gap-2 text-lg font-semibold text-gray-900">
                <RefreshCcw size={18} className="text-amber-500" />
                {overrideCount}
              </div>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">Catalog</div>
              <div className="mt-2 flex items-center gap-2 text-lg font-semibold text-gray-900">
                <Boxes size={18} className="text-gray-500" />
                {totalCount}
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto]">
            <label className="space-y-1">
              <div className="text-xs font-medium text-gray-600">Search packs</div>
              <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-sm">
                <Search size={16} className="text-gray-400" />
                <input
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="Search by name, category, effect, or setting"
                  className="w-full border-none bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-400"
                />
              </div>
            </label>

            <div className="flex flex-col gap-2 xl:min-w-[360px]">
              <div className="text-xs font-medium text-gray-600">View</div>
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
                        : "bg-white text-gray-600 hover:bg-gray-100"
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
                      : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-100"
                  }`}
                >
                  {option === "all" ? "All categories" : humanizeCategory(option)} · {count}
                </button>
              );
            })}
          </div>
        </div>

        {isLoading && (
          <div className="rounded-xl border border-dashed border-gray-300 px-4 py-8 text-sm text-gray-500">
            Loading feature packs...
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Failed to load feature packs.
          </div>
        )}

        {!isLoading && !error && filteredPacks.length === 0 && (
          <div className="rounded-xl border border-dashed border-gray-300 px-4 py-8 text-sm text-gray-500">
            No packs match this filter yet.
          </div>
        )}

        {!isLoading && !error && groupedPacks.length > 0 && (
          <div className="space-y-6">
            {groupedPacks.map(([group, groupPacks]) => {
              const GroupIcon = categoryIcon(group);
              return (
                <section key={group} className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-gray-200 bg-gray-50 text-gray-700">
                      <GroupIcon size={18} />
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-gray-900">{humanizeCategory(group)}</h4>
                      <p className="text-xs text-gray-500">{groupPacks.length} pack{groupPacks.length === 1 ? "" : "s"}</p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {groupPacks.map((pack) => {
                      const values = formValues[pack.slug] ?? {};
                      const isPending = applyMutation.isPending && applyMutation.variables?.slug === pack.slug;
                      const isAvailable = pack.available !== false;
                      const badge = statusBadge(pack, isAvailable);
                      const isExpanded = expanded[pack.slug] ?? false;
                      const previews = inputPreview(pack, pack.current_inputs);
                      const managedPreviews = inputPreview(pack, pack.managed_inputs);
                      const runtimeOverridePreviews = inputPreview(pack, pack.runtime_overrides, { includeEmpty: true });
                      const PackIcon = categoryIcon(pack.category);

                      return (
                        <article key={pack.slug} className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                          <div className="p-4 sm:p-5">
                            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-gray-200 bg-gray-50 text-gray-700">
                                    <PackIcon size={18} />
                                  </div>
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <h5 className="text-base font-semibold text-gray-900">{pack.name}</h5>
                                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${badge.className}`}>
                                        {badge.label}
                                      </span>
                                      <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-medium text-gray-600">
                                        {humanizeCategory(pack.category)}
                                      </span>
                                      {runtimeOverridePreviews.length > 0 && (
                                        <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700">
                                          {runtimeOverridePreviews.length} live override{runtimeOverridePreviews.length === 1 ? "" : "s"}
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

                                {previews.length > 0 && (
                                  <div className="mt-4">
                                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                                      Live effective setup
                                    </div>
                                    <div className="mt-2 flex flex-wrap gap-2">
                                      {previews.slice(0, 6).map((preview) => (
                                        <span
                                          key={preview}
                                          className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs text-gray-600"
                                        >
                                          {preview}
                                        </span>
                                      ))}
                                      {previews.length > 6 && (
                                        <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs text-gray-500">
                                          +{previews.length - 6} more
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                )}

                                {!isAvailable && pack.availability_note && (
                                  <div className="mt-4 rounded-xl border border-dashed border-gray-300 bg-gray-50 px-3 py-3 text-sm text-gray-600">
                                    {pack.availability_note}
                                  </div>
                                )}
                              </div>

                              <div className="flex shrink-0 flex-col gap-2 xl:w-44">
                                <button
                                  onClick={() => handleApply(pack)}
                                  disabled={isPending || !isAvailable}
                                  className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {!isAvailable ? "Coming soon" : isPending ? "Applying..." : pack.applied ? "Reapply pack" : "Apply pack"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => toggleExpanded(pack.slug)}
                                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                                >
                                  {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                  {isExpanded ? "Hide details" : "Configure"}
                                </button>
                              </div>
                            </div>
                          </div>

                          {isExpanded && (
                            <div className="border-t border-gray-200 bg-gray-50/70 px-4 py-4 sm:px-5">
                              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
                                <div className="space-y-4">
                                  {managedPreviews.length > 0 && (
                                    <div className="rounded-2xl border border-gray-200 bg-white p-4">
                                      <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                                        <ShieldCheck size={16} className="text-emerald-500" />
                                        Pack-managed settings
                                      </div>
                                      <div className="mt-3 flex flex-wrap gap-2">
                                        {managedPreviews.map((preview) => (
                                          <span
                                            key={`managed-${preview}`}
                                            className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs text-emerald-700"
                                          >
                                            {preview}
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  {runtimeOverridePreviews.length > 0 && (
                                    <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
                                      <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
                                        <RefreshCcw size={16} className="text-amber-600" />
                                        Runtime overrides
                                      </div>
                                      <div className="mt-2 text-sm text-amber-800">
                                        The live bot currently differs from the last pack-managed settings below. Reapply if you want these overrides to become the new managed baseline.
                                      </div>
                                      <div className="mt-3 flex flex-wrap gap-2">
                                        {runtimeOverridePreviews.map((preview) => (
                                          <span
                                            key={`override-${preview}`}
                                            className="rounded-full border border-amber-200 bg-white px-3 py-1 text-xs text-amber-800"
                                          >
                                            {preview}
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  {pack.notes && pack.notes.length > 0 && (
                                    <div className="rounded-2xl border border-gray-200 bg-white p-4">
                                      <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                                        <Sparkles size={16} className="text-blue-500" />
                                        What this pack changes
                                      </div>
                                      <div className="mt-3 space-y-2">
                                        {pack.notes.map((note) => (
                                          <div key={note} className="rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-600">
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
                                    <div className="mt-3 space-y-2 text-sm text-gray-600">
                                      <div>Secrets stay hidden and can be left blank on reapply to keep the current value.</div>
                                      <div>Any overwritten workspace files are backed up before the pack is applied.</div>
                                    </div>
                                  </div>
                                </div>

                                <div className="rounded-2xl border border-gray-200 bg-white p-4">
                                  <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                                    <SlidersHorizontal size={16} className="text-gray-500" />
                                    Configure {pack.name}
                                  </div>

                                  {pack.inputs.length === 0 ? (
                                    <div className="mt-3 rounded-xl border border-dashed border-gray-300 px-4 py-5 text-sm text-gray-500">
                                      This pack does not need per-instance inputs.
                                    </div>
                                  ) : (
                                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                                      {pack.inputs.map((input) => (
                                        <label
                                          key={input.key}
                                          className={`space-y-1.5 ${input.type === "textarea" ? "md:col-span-2" : ""}`}
                                        >
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
                                              className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                                            />
                                          ) : input.type === "boolean" ? (
                                            <div className="flex items-center justify-between rounded-xl border border-gray-300 bg-gray-50 px-3 py-3">
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
                                              className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                                            />
                                          )}
                                        </label>
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
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
