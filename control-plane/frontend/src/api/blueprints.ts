import client from "./client";
import type { Blueprint, BlueprintApplyResult, CaptureBlueprintPayload } from "@/types/blueprint";

export async function fetchBlueprints(): Promise<Blueprint[]> {
  const { data } = await client.get<{ blueprints: Blueprint[] }>("/blueprints");
  return data.blueprints;
}

export async function captureInstanceBlueprint(
  id: number,
  payload: CaptureBlueprintPayload,
): Promise<Blueprint> {
  const { data } = await client.post<Blueprint>(`/instances/${id}/blueprints/capture`, payload);
  return data;
}

export async function applyInstanceBlueprint(
  id: number,
  slug: string,
): Promise<BlueprintApplyResult> {
  const { data } = await client.post<BlueprintApplyResult>(
    `/instances/${id}/blueprints/${encodeURIComponent(slug)}/apply`,
  );
  return data;
}

export async function exportBlueprint(
  slug: string,
): Promise<{ blob: Blob; filename: string }> {
  const response = await fetch(`/api/v1/blueprints/${encodeURIComponent(slug)}/export`, {
    credentials: "include",
  });

  if (!response.ok) {
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.error || "Failed to export blueprint");
    }
    throw new Error((await response.text()) || "Failed to export blueprint");
  }

  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") || "";
  const match = disposition.match(/filename="([^"]+)"/);
  const filename = match?.[1] || `${slug}-blueprint.json`;

  return { blob, filename };
}

export async function importBlueprint(file: File): Promise<Blueprint> {
  const form = new FormData();
  form.append("file", file);

  const { data } = await client.post<Blueprint>("/blueprints/import", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}
