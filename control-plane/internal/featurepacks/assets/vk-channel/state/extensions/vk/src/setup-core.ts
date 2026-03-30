import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "openclaw/plugin-sdk/account-id";
import type { ChannelSetupAdapter, OpenClawConfig } from "openclaw/plugin-sdk/setup";
import { createSetupInputPresenceValidator } from "openclaw/plugin-sdk/setup";
import { listVkAccountIds, resolveVkAccount } from "./accounts.js";
import type { VkConfig } from "./types.js";

const channel = "vk" as const;

type VkSetupInput = {
  useEnv?: boolean;
  name?: string;
  accessToken?: string;
  token?: string;
  tokenFile?: string;
  audience?: string;
  webhookUrl?: string;
  webhookPath?: string;
  password?: string;
  code?: string;
};

export function patchVkAccountConfig(params: {
  cfg: OpenClawConfig;
  accountId: string;
  patch: Record<string, unknown>;
  clearFields?: string[];
  enabled?: boolean;
}): OpenClawConfig {
  const accountId = normalizeAccountId(params.accountId);
  const vkConfig = (params.cfg.channels?.vk ?? {}) as VkConfig;
  const clearFields = params.clearFields ?? [];

  if (accountId === DEFAULT_ACCOUNT_ID) {
    const nextVk = { ...vkConfig } as Record<string, unknown>;
    for (const field of clearFields) {
      delete nextVk[field];
    }
    return {
      ...params.cfg,
      channels: {
        ...params.cfg.channels,
        vk: {
          ...nextVk,
          ...(params.enabled ? { enabled: true } : {}),
          ...params.patch,
        },
      },
    };
  }

  const nextAccount = {
    ...(vkConfig.accounts?.[accountId] ?? {}),
  } as Record<string, unknown>;
  for (const field of clearFields) {
    delete nextAccount[field];
  }

  return {
    ...params.cfg,
    channels: {
      ...params.cfg.channels,
      vk: {
        ...vkConfig,
        ...(params.enabled ? { enabled: true } : {}),
        accounts: {
          ...vkConfig.accounts,
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

export function isVkConfigured(cfg: OpenClawConfig, accountId: string): boolean {
  const resolved = resolveVkAccount({ cfg, accountId });
  return Boolean(resolved.token.trim() && resolved.groupId?.trim());
}

export function parseVkAllowFromId(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed === "*") {
    return "*";
  }
  const normalized = trimmed.replace(/^(vk|vkontakte):/i, "").trim();
  return /^\d+$/.test(normalized) ? normalized : null;
}

function resolveVkEnvToken(): string | undefined {
  return process.env.VK_COMMUNITY_TOKEN?.trim() || process.env.VK_BOT_TOKEN?.trim() || undefined;
}

function resolveVkEnvGroupId(): string | undefined {
  return process.env.VK_GROUP_ID?.trim() || undefined;
}

export const vkSetupAdapter: ChannelSetupAdapter = {
  resolveAccountId: ({ accountId }) => normalizeAccountId(accountId),
  applyAccountName: ({ cfg, accountId, name }) =>
    patchVkAccountConfig({
      cfg,
      accountId,
      patch: name?.trim() ? { name: name.trim() } : {},
    }),
  validateInput: createSetupInputPresenceValidator({
    defaultAccountOnlyEnvError:
      "VK_COMMUNITY_TOKEN / VK_BOT_TOKEN can only be used for the default account.",
    whenNotUseEnv: [
      {
        someOf: ["accessToken", "token", "tokenFile"],
        message: "VK requires accessToken or --token-file (or --use-env).",
      },
      {
        someOf: ["audience"],
        message: "VK requires the community/group id.",
      },
    ],
    validate: ({ cfg, accountId, input }) => {
      const resolved = resolveVkAccount({ cfg, accountId });
      const audience =
        typeof input.audience === "string" ? input.audience.trim() : resolved.groupId?.trim() || "";
      if (audience && !/^\d+$/.test(audience)) {
        return "VK community/group id must be numeric.";
      }
      if (!audience) {
        return "VK requires the community/group id.";
      }
      return null;
    },
  }),
  applyAccountConfig: ({ cfg, accountId, input }) => {
    const typedInput = input as VkSetupInput;
    const normalizedAccountId = normalizeAccountId(accountId);
    const clearCredentialFields = typedInput.useEnv
      ? ["accessToken", "tokenFile"]
      : typedInput.tokenFile?.trim()
        ? ["accessToken"]
        : typedInput.accessToken?.trim() || typedInput.token?.trim()
          ? ["tokenFile"]
          : undefined;
    const commonPatch = {
      ...(typedInput.audience?.trim() ? { groupId: typedInput.audience.trim() } : {}),
      ...(typedInput.webhookUrl?.trim() ? { webhookUrl: typedInput.webhookUrl.trim() } : {}),
      ...(typedInput.webhookPath?.trim() ? { webhookPath: typedInput.webhookPath.trim() } : {}),
      ...(typedInput.password?.trim()
        ? {
            webhookSecret: typedInput.password.trim(),
            callbackSecret: typedInput.password.trim(),
          }
        : typedInput.password === ""
          ? { webhookSecret: undefined, callbackSecret: undefined }
          : {}),
      ...(typedInput.code?.trim()
        ? { confirmationToken: typedInput.code.trim() }
        : typedInput.code === ""
          ? { confirmationToken: undefined }
          : {}),
      useLongPoll: false,
    };

    if (typedInput.useEnv) {
      return patchVkAccountConfig({
        cfg,
        accountId: normalizedAccountId,
        enabled: true,
        clearFields: clearCredentialFields,
        patch: commonPatch,
      });
    }

    return patchVkAccountConfig({
      cfg,
      accountId: normalizedAccountId,
      enabled: true,
      clearFields: clearCredentialFields,
      patch: {
        ...(typedInput.tokenFile?.trim()
          ? { tokenFile: typedInput.tokenFile.trim() }
          : typedInput.accessToken?.trim()
            ? { accessToken: typedInput.accessToken.trim() }
            : typedInput.token?.trim()
              ? { accessToken: typedInput.token.trim() }
              : {}),
        ...commonPatch,
      },
    });
  },
};

export { listVkAccountIds, resolveVkEnvGroupId, resolveVkEnvToken };
