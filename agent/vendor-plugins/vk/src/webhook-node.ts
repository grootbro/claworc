import type { IncomingMessage, ServerResponse } from "node:http";
import { danger, type RuntimeEnv } from "openclaw/plugin-sdk/runtime";
import {
  beginWebhookRequestPipelineOrReject,
  isRequestBodyLimitError,
  readRequestBodyWithLimit,
  requestBodyErrorToText,
} from "openclaw/plugin-sdk/webhook-request-guards";
import type { ResolvedVkAccount } from "./accounts.js";
import {
  parseVkMessageNewEnvelope,
  type VkCallbackEnvelope,
  type VkInboundMessage,
} from "./normalize.js";

const VK_WEBHOOK_MAX_BODY_BYTES = 1024 * 1024;
const VK_WEBHOOK_PREAUTH_MAX_BODY_BYTES = 64 * 1024;
const VK_WEBHOOK_PREAUTH_BODY_TIMEOUT_MS = 5_000;

export function createVkWebhookHandler(params: {
  account: ResolvedVkAccount;
  runtime: RuntimeEnv;
  onMessage: (message: VkInboundMessage) => Promise<void>;
}): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const requestLifecycle = beginWebhookRequestPipelineOrReject({
      req,
      res,
      allowMethods: ["POST"],
      requireJsonContentType: true,
    });
    if (!requestLifecycle.ok) {
      return;
    }

    try {
      const rawBody = await readRequestBodyWithLimit(req, {
        maxBytes: Math.min(VK_WEBHOOK_MAX_BODY_BYTES, VK_WEBHOOK_PREAUTH_MAX_BODY_BYTES),
        timeoutMs: VK_WEBHOOK_PREAUTH_BODY_TIMEOUT_MS,
      });
      const body = JSON.parse(rawBody) as VkCallbackEnvelope;
      const expectedGroupId = params.account.groupId?.trim();
      if (expectedGroupId && String(body.group_id ?? "").trim() !== expectedGroupId) {
        res.statusCode = 401;
        res.end("group_id mismatch");
        return;
      }

      const expectedSecret =
        params.account.config.callbackSecret?.trim() || params.account.config.webhookSecret?.trim();
      if (expectedSecret && String(body.secret ?? "").trim() !== expectedSecret) {
        res.statusCode = 401;
        res.end("secret mismatch");
        return;
      }

      if (body.type === "confirmation") {
        const token = params.account.config.confirmationToken?.trim();
        if (!token) {
          res.statusCode = 500;
          res.end("confirmation token not configured");
          return;
        }
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end(token);
        return;
      }

      if (body.type !== "message_new") {
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("ok");
        return;
      }

      const message = parseVkMessageNewEnvelope(body);
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("ok");

      if (!message) {
        return;
      }

      void params.onMessage(message).catch((error) => {
        params.runtime.error?.(danger(`vk webhook message_new handler failed: ${String(error)}`));
      });
    } catch (error) {
      if (isRequestBodyLimitError(error, "PAYLOAD_TOO_LARGE")) {
        res.statusCode = 413;
        res.end(requestBodyErrorToText("PAYLOAD_TOO_LARGE"));
        return;
      }
      if (isRequestBodyLimitError(error, "REQUEST_BODY_TIMEOUT")) {
        res.statusCode = 408;
        res.end(requestBodyErrorToText("REQUEST_BODY_TIMEOUT"));
        return;
      }
      params.runtime.error?.(danger(`vk webhook error: ${String(error)}`));
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end("Internal server error");
      }
    } finally {
      requestLifecycle.release();
    }
  };
}
