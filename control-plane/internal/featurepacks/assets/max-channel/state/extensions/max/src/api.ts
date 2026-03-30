import { Bot } from "@maxhub/max-bot-api";
import type { AttachmentRequest, BotInfo } from "@maxhub/max-bot-api/types";
import type { ResolvedMaxAccount } from "./types.js";

type MaxApi = InstanceType<typeof Bot>["api"];
const DEFAULT_MAX_API_BASE_URL = "https://platform-api.max.ru";
const maxRateLimitTail = new Map<string, Promise<void>>();
const maxRateLimitNextAt = new Map<string, number>();

function createMaxApi(account: ResolvedMaxAccount): MaxApi {
  return new Bot(account.token).api;
}

function resolveMaxApiBaseUrl(account: ResolvedMaxAccount): string {
  return (account.config.apiBaseUrl?.trim() || DEFAULT_MAX_API_BASE_URL).replace(/\/+$/, "");
}

function resolveMaxFormat(account: ResolvedMaxAccount): "markdown" | "html" | undefined {
  if (account.config.format === "html") {
    return "html";
  }
  if (account.config.format === "plain") {
    return undefined;
  }
  return "markdown";
}

export function resolveMaxRequestsPerSecond(account: ResolvedMaxAccount): number {
  const configured = account.config.requestsPerSecond;
  if (typeof configured !== "number" || !Number.isFinite(configured)) {
    return 30;
  }
  return Math.max(1, Math.min(30, Math.floor(configured)));
}

function getMaxRateLimitKey(account: ResolvedMaxAccount): string {
  return `${account.accountId}:${account.token}`;
}

async function runMaxRateLimited<T>(
  account: ResolvedMaxAccount,
  operation: () => Promise<T>,
): Promise<T> {
  const key = getMaxRateLimitKey(account);
  const intervalMs = Math.ceil(1000 / resolveMaxRequestsPerSecond(account));
  const previous = maxRateLimitTail.get(key) ?? Promise.resolve();
  let release: (() => void) | null = null;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  maxRateLimitTail.set(
    key,
    previous.catch(() => {}).then(() => current),
  );

  await previous.catch(() => {});
  const scheduledAt = Math.max(maxRateLimitNextAt.get(key) ?? 0, Date.now());
  maxRateLimitNextAt.set(key, scheduledAt + intervalMs);
  const waitMs = scheduledAt - Date.now();
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  try {
    return await operation();
  } finally {
    release?.();
  }
}

type MaxSuccessEnvelope = {
  success?: boolean;
  message?: string | null;
};

async function maxWebhookApiCall<T>(params: {
  account: ResolvedMaxAccount;
  method: "POST" | "DELETE";
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
}): Promise<T> {
  const url = new URL(`${resolveMaxApiBaseUrl(params.account)}${params.path}`);
  for (const [key, value] of Object.entries(params.query ?? {})) {
    if (value === undefined) {
      continue;
    }
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    method: params.method,
    headers: {
      Authorization: params.account.token,
      "Content-Type": "application/json",
    },
    body: params.body === undefined ? undefined : JSON.stringify(params.body),
  });

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as T) : ({} as T);
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "message" in (payload as object)
        ? String((payload as { message?: unknown }).message ?? `HTTP ${response.status}`)
        : `HTTP ${response.status}`;
    throw new Error(`MAX API ${params.method} ${params.path} failed: ${message}`);
  }
  return payload;
}

export async function fetchMaxBotInfo(params: {
  account: ResolvedMaxAccount;
}): Promise<BotInfo> {
  const api = createMaxApi(params.account);
  return await runMaxRateLimited(params.account, async () => await api.getMyInfo());
}

export async function subscribeMaxWebhook(params: {
  account: ResolvedMaxAccount;
  url: string;
  secret?: string;
  updateTypes?: string[];
}): Promise<void> {
  const payload = await runMaxRateLimited(
    params.account,
    async () =>
      await maxWebhookApiCall<MaxSuccessEnvelope>({
        account: params.account,
        method: "POST",
        path: "/subscriptions",
        body: {
          url: params.url,
          update_types: params.updateTypes?.length ? params.updateTypes : undefined,
          secret: params.secret || undefined,
        },
      }),
  );
  if (payload.success === false) {
    throw new Error(`MAX webhook subscription failed: ${payload.message ?? "unknown error"}`);
  }
}

export async function unsubscribeMaxWebhook(params: {
  account: ResolvedMaxAccount;
  url: string;
}): Promise<void> {
  const payload = await runMaxRateLimited(
    params.account,
    async () =>
      await maxWebhookApiCall<MaxSuccessEnvelope>({
        account: params.account,
        method: "DELETE",
        path: "/subscriptions",
        query: {
          url: params.url,
        },
      }),
  );
  if (payload.success === false) {
    throw new Error(`MAX webhook unsubscribe failed: ${payload.message ?? "unknown error"}`);
  }
}

export async function sendMaxTyping(params: {
  account: ResolvedMaxAccount;
  chatId: number;
}) {
  const api = createMaxApi(params.account);
  return await runMaxRateLimited(
    params.account,
    async () => await api.sendAction(params.chatId, "typing_on"),
  );
}

export async function sendMaxMessage(params: {
  account: ResolvedMaxAccount;
  chatId: number;
  text: string;
  replyToMessageId?: string;
  attachments?: AttachmentRequest[];
}) {
  const api = createMaxApi(params.account);
  return await runMaxRateLimited(
    params.account,
    async () =>
      await api.sendMessageToChat(params.chatId, params.text, {
        format: resolveMaxFormat(params.account),
        attachments: params.attachments?.length ? params.attachments : undefined,
        link:
          typeof params.replyToMessageId === "string" && params.replyToMessageId.trim()
            ? {
                type: "reply",
                mid: params.replyToMessageId.trim(),
              }
            : undefined,
      }),
  );
}

export async function sendMaxUserMessage(params: {
  account: ResolvedMaxAccount;
  userId: number;
  text: string;
  replyToMessageId?: string;
  attachments?: AttachmentRequest[];
}) {
  const api = createMaxApi(params.account);
  return await runMaxRateLimited(
    params.account,
    async () =>
      await api.sendMessageToUser(params.userId, params.text, {
        format: resolveMaxFormat(params.account),
        attachments: params.attachments?.length ? params.attachments : undefined,
        link:
          typeof params.replyToMessageId === "string" && params.replyToMessageId.trim()
            ? {
                type: "reply",
                mid: params.replyToMessageId.trim(),
              }
            : undefined,
      }),
  );
}

export async function editMaxMessage(params: {
  account: ResolvedMaxAccount;
  messageId: string;
  text: string;
  attachments?: AttachmentRequest[];
}) {
  const api = createMaxApi(params.account);
  return await runMaxRateLimited(
    params.account,
    async () =>
      await api.editMessage(params.messageId, {
        text: params.text,
        attachments: params.attachments?.length ? params.attachments : undefined,
        format: resolveMaxFormat(params.account),
      }),
  );
}

export async function answerOnMaxCallback(params: {
  account: ResolvedMaxAccount;
  callbackId: string;
  notification?: string;
}) {
  const api = createMaxApi(params.account);
  return await runMaxRateLimited(
    params.account,
    async () =>
      await api.answerOnCallback(params.callbackId, {
        notification: params.notification?.trim() || undefined,
      }),
  );
}
