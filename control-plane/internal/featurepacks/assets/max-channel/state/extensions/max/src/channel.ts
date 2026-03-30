import { describeAccountSnapshot } from "openclaw/plugin-sdk/account-helpers";
import { createScopedChannelConfigAdapter } from "openclaw/plugin-sdk/channel-config-helpers";
import { buildChannelConfigSchema } from "openclaw/plugin-sdk/channel-config-schema";
import { createAccountStatusSink } from "openclaw/plugin-sdk/channel-lifecycle";
import { createChatChannelPlugin } from "openclaw/plugin-sdk/core";
import {
  buildPassiveChannelStatusSummary,
  runStoppablePassiveMonitor,
} from "openclaw/plugin-sdk/extension-shared";
import { resolveOutboundSendDep } from "openclaw/plugin-sdk/outbound-runtime";
import {
  createComputedAccountStatusAdapter,
  createDefaultChannelRuntimeState,
} from "openclaw/plugin-sdk/status-helpers";
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/account-id";
import type { ChannelPlugin } from "openclaw/plugin-sdk/core";
import {
  listMaxAccountIds,
  resolveDefaultMaxAccountId,
  resolveMaxAccount,
  type ResolvedMaxAccount,
} from "./accounts.js";
import { MaxConfigSchema } from "./config-schema.js";
import { monitorMaxProvider } from "./monitor.js";
import { maxOutbound, sendMaxOutbound, type MaxSendDep } from "./outbound-adapter.js";
import { maxSetupAdapter } from "./setup-core.js";
import { maxSetupWizard } from "./setup-surface.js";

const meta = {
  id: "max",
  label: "MAX",
  selectionLabel: "MAX",
  docsPath: "/channels/max",
  docsLabel: "max",
  blurb: "MAX messenger bot channel with webhook-first production delivery.",
  aliases: ["mailru-max"],
  order: 83,
  quickstartAllowFrom: true,
};

function normalizeMaxMessagingTarget(raw: string): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.replace(/^max:/i, "").trim();
}

const maxConfigAdapter = createScopedChannelConfigAdapter<ResolvedMaxAccount>({
  sectionKey: "max",
  listAccountIds: listMaxAccountIds,
  resolveAccount: (cfg, accountId) => resolveMaxAccount({ cfg, accountId }),
  defaultAccountId: resolveDefaultMaxAccountId,
  clearBaseFields: ["botToken", "tokenFile", "name"],
  resolveAllowFrom: (account) => account.config.allowFrom,
});

export const maxPlugin: ChannelPlugin<ResolvedMaxAccount> = createChatChannelPlugin({
  base: {
    id: "max",
    meta,
    setup: maxSetupAdapter,
    setupWizard: maxSetupWizard,
    capabilities: {
      chatTypes: ["direct", "group"],
      media: false,
      reactions: false,
      threads: false,
      polls: false,
      nativeCommands: false,
      blockStreaming: true,
    },
    reload: { configPrefixes: ["channels.max"] },
    configSchema: buildChannelConfigSchema(MaxConfigSchema),
    config: {
      ...maxConfigAdapter,
      isConfigured: (account) => Boolean(account.token?.trim()),
      describeAccount: (account) =>
        describeAccountSnapshot({
          account,
          configured: Boolean(account.token?.trim()),
          extra: {
            tokenSource: account.tokenSource,
            mode: account.config.useLongPoll ? "long-poll (dev)" : "webhook",
            format: account.config.format ?? "markdown",
          },
        }),
    },
    groups: {
      resolveRequireMention: () => true,
    },
    messaging: {
      normalizeTarget: normalizeMaxMessagingTarget,
      targetResolver: {
        looksLikeId: (value) => /^[a-zA-Z0-9:_-]+$/.test(value.trim()),
        hint: "<chatId>",
      },
    },
    status: createComputedAccountStatusAdapter<ResolvedMaxAccount>({
      defaultRuntime: createDefaultChannelRuntimeState(DEFAULT_ACCOUNT_ID),
      buildChannelSummary: ({ snapshot }) =>
        buildPassiveChannelStatusSummary(snapshot, {
          tokenSource: snapshot.tokenSource ?? "none",
          mode: snapshot.mode ?? "webhook",
          format: snapshot.format ?? "markdown",
        }),
      resolveAccountSnapshot: ({ account }) => ({
        accountId: account.accountId,
        name: account.name,
        enabled: account.enabled,
        configured: Boolean(account.token?.trim()),
        extra: {
          tokenSource: account.tokenSource,
          mode: account.config.useLongPoll ? "long-poll (dev)" : "webhook",
          format: account.config.format ?? "markdown",
        },
      }),
    }),
    agentPrompt: {
      extend: async () =>
        [
          "MAX channel notes:",
          "- Treat this transport as customer-facing conversational messaging.",
          "- Prefer concise replies, strong lead qualification, and explicit handoff when commercial intent is clear.",
          "- Production should use webhooks; long polling is only a development fallback.",
          "- MAX supports inline callback buttons; use shared interactive reply blocks when a short choice list improves UX.",
        ].join("\n"),
    },
    gateway: {
      startAccount: async (ctx) => {
        const account = ctx.account;
        if (!account.token?.trim()) {
          throw new Error(`MAX account "${account.accountId}" is missing a bot token`);
        }
        if (!account.config.webhookUrl?.trim() && !account.config.useLongPoll) {
          throw new Error(
            `MAX account "${account.accountId}" requires channels.max.webhookUrl for production webhook delivery`,
          );
        }
        if (account.config.useLongPoll) {
          throw new Error(
            `MAX long polling is not implemented in this extension yet; use webhookUrl for production-first setup`,
          );
        }

        ctx.log?.info?.(`[${account.accountId}] starting MAX provider`);
        const statusSink = createAccountStatusSink({
          accountId: ctx.accountId,
          setStatus: ctx.setStatus,
        });

        await runStoppablePassiveMonitor({
          abortSignal: ctx.abortSignal,
          start: async () =>
            await monitorMaxProvider({
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
  outbound: {
    base: {
      deliveryMode: "direct",
      chunker: null,
      textChunkLimit: 4000,
      sendPayload: async (ctx) => {
        const account = resolveMaxAccount({
          cfg: ctx.cfg,
          accountId: ctx.accountId ?? resolveDefaultMaxAccountId(ctx.cfg),
        });
        const send =
          resolveOutboundSendDep<MaxSendDep>(ctx.deps, "max") ??
          (async (to, text, opts) =>
            await sendMaxOutbound({
              account,
              to,
              text,
              replyToId: opts?.replyToId,
              mediaUrl: opts?.mediaUrl,
              mediaUrls: opts?.mediaUrls,
              interactive: opts?.interactive ?? ctx.payload.interactive,
              channelDataMax: opts?.channelDataMax ?? ctx.payload.channelData?.max,
              identity: opts?.identity ?? ctx.identity,
            }));
        return await maxOutbound.sendPayload!({
          ...ctx,
          deps: {
            ...(ctx.deps ?? {}),
            max: send,
          },
        });
      },
    },
    attachedResults: {
      channel: "max",
      sendText: async ({ to, text, deps, replyToId, identity, accountId, cfg }) => {
        const account = resolveMaxAccount({
          cfg,
          accountId: accountId ?? resolveDefaultMaxAccountId(cfg),
        });
        const send =
          resolveOutboundSendDep<MaxSendDep>(deps, "max") ??
          (async (toArg, textArg, opts) =>
            await sendMaxOutbound({
              account,
              to: toArg,
              text: textArg,
              replyToId: opts?.replyToId,
              mediaUrl: opts?.mediaUrl,
              mediaUrls: opts?.mediaUrls,
              interactive: opts?.interactive,
              channelDataMax: opts?.channelDataMax,
              identity: opts?.identity,
            }));
        return await send(to, text, { replyToId, identity });
      },
      sendMedia: async ({ to, text, mediaUrl, deps, replyToId, identity, accountId, cfg }) => {
        const account = resolveMaxAccount({
          cfg,
          accountId: accountId ?? resolveDefaultMaxAccountId(cfg),
        });
        const send =
          resolveOutboundSendDep<MaxSendDep>(deps, "max") ??
          (async (toArg, textArg, opts) =>
            await sendMaxOutbound({
              account,
              to: toArg,
              text: textArg,
              replyToId: opts?.replyToId,
              mediaUrl: opts?.mediaUrl,
              mediaUrls: opts?.mediaUrls,
              interactive: opts?.interactive,
              channelDataMax: opts?.channelDataMax,
              identity: opts?.identity,
            }));
        return await send(to, text, { mediaUrl, replyToId, identity });
      },
    },
  },
});
