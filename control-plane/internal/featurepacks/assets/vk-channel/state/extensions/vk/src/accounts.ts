import {
  createAccountListHelpers,
  resolveMergedAccountConfig,
} from "openclaw/plugin-sdk/account-helpers";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "openclaw/plugin-sdk/account-id";
import { tryReadSecretFileSync } from "openclaw/plugin-sdk/core";
import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import type { ResolvedVkAccount, VkAccountConfig, VkConfig, VkTokenSource } from "./types.js";

export type { ResolvedVkAccount };

const { listAccountIds: listVkAccountIds, resolveDefaultAccountId: resolveDefaultVkAccountId } =
  createAccountListHelpers("vk");
export { listVkAccountIds, resolveDefaultVkAccountId };

function readTokenFile(filePath: string | undefined): string | undefined {
  return tryReadSecretFileSync(filePath, "VK token file", { rejectSymlink: true });
}

function mergeVkAccountConfig(cfg: OpenClawConfig, accountId: string): VkAccountConfig {
  return resolveMergedAccountConfig<VkAccountConfig>({
    channelConfig: cfg.channels?.vk as VkAccountConfig | undefined,
    accounts: (cfg.channels?.vk as VkConfig | undefined)?.accounts as
      | Record<string, Partial<VkAccountConfig>>
      | undefined,
    accountId,
    omitKeys: ["defaultAccount"],
  });
}

function resolveVkToken(params: {
  cfg: OpenClawConfig;
  accountId: string;
  merged: VkAccountConfig;
}): { token: string; tokenSource: VkTokenSource } {
  if (typeof params.merged.accessToken === "string" && params.merged.accessToken.trim()) {
    return { token: params.merged.accessToken.trim(), tokenSource: "config" };
  }

  const fileToken = readTokenFile(params.merged.tokenFile);
  if (fileToken) {
    return { token: fileToken, tokenSource: "file" };
  }

  if (params.accountId === DEFAULT_ACCOUNT_ID) {
    const envToken =
      process.env.VK_COMMUNITY_TOKEN?.trim() || process.env.VK_BOT_TOKEN?.trim() || "";
    if (envToken) {
      return { token: envToken, tokenSource: "env" };
    }
  }

  return { token: "", tokenSource: "none" };
}

export function resolveVkAccount(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
}): ResolvedVkAccount {
  const accountId = normalizeAccountId(params.accountId);
  const baseEnabled = (params.cfg.channels?.vk as VkConfig | undefined)?.enabled !== false;
  const merged = mergeVkAccountConfig(params.cfg, accountId);
  const accountEnabled = merged.enabled !== false;
  const enabled = baseEnabled && accountEnabled;
  const tokenResolution = resolveVkToken({ cfg: params.cfg, accountId, merged });
  const groupId =
    merged.groupId ?? (accountId === DEFAULT_ACCOUNT_ID ? process.env.VK_GROUP_ID?.trim() : undefined);

  return {
    accountId,
    name: merged.name?.trim() || undefined,
    enabled,
    token: tokenResolution.token,
    tokenSource: tokenResolution.tokenSource,
    groupId: groupId !== undefined && groupId !== null ? String(groupId).trim() : undefined,
    config: merged,
  };
}

export function listEnabledVkAccounts(cfg: OpenClawConfig): ResolvedVkAccount[] {
  return listVkAccountIds(cfg)
    .map((accountId) => resolveVkAccount({ cfg, accountId }))
    .filter((account) => account.enabled);
}
