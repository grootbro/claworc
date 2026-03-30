import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { applyInstanceBlueprint, captureInstanceBlueprint, fetchBlueprints, importBlueprint } from "@/api/blueprints";
import { errorToast, successToast } from "@/utils/toast";
import type { CaptureBlueprintPayload } from "@/types/blueprint";

export function useBlueprints(enabled: boolean = true) {
  return useQuery({
    queryKey: ["blueprints"],
    queryFn: fetchBlueprints,
    enabled,
  });
}

export function useCaptureInstanceBlueprint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: CaptureBlueprintPayload }) =>
      captureInstanceBlueprint(id, payload),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["blueprints"] });
      successToast("Blueprint saved", data.name);
    },
    onError: (error: unknown) => {
      errorToast("Failed to save blueprint", error);
    },
  });
}

export function useApplyInstanceBlueprint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, slug }: { id: number; slug: string }) =>
      applyInstanceBlueprint(id, slug),
    onSuccess: (data, variables) => {
      qc.invalidateQueries({ queryKey: ["instances", variables.id, "feature-packs"] });
      qc.invalidateQueries({ queryKey: ["instances", variables.id, "config"] });
      qc.invalidateQueries({ queryKey: ["instances", variables.id] });
      qc.invalidateQueries({ queryKey: ["instances"] });
      successToast("Blueprint applied", data.name);
    },
    onError: (error: unknown) => {
      errorToast("Failed to apply blueprint", error);
    },
  });
}

export function useImportBlueprint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => importBlueprint(file),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["blueprints"] });
      successToast("Blueprint imported", data.name);
    },
    onError: (error: unknown) => {
      errorToast("Failed to import blueprint", error);
    },
  });
}
