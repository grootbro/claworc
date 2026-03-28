import { useEffect, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { useSettings } from "@/hooks/useSettings";
import { useProviders } from "@/hooks/useProviders";
import { importArchiveImage, inspectInstanceImage } from "@/api/instances";
import { fetchCatalogProviderDetail } from "@/api/llm";
import type { CatalogProviderDetail } from "@/api/llm";
import ProviderModelSelector from "@/components/ProviderModelSelector";
import type { ArchiveImageImportResult, ImageContractInspection, InstanceCreatePayload } from "@/types/instance";
import { useAuth } from "@/contexts/AuthContext";

interface InstanceFormProps {
  onSubmit: (payload: InstanceCreatePayload) => void;
  onCancel: () => void;
  loading?: boolean;
}

const FALLBACK_MODEL_PRESET = [
  "gemini/gemini-3-flash-preview",
  "gemini/gemini-2.5-flash",
  "openai/gpt-5.2",
];

const ARCHIVE_LAYOUT_EXAMPLES = [
  {
    label: "Archive root is already the OpenClaw home",
    example: ".openclaw/openclaw.json",
  },
  {
    label: "One wrapper folder contains the OpenClaw home",
    example: "my-export/.openclaw/openclaw.json",
  },
];

type ArchiveGuidance = {
  title: string;
  bullets: string[];
};

function getArchiveLayoutLabel(layout: string): string {
  switch (layout) {
    case "archive_root":
      return "Archive root";
    case "top_level_directory":
      return "Top-level folder";
    case "nested_directory":
      return "Nested folder";
    default:
      return "Detected layout";
  }
}

function getArchiveLayoutDescription(layout: string): string {
  switch (layout) {
    case "archive_root":
      return "Claworc found .openclaw right at the archive root.";
    case "top_level_directory":
      return "Claworc used the archive's single wrapper folder as the imported home.";
    case "nested_directory":
      return "Claworc found one nested directory that clearly contains the OpenClaw home.";
    default:
      return "Claworc detected a usable OpenClaw home inside the archive.";
  }
}

function getInspectErrorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const maybeError = error as { response?: { data?: { error?: string } }; message?: string };
    if (maybeError.response?.data?.error) return maybeError.response.data.error;
    if (maybeError.message) return maybeError.message;
  }
  return "Failed to inspect image";
}

function getImportErrorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const maybeError = error as { response?: { data?: { error?: string } }; message?: string };
    if (maybeError.response?.data?.error) return maybeError.response.data.error;
    if (maybeError.message) return maybeError.message;
  }
  return "Failed to build image from archive";
}

function getArchiveErrorGuidance(message: string): ArchiveGuidance | null {
  const normalized = message.toLowerCase();

  if (normalized.includes("missing an openclaw home")) {
    return {
      title: "Archive layout not recognized",
      bullets: [
        "Put .openclaw at the archive root, or wrap everything in one top-level folder that contains .openclaw.",
        "Make sure the exported home keeps openclaw.json, skills, and workspace files under that same root.",
      ],
    };
  }

  if (normalized.includes("more than one possible openclaw home")) {
    return {
      title: "More than one candidate home was found",
      bullets: [
        "Keep exactly one .openclaw root in the archive.",
        "Remove old backups or duplicate exported homes before uploading again.",
      ],
    };
  }

  if (normalized.includes("contains symlinks")) {
    return {
      title: "Archive contains unsupported symlinks",
      bullets: [
        "Repack the export with real files only.",
        "If you built the archive on macOS or Linux, avoid preserving symbolic links in the final zip or tarball.",
      ],
    };
  }

  if (normalized.includes("unsupported archive format")) {
    return {
      title: "Archive format is not supported",
      bullets: [
        "Use .zip, .tar, .tar.gz, or .tgz.",
        "If needed, re-export the same files into one of those formats and retry.",
      ],
    };
  }

  if (normalized.includes("could not be read cleanly")) {
    return {
      title: "Archive looks corrupted or incomplete",
      bullets: [
        "Re-export the archive and try again.",
        "Prefer .zip or .tar.gz if the current archive was produced by a custom backup tool.",
      ],
    };
  }

  return null;
}

export default function InstanceForm({
  onSubmit,
  onCancel,
  loading,
}: InstanceFormProps) {
  const { isAdmin } = useAuth();
  const [imageMode, setImageMode] = useState<"managed" | "prebuilt" | "archive">("managed");
  const [displayName, setDisplayName] = useState("");
  const [cpuRequest, setCpuRequest] = useState("500m");
  const [cpuLimit, setCpuLimit] = useState("2000m");
  const [memoryRequest, setMemoryRequest] = useState("1Gi");
  const [memoryLimit, setMemoryLimit] = useState("4Gi");
  const [storageHomebrew, setStorageHomebrew] = useState("10Gi");
  const [storageHome, setStorageHome] = useState("10Gi");

  const [containerImage, setContainerImage] = useState("");
  const [vncResolution, setVncResolution] = useState("");
  const [timezone, setTimezone] = useState("");
  const [userAgent, setUserAgent] = useState("");

  const { data: settings } = useSettings();
  const { data: allProviders = [] } = useProviders();
  const defaultManagedImage = settings?.default_container_image ?? "glukw/openclaw-vnc-chromium:latest";
  const [archiveBaseImage, setArchiveBaseImage] = useState("");
  const [archiveFile, setArchiveFile] = useState<File | null>(null);
  const [archiveImport, setArchiveImport] = useState<ArchiveImageImportResult | null>(null);
  const [isImportingArchive, setIsImportingArchive] = useState(false);
  const [archiveError, setArchiveError] = useState("");
  const isCreateDisabled =
    loading ||
    !displayName.trim() ||
    (isAdmin && imageMode === "prebuilt" && !containerImage.trim()) ||
    (isAdmin && imageMode === "archive" && !archiveImport?.generated_image_ref);

  // Fetch catalog model lists for all catalog providers
  const catalogKeys = [...new Set(allProviders.filter((p) => p.provider).map((p) => p.provider))];
  const catalogDetailResults = useQueries({
    queries: catalogKeys.map((key) => ({
      queryKey: ["catalog-provider", key],
      queryFn: () => fetchCatalogProviderDetail(key),
      staleTime: 5 * 60 * 1000,
    })),
  });
  const catalogDetailMap: Record<string, CatalogProviderDetail> = {};
  catalogKeys.forEach((key, i) => {
    if (catalogDetailResults[i]?.data) catalogDetailMap[key] = catalogDetailResults[i].data!;
  });
  const catalogReady = allProviders.every((p) => !p.provider || Boolean(catalogDetailMap[p.provider]));

  // Gateway providers + model selection
  const [enabledProviders, setEnabledProviders] = useState<number[]>([]);
  const [providerModels, setProviderModels] = useState<Record<number, string[]>>({});
  const [defaultModel, setDefaultModel] = useState<string>("");
  const [didInitModels, setDidInitModels] = useState(false);

  // Brave key
  const [braveKey, setBraveKey] = useState("");
  const [imageInspection, setImageInspection] = useState<ImageContractInspection | null>(null);
  const [isInspectingImage, setIsInspectingImage] = useState(false);
  const [inspectError, setInspectError] = useState("");

  useEffect(() => {
    if (didInitModels || allProviders.length === 0 || !catalogReady) return;

    const presetModels = settings?.default_models?.length
      ? settings.default_models
      : FALLBACK_MODEL_PRESET;

    const nextEnabled = new Set<number>();
    const nextProviderModels: Record<number, string[]> = {};
    let nextDefaultModel = "";

    for (const fullModel of presetModels) {
      const [providerKey, modelId] = fullModel.split("/", 2);
      if (!providerKey || !modelId) continue;

      const provider = allProviders.find((p) => p.key === providerKey);
      if (!provider) continue;

      const availableModelIDs = provider.provider
        ? (catalogDetailMap[provider.provider]?.models ?? []).map((m) => m.model_id)
        : (provider.models ?? []).map((m) => m.id);
      if (!availableModelIDs.includes(modelId)) continue;

      nextEnabled.add(provider.id);
      nextProviderModels[provider.id] = [...(nextProviderModels[provider.id] ?? []), modelId];
      if (!nextDefaultModel) nextDefaultModel = fullModel;
    }

    if (nextEnabled.size === 0) {
      setDidInitModels(true);
      return;
    }

    setEnabledProviders([...nextEnabled]);
    setProviderModels(nextProviderModels);
    setDefaultModel(nextDefaultModel);
    setDidInitModels(true);
  }, [allProviders, catalogDetailMap, catalogReady, didInitModels, settings?.default_models]);

  useEffect(() => {
    setImageInspection(null);
    setInspectError("");
  }, [containerImage, imageMode]);

  useEffect(() => {
    setArchiveImport(null);
    setArchiveError("");
  }, [archiveFile, archiveBaseImage, displayName, imageMode]);

  const archiveErrorGuidance = archiveError ? getArchiveErrorGuidance(archiveError) : null;

  const handleInspectImage = async () => {
    const imageRef = containerImage.trim();
    if (!imageRef) return;

    setIsInspectingImage(true);
    setInspectError("");
    setImageInspection(null);
    try {
      const result = await inspectInstanceImage(imageRef);
      setImageInspection(result);
    } catch (error) {
      setInspectError(getInspectErrorMessage(error));
    } finally {
      setIsInspectingImage(false);
    }
  };

  const handleBuildArchiveImage = async () => {
    if (!archiveFile) return;

    setIsImportingArchive(true);
    setArchiveError("");
    setArchiveImport(null);
    try {
      const result = await importArchiveImage({
        file: archiveFile,
        baseImage: archiveBaseImage.trim() || undefined,
        displayName: displayName.trim() || undefined,
      });
      setArchiveImport(result);
      setContainerImage(result.generated_image_ref);
    } catch (error) {
      setArchiveError(getImportErrorMessage(error));
    } finally {
      setIsImportingArchive(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) return;

    // Build provider-prefixed extra models.
    // Skip providers with stored models (custom providers) — their models are
    // pushed to the container directly from the provider definition.
    const extraModels: string[] = [];
    for (const p of allProviders) {
      for (const m of providerModels[p.id] ?? []) {
        extraModels.push(`${p.key}/${m}`);
      }
    }

    const payload: InstanceCreatePayload = {
      display_name: displayName.trim(),
      brave_api_key: braveKey || null,
      timezone: timezone || null,
      user_agent: userAgent || null,
    };
    if (isAdmin) {
      payload.cpu_request = cpuRequest;
      payload.cpu_limit = cpuLimit;
      payload.memory_request = memoryRequest;
      payload.memory_limit = memoryLimit;
      payload.storage_homebrew = storageHomebrew;
      payload.storage_home = storageHome;
      payload.container_image =
        imageMode === "prebuilt"
          ? (containerImage.trim() || null)
          : imageMode === "archive"
            ? (archiveImport?.generated_image_ref ?? null)
            : null;
      payload.vnc_resolution = vncResolution || null;
    }

    if (enabledProviders.length > 0) {
      payload.enabled_providers = enabledProviders;
    }
    if (extraModels.length > 0) {
      payload.models = { disabled: [], extra: extraModels };
    }
    if (defaultModel) {
      payload.default_model = defaultModel;
    }

    onSubmit(payload);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* General */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h3 className="text-sm font-medium text-gray-900 mb-4">General</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              Display Name *
            </label>
            <input
              data-testid="display-name-input"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g., Bot Alpha"
              required
              autoFocus
              className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {isAdmin ? (
            <>
              <div>
                <label className="block text-xs text-gray-500 mb-2">
                  Agent Runtime
                </label>
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className={`rounded-lg border p-3 cursor-pointer ${imageMode === "managed" ? "border-blue-500 bg-blue-50" : "border-gray-200 bg-white"}`}>
                    <div className="flex items-start gap-2">
                      <input
                        type="radio"
                        name="image-mode"
                        value="managed"
                        checked={imageMode === "managed"}
                        onChange={() => setImageMode("managed")}
                        className="mt-0.5"
                      />
                      <div>
                        <div className="text-sm font-medium text-gray-900">Managed Image</div>
                        <p className="text-xs text-gray-500 mt-1">
                          Use the admin-managed base image and let Claworc prepare a fresh instance.
                        </p>
                      </div>
                    </div>
                  </label>
                  <label className={`rounded-lg border p-3 cursor-pointer ${imageMode === "prebuilt" ? "border-blue-500 bg-blue-50" : "border-gray-200 bg-white"}`}>
                    <div className="flex items-start gap-2">
                      <input
                        type="radio"
                        name="image-mode"
                        value="prebuilt"
                        checked={imageMode === "prebuilt"}
                        onChange={() => setImageMode("prebuilt")}
                        className="mt-0.5"
                      />
                      <div>
                        <div className="text-sm font-medium text-gray-900">Prebuilt Image</div>
                        <p className="text-xs text-gray-500 mt-1">
                          Use a custom Claworc-compatible image with baked <code>~/.openclaw</code>, skills, tools, or workspace files.
                        </p>
                      </div>
                    </div>
                  </label>
                  <label className={`rounded-lg border p-3 cursor-pointer ${imageMode === "archive" ? "border-blue-500 bg-blue-50" : "border-gray-200 bg-white"}`}>
                    <div className="flex items-start gap-2">
                      <input
                        type="radio"
                        name="image-mode"
                        value="archive"
                        checked={imageMode === "archive"}
                        onChange={() => setImageMode("archive")}
                        className="mt-0.5"
                      />
                      <div>
                        <div className="text-sm font-medium text-gray-900">Archive Import</div>
                        <p className="text-xs text-gray-500 mt-1">
                          Upload a workspace archive and let Claworc build a local immutable prebuilt image for you.
                        </p>
                      </div>
                    </div>
                  </label>
                </div>
                {imageMode === "managed" ? (
                  <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
                    <div className="text-xs font-medium text-gray-700">Managed base image</div>
                    <div className="mt-1 break-all font-mono text-xs text-gray-600">{defaultManagedImage}</div>
                  </div>
                ) : imageMode === "prebuilt" ? (
                  <div className="mt-3 space-y-3">
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input
                        type="text"
                        value={containerImage}
                        onChange={(e) => {
                          setImageMode("prebuilt");
                          setContainerImage(e.target.value);
                        }}
                        placeholder="registry.example.com/openclaw-my-agent:latest"
                        className="flex-1 px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <button
                        type="button"
                        onClick={handleInspectImage}
                        disabled={isInspectingImage || !containerImage.trim()}
                        className="px-3 py-1.5 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isInspectingImage ? "Inspecting..." : "Inspect image"}
                      </button>
                    </div>
                    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      Prebuilt images should expose the labels <code>io.claworc.image-mode</code>, <code>io.claworc.openclaw-user</code>, and <code>io.claworc.openclaw-home</code>. Use <span className="font-medium">Inspect image</span> to pull the image once and preview the runtime contract before create.
                    </div>
                    {inspectError ? (
                      <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                        {inspectError}
                      </div>
                    ) : null}
                    {imageInspection ? (
                      <div className={`rounded-md border px-3 py-3 ${imageInspection.prebuilt_ready ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${imageInspection.prebuilt_ready ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                            {imageInspection.prebuilt_ready ? "Prebuilt ready" : "Managed-compatible fallback"}
                          </span>
                          <span className="text-[11px] font-mono text-gray-600">{imageInspection.mode}</span>
                        </div>
                        <dl className="mt-3 grid gap-2 text-xs text-gray-700 sm:grid-cols-3">
                          <div>
                            <dt className="text-gray-500">OpenClaw User</dt>
                            <dd className="mt-1 font-mono break-all">{imageInspection.open_claw_user}</dd>
                          </div>
                          <div>
                            <dt className="text-gray-500">OpenClaw Home</dt>
                            <dd className="mt-1 font-mono break-all">{imageInspection.open_claw_home}</dd>
                          </div>
                          <div>
                            <dt className="text-gray-500">Browser Metrics Path</dt>
                            <dd className="mt-1 font-mono break-all">{imageInspection.browser_metrics_path}</dd>
                          </div>
                        </dl>
                        <ul className="mt-3 space-y-1 text-xs text-gray-700">
                          {imageInspection.notes.map((note) => (
                            <li key={note}>{note}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="mt-3 space-y-3">
                    <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-3">
                      <div className="text-xs font-medium text-blue-900">Archive import best practice</div>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        {ARCHIVE_LAYOUT_EXAMPLES.map((example) => (
                          <div key={example.example} className="rounded-md border border-blue-100 bg-white/80 px-3 py-2">
                            <div className="text-[11px] font-medium text-gray-800">{example.label}</div>
                            <div className="mt-1 font-mono text-[11px] text-blue-900 break-all">{example.example}</div>
                          </div>
                        ))}
                      </div>
                      <ul className="mt-3 space-y-1 text-xs text-blue-900">
                        <li>Keep exactly one <code>.openclaw</code> root in the archive.</li>
                        <li>Use real files only. Symlinks are rejected on import for safety.</li>
                        <li>Claworc builds a local immutable prebuilt image first, then Create Instance uses that image.</li>
                      </ul>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">
                        Base Image Override
                      </label>
                      <input
                        type="text"
                        value={archiveBaseImage}
                        onChange={(e) => setArchiveBaseImage(e.target.value)}
                        placeholder={defaultManagedImage}
                        className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <p className="mt-1 text-xs text-gray-500">
                        Leave empty to build from the managed default image. The imported archive is copied into that image&apos;s OpenClaw home.
                      </p>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">
                        Archive File
                      </label>
                      <input
                        type="file"
                        accept=".zip,.tar,.tar.gz,.tgz"
                        onChange={(e) => setArchiveFile(e.target.files?.[0] ?? null)}
                        className="block w-full text-sm text-gray-700 file:mr-3 file:rounded-md file:border-0 file:bg-blue-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-blue-700 hover:file:bg-blue-100"
                      />
                      <p className="mt-1 text-xs text-gray-500">
                        Supported formats: <code>.zip</code>, <code>.tar</code>, <code>.tar.gz</code>, <code>.tgz</code>. Archive can contain the OpenClaw home at the root or inside one wrapper folder.
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={handleBuildArchiveImage}
                        disabled={isImportingArchive || !archiveFile}
                        className="px-3 py-1.5 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isImportingArchive ? "Building image..." : "Build image from archive"}
                      </button>
                      {archiveFile ? <span className="text-xs text-gray-500">{archiveFile.name}</span> : null}
                    </div>
                    {archiveError ? (
                      <div className="rounded-md border border-red-200 bg-red-50 px-3 py-3 text-xs text-red-700">
                        <div className="font-medium text-red-900">
                          {archiveErrorGuidance?.title ?? "Archive import failed"}
                        </div>
                        <div className="mt-1">{archiveError}</div>
                        {archiveErrorGuidance ? (
                          <ul className="mt-3 space-y-1 text-xs text-red-800">
                            {archiveErrorGuidance.bullets.map((bullet) => (
                              <li key={bullet}>{bullet}</li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    ) : null}
                    {archiveImport ? (
                      <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
                            Archive imported
                          </span>
                          <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-800">
                            {getArchiveLayoutLabel(archiveImport.detected_layout)}
                          </span>
                          <span className="text-[11px] font-mono text-gray-600">{archiveImport.mode}</span>
                        </div>
                        <p className="mt-2 text-xs text-emerald-900">
                          {getArchiveLayoutDescription(archiveImport.detected_layout)}
                        </p>
                        <dl className="mt-3 grid gap-2 text-xs text-gray-700 sm:grid-cols-2">
                          <div>
                            <dt className="text-gray-500">Generated Image Ref</dt>
                            <dd className="mt-1 font-mono break-all">{archiveImport.generated_image_ref}</dd>
                          </div>
                          <div>
                            <dt className="text-gray-500">Base Image</dt>
                            <dd className="mt-1 font-mono break-all">{archiveImport.base_image}</dd>
                          </div>
                          <div>
                            <dt className="text-gray-500">Detected Root</dt>
                            <dd className="mt-1 font-mono break-all">{archiveImport.detected_root}</dd>
                          </div>
                          <div>
                            <dt className="text-gray-500">Detected Layout</dt>
                            <dd className="mt-1">{getArchiveLayoutLabel(archiveImport.detected_layout)}</dd>
                          </div>
                          <div>
                            <dt className="text-gray-500">OpenClaw User</dt>
                            <dd className="mt-1 font-mono break-all">{archiveImport.open_claw_user}</dd>
                          </div>
                          <div>
                            <dt className="text-gray-500">OpenClaw Home</dt>
                            <dd className="mt-1 font-mono break-all">{archiveImport.open_claw_home}</dd>
                          </div>
                          <div>
                            <dt className="text-gray-500">Browser Metrics Path</dt>
                            <dd className="mt-1 font-mono break-all">{archiveImport.browser_metrics_path}</dd>
                          </div>
                        </dl>
                        <div className="mt-3 rounded-md border border-emerald-100 bg-white/80 px-3 py-2 text-xs text-emerald-900">
                          Create Instance will now use this generated image ref directly, so the imported archive becomes the starting OpenClaw home for the new bot.
                        </div>
                        <ul className="mt-3 space-y-1 text-xs text-gray-700">
                          {archiveImport.notes.map((note) => (
                            <li key={note}>{note}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  VNC Resolution Override
                </label>
                <input
                  type="text"
                  value={vncResolution}
                  onChange={(e) => setVncResolution(e.target.value)}
                  placeholder={settings?.default_vnc_resolution ?? "1920x1080"}
                  className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </>
          ) : null}
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              Timezone Override
            </label>
            <input
              type="text"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              placeholder={settings?.default_timezone ?? "America/New_York"}
              className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              User-Agent Override
            </label>
            <input
              type="text"
              value={userAgent}
              onChange={(e) => setUserAgent(e.target.value)}
              placeholder={settings?.default_user_agent || "Browser default"}
              className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      {/* Enabled Models */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h3 className="text-sm font-medium text-gray-900 mb-1">Enabled Models</h3>
        <p className="text-xs text-gray-500 mb-4">
          Pick among available model(s) for the agent.
        </p>

        {allProviders.length === 0 ? (
          <p className="text-sm text-gray-400 italic">
            No providers configured. Add providers in Settings → Model API Keys first.
          </p>
        ) : (
          <ProviderModelSelector
            providers={allProviders}
            catalogDetailMap={catalogDetailMap}
            enabledProviders={enabledProviders}
            providerModels={providerModels}
            defaultModel={defaultModel}
            onUpdate={(newEnabled, newModels, newDefault) => {
              setDidInitModels(true);
              setEnabledProviders(newEnabled);
              setProviderModels(newModels);
              setDefaultModel(newDefault);
            }}
          />
        )}

        {/* Brave key */}
        <div className="pt-4 mt-4 border-t border-gray-200">
          <label className="block text-xs text-gray-500 mb-1">
            Brave API Key (web search)
          </label>
          <input
            type="password"
            value={braveKey}
            onChange={(e) => setBraveKey(e.target.value)}
            placeholder="Leave empty to use global key"
            className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Container Resources */}
      {isAdmin ? (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h3 className="text-sm font-medium text-gray-900 mb-4">Container Resources</h3>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              {[
                { label: "CPU Request", value: cpuRequest, set: setCpuRequest },
                { label: "CPU Limit", value: cpuLimit, set: setCpuLimit },
                { label: "Memory Request", value: memoryRequest, set: setMemoryRequest },
                { label: "Memory Limit", value: memoryLimit, set: setMemoryLimit },
              ].map((field) => (
                <div key={field.label}>
                  <label className="block text-xs text-gray-500 mb-1">
                    {field.label}
                  </label>
                  <input
                    type="text"
                    value={field.value}
                    onChange={(e) => field.set(e.target.value)}
                    className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-4">
              {[
                { label: "Homebrew Storage", value: storageHomebrew, set: setStorageHomebrew },
                { label: "Home Storage", value: storageHome, set: setStorageHome },
              ].map((field) => (
                <div key={field.label}>
                  <label className="block text-xs text-gray-500 mb-1">
                    {field.label}
                  </label>
                  <input
                    type="text"
                    value={field.value}
                    onChange={(e) => field.set(e.target.value)}
                    className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-900">
          User self-service uses the admin-approved base image and resource limits. Model selection, timezone, user-agent and per-instance API keys still stay configurable.
        </div>
      )}

      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          data-testid="create-instance-button"
          type="submit"
          disabled={isCreateDisabled}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Creating..." : "Create"}
        </button>
      </div>

    </form>
  );
}
