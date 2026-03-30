import { createChannelPairingController } from "openclaw/plugin-sdk/channel-pairing";
import { logInboundDrop } from "openclaw/plugin-sdk/channel-inbound";
import { resolveDefaultGroupPolicy, type OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import { dispatchInboundReplyWithBase } from "openclaw/plugin-sdk/inbound-reply-dispatch";
import { deliverFormattedTextWithAttachments, type OutboundReplyPayload } from "openclaw/plugin-sdk/reply-payload";
import { finalizeInboundContext } from "openclaw/plugin-sdk/reply-runtime";
import { resolveAgentRoute } from "openclaw/plugin-sdk/routing";
import { danger, type RuntimeEnv } from "openclaw/plugin-sdk/runtime";
import { readStoreAllowFromForDmPolicy, resolveDmGroupAccessWithCommandGate } from "../../../src/security/dm-policy-shared.js";
import type { ResolvedMaxAccount } from "./accounts.js";
import { answerOnMaxCallback, sendMaxTyping } from "./api.js";
import { getMaxRuntime } from "./runtime.js";
import { sendMaxText } from "./send.js";
import type { MaxInboundMessage } from "./normalize.js";

const CHANNEL_ID = "max" as const;

function normalizeMaxAllowEntry(value: string | number): string | undefined {
  const trimmed = String(value).trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed === "*") {
    return trimmed;
  }
  const withoutPrefix = trimmed.replace(/^max:/i, "").trim();
  const match = withoutPrefix.match(/-?\d+/);
  return match?.[0];
}

function normalizeMaxAllowList(values: Array<string | number> | undefined | null): string[] {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => normalizeMaxAllowEntry(value))
        .filter((value): value is string => Boolean(value)),
    ),
  );
}

function isMaxSenderAllowed(allowFrom: string[], senderId: string): boolean {
  return allowFrom.includes("*") || allowFrom.includes(senderId);
}

async function deliverMaxReply(params: {
  payload: OutboundReplyPayload;
  target: string;
  account: ResolvedMaxAccount;
  statusSink?: (patch: { lastOutboundAt?: number }) => void;
}): Promise<void> {
  await deliverFormattedTextWithAttachments({
    payload: params.payload,
    send: async ({ text, replyToId }) => {
      await sendMaxText({
        account: params.account,
        to: params.target,
        text,
        replyToId,
      });
      params.statusSink?.({ lastOutboundAt: Date.now() });
    },
  });
}

export async function handleMaxInbound(params: {
  message: MaxInboundMessage;
  account: ResolvedMaxAccount;
  config: OpenClawConfig;
  runtime: RuntimeEnv;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
}): Promise<void> {
  const { message, account, config, runtime, statusSink } = params;
  const core = getMaxRuntime();
  const rawBody = message.text.trim();
  if (!rawBody) {
    return;
  }

  statusSink?.({ lastInboundAt: message.timestamp });
  if (typeof message.chatId === "number") {
    void sendMaxTyping({ account, chatId: message.chatId }).catch(() => {});
  }
  if (message.callbackId) {
    void answerOnMaxCallback({
      account,
      callbackId: message.callbackId,
    }).catch((error) => {
      runtime.error?.(danger(`max callback ack failed for ${message.callbackId}: ${String(error)}`));
    });
  }

  const isGroup = message.isGroupChat;
  const senderId = message.senderId;
  const target = message.target;
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
  const allowFrom = normalizeMaxAllowList(account.config.allowFrom);
  const groupAllowFrom = normalizeMaxAllowList(account.config.groupAllowFrom);
  const storeAllowList = normalizeMaxAllowList(storeAllowFrom);
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
    isSenderAllowed: (entries) => isMaxSenderAllowed(entries, senderId),
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
        senderIdLine: `Your MAX user id: ${senderId}`,
        meta: { name: message.senderName },
        sendPairingReply: async (text) => {
          await sendMaxText({
            account,
            to: target,
            text,
          });
          statusSink?.({ lastOutboundAt: Date.now() });
        },
        onReplyError: (error) => {
          runtime.error?.(danger(`max pairing reply failed for ${senderId}: ${String(error)}`));
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
      target,
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

  if (isGroup && !message.wasMentioned && !hasControlCommand && !message.isInteractiveCallback) {
    runtime.log?.(`max: drop target ${target} (no mention)`);
    return;
  }

  const route = resolveAgentRoute({
    cfg: config,
    channel: CHANNEL_ID,
    accountId: account.accountId,
    peer: {
      kind: isGroup ? "group" : "direct",
      id: target,
    },
  });

  const storePath = core.channel.session.resolveStorePath(
    (config.session as Record<string, unknown> | undefined)?.store as string | undefined,
    { agentId: route.agentId },
  );
  const previousTimestamp = core.channel.session.readSessionUpdatedAt({
    storePath,
    sessionKey: route.sessionKey,
  });
  const body = core.channel.reply.formatAgentEnvelope({
    channel: "MAX",
    from: isGroup ? `chat:${message.chatId ?? target}` : message.senderName || `user:${senderId}`,
    timestamp: message.timestamp,
    previousTimestamp,
    envelope: core.channel.reply.resolveEnvelopeFormatOptions(config),
    body: rawBody,
  });
  const ctxPayload = finalizeInboundContext({
    Body: body,
    BodyForAgent: rawBody,
    RawBody: message.rawText,
    CommandBody: rawBody,
    From: target,
    To: target,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: isGroup ? "group" : "direct",
    ConversationLabel: isGroup ? `MAX chat ${message.chatId ?? target}` : message.senderName || `MAX user ${senderId}`,
    SenderName: message.senderName,
    SenderId: senderId,
    GroupSubject: isGroup ? `MAX chat ${message.chatId ?? target}` : undefined,
    Provider: CHANNEL_ID,
    Surface: CHANNEL_ID,
    WasMentioned: isGroup ? message.wasMentioned : undefined,
    MessageSid: message.messageId,
    Timestamp: message.timestamp,
    OriginatingChannel: CHANNEL_ID,
    OriginatingTo: target,
    CommandAuthorized: commandAuthorized,
  });

  await dispatchInboundReplyWithBase({
    cfg: config,
    channel: CHANNEL_ID,
    accountId: account.accountId,
    route,
    storePath,
    ctxPayload,
    core,
    deliver: async (payload) => {
      await deliverMaxReply({
        payload,
        target,
        account,
        statusSink,
      });
    },
    onRecordError: (error) => {
      runtime.error?.(danger(`max: failed updating session meta: ${String(error)}`));
    },
    onDispatchError: (error, info) => {
      runtime.error?.(danger(`max ${info.kind} reply failed: ${String(error)}`));
    },
  });
}
