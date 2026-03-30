import { useEffect, useMemo, useState } from "react";
import { useApplyInstanceFeaturePack, useInstanceFeaturePacks } from "@/hooks/useInstances";
import type { FeaturePackInput, InstanceFeaturePack } from "@/types/instance";

interface FeaturePackPanelProps {
  instanceId: number;
  enabled?: boolean;
}

function inputDefault(pack: InstanceFeaturePack, input: FeaturePackInput): string {
  if (input.type === "secret") {
    return "";
  }
  return pack.current_inputs?.[input.key] ?? input.default_value ?? (input.type === "boolean" ? "false" : "");
}

function hasConfiguredSecret(pack: InstanceFeaturePack, input: FeaturePackInput): boolean {
  return input.type === "secret" && pack.current_inputs?.[input.key] === "__configured__";
}

export default function FeaturePackPanel({ instanceId, enabled = true }: FeaturePackPanelProps) {
  const { data: packs = [], isLoading, error } = useInstanceFeaturePacks(instanceId, enabled);
  const applyMutation = useApplyInstanceFeaturePack();
  const [formValues, setFormValues] = useState<Record<string, Record<string, string>>>({});

  useEffect(() => {
    if (!packs.length) return;
    setFormValues((current) => {
      const next = { ...current };
      for (const pack of packs) {
        if (next[pack.slug]) continue;
        next[pack.slug] = Object.fromEntries(
          pack.inputs.map((input) => [input.key, inputDefault(pack, input)]),
        );
      }
      return next;
    });
  }, [packs]);

  const orderedPacks = useMemo(
    () => [...packs].sort((a, b) => Number(b.applied) - Number(a.applied) || a.name.localeCompare(b.name)),
    [packs],
  );

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
    applyMutation.mutate({
      id: instanceId,
      slug: pack.slug,
      inputs: formValues[pack.slug] ?? {},
    }, {
      onSuccess: () => {
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
    });
  };

  return (
    <section className="bg-white rounded-lg border border-gray-200 p-4 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Feature Packs</h3>
          <p className="mt-1 text-sm text-gray-600">
            Install reusable capabilities like sales routing, native lead storage, and channel-ready workspace bundles
            without hand-editing every bot.
          </p>
        </div>
        <div className="text-xs text-gray-500">
          Packs back up overwritten files before applying.
        </div>
      </div>

      {isLoading && (
        <div className="rounded-md border border-dashed border-gray-300 px-4 py-5 text-sm text-gray-500">
          Loading feature packs...
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Failed to load feature packs.
        </div>
      )}

      {!isLoading && !error && orderedPacks.length === 0 && (
        <div className="rounded-md border border-dashed border-gray-300 px-4 py-5 text-sm text-gray-500">
          No feature packs are available yet.
        </div>
      )}

      <div className="space-y-4">
        {orderedPacks.map((pack) => {
          const values = formValues[pack.slug] ?? {};
          const isPending = applyMutation.isPending && applyMutation.variables?.slug === pack.slug;
          const isAvailable = pack.available !== false;
          return (
            <article key={pack.slug} className="rounded-lg border border-gray-200 p-4 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="text-sm font-semibold text-gray-900">{pack.name}</h4>
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                      {pack.category}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        !isAvailable
                          ? "bg-gray-100 text-gray-600"
                          : pack.applied
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {!isAvailable ? "Coming soon" : pack.applied ? "Applied" : "Available"}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-gray-600">{pack.summary}</p>
                  {!isAvailable && pack.availability_note && (
                    <p className="mt-2 text-xs font-medium text-gray-500">{pack.availability_note}</p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                    <span>Version {pack.version}</span>
                    {pack.restarts_gateway && <span>Restarts openclaw-gateway after real changes</span>}
                    {pack.applied_at && <span>Last applied {new Date(pack.applied_at).toLocaleString()}</span>}
                  </div>
                </div>
                <button
                  onClick={() => handleApply(pack)}
                  disabled={isPending || !isAvailable}
                  className="shrink-0 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {!isAvailable ? "Coming soon" : isPending ? "Applying..." : pack.applied ? "Reapply pack" : "Apply pack"}
                </button>
              </div>

              {pack.inputs.length > 0 && (
                <div className="grid gap-4 md:grid-cols-2">
                  {pack.inputs.map((input) => (
                    <label key={input.key} className={`space-y-1 ${input.type === "textarea" ? "md:col-span-2" : ""}`}>
                      <div className="text-sm font-medium text-gray-700">{input.label}</div>
                      <div className="text-xs text-gray-500">{input.description}</div>
                      {hasConfiguredSecret(pack, input) && (
                        <div className="text-[11px] font-medium text-emerald-700">
                          Secret is already configured. Leave this blank to keep the current value.
                        </div>
                      )}
                      {input.type === "textarea" ? (
                        <textarea
                          rows={3}
                          value={values[input.key] ?? inputDefault(pack, input)}
                          onChange={(event) => handleChange(pack.slug, input.key, event.target.value)}
                          placeholder={input.placeholder}
                          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                        />
                      ) : input.type === "boolean" ? (
                        <div className="flex items-center gap-3 rounded-md border border-gray-300 px-3 py-2">
                          <input
                            type="checkbox"
                            checked={(values[input.key] ?? inputDefault(pack, input)) === "true"}
                            onChange={(event) => handleChange(pack.slug, input.key, event.target.checked ? "true" : "false")}
                            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span className="text-sm text-gray-700">Enabled</span>
                        </div>
                      ) : (
                        <input
                          type={input.type === "secret" ? "password" : "text"}
                          value={values[input.key] ?? inputDefault(pack, input)}
                          onChange={(event) => handleChange(pack.slug, input.key, event.target.value)}
                          placeholder={input.placeholder}
                          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                        />
                      )}
                    </label>
                  ))}
                </div>
              )}

              {pack.notes && pack.notes.length > 0 && (
                <div className="rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600">
                  {pack.notes.map((note) => (
                    <div key={note}>{note}</div>
                  ))}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
