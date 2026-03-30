import { createChannelReplyPipeline } from "openclaw/plugin-sdk/channel-reply-pipeline";
import { createNormalizedOutboundDeliverer, type OutboundReplyPayload } from "openclaw/plugin-sdk/reply-payload";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";

type RecordInboundSessionFn = (params: {
  storePath: string;
  sessionKey: string;
  ctx: Record<string, unknown>;
  onRecordError: (err: unknown) => void;
}) => Promise<void>;
type DispatchReplyWithBufferedBlockDispatcherFn = (params: {
  ctx: Record<string, unknown>;
  cfg: OpenClawConfig;
  dispatcherOptions: Record<string, unknown>;
  replyOptions?: Record<string, unknown>;
}) => Promise<unknown>;

export async function dispatchVkInboundReply(params: {
  cfg: OpenClawConfig;
  channel: string;
  accountId?: string;
  route: {
    agentId: string;
    sessionKey: string;
  };
  storePath: string;
  ctxPayload: Record<string, unknown>;
  core: {
    channel: {
      session: {
        recordInboundSession: RecordInboundSessionFn;
      };
      reply: {
        dispatchReplyWithBufferedBlockDispatcher: DispatchReplyWithBufferedBlockDispatcherFn;
      };
    };
  };
  deliver: (payload: OutboundReplyPayload) => Promise<void>;
  onRecordError: (err: unknown) => void;
  onDispatchError: (err: unknown, info: { kind: string }) => void;
}): Promise<void> {
  await params.core.channel.session.recordInboundSession({
    storePath: params.storePath,
    sessionKey:
      (typeof params.ctxPayload.SessionKey === "string" && params.ctxPayload.SessionKey) ||
      params.route.sessionKey,
    ctx: params.ctxPayload,
    onRecordError: params.onRecordError,
  });

  const { onModelSelected, ...replyPipeline } = createChannelReplyPipeline({
    cfg: params.cfg,
    agentId: params.route.agentId,
    channel: params.channel,
    accountId: params.accountId,
  });
  const deliver = createNormalizedOutboundDeliverer(params.deliver);

  await params.core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx: params.ctxPayload,
    cfg: params.cfg,
    dispatcherOptions: {
      ...replyPipeline,
      deliver,
      onError: params.onDispatchError,
    },
    replyOptions: {
      onModelSelected,
    },
  });
}
