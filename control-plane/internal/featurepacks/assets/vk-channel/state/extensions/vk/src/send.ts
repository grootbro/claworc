import type { ResolvedVkAccount } from "./types.js";
import { sendVkMessage } from "./api.js";

export async function sendVkText(params: {
  account: ResolvedVkAccount;
  to: string;
  text: string;
  replyToId?: string;
}) {
  const normalizedTarget = params.to.trim().replace(/^(vk|vkontakte):/i, "").trim();
  if (!/^-?\d+$/.test(normalizedTarget)) {
    throw new Error(`VK target must be a numeric peer id, received "${params.to}"`);
  }
  const prefix = params.account.config.responsePrefix?.trim();
  const text = prefix ? `${prefix}\n\n${params.text}` : params.text;
  await sendVkMessage({
    account: params.account,
    peerId: Number.parseInt(normalizedTarget, 10),
    text,
    replyToId: params.replyToId,
  });
}
