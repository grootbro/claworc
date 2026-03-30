import {
  createAccountListHelpers,
  resolveMergedAccountConfig,
} from "openclaw/plugin-sdk/account-helpers";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "openclaw/plugin-sdk/account-id";
import { tryReadSecretFileSync } from "openclaw/plugin-sdk/core";
import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import type { MaxAccountConfig, MaxConfig, MaxTokenSource, ResolvedMaxAccount } from "./types.js";

export type { ResolvedMaxAccount };

const { listAccountIds: listMaxAccountIds, resolveDefaultAccountId: resolveDefaultMaxAccountId } =
  createAccountListHelpers("max");
export { listMaxAccountIds, resolveDefaultMaxAccountId };

function readTokenFile(filePath: string | undefined): string | undefined {
  return tryReadSecretFileSync(filePath, "MAX token file", { rejectSymlink: true });
}

function mergeMaxAccountConfig(cfg: OpenClawConfig, accountId: string): MaxAccountConfig {
  return resolveMergedAccountConfig<MaxAccountConfig>({
    channelConfig: cfg.channels?.max as MaxAccountConfig | undefined,
    accounts: (cfg.channels?.max as MaxConfig | undefined)?.accounts as
      | Record<string, Partial<MaxAccountConfig>>
      | undefined,
    accountId,
    omitKeys: ["defaultAccount"],
  });
}

function resolveMaxToken(params: {
  cfg: OpenClawConfig;
  accountId: string;
  merged: MaxAccountConfig;
}): { token: string; tokenSource: MaxTokenSource } {
  if (typeof params.merged.botToken === "string" && params.merged.botToken.trim()) {
    return { token: params.merged.botToken.trim(), tokenSource: "config" };
  }

  const fileToken = readTokenFile(params.merged.tokenFile);
  if (fileToken) {
    return { token: fileToken, tokenSource: "file" };
  }

  if (params.accountId === DEFAULT_ACCOUNT_ID) {
    const envToken = process.env.MAX_BOT_TOKEN?.trim() || process.env.MAX_TOKEN?.trim() || "";
    if (envToken) {
      return { token: envToken, tokenSource: "env" };
    }
  }

  return { token: "", tokenSource: "none" };
}

export function resolveMaxAccount(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
}): ResolvedMaxAccount {
  const accountId = normalizeAccountId(params.accountId);
  const baseEnabled = (params.cfg.channels?.max as MaxConfig | undefined)?.enabled !== false;
  const merged = mergeMaxAccountConfig(params.cfg, accountId);
  const accountEnabled = merged.enabled !== false;
  const enabled = baseEnabled && accountEnabled;
  const tokenResolution = resolveMaxToken({ cfg: params.cfg, accountId, merged });

  return {
    accountId,
    name: merged.name?.trim() || undefined,
    enabled,
    token: tokenResolution.token,
    tokenSource: tokenResolution.tokenSource,
    config: merged,
  };
}

export function listEnabledMaxAccounts(cfg: OpenClawConfig): ResolvedMaxAccount[] {
  return listMaxAccountIds(cfg)
    .map((accountId) => resolveMaxAccount({ cfg, accountId }))
    .filter((account) => account.enabled);
}
