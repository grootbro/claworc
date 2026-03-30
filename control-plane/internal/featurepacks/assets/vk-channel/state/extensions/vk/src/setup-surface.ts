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
  isVkConfigured,
  listVkAccountIds,
  parseVkAllowFromId,
  patchVkAccountConfig,
  resolveVkEnvGroupId,
  resolveVkEnvToken,
  vkSetupAdapter,
} from "./setup-core.js";
import { resolveVkAccount } from "./accounts.js";

const channel = "vk" as const;

const VK_SETUP_HELP_LINES = [
  "1) Create or choose a VK community with Community Messages enabled",
  "2) Copy the community access token",
  "3) Note the numeric community/group id",
  "4) Configure Callback API with your OpenClaw webhook URL",
  "5) Optional: set a secret key and confirmation code for safer delivery",
  `Docs: ${formatDocsLink("/channels/vk", "channels/vk")}`,
];

const VK_ALLOW_FROM_HELP_LINES = [
  "Allowlist VK DMs by numeric VK user id.",
  "Examples:",
  "- 123456789",
  "- vk:123456789",
  "Multiple entries: comma-separated.",
  `Docs: ${formatDocsLink("/channels/vk", "channels/vk")}`,
];

const vkDmPolicy: ChannelSetupDmPolicy = createTopLevelChannelDmPolicy({
  label: "VK",
  channel,
  policyKey: "channels.vk.dmPolicy",
  allowFromKey: "channels.vk.allowFrom",
  getCurrent: (cfg) => cfg.channels?.vk?.dmPolicy ?? "pairing",
});

export { vkSetupAdapter } from "./setup-core.js";

function isValidUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export const vkSetupWizard: ChannelSetupWizard = {
  channel,
  status: createStandardChannelSetupStatus({
    channelLabel: "VK",
    configuredLabel: "configured",
    unconfiguredLabel: "needs token + group id",
    configuredHint: "configured",
    unconfiguredHint: "needs token + community id",
    configuredScore: 2,
    unconfiguredScore: 0,
    includeStatusLine: true,
    resolveConfigured: ({ cfg }) =>
      listVkAccountIds(cfg).some((accountId) => isVkConfigured(cfg, accountId)),
  }),
  introNote: {
    title: "VK Community Messages",
    lines: VK_SETUP_HELP_LINES,
    shouldShow: ({ cfg, accountId }) => !isVkConfigured(cfg, accountId),
  },
  prepare: async ({ cfg, accountId, credentialValues }) => {
    const envToken = accountId === DEFAULT_ACCOUNT_ID ? resolveVkEnvToken() : undefined;
    const envGroupId = accountId === DEFAULT_ACCOUNT_ID ? resolveVkEnvGroupId() : undefined;
    if (!envGroupId) {
      return;
    }
    return {
      credentialValues: {
        ...credentialValues,
        audience: envGroupId,
      },
    };
  },
  credentials: [
    {
      inputKey: "accessToken",
      providerHint: channel,
      credentialLabel: "VK community token",
      preferredEnvVar: "VK_COMMUNITY_TOKEN",
      helpTitle: "VK community token",
      helpLines: VK_SETUP_HELP_LINES,
      envPrompt: "VK_COMMUNITY_TOKEN or VK_BOT_TOKEN detected. Use env var?",
      keepPrompt: "VK access token already configured. Keep it?",
      inputPrompt: "Enter VK community access token",
      allowEnv: ({ accountId }) => accountId === DEFAULT_ACCOUNT_ID,
      inspect: ({ cfg, accountId }) => {
        const resolved = resolveVkAccount({ cfg, accountId });
        return {
          accountConfigured: isVkConfigured(cfg, accountId),
          hasConfiguredValue: Boolean(
            resolved.config.accessToken?.trim() || resolved.config.tokenFile?.trim(),
          ),
          resolvedValue: resolved.token?.trim() || undefined,
          envValue: accountId === DEFAULT_ACCOUNT_ID ? resolveVkEnvToken() : undefined,
        };
      },
      applyUseEnv: ({ cfg, accountId }) =>
        patchVkAccountConfig({
          cfg,
          accountId,
          enabled: true,
          clearFields: ["accessToken", "tokenFile"],
          patch: { useLongPoll: false },
        }),
      applySet: ({ cfg, accountId, resolvedValue }) =>
        patchVkAccountConfig({
          cfg,
          accountId,
          enabled: true,
          clearFields: ["tokenFile"],
          patch: { accessToken: resolvedValue, useLongPoll: false },
        }),
    },
  ],
  textInputs: [
    {
      inputKey: "audience",
      message: "VK community / group id",
      placeholder: "123456789",
      required: true,
      currentValue: ({ cfg, accountId, credentialValues }) =>
        resolveVkAccount({ cfg, accountId }).groupId?.trim() || credentialValues.audience,
      validate: ({ value }) =>
        /^\d+$/.test(String(value ?? "").trim()) ? undefined : "Enter a numeric community id",
      normalizeValue: ({ value }) => String(value).trim(),
      applySet: async ({ cfg, accountId, value }) =>
        patchVkAccountConfig({
          cfg,
          accountId,
          enabled: true,
          patch: { groupId: value, useLongPoll: false },
        }),
    },
    {
      inputKey: "webhookUrl",
      message: "VK callback URL (optional, for your records)",
      placeholder: "https://your.host/vk/default/webhook",
      applyEmptyValue: true,
      confirmCurrentValue: true,
      currentValue: ({ cfg, accountId }) =>
        resolveVkAccount({ cfg, accountId }).config.webhookUrl?.trim() || undefined,
      validate: ({ value }) => {
        const trimmed = String(value ?? "").trim();
        if (!trimmed) {
          return undefined;
        }
        return isValidUrl(trimmed) ? undefined : "Enter a valid http(s) URL";
      },
      normalizeValue: ({ value }) => String(value ?? "").trim(),
      applySet: async ({ cfg, accountId, value }) =>
        patchVkAccountConfig({
          cfg,
          accountId,
          enabled: true,
          patch: { webhookUrl: value || undefined },
        }),
    },
    {
      inputKey: "password",
      message: "VK callback secret key (optional)",
      placeholder: "shared-secret",
      applyEmptyValue: true,
      confirmCurrentValue: true,
      currentValue: ({ cfg, accountId }) =>
        resolveVkAccount({ cfg, accountId }).config.callbackSecret?.trim() ||
        resolveVkAccount({ cfg, accountId }).config.webhookSecret?.trim() ||
        undefined,
      normalizeValue: ({ value }) => String(value ?? "").trim(),
      applySet: async ({ cfg, accountId, value }) =>
        patchVkAccountConfig({
          cfg,
          accountId,
          enabled: true,
          patch: {
            callbackSecret: value || undefined,
            webhookSecret: value || undefined,
          },
        }),
    },
    {
      inputKey: "code",
      message: "VK confirmation token (optional, recommended)",
      placeholder: "confirmation-code",
      applyEmptyValue: true,
      confirmCurrentValue: true,
      currentValue: ({ cfg, accountId }) =>
        resolveVkAccount({ cfg, accountId }).config.confirmationToken?.trim() || undefined,
      normalizeValue: ({ value }) => String(value ?? "").trim(),
      applySet: async ({ cfg, accountId, value }) =>
        patchVkAccountConfig({
          cfg,
          accountId,
          enabled: true,
          patch: { confirmationToken: value || undefined },
        }),
    },
    {
      inputKey: "webhookPath",
      message: "Custom webhook path (optional)",
      placeholder: "/vk/default/webhook",
      applyEmptyValue: true,
      confirmCurrentValue: true,
      currentValue: ({ cfg, accountId }) =>
        resolveVkAccount({ cfg, accountId }).config.webhookPath?.trim() || undefined,
      normalizeValue: ({ value }) => String(value ?? "").trim(),
      applySet: async ({ cfg, accountId, value }) =>
        patchVkAccountConfig({
          cfg,
          accountId,
          enabled: true,
          patch: { webhookPath: value || undefined },
        }),
    },
  ],
  allowFrom: createAllowFromSection({
    helpTitle: "VK allowlist",
    helpLines: VK_ALLOW_FROM_HELP_LINES,
    credentialInputKey: "accessToken",
    message: "VK allowFrom (numeric user id)",
    placeholder: "123456789",
    invalidWithoutCredentialNote: "VK allowFrom requires numeric user ids like 123456789.",
    parseInputs: splitSetupEntries,
    parseId: parseVkAllowFromId,
    apply: ({ cfg, accountId, allowFrom }) =>
      patchVkAccountConfig({
        cfg,
        accountId,
        enabled: true,
        patch: { dmPolicy: "allowlist", allowFrom },
      }),
  }),
  dmPolicy: vkDmPolicy,
  completionNote: {
    title: "VK Callback API reminder",
    lines: [
      "Set the VK Callback API URL to your OpenClaw VK webhook path.",
      "Recommended path: /vk/<account-id>/webhook",
      "If VK asks for confirmation, it will POST a confirmation event and OpenClaw will answer with your confirmation token.",
      `Docs: ${formatDocsLink("/channels/vk", "channels/vk")}`,
    ],
  },
  disable: (cfg) => setSetupChannelEnabled(cfg, channel, false),
};
