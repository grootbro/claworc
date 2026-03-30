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
