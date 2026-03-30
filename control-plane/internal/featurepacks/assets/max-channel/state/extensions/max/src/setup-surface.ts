import {
  createAllowFromSection,
  createStandardChannelSetupStatus,
  createTopLevelChannelDmPolicy,
  DEFAULT_ACCOUNT_ID,
  formatDocsLink,
  setSetupChannelEnabled,
  splitSetupEntries,
  type ChannelSetupDmPolicy,
  type ChannelSetupWizard,
} from "openclaw/plugin-sdk/setup";
import {
  isMaxConfigured,
  listMaxAccountIds,
  maxSetupAdapter,
  parseMaxAllowFromId,
  patchMaxAccountConfig,
  resolveMaxEnvToken,
} from "./setup-core.js";
import { resolveMaxAccount } from "./accounts.js";

const channel = "max" as const;

const MAX_SETUP_HELP_LINES = [
  "1) Create a MAX bot and copy the bot token",
  "2) Configure an HTTPS webhook URL for your gateway",
  "3) Optional: set a webhook secret for signed delivery",
  "4) Point the bot subscription at your OpenClaw MAX webhook",
  `Docs: ${formatDocsLink("/channels/max", "channels/max")}`,
];

const MAX_ALLOW_FROM_HELP_LINES = [
  "Allowlist MAX DMs by numeric user id.",
  "Examples:",
  "- 123456789",
  "- max:123456789",
  "Multiple entries: comma-separated.",
  `Docs: ${formatDocsLink("/channels/max", "channels/max")}`,
];

const maxDmPolicy: ChannelSetupDmPolicy = createTopLevelChannelDmPolicy({
  label: "MAX",
  channel,
  policyKey: "channels.max.dmPolicy",
  allowFromKey: "channels.max.allowFrom",
  getCurrent: (cfg) => cfg.channels?.max?.dmPolicy ?? "pairing",
});

export { maxSetupAdapter } from "./setup-core.js";

function isValidUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export const maxSetupWizard: ChannelSetupWizard = {
  channel,
  status: createStandardChannelSetupStatus({
    channelLabel: "MAX",
    configuredLabel: "configured",
    unconfiguredLabel: "needs bot token + webhook",
    configuredHint: "configured",
    unconfiguredHint: "needs token + webhook",
    configuredScore: 2,
    unconfiguredScore: 0,
    includeStatusLine: true,
    resolveConfigured: ({ cfg }) =>
      listMaxAccountIds(cfg).some((accountId) => isMaxConfigured(cfg, accountId)),
  }),
  introNote: {
    title: "MAX bot webhook setup",
    lines: MAX_SETUP_HELP_LINES,
    shouldShow: ({ cfg, accountId }) => !isMaxConfigured(cfg, accountId),
  },
  credentials: [
    {
      inputKey: "botToken",
      providerHint: channel,
      credentialLabel: "MAX bot token",
      preferredEnvVar: "MAX_BOT_TOKEN",
      helpTitle: "MAX bot token",
      helpLines: MAX_SETUP_HELP_LINES,
      envPrompt: "MAX_BOT_TOKEN or MAX_TOKEN detected. Use env var?",
      keepPrompt: "MAX bot token already configured. Keep it?",
      inputPrompt: "Enter MAX bot token",
      allowEnv: ({ accountId }) => accountId === DEFAULT_ACCOUNT_ID,
      inspect: ({ cfg, accountId }) => {
        const resolved = resolveMaxAccount({ cfg, accountId });
        return {
          accountConfigured: isMaxConfigured(cfg, accountId),
          hasConfiguredValue: Boolean(resolved.config.botToken?.trim() || resolved.config.tokenFile?.trim()),
          resolvedValue: resolved.token?.trim() || undefined,
          envValue: accountId === DEFAULT_ACCOUNT_ID ? resolveMaxEnvToken() : undefined,
        };
      },
      applyUseEnv: ({ cfg, accountId }) =>
        patchMaxAccountConfig({
          cfg,
          accountId,
          enabled: true,
          clearFields: ["botToken", "tokenFile"],
          patch: { useLongPoll: false },
        }),
      applySet: ({ cfg, accountId, resolvedValue }) =>
        patchMaxAccountConfig({
          cfg,
          accountId,
          enabled: true,
          clearFields: ["tokenFile"],
          patch: { botToken: resolvedValue, useLongPoll: false },
        }),
    },
  ],
  textInputs: [
    {
      inputKey: "webhookUrl",
      message: "MAX public webhook URL",
      placeholder: "https://your.host/max/default/webhook",
      required: true,
      currentValue: ({ cfg, accountId }) =>
        resolveMaxAccount({ cfg, accountId }).config.webhookUrl?.trim() || undefined,
      validate: ({ value }) => {
        const trimmed = String(value ?? "").trim();
        if (!trimmed) {
          return "Required";
        }
        return isValidUrl(trimmed) ? undefined : "Enter a valid http(s) URL";
      },
      normalizeValue: ({ value }) => String(value).trim(),
      applySet: async ({ cfg, accountId, value }) =>
        patchMaxAccountConfig({
          cfg,
          accountId,
          enabled: true,
          patch: { webhookUrl: value, useLongPoll: false },
        }),
    },
    {
      inputKey: "password",
      message: "MAX webhook secret (optional)",
      placeholder: "shared-secret",
      applyEmptyValue: true,
      confirmCurrentValue: true,
      currentValue: ({ cfg, accountId }) =>
        resolveMaxAccount({ cfg, accountId }).config.webhookSecret?.trim() || undefined,
      normalizeValue: ({ value }) => String(value ?? "").trim(),
      applySet: async ({ cfg, accountId, value }) =>
        patchMaxAccountConfig({
          cfg,
          accountId,
          enabled: true,
          patch: { webhookSecret: value || undefined },
        }),
    },
    {
      inputKey: "webhookPath",
      message: "Custom webhook path (optional)",
      placeholder: "/max/default/webhook",
      applyEmptyValue: true,
      confirmCurrentValue: true,
      currentValue: ({ cfg, accountId }) =>
        resolveMaxAccount({ cfg, accountId }).config.webhookPath?.trim() || undefined,
      normalizeValue: ({ value }) => String(value ?? "").trim(),
      applySet: async ({ cfg, accountId, value }) =>
        patchMaxAccountConfig({
          cfg,
          accountId,
          enabled: true,
          patch: { webhookPath: value || undefined },
        }),
    },
  ],
  allowFrom: createAllowFromSection({
    helpTitle: "MAX allowlist",
    helpLines: MAX_ALLOW_FROM_HELP_LINES,
    credentialInputKey: "botToken",
    message: "MAX allowFrom (numeric user id)",
    placeholder: "123456789",
    invalidWithoutCredentialNote:
      "MAX allowFrom requires numeric user ids like 123456789.",
    parseInputs: splitSetupEntries,
    parseId: parseMaxAllowFromId,
    apply: ({ cfg, accountId, allowFrom }) =>
      patchMaxAccountConfig({
        cfg,
        accountId,
        enabled: true,
        patch: { dmPolicy: "allowlist", allowFrom },
      }),
  }),
  dmPolicy: maxDmPolicy,
  completionNote: {
    title: "MAX webhook reminder",
    lines: [
      "OpenClaw registers the inbound route locally and subscribes MAX to the webhook URL you saved.",
      "Recommended path: /max/<account-id>/webhook",
      "Keep requestsPerSecond at or below 30 to match MAX API limits.",
      `Docs: ${formatDocsLink("/channels/max", "channels/max")}`,
    ],
  },
  disable: (cfg) => setSetupChannelEnabled(cfg, channel, false),
};
