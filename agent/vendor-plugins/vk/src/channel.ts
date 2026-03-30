import { describeAccountSnapshot } from "openclaw/plugin-sdk/account-helpers";
import {
  createScopedChannelConfigAdapter,
  formatTrimmedAllowFromEntries,
} from "openclaw/plugin-sdk/channel-config-helpers";
import { buildChannelConfigSchema } from "openclaw/plugin-sdk/channel-config-schema";
import { createAccountStatusSink } from "openclaw/plugin-sdk/channel-lifecycle";
import { createChatChannelPlugin } from "openclaw/plugin-sdk/core";
import {
  buildPassiveChannelStatusSummary,
  runStoppablePassiveMonitor,
} from "openclaw/plugin-sdk/extension-shared";
import {
  createComputedAccountStatusAdapter,
  createDefaultChannelRuntimeState,
} from "openclaw/plugin-sdk/status-helpers";
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/account-id";
import type { ChannelPlugin } from "openclaw/plugin-sdk/core";
import {
  listVkAccountIds,
  resolveDefaultVkAccountId,
  resolveVkAccount,
  type ResolvedVkAccount,
} from "./accounts.js";
import { VkConfigSchema } from "./config-schema.js";
import { monitorVkProvider } from "./monitor.js";
import { vkSetupAdapter } from "./setup-core.js";
import { vkSetupWizard } from "./setup-surface.js";

const meta = {
  id: "vk",
  label: "VK",
  selectionLabel: "VK (Community Messages)",
  docsPath: "/channels/vk",
  docsLabel: "vk",
  blurb: "VK Community Messages channel for customer support and lead intake.",
  aliases: ["vkontakte"],
  order: 82,
  quickstartAllowFrom: true,
};

function normalizeVkMessagingTarget(raw: string): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.replace(/^(vk|vkontakte):/i, "").trim();
}

function normalizeVkAllowEntry(raw: string): string | undefined {
  const normalized = normalizeVkMessagingTarget(raw);
  return normalized?.length ? normalized : undefined;
}

const vkConfigAdapter = createScopedChannelConfigAdapter<ResolvedVkAccount>({
  sectionKey: "vk",
  listAccountIds: listVkAccountIds,
  resolveAccount: (cfg, accountId) => resolveVkAccount({ cfg, accountId }),
  defaultAccountId: resolveDefaultVkAccountId,
  clearBaseFields: ["accessToken", "tokenFile", "name"],
  resolveAllowFrom: (account) => account.config.allowFrom,
  formatAllowFrom: (allowFrom) =>
    formatTrimmedAllowFromEntries(allowFrom).map((entry) => normalizeVkAllowEntry(entry) ?? entry),
});

export const vkPlugin: ChannelPlugin<ResolvedVkAccount> = createChatChannelPlugin({
  base: {
    id: "vk",
    meta,
    setup: vkSetupAdapter,
    setupWizard: vkSetupWizard,
    capabilities: {
      chatTypes: ["direct", "group"],
      media: true,
      reactions: false,
      threads: false,
      polls: false,
      nativeCommands: false,
      blockStreaming: true,
    },
    reload: { configPrefixes: ["channels.vk"] },
    configSchema: buildChannelConfigSchema(VkConfigSchema),
    config: {
      ...vkConfigAdapter,
      isConfigured: (account) => Boolean(account.token?.trim() && account.groupId?.trim()),
      describeAccount: (account) =>
        describeAccountSnapshot({
          account,
          configured: Boolean(account.token?.trim() && account.groupId?.trim()),
          extra: {
            tokenSource: account.tokenSource,
            mode: account.config.useLongPoll ? "long-poll (dev)" : "webhook",
            groupId: account.groupId ? "[set]" : "[missing]",
          },
        }),
    },
    groups: {
      resolveRequireMention: () => true,
    },
    messaging: {
      normalizeTarget: normalizeVkMessagingTarget,
      targetResolver: {
        looksLikeId: (value) => /^\d+$/.test(value.trim()),
        hint: "<peerId>",
      },
    },
    status: createComputedAccountStatusAdapter<ResolvedVkAccount>({
      defaultRuntime: createDefaultChannelRuntimeState(DEFAULT_ACCOUNT_ID),
      buildChannelSummary: ({ snapshot }) =>
        buildPassiveChannelStatusSummary(snapshot, {
          tokenSource: snapshot.tokenSource ?? "none",
          mode: snapshot.mode ?? "webhook",
          groupId: snapshot.groupId ?? null,
        }),
      resolveAccountSnapshot: ({ account }) => ({
        accountId: account.accountId,
        name: account.name,
        enabled: account.enabled,
        configured: Boolean(account.token?.trim() && account.groupId?.trim()),
        extra: {
          tokenSource: account.tokenSource,
          mode: account.config.useLongPoll ? "long-poll (dev)" : "webhook",
          groupId: account.groupId ? "[set]" : "[missing]",
        },
      }),
    }),
    agentPrompt: {
      extend: async () =>
        [
          "VK channel notes:",
          "- Treat this transport as customer-facing community messaging.",
          "- Prefer concise replies and explicit lead handoff when commercial intent is clear.",
          "- Do not assume message delivery rights unless the user has already opened the thread or granted community message access.",
        ].join("\n"),
    },
    gateway: {
      startAccount: async (ctx) => {
        const account = ctx.account;
        if (!account.token?.trim()) {
          throw new Error(`VK account "${account.accountId}" is missing an access token`);
        }
        if (!account.groupId?.trim()) {
          throw new Error(`VK account "${account.accountId}" is missing a groupId`);
        }

        ctx.log?.info?.(`[${account.accountId}] starting VK provider`);
        const statusSink = createAccountStatusSink({
          accountId: ctx.accountId,
          setStatus: ctx.setStatus,
        });

        await runStoppablePassiveMonitor({
          abortSignal: ctx.abortSignal,
          start: async () =>
            await monitorVkProvider({
              account,
              config: ctx.cfg,
              runtime: ctx.runtime,
              abortSignal: ctx.abortSignal,
              statusSink,
            }),
        });
      },
    },
  },
});
