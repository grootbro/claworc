import type { AttachmentRequest, Button } from "@maxhub/max-bot-api/types";
import type { InteractiveReply } from "openclaw/plugin-sdk/interactive-runtime";
import { buildMaxInteractiveAttachments } from "./shared-interactive.js";

type MaxChannelData = {
  attachments?: unknown;
  keyboard?: {
    buttons?: unknown;
  };
  requestContactText?: unknown;
  requestGeoLocationText?: unknown;
  requestGeoLocationQuick?: unknown;
  linkButtons?: unknown;
};

function readTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function normalizeKeyboardButton(raw: unknown): Button | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const type = readTrimmedString(record.type)?.toLowerCase();
  const text = readTrimmedString(record.text) ?? readTrimmedString(record.label);
  if (!type || !text) {
    return null;
  }

  if (type === "callback") {
    const payload =
      readTrimmedString(record.payload) ??
      readTrimmedString(record.value) ??
      readTrimmedString(record.callbackData) ??
      readTrimmedString(record.callback_data);
    if (!payload) {
      return null;
    }
    const intent = readTrimmedString(record.intent)?.toLowerCase();
    return {
      type: "callback",
      text,
      payload,
      ...(intent === "default" || intent === "positive" || intent === "negative"
        ? { intent }
        : {}),
    };
  }

  if (type === "link") {
    const url = readTrimmedString(record.url) ?? readTrimmedString(record.href);
    return url ? { type: "link", text, url } : null;
  }

  if (type === "request_contact") {
    return { type: "request_contact", text };
  }

  if (type === "request_geo_location") {
    const quick = readBoolean(record.quick);
    return {
      type: "request_geo_location",
      text,
      ...(quick !== undefined ? { quick } : {}),
    };
  }

  if (type === "chat") {
    const chatTitle =
      readTrimmedString(record.chat_title) ?? readTrimmedString(record.chatTitle);
    if (!chatTitle) {
      return null;
    }
    const chatDescription =
      readTrimmedString(record.chat_description) ?? readTrimmedString(record.chatDescription);
    const startPayload =
      readTrimmedString(record.start_payload) ?? readTrimmedString(record.startPayload);
    const uuid = readTrimmedString(record.uuid);
    return {
      type: "chat",
      text,
      chat_title: chatTitle,
      ...(chatDescription ? { chat_description: chatDescription } : {}),
      ...(startPayload ? { start_payload: startPayload } : {}),
      ...(uuid ? { uuid } : {}),
    };
  }

  return null;
}

function normalizeKeyboardRows(raw: unknown): Button[][] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((row) =>
      Array.isArray(row)
        ? row
            .map((button) => normalizeKeyboardButton(button))
            .filter((button): button is Button => Boolean(button))
        : [],
    )
    .filter((row) => row.length > 0);
}

function normalizeAttachment(raw: unknown): AttachmentRequest | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const type = readTrimmedString(record.type)?.toLowerCase();
  if (!type) {
    return null;
  }

  if (type === "inline_keyboard") {
    const payload =
      record.payload && typeof record.payload === "object" && !Array.isArray(record.payload)
        ? (record.payload as Record<string, unknown>)
        : {};
    const buttons = normalizeKeyboardRows(payload.buttons);
    return buttons.length > 0
      ? {
          type: "inline_keyboard",
          payload: { buttons },
        }
      : null;
  }

  if (type === "contact") {
    const payload =
      record.payload && typeof record.payload === "object" && !Array.isArray(record.payload)
        ? (record.payload as Record<string, unknown>)
        : record;
    const name = readTrimmedString(payload.name) ?? null;
    const contactId =
      typeof payload.contact_id === "number" && Number.isFinite(payload.contact_id)
        ? payload.contact_id
        : typeof payload.contactId === "number" && Number.isFinite(payload.contactId)
          ? payload.contactId
          : null;
    const vcfInfo = readTrimmedString(payload.vcf_info) ?? readTrimmedString(payload.vcfInfo) ?? null;
    const vcfPhone =
      readTrimmedString(payload.vcf_phone) ?? readTrimmedString(payload.vcfPhone) ?? null;
    return name || contactId !== null || vcfInfo || vcfPhone
      ? {
          type: "contact",
          payload: {
            name,
            ...(contactId !== null ? { contact_id: contactId } : {}),
            ...(vcfInfo ? { vcf_info: vcfInfo } : {}),
            ...(vcfPhone ? { vcf_phone: vcfPhone } : {}),
          },
        }
      : null;
  }

  if (type === "location") {
    const latitude = readFiniteNumber(record.latitude);
    const longitude = readFiniteNumber(record.longitude);
    return latitude !== undefined && longitude !== undefined
      ? {
          type: "location",
          latitude,
          longitude,
        }
      : null;
  }

  if (type === "sticker") {
    const payload =
      record.payload && typeof record.payload === "object" && !Array.isArray(record.payload)
        ? (record.payload as Record<string, unknown>)
        : record;
    const code = readTrimmedString(payload.code);
    return code
      ? {
          type: "sticker",
          payload: { code },
        }
      : null;
  }

  if (type === "image" || type === "video" || type === "audio" || type === "file" || type === "share") {
    const payload =
      record.payload && typeof record.payload === "object" && !Array.isArray(record.payload)
        ? (record.payload as Record<string, unknown>)
        : record;
    const url = readTrimmedString(payload.url);
    const token = readTrimmedString(payload.token);
    if (type === "share") {
      return url || token
        ? {
            type: "share",
            payload: {
              ...(url ? { url } : {}),
              ...(token ? { token } : {}),
            },
          }
        : null;
    }
    if (type === "image") {
      const photos =
        payload.photos && typeof payload.photos === "object" && !Array.isArray(payload.photos)
          ? payload.photos
          : undefined;
      return url || token || photos
        ? {
            type: "image",
            payload: {
              ...(url ? { url } : {}),
              ...(token ? { token } : {}),
              ...(photos ? { photos: photos as Record<string, { token: string }> } : {}),
            },
          }
        : null;
    }
    return token
      ? {
          type,
          payload: { token },
        }
      : null;
  }

  return null;
}

function resolveRawAttachments(raw: unknown): AttachmentRequest[] {
  return Array.isArray(raw)
    ? raw
        .map((entry) => normalizeAttachment(entry))
        .filter((entry): entry is AttachmentRequest => Boolean(entry))
    : [];
}

function collectInlineKeyboardRows(attachments: AttachmentRequest[]): Button[][] {
  return attachments
    .filter((attachment): attachment is Extract<AttachmentRequest, { type: "inline_keyboard" }> =>
      attachment.type === "inline_keyboard",
    )
    .flatMap((attachment) => attachment.payload.buttons);
}

function filterNonKeyboardAttachments(attachments: AttachmentRequest[]): AttachmentRequest[] {
  return attachments.filter((attachment) => attachment.type !== "inline_keyboard");
}

function normalizeLinkButtons(raw: unknown): Button[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return null;
      }
      const record = entry as Record<string, unknown>;
      const text = readTrimmedString(record.text) ?? readTrimmedString(record.label);
      const url = readTrimmedString(record.url) ?? readTrimmedString(record.href);
      return text && url
        ? {
            type: "link" as const,
            text,
            url,
          }
        : null;
    })
    .filter((entry): entry is Button => Boolean(entry));
}

function resolveShortcutRows(data: MaxChannelData): Button[][] {
  const rows: Button[][] = [];
  const requestContactText = readTrimmedString(data.requestContactText);
  if (requestContactText) {
    rows.push([{ type: "request_contact", text: requestContactText }]);
  }
  const requestGeoLocationText = readTrimmedString(data.requestGeoLocationText);
  if (requestGeoLocationText) {
    rows.push([
      {
        type: "request_geo_location",
        text: requestGeoLocationText,
        ...(readBoolean(data.requestGeoLocationQuick) !== undefined
          ? { quick: readBoolean(data.requestGeoLocationQuick) }
          : {}),
      },
    ]);
  }
  const linkButtons = normalizeLinkButtons(data.linkButtons);
  if (linkButtons.length > 0) {
    rows.push(linkButtons);
  }
  return rows;
}

export function resolveMaxPayloadAttachments(params: {
  channelDataMax?: unknown;
  interactive?: InteractiveReply;
}): AttachmentRequest[] | undefined {
  const data =
    params.channelDataMax && typeof params.channelDataMax === "object" && !Array.isArray(params.channelDataMax)
      ? (params.channelDataMax as MaxChannelData)
      : undefined;

  const rawAttachments = resolveRawAttachments(data?.attachments);
  const keyboardRows: Button[][] = [
    ...collectInlineKeyboardRows(rawAttachments),
    ...normalizeKeyboardRows(data?.keyboard?.buttons),
    ...resolveShortcutRows(data ?? {}),
    ...collectInlineKeyboardRows(buildMaxInteractiveAttachments(params.interactive) ?? []),
  ];

  const attachments = [...filterNonKeyboardAttachments(rawAttachments)];
  if (keyboardRows.length > 0) {
    attachments.push({
      type: "inline_keyboard",
      payload: {
        buttons: keyboardRows,
      },
    });
  }

  return attachments.length > 0 ? attachments : undefined;
}
