import type {
  BotStartedUpdate,
  Message,
  MessageCallbackUpdate,
  MessageCreatedUpdate,
  Update,
} from "@maxhub/max-bot-api/types";

export type MaxInboundMessage = {
  updateType: "message_created" | "bot_started" | "message_callback";
  messageId: string;
  target: string;
  senderId: string;
  senderName?: string;
  senderUsername?: string;
  text: string;
  rawText: string;
  timestamp: number;
  isGroupChat: boolean;
  wasMentioned: boolean;
  replyToMessageId?: string;
  chatId?: number;
  callbackId?: string;
  isInteractiveCallback?: boolean;
};

function normalizeEpoch(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return Date.now();
  }
  return value < 1_000_000_000_000 ? value * 1000 : value;
}

function stripLeadingBotMention(params: {
  text: string;
  markup: Message["body"]["markup"];
  botUserId?: number;
}): { text: string; wasMentioned: boolean } {
  const trimmedText = params.text.trim();
  const markup = Array.isArray(params.markup) ? params.markup : [];
  const mention = markup.find(
    (entry) =>
      entry?.type === "user_mention" &&
      entry.from === 0 &&
      entry.user_id === params.botUserId,
  );
  if (!mention) {
    return { text: trimmedText, wasMentioned: false };
  }

  return {
    text: params.text.slice(mention.length).trim(),
    wasMentioned: true,
  };
}

function normalizeMessageCreatedUpdate(params: {
  update: MessageCreatedUpdate;
  botUserId?: number;
}): MaxInboundMessage | null {
  const message = params.update.message;
  const sender = message.sender;
  if (!sender || sender.is_bot) {
    return null;
  }

  const rawText = message.body.text?.trim() ?? "";
  const mentionInfo = stripLeadingBotMention({
    text: rawText,
    markup: message.body.markup,
    botUserId: params.botUserId,
  });
  const isGroupChat = message.recipient.chat_type !== "dialog";
  const chatId = typeof message.recipient.chat_id === "number" ? message.recipient.chat_id : undefined;
  const target = isGroupChat
    ? typeof chatId === "number"
      ? `chat:${chatId}`
      : ""
    : `user:${sender.user_id}`;

  if (!target) {
    return null;
  }

  return {
    updateType: "message_created",
    messageId: message.body.mid,
    target,
    senderId: String(sender.user_id),
    senderName: sender.name ?? undefined,
    senderUsername: sender.username ?? undefined,
    text: mentionInfo.text,
    rawText,
    timestamp: normalizeEpoch(params.update.timestamp),
    isGroupChat,
    wasMentioned: mentionInfo.wasMentioned,
    replyToMessageId: message.body.mid,
    chatId,
  };
}

function normalizeBotStartedUpdate(update: BotStartedUpdate): MaxInboundMessage {
  const rawText = update.payload?.trim() ? `/start ${update.payload.trim()}` : "/start";
  return {
    updateType: "bot_started",
    messageId: `bot_started:${update.chat_id}:${update.timestamp}`,
    target: `user:${update.user.user_id}`,
    senderId: String(update.user.user_id),
    senderName: update.user.name ?? undefined,
    senderUsername: update.user.username ?? undefined,
    text: rawText,
    rawText,
    timestamp: normalizeEpoch(update.timestamp),
    isGroupChat: false,
    wasMentioned: true,
    chatId: update.chat_id,
  };
}

function normalizeMessageCallbackUpdate(params: {
  update: MessageCallbackUpdate;
  botUserId?: number;
}): MaxInboundMessage {
  const message = params.update.message ?? null;
  const sender = params.update.callback.user;
  const rawText = params.update.callback.payload?.trim() || "/callback";
  const mentionInfo =
    message
      ? stripLeadingBotMention({
          text: rawText,
          markup: message.body.markup,
          botUserId: params.botUserId,
        })
      : { text: rawText, wasMentioned: true };
  const isGroupChat = message ? message.recipient.chat_type !== "dialog" : false;
  const chatId =
    message && typeof message.recipient.chat_id === "number"
      ? message.recipient.chat_id
      : undefined;
  const target = isGroupChat
    ? typeof chatId === "number"
      ? `chat:${chatId}`
      : `user:${sender.user_id}`
    : `user:${sender.user_id}`;

  return {
    updateType: "message_callback",
    messageId: message?.body.mid ?? `callback:${params.update.callback.callback_id}`,
    target,
    senderId: String(sender.user_id),
    senderName: sender.name ?? undefined,
    senderUsername: sender.username ?? undefined,
    text: mentionInfo.text || rawText,
    rawText,
    timestamp: normalizeEpoch(params.update.timestamp),
    isGroupChat,
    wasMentioned: true,
    replyToMessageId: message?.body.mid,
    chatId,
    callbackId: params.update.callback.callback_id,
    isInteractiveCallback: true,
  };
}

export function normalizeMaxUpdate(params: {
  update: Update;
  botUserId?: number;
}): MaxInboundMessage | null {
  if (params.update.update_type === "message_callback") {
    return normalizeMessageCallbackUpdate({
      update: params.update,
      botUserId: params.botUserId,
    });
  }
  if (params.update.update_type === "message_created") {
    return normalizeMessageCreatedUpdate({
      update: params.update,
      botUserId: params.botUserId,
    });
  }
  if (params.update.update_type === "bot_started") {
    return normalizeBotStartedUpdate(params.update);
  }
  return null;
}
