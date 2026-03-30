export type VkCallbackEnvelope = {
  type?: string;
  group_id?: number;
  secret?: string;
  object?: unknown;
};

type VkMessageNewObject = {
  message?: {
    id?: number;
    conversation_message_id?: number;
    date?: number;
    peer_id?: number;
    from_id?: number;
    out?: number;
    text?: string;
  };
};

export type VkInboundMessage = {
  messageId: string;
  conversationMessageId?: string;
  peerId: string;
  senderId: string;
  text: string;
  timestamp: number;
  isGroupChat: boolean;
};

const VK_GROUP_PEER_OFFSET = 2_000_000_000;

export function isVkGroupPeer(peerId: number): boolean {
  return Number.isFinite(peerId) && peerId >= VK_GROUP_PEER_OFFSET;
}

export function parseVkMessageNewEnvelope(body: unknown): VkInboundMessage | null {
  if (!body || typeof body !== "object") {
    return null;
  }

  const envelope = body as VkCallbackEnvelope;
  if (envelope.type !== "message_new" || !envelope.object || typeof envelope.object !== "object") {
    return null;
  }

  const payload = envelope.object as VkMessageNewObject;
  const message = payload.message;
  if (!message || typeof message !== "object") {
    return null;
  }

  const peerId = typeof message.peer_id === "number" ? message.peer_id : NaN;
  const senderId = typeof message.from_id === "number" ? message.from_id : NaN;
  if (!Number.isFinite(peerId) || !Number.isFinite(senderId)) {
    return null;
  }

  if (typeof message.out === "number" && message.out > 0) {
    return null;
  }

  const text = typeof message.text === "string" ? message.text.trim() : "";
  return {
    messageId: typeof message.id === "number" ? String(message.id) : `${peerId}:${senderId}:${message.date ?? Date.now()}`,
    conversationMessageId:
      typeof message.conversation_message_id === "number"
        ? String(message.conversation_message_id)
        : undefined,
    peerId: String(peerId),
    senderId: String(senderId),
    text,
    timestamp:
      typeof message.date === "number" && Number.isFinite(message.date)
        ? message.date * 1000
        : Date.now(),
    isGroupChat: isVkGroupPeer(peerId),
  };
}
