import {
  attachChannelToResult,
  type ChannelOutboundAdapter,
  createAttachedChannelResultAdapter,
} from "openclaw/plugin-sdk/channel-send-result";
import {
  normalizeInteractiveReply,
  resolveInteractiveTextFallback,
} from "openclaw/plugin-sdk/interactive-runtime";
import {
  resolveOutboundSendDep,
  type OutboundIdentity,
} from "openclaw/plugin-sdk/outbound-runtime";
import { resolvePayloadMediaUrls, sendTextMediaPayload } from "openclaw/plugin-sdk/reply-payload";
import type { ResolvedMaxAccount } from "./accounts.js";
import { sendMaxMessage, sendMaxUserMessage } from "./api.js";
import { resolveMaxPayloadAttachments } from "./channel-data.js";

type MaxSendResult = { messageId: string; chatId: string };
type MaxSendOpts = {
  replyToId?: string | null;
  mediaUrl?: string | null;
  mediaUrls?: string[] | null;
  interactive?: unknown;
  channelDataMax?: unknown;
  identity?: OutboundIdentity;
};
export type MaxSendDep = (to: string, text: string, opts?: MaxSendOpts) => Promise<MaxSendResult>;

type DirectMaxSendParams = {
  account: ResolvedMaxAccount;
  to: string;
  text: string;
  replyToId?: string | null;
  mediaUrl?: string | null;
  mediaUrls?: string[] | null;
  interactive?: unknown;
  channelDataMax?: unknown;
  identity?: OutboundIdentity;
};

function resolveMaxText(params: {
  text: string;
  mediaUrl?: string | null;
  mediaUrls?: string[] | null;
  identity?: OutboundIdentity;
}): string {
  const parts: string[] = [];
  const identityName = params.identity?.name?.trim();
  if (identityName) {
    parts.push(`${identityName}`);
  }
  const text = params.text.trim();
  if (text) {
    parts.push(text);
  }
  const mediaUrl = params.mediaUrl?.trim();
  if (mediaUrl) {
    parts.push(mediaUrl);
  }
  for (const extraUrl of params.mediaUrls ?? []) {
    const trimmed = extraUrl?.trim();
    if (trimmed && trimmed !== mediaUrl) {
      parts.push(trimmed);
    }
  }
  return parts.join(identityName && (text || mediaUrl) ? "\n\n" : "\n\n").trim();
}

export async function sendMaxOutbound(params: DirectMaxSendParams): Promise<MaxSendResult> {
  const normalizedTarget = params.to.trim().replace(/^max:/i, "").trim();
  const bodyText = resolveMaxText({
    text: params.text,
    mediaUrl: params.mediaUrl,
    mediaUrls: params.mediaUrls,
    identity: params.identity,
  });
  const attachments = resolveMaxPayloadAttachments({
    channelDataMax: params.channelDataMax,
    interactive: normalizeInteractiveReply(params.interactive),
  });
  const finalText = bodyText || (attachments?.length ? " " : "");

  if (/^user:\d+$/i.test(normalizedTarget)) {
    const userId = Number.parseInt(normalizedTarget.split(":", 2)[1] ?? "", 10);
    const result = await sendMaxUserMessage({
      account: params.account,
      userId,
      text: finalText,
      replyToMessageId: params.replyToId ?? undefined,
      attachments,
    });
    return { messageId: result.body.mid, chatId: `user:${userId}` };
  }

  if (/^(chat:)?\d+$/i.test(normalizedTarget)) {
    const chatId = Number.parseInt(normalizedTarget.replace(/^chat:/i, ""), 10);
    const result = await sendMaxMessage({
      account: params.account,
      chatId,
      text: finalText,
      replyToMessageId: params.replyToId ?? undefined,
      attachments,
    });
    return { messageId: result.body.mid, chatId: `chat:${chatId}` };
  }

  throw new Error(
    `MAX target must be a numeric chat id or user:<id>, received "${params.to}"`,
  );
}

function resolveMaxSendDep(deps?: { [channelId: string]: unknown } | null): MaxSendDep {
  const send = resolveOutboundSendDep<MaxSendDep>(deps, "max");
  if (!send) {
    throw new Error("MAX outbound send dependency is required for payload delivery");
  }
  return send;
}

export const maxOutbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  chunker: null,
  textChunkLimit: 4000,
  sendPayload: async (ctx) => {
    const payload = {
      ...ctx.payload,
      text:
        resolveInteractiveTextFallback({
          text: ctx.payload.text,
          interactive: normalizeInteractiveReply(ctx.payload.interactive),
        }) ?? "",
    };
    const channelDataMax =
      payload.channelData && typeof payload.channelData === "object" && !Array.isArray(payload.channelData)
        ? (payload.channelData.max as unknown)
        : undefined;
    const hasNativeMaxPayload = Boolean(channelDataMax || payload.interactive);
    if (hasNativeMaxPayload) {
      const mediaUrls = resolvePayloadMediaUrls(payload);
      return attachChannelToResult(
        "max",
        await resolveMaxSendDep(ctx.deps)(ctx.to, payload.text ?? "", {
          replyToId: ctx.replyToId,
          mediaUrl: payload.mediaUrl ?? null,
          mediaUrls,
          interactive: payload.interactive,
          channelDataMax,
          identity: ctx.identity,
        }),
      );
    }
    return await sendTextMediaPayload({
      channel: "max",
      ctx: {
        ...ctx,
        payload,
      },
      adapter: maxOutbound,
    });
  },
  ...createAttachedChannelResultAdapter({
    channel: "max",
    sendText: async ({ to, text, deps, replyToId, identity }) =>
      await resolveMaxSendDep(deps)(to, text, { replyToId, identity }),
    sendMedia: async ({ to, text, mediaUrl, deps, replyToId, identity }) =>
      await resolveMaxSendDep(deps)(to, text, { mediaUrl, replyToId, identity }),
  }),
};
