export interface BlueprintPack {
  slug: string;
  name: string;
  summary: string;
  category: string;
  inputs?: Record<string, string>;
  requires_secret_inputs: boolean;
}

export interface Blueprint {
  slug: string;
  name: string;
  summary?: string;
  version: string;
  source_instance_id?: number;
  source_instance_name?: string;
  pack_count: number;
  requires_secrets: boolean;
  created_at: string;
  updated_at: string;
  packs: BlueprintPack[];
}

export interface CaptureBlueprintPayload {
  name: string;
  summary?: string;
  slug?: string;
}

export interface BlueprintApplyResult {
  slug: string;
  name: string;
  applied_at: string;
  applied_packs: number;
  restarted: boolean;
  notes?: string[];
}
