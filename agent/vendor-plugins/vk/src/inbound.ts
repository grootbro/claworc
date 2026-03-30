import { createChannelPairingController } from "openclaw/plugin-sdk/channel-pairing";
import { buildMentionRegexes, logInboundDrop, matchesMentionPatterns } from "openclaw/plugin-sdk/channel-inbound";
import { resolveDefaultGroupPolicy, type OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import { deliverFormattedTextWithAttachments, type OutboundReplyPayload } from "openclaw/plugin-sdk/reply-payload";
import { finalizeInboundContext } from "openclaw/plugin-sdk/reply-runtime";
import { resolveAgentRoute } from "openclaw/plugin-sdk/routing";
import { danger, type RuntimeEnv } from "openclaw/plugin-sdk/runtime";
import {
  readStoreAllowFromForDmPolicy,
  resolveDmGroupAccessWithCommandGate,
} from "openclaw/plugin-sdk/security-runtime";
import type { ResolvedVkAccount } from "./accounts.js";
import { markVkConversationRead } from "./api.js";
import { getVkRuntime } from "./runtime.js";
import { dispatchVkInboundReply } from "./reply-dispatch.js";
import { sendVkText } from "./send.js";
import type { VkInboundMessage } from "./normalize.js";

const CHANNEL_ID = "vk" as const;

function normalizeVkAllowEntry(value: string | number): string | undefined {
  const trimmed = String(value).trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed === "*") {
    return trimmed;
  }
  const withoutPrefix = trimmed.replace(/^(vk|vkontakte):/i, "").trim();
  const match = withoutPrefix.match(/-?\d+/);
  return match?.[0];
}

function normalizeVkAllowList(values: Array<string | number> | undefined | null): string[] {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => normalizeVkAllowEntry(value))
        .filter((value): value is string => Boolean(value)),
    ),
  );
}

function isVkSenderAllowed(allowFrom: string[], senderId: string): boolean {
  return allowFrom.includes("*") || allowFrom.includes(senderId);
}

async function deliverVkReply(params: {
  payload: OutboundReplyPayload;
  peerId: string;
  account: ResolvedVkAccount;
  statusSink?: (patch: { lastOutboundAt?: number }) => void;
}): Promise<void> {
  await deliverFormattedTextWithAttachments({
    payload: params.payload,
    send: async ({ text, replyToId }) => {
      await sendVkText({
        account: params.account,
        to: params.peerId,
        text,
        replyToId,
      });
      params.statusSink?.({ lastOutboundAt: Date.now() });
    },
  });
}

export async function handleVkInbound(params: {
  message: VkInboundMessage;
  account: ResolvedVkAccount;
  config: OpenClawConfig;
  runtime: RuntimeEnv;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
}): Promise<void> {
  const { message, account, config, runtime, statusSink } = params;
  const core = getVkRuntime();
  const rawBody = message.text.trim();
  if (!rawBody) {
    return;
  }

  statusSink?.({ lastInboundAt: message.timestamp });

  const isGroup = message.isGroupChat;
  const senderId = message.senderId;
  const peerId = message.peerId;
  const pairing = createChannelPairingController({
    core,
    channel: CHANNEL_ID,
    accountId: account.accountId,
  });

  const dmPolicy = account.config.dmPolicy ?? "pairing";
  const groupPolicy = account.config.groupPolicy ?? resolveDefaultGroupPolicy(config);
  const storeAllowFrom = await readStoreAllowFromForDmPolicy({
    provider: CHANNEL_ID,
    accountId: account.accountId,
    dmPolicy,
    readStore: pairing.readStoreForDmPolicy,
  });
  const allowFrom = normalizeVkAllowList(account.config.allowFrom);
  const groupAllowFrom = normalizeVkAllowList(account.config.groupAllowFrom);
  const storeAllowList = normalizeVkAllowList(storeAllowFrom);
  const allowTextCommands = core.channel.commands.shouldHandleTextCommands({
    cfg: config,
    surface: CHANNEL_ID,
  });
  const hasControlCommand = core.channel.text.hasControlCommand(rawBody, config);
  const access = resolveDmGroupAccessWithCommandGate({
    isGroup,
    dmPolicy,
    groupPolicy,
    allowFrom,
    groupAllowFrom,
    storeAllowFrom: storeAllowList,
    isSenderAllowed: (entries) => isVkSenderAllowed(entries, senderId),
    command: {
      useAccessGroups:
        (config.commands as Record<string, unknown> | undefined)?.useAccessGroups !== false,
      allowTextCommands,
      hasControlCommand,
    },
  });
  const commandAuthorized = access.commandAuthorized;

  if (!isGroup && access.decision !== "allow") {
    if (access.decision === "pairing") {
      await pairing.issueChallenge({
        senderId,
        senderIdLine: `Your VK user id: ${senderId}`,
        sendPairingReply: async (text) => {
          await sendVkText({
            account,
            to: peerId,
            text,
          });
          statusSink?.({ lastOutboundAt: Date.now() });
        },
        onReplyError: (error) => {
          runtime.error?.(danger(`vk pairing reply failed for ${senderId}: ${String(error)}`));
        },
      });
    }
    logInboundDrop({
      log: (entry) => runtime.log?.(entry),
      channel: CHANNEL_ID,
      reason: access.reason,
      target: senderId,
    });
    return;
  }

  if (isGroup && access.decision !== "allow") {
    logInboundDrop({
      log: (entry) => runtime.log?.(entry),
      channel: CHANNEL_ID,
      reason: access.reason,
      target: peerId,
    });
    return;
  }

  if (access.shouldBlockControlCommand) {
    logInboundDrop({
      log: (entry) => runtime.log?.(entry),
      channel: CHANNEL_ID,
      reason: "control command (unauthorized)",
      target: senderId,
    });
    return;
  }

  const mentionRegexes = buildMentionRegexes(config);
  const wasMentioned = mentionRegexes.length > 0 ? matchesMentionPatterns(rawBody, mentionRegexes) : false;
  if (isGroup && !wasMentioned && !hasControlCommand) {
    runtime.log?.(`vk: drop peer ${peerId} (no mention)`);
    return;
  }

  const route = resolveAgentRoute({
    cfg: config,
    channel: CHANNEL_ID,
    accountId: account.accountId,
    peer: {
      kind: isGroup ? "group" : "direct",
      id: isGroup ? peerId : senderId,
    },
  });
  runtime.log?.(
    `vk inbound accepted: peer=${peerId} sender=${senderId} sessionKey=${route.sessionKey} group=${isGroup ? "yes" : "no"}`,
  );

  const storePath = core.channel.session.resolveStorePath(
    (config.session as Record<string, unknown> | undefined)?.store as string | undefined,
    { agentId: route.agentId },
  );
  const previousTimestamp = core.channel.session.readSessionUpdatedAt({
    storePath,
    sessionKey: route.sessionKey,
  });
  const body = core.channel.reply.formatAgentEnvelope({
    channel: "VK",
    from: isGroup ? `peer:${peerId}` : `user:${senderId}`,
    timestamp: message.timestamp,
    previousTimestamp,
    envelope: core.channel.reply.resolveEnvelopeFormatOptions(config),
    body: rawBody,
  });
  const ctxPayload = finalizeInboundContext({
    Body: body,
    BodyForAgent: rawBody,
    RawBody: rawBody,
    CommandBody: rawBody,
    From: isGroup ? `vk:chat:${peerId}` : `vk:${senderId}`,
    To: `vk:${peerId}`,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: isGroup ? "group" : "direct",
    ConversationLabel: isGroup ? `VK chat ${peerId}` : `VK user ${senderId}`,
    SenderId: senderId,
    GroupSubject: isGroup ? `VK chat ${peerId}` : undefined,
    Provider: CHANNEL_ID,
    Surface: CHANNEL_ID,
    WasMentioned: isGroup ? wasMentioned : undefined,
    MessageSid: message.messageId,
    Timestamp: message.timestamp,
    OriginatingChannel: CHANNEL_ID,
    OriginatingTo: `vk:${peerId}`,
    CommandAuthorized: commandAuthorized,
  });

  await dispatchVkInboundReply({
    cfg: config,
    channel: CHANNEL_ID,
    accountId: account.accountId,
    route,
    storePath,
    ctxPayload,
    core,
    deliver: async (payload) => {
      runtime.log?.(`vk deliver: peer=${peerId} sessionKey=${route.sessionKey}`);
      await deliverVkReply({
        payload,
        peerId,
        account,
        statusSink,
      });
    },
    updateLastRoute: {
      sessionKey: route.sessionKey,
      channel: CHANNEL_ID,
      to: `vk:${peerId}`,
      accountId: account.accountId,
    },
    onRecordError: (error) => {
      runtime.error?.(danger(`vk: failed updating session meta: ${String(error)}`));
    },
    onDispatchError: (error, info) => {
      runtime.error?.(danger(`vk ${info.kind} reply failed: ${String(error)}`));
    },
    onDispatchComplete: (result) => {
      runtime.log?.(`vk dispatch complete: peer=${peerId} sessionKey=${route.sessionKey} result=${JSON.stringify(result)}`);
    },
  });

  if (account.config.markAsRead) {
    try {
      await markVkConversationRead({
        account,
        peerId: Number.parseInt(peerId, 10),
      });
    } catch (error) {
      runtime.error?.(danger(`vk markAsRead failed for peer ${peerId}: ${String(error)}`));
    }
  }
}
