import client from "./client";
import type {
  ArchiveImageImportResult,
  InstanceBackupRestoreResult,
  Instance,
  InstanceDetail,
  InstanceCreatePayload,
  InstanceUpdatePayload,
  InstanceConfig,
  InstanceConfigUpdate,
  InstanceStats,
  InstanceDoctorResult,
  ImageContractInspection,
  InstanceFeaturePack,
  ApplyFeaturePackResult,
} from "@/types/instance";

export async function fetchInstances(): Promise<Instance[]> {
  const { data } = await client.get<Instance[]>("/instances");
  return data;
}

export async function fetchInstance(id: number): Promise<InstanceDetail> {
  const { data } = await client.get<InstanceDetail>(`/instances/${id}`);
  return data;
}

export async function createInstance(
  payload: InstanceCreatePayload,
): Promise<InstanceDetail> {
  const { data } = await client.post<InstanceDetail>("/instances", payload);
  return data;
}

export async function inspectInstanceImage(
  containerImage: string,
): Promise<ImageContractInspection> {
  const { data } = await client.post<ImageContractInspection>(
    "/instances/inspect-image",
    { container_image: containerImage },
  );
  return data;
}

export async function importArchiveImage(
  params: { file: File; baseImage?: string; displayName?: string },
): Promise<ArchiveImageImportResult> {
  const form = new FormData();
  form.append("file", params.file);
  if (params.baseImage) form.append("base_image", params.baseImage);
  if (params.displayName) form.append("display_name", params.displayName);

  const { data } = await client.post<ArchiveImageImportResult>(
    "/instances/import-archive-image",
    form,
    { headers: { "Content-Type": "multipart/form-data" } },
  );
  return data;
}

export async function exportInstanceBackup(
  id: number,
  format: "zip" | "tgz" = "zip",
): Promise<{ blob: Blob; filename: string }> {
  const response = await fetch(
    `/api/v1/instances/${id}/backup-archive?format=${encodeURIComponent(format)}`,
    {
      credentials: "include",
    },
  );

  if (!response.ok) {
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.error || "Failed to export backup archive");
    }
    throw new Error((await response.text()) || "Failed to export backup archive");
  }

  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") || "";
  const match = disposition.match(/filename="([^"]+)"/);
  const filename = match?.[1] || `instance-backup.${format === "tgz" ? "tgz" : "zip"}`;

  return { blob, filename };
}

export async function restoreInstanceBackup(
  id: number,
  file: File,
): Promise<InstanceBackupRestoreResult> {
  const form = new FormData();
  form.append("file", file);

  const { data } = await client.post<InstanceBackupRestoreResult>(
    `/instances/${id}/restore-backup`,
    form,
    { headers: { "Content-Type": "multipart/form-data" } },
  );
  return data;
}

export async function updateInstance(
  id: number,
  payload: InstanceUpdatePayload,
): Promise<InstanceDetail> {
  const { data } = await client.put<InstanceDetail>(`/instances/${id}`, payload);
  return data;
}

export async function deleteInstance(id: number): Promise<void> {
  await client.delete(`/instances/${id}`);
}

export async function startInstance(
  id: number,
): Promise<{ status: string }> {
  const { data } = await client.post<{ status: string }>(
    `/instances/${id}/start`,
  );
  return data;
}

export async function stopInstance(
  id: number,
): Promise<{ status: string }> {
  const { data } = await client.post<{ status: string }>(
    `/instances/${id}/stop`,
  );
  return data;
}

export async function restartInstance(
  id: number,
): Promise<{ status: string }> {
  const { data } = await client.post<{ status: string }>(
    `/instances/${id}/restart`,
  );
  return data;
}

export async function fetchInstanceConfig(
  id: number,
): Promise<InstanceConfig> {
  const { data } = await client.get<InstanceConfig>(`/instances/${id}/config`);
  return data;
}

export async function fetchInstanceFeaturePacks(
  id: number,
): Promise<InstanceFeaturePack[]> {
  const { data } = await client.get<{ feature_packs: InstanceFeaturePack[] }>(
    `/instances/${id}/feature-packs`,
  );
  return data.feature_packs;
}

export async function updateInstanceConfig(
  id: number,
  config: string,
): Promise<InstanceConfigUpdate> {
  const { data } = await client.put<InstanceConfigUpdate>(
    `/instances/${id}/config`,
    { config },
  );
  return data;
}

export async function applyInstanceFeaturePack(
  id: number,
  slug: string,
  inputs: Record<string, string>,
): Promise<ApplyFeaturePackResult> {
  const { data } = await client.post<ApplyFeaturePackResult>(
    `/instances/${id}/feature-packs/${encodeURIComponent(slug)}/apply`,
    { inputs },
  );
  return data;
}

export async function cloneInstance(
  id: number,
): Promise<InstanceDetail> {
  const { data } = await client.post<InstanceDetail>(
    `/instances/${id}/clone`,
  );
  return data;
}

export async function reorderInstances(orderedIds: number[]): Promise<void> {
  await client.put("/instances/reorder", { ordered_ids: orderedIds });
}

export async function fetchInstanceStats(
  id: number,
): Promise<InstanceStats> {
  const { data } = await client.get<InstanceStats>(`/instances/${id}/stats`);
  return data;
}

export async function updateInstanceImage(id: number): Promise<void> {
  await client.post(`/instances/${id}/update-image`);
}

export async function runInstanceDoctor(
  id: number,
  fix: boolean = false,
): Promise<InstanceDoctorResult> {
  const { data } = await client.post<InstanceDoctorResult>(
    `/instances/${id}/doctor`,
    { fix },
  );
  return data;
}
