import { useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
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

export default function FeaturePacksPage() {
  const { data: instances = [], isLoading } = useInstances();
  const [searchParams, setSearchParams] = useSearchParams();

  const selectedId = Number(searchParams.get("instance") || 0);

  const defaultInstanceId = useMemo(() => {
    const running = instances.find((instance) => instance.status === "running");
    return running?.id ?? instances[0]?.id ?? 0;
  }, [instances]);

  useEffect(() => {
    if (!instances.length || selectedId) {
      return;
    }
    if (!defaultInstanceId) {
      return;
    }
    setSearchParams({ instance: String(defaultInstanceId) }, { replace: true });
  }, [defaultInstanceId, instances.length, selectedId, setSearchParams]);

  const selectedInstance =
    instances.find((instance) => instance.id === selectedId) ??
    instances.find((instance) => instance.id === defaultInstanceId);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Feature Packs</h1>
          <p className="mt-1 max-w-3xl text-sm text-gray-600">
            Central catalog for reusable bot capabilities. Pick an instance, review what each pack does,
            then apply it without hand-editing workspace files or channel config.
          </p>
        </div>
        {selectedInstance && (
          <Link
            to={`/instances/${selectedInstance.id}#features`}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Open {selectedInstance.display_name}
          </Link>
        )}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Target instance</h2>
              <p className="mt-1 text-xs text-gray-500">
                Packs are applied per bot. Choose which OpenClaw instance should receive the capability bundle.
              </p>
            </div>

            {isLoading ? (
              <div className="rounded-md border border-dashed border-gray-300 px-4 py-5 text-sm text-gray-500">
                Loading instances...
              </div>
            ) : instances.length === 0 ? (
              <div className="rounded-md border border-dashed border-gray-300 px-4 py-5 text-sm text-gray-500">
                No instances found yet.
              </div>
            ) : (
              <div className="space-y-2">
                {instances.map((instance) => {
                  const isSelected = selectedInstance?.id === instance.id;
                  return (
                    <button
                      key={instance.id}
                      type="button"
                      onClick={() => setSearchParams({ instance: String(instance.id) })}
                      className={`w-full rounded-lg border px-3 py-3 text-left transition-colors ${
                        isSelected
                          ? "border-blue-300 bg-blue-50"
                          : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-gray-900">
                            {instance.display_name}
                          </div>
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
          </aside>

          <section className="min-w-0">
            {!selectedInstance ? (
              <div className="rounded-md border border-dashed border-gray-300 px-4 py-5 text-sm text-gray-500">
                Pick an instance to manage its feature packs.
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <div>
                      <div className="text-sm font-semibold text-gray-900">{selectedInstance.display_name}</div>
                      <div className="text-xs text-gray-500">{selectedInstance.name}</div>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusClasses(selectedInstance.status)}`}>
                      {selectedInstance.status}
                    </span>
                    {selectedInstance.status !== "running" && (
                      <span className="text-xs text-amber-700">
                        Start the bot before applying packs that need SSH access.
                      </span>
                    )}
                  </div>
                </div>

                {selectedInstance.status === "running" ? (
                  <FeaturePackPanel
                    instanceId={selectedInstance.id}
                    enabled
                  />
                ) : (
                  <div className="rounded-md border border-dashed border-amber-300 bg-amber-50 px-4 py-5 text-sm text-amber-800">
                    Feature packs need the bot to be running first, because `claworc` applies them over SSH inside the live OpenClaw home.
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
