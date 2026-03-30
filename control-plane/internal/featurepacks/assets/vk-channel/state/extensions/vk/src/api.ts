import { randomInt } from "node:crypto";
import type { ResolvedVkAccount } from "./types.js";

const VK_API_BASE = "https://api.vk.com/method";
const DEFAULT_VK_API_VERSION = "5.199";

type VkApiErrorPayload = {
  error_code?: number;
  error_msg?: string;
  request_params?: Array<{ key?: string; value?: string }>;
};

type VkApiEnvelope<T> = {
  response?: T;
  error?: VkApiErrorPayload;
};

export class VkApiError extends Error {
  readonly code?: number;
  readonly method: string;
  readonly payload?: VkApiErrorPayload;

  constructor(params: { method: string; payload?: VkApiErrorPayload; message: string }) {
    super(params.message);
    this.name = "VkApiError";
    this.method = params.method;
    this.payload = params.payload;
    this.code = params.payload?.error_code;
  }
}

function resolveVkApiVersion(account: ResolvedVkAccount): string {
  const configured = account.config.apiVersion?.trim();
  return configured || DEFAULT_VK_API_VERSION;
}

function appendVkParam(body: URLSearchParams, key: string, value: unknown): void {
  if (value === undefined || value === null) {
    return;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return;
    }
    body.set(key, value.join(","));
    return;
  }
  body.set(key, String(value));
}

export async function vkApiCall<T>(params: {
  account: ResolvedVkAccount;
  method: string;
  body?: Record<string, unknown>;
}): Promise<T> {
  const form = new URLSearchParams();
  form.set("access_token", params.account.token);
  form.set("v", resolveVkApiVersion(params.account));

  for (const [key, value] of Object.entries(params.body ?? {})) {
    appendVkParam(form, key, value);
  }

  const response = await fetch(`${VK_API_BASE}/${params.method}`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=utf-8",
    },
    body: form,
  });

  if (!response.ok) {
    throw new VkApiError({
      method: params.method,
      message: `VK API ${params.method} failed with HTTP ${response.status}`,
    });
  }

  const payload = (await response.json()) as VkApiEnvelope<T>;
  if (payload.error) {
    throw new VkApiError({
      method: params.method,
      payload: payload.error,
      message:
        payload.error.error_msg?.trim() ||
        `VK API ${params.method} failed with code ${payload.error.error_code ?? "unknown"}`,
    });
  }
  if (payload.response === undefined) {
    throw new VkApiError({
      method: params.method,
      message: `VK API ${params.method} returned no response payload`,
    });
  }

  return payload.response;
}

function buildVkRandomId(): number {
  return randomInt(1, 2_147_483_647);
}

export async function sendVkMessage(params: {
  account: ResolvedVkAccount;
  peerId: number;
  text: string;
  replyToId?: string;
}): Promise<{ messageId?: number; conversationMessageId?: number }> {
  const replyTo =
    typeof params.replyToId === "string" && /^\d+$/.test(params.replyToId.trim())
      ? Number.parseInt(params.replyToId.trim(), 10)
      : undefined;
  const response = await vkApiCall<number | { message_id?: number; conversation_message_id?: number }>({
    account: params.account,
    method: "messages.send",
    body: {
      peer_id: params.peerId,
      message: params.text,
      random_id: buildVkRandomId(),
      reply_to: replyTo,
    },
  });

  if (typeof response === "number") {
    return { messageId: response };
  }
  return {
    messageId: response.message_id,
    conversationMessageId: response.conversation_message_id,
  };
}

export async function markVkConversationRead(params: {
  account: ResolvedVkAccount;
  peerId: number;
}): Promise<void> {
  await vkApiCall({
    account: params.account,
    method: "messages.markAsRead",
    body: {
      peer_id: params.peerId,
    },
  });
}
