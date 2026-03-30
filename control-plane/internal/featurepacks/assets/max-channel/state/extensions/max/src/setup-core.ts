import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "openclaw/plugin-sdk/account-id";
import type { ChannelSetupAdapter, OpenClawConfig } from "openclaw/plugin-sdk/setup";
import { createSetupInputPresenceValidator } from "openclaw/plugin-sdk/setup";
import { resolveMaxAccount, listMaxAccountIds } from "./accounts.js";
import type { MaxConfig } from "./types.js";

const channel = "max" as const;

type MaxSetupInput = {
  useEnv?: boolean;
  name?: string;
  botToken?: string;
  token?: string;
  tokenFile?: string;
  webhookUrl?: string;
  webhookPath?: string;
  password?: string;
  url?: string;
};

export function patchMaxAccountConfig(params: {
  cfg: OpenClawConfig;
  accountId: string;
  patch: Record<string, unknown>;
  clearFields?: string[];
  enabled?: boolean;
}): OpenClawConfig {
  const accountId = normalizeAccountId(params.accountId);
  const maxConfig = (params.cfg.channels?.max ?? {}) as MaxConfig;
  const clearFields = params.clearFields ?? [];

  if (accountId === DEFAULT_ACCOUNT_ID) {
    const nextMax = { ...maxConfig } as Record<string, unknown>;
    for (const field of clearFields) {
      delete nextMax[field];
    }
    return {
      ...params.cfg,
      channels: {
        ...params.cfg.channels,
        max: {
          ...nextMax,
          ...(params.enabled ? { enabled: true } : {}),
          ...params.patch,
        },
      },
    };
  }

  const nextAccount = {
    ...(maxConfig.accounts?.[accountId] ?? {}),
  } as Record<string, unknown>;
  for (const field of clearFields) {
    delete nextAccount[field];
  }

  return {
    ...params.cfg,
    channels: {
      ...params.cfg.channels,
      max: {
        ...maxConfig,
        ...(params.enabled ? { enabled: true } : {}),
        accounts: {
          ...maxConfig.accounts,
          [accountId]: {
            ...nextAccount,
            ...(params.enabled ? { enabled: true } : {}),
            ...params.patch,
          },
        },
      },
    },
  };
}

export function isMaxConfigured(cfg: OpenClawConfig, accountId: string): boolean {
  const resolved = resolveMaxAccount({ cfg, accountId });
  return Boolean(resolved.token.trim() && resolved.config.webhookUrl?.trim());
}

export function parseMaxAllowFromId(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed === "*") {
    return "*";
  }
  const normalized = trimmed.replace(/^max:/i, "").trim();
  return /^\d+$/.test(normalized) ? normalized : null;
}

function resolveMaxEnvToken(): string | undefined {
  return process.env.MAX_BOT_TOKEN?.trim() || process.env.MAX_TOKEN?.trim() || undefined;
}

export const maxSetupAdapter: ChannelSetupAdapter = {
  resolveAccountId: ({ accountId }) => normalizeAccountId(accountId),
  applyAccountName: ({ cfg, accountId, name }) =>
    patchMaxAccountConfig({
      cfg,
      accountId,
      patch: name?.trim() ? { name: name.trim() } : {},
    }),
  validateInput: createSetupInputPresenceValidator({
    defaultAccountOnlyEnvError:
      "MAX_BOT_TOKEN or MAX_TOKEN can only be used for the default account.",
    whenNotUseEnv: [
      {
        someOf: ["botToken", "token", "tokenFile"],
        message: "MAX requires botToken or --token-file (or --use-env).",
      },
      {
        someOf: ["webhookUrl"],
        message: "MAX requires webhookUrl for production webhook delivery.",
      },
    ],
    validate: ({ cfg, accountId, input }) => {
      const existingWebhookUrl = resolveMaxAccount({ cfg, accountId }).config.webhookUrl?.trim();
      const nextWebhookUrl =
        typeof input.webhookUrl === "string" ? input.webhookUrl.trim() : existingWebhookUrl;
      if (!nextWebhookUrl) {
        return "MAX requires webhookUrl for production webhook delivery.";
      }
      return null;
    },
  }),
  applyAccountConfig: ({ cfg, accountId, input }) => {
    const typedInput = input as MaxSetupInput;
    const normalizedAccountId = normalizeAccountId(accountId);
    const clearCredentialFields = typedInput.useEnv
      ? ["botToken", "tokenFile"]
      : typedInput.tokenFile?.trim()
        ? ["botToken"]
        : typedInput.botToken?.trim() || typedInput.token?.trim()
          ? ["tokenFile"]
          : undefined;
    if (typedInput.useEnv) {
      return patchMaxAccountConfig({
        cfg,
        accountId: normalizedAccountId,
        enabled: true,
        clearFields: clearCredentialFields,
        patch: {
          ...(typedInput.webhookUrl?.trim() ? { webhookUrl: typedInput.webhookUrl.trim() } : {}),
          ...(typedInput.webhookPath?.trim() ? { webhookPath: typedInput.webhookPath.trim() } : {}),
          ...(typedInput.password?.trim()
            ? { webhookSecret: typedInput.password.trim() }
            : typedInput.password === ""
              ? { webhookSecret: undefined }
              : {}),
          ...(typedInput.url?.trim() ? { apiBaseUrl: typedInput.url.trim() } : {}),
          useLongPoll: false,
        },
      });
    }
    return patchMaxAccountConfig({
      cfg,
      accountId: normalizedAccountId,
      enabled: true,
      clearFields: clearCredentialFields,
      patch: {
        ...(typedInput.tokenFile?.trim()
          ? { tokenFile: typedInput.tokenFile.trim() }
          : typedInput.botToken?.trim()
            ? { botToken: typedInput.botToken.trim() }
            : typedInput.token?.trim()
              ? { botToken: typedInput.token.trim() }
              : {}),
        ...(typedInput.webhookUrl?.trim() ? { webhookUrl: typedInput.webhookUrl.trim() } : {}),
        ...(typedInput.webhookPath?.trim() ? { webhookPath: typedInput.webhookPath.trim() } : {}),
        ...(typedInput.password?.trim()
          ? { webhookSecret: typedInput.password.trim() }
          : typedInput.password === ""
            ? { webhookSecret: undefined }
            : {}),
        ...(typedInput.url?.trim() ? { apiBaseUrl: typedInput.url.trim() } : {}),
        useLongPoll: false,
      },
    });
  },
};

export { listMaxAccountIds, resolveMaxEnvToken };
