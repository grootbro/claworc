import type { IncomingMessage, ServerResponse } from "node:http";
import type { Update } from "@maxhub/max-bot-api/types";
import { danger, type RuntimeEnv } from "openclaw/plugin-sdk/runtime";
import {
  beginWebhookRequestPipelineOrReject,
  isRequestBodyLimitError,
  readRequestBodyWithLimit,
  requestBodyErrorToText,
} from "openclaw/plugin-sdk/webhook-request-guards";

const MAX_WEBHOOK_MAX_BODY_BYTES = 1024 * 1024;
const MAX_WEBHOOK_PREAUTH_MAX_BODY_BYTES = 64 * 1024;
const MAX_WEBHOOK_PREAUTH_BODY_TIMEOUT_MS = 5_000;

function readMaxWebhookSecret(
  headers: IncomingMessage["headers"],
): string | undefined {
  const header = headers["x-max-bot-api-secret"];
  if (typeof header === "string") {
    return header.trim();
  }
  if (Array.isArray(header) && header[0]) {
    return header[0].trim();
  }
  return undefined;
}

export function createMaxWebhookHandler(params: {
  runtime: RuntimeEnv;
  expectedSecret?: string;
  onUpdate: (update: Update) => Promise<void>;
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
        maxBytes: Math.min(MAX_WEBHOOK_MAX_BODY_BYTES, MAX_WEBHOOK_PREAUTH_MAX_BODY_BYTES),
        timeoutMs: MAX_WEBHOOK_PREAUTH_BODY_TIMEOUT_MS,
      });

      const expectedSecret = params.expectedSecret?.trim();
      if (expectedSecret) {
        const actualSecret = readMaxWebhookSecret(req.headers);
        if (actualSecret !== expectedSecret) {
          res.statusCode = 401;
          res.end("secret mismatch");
          return;
        }
      }

      const update = JSON.parse(rawBody) as Update;
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("ok");

      void params.onUpdate(update).catch((error) => {
        params.runtime.error?.(danger(`max webhook update handler failed: ${String(error)}`));
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
      params.runtime.error?.(danger(`max webhook error: ${String(error)}`));
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end("Internal server error");
      }
    } finally {
      requestLifecycle.release();
    }
  };
}
