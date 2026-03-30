import type { ResolvedMaxAccount } from "./types.js";
import { sendMaxMessage, sendMaxUserMessage } from "./api.js";

export async function sendMaxText(params: {
  account: ResolvedMaxAccount;
  to: string;
  text: string;
  replyToId?: string;
}) {
  const normalizedTarget = params.to.trim().replace(/^max:/i, "").trim();
  const prefix = params.account.config.responsePrefix?.trim();
  const text = prefix ? `${prefix}\n\n${params.text}` : params.text;

  if (/^user:\d+$/i.test(normalizedTarget)) {
    const userId = Number.parseInt(normalizedTarget.split(":", 2)[1] ?? "", 10);
    await sendMaxUserMessage({
      account: params.account,
      userId,
      text,
      replyToMessageId: params.replyToId,
    });
    return;
  }

  if (/^(chat:)?\d+$/i.test(normalizedTarget)) {
    const chatId = Number.parseInt(normalizedTarget.replace(/^chat:/i, ""), 10);
    await sendMaxMessage({
      account: params.account,
      chatId,
      text,
      replyToMessageId: params.replyToId,
    });
    return;
  }

  throw new Error(
    `MAX target must be a numeric chat id or user:<id>, received "${params.to}"`,
  );
}
