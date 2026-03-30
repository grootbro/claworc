import { createAccountStatusSink } from "openclaw/plugin-sdk/channel-lifecycle";
import { runStoppablePassiveMonitor } from "openclaw/plugin-sdk/extension-shared";
import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import type { RuntimeEnv } from "openclaw/plugin-sdk/runtime";
import { normalizePluginHttpPath, registerPluginHttpRoute } from "openclaw/plugin-sdk/webhook-ingress";
import type { ResolvedMaxAccount } from "./accounts.js";
import { fetchMaxBotInfo, subscribeMaxWebhook, unsubscribeMaxWebhook } from "./api.js";
import { handleMaxInbound } from "./inbound.js";
import { normalizeMaxUpdate } from "./normalize.js";
import { createMaxWebhookHandler } from "./webhook-node.js";

const DEFAULT_MAX_UPDATE_TYPES = ["message_created", "message_callback", "bot_started"] as const;

export async function monitorMaxProvider(params: {
  account: ResolvedMaxAccount;
  config: OpenClawConfig;
  runtime: RuntimeEnv;
  abortSignal: AbortSignal;
  statusSink: ReturnType<typeof createAccountStatusSink>;
}): Promise<{ stop: () => Promise<void> | void }> {
  const webhookUrl = params.account.config.webhookUrl?.trim();
  if (!webhookUrl) {
    throw new Error(
      `MAX account "${params.account.accountId}" requires channels.max.webhookUrl for production webhook delivery`,
    );
  }

  const botInfo = await fetchMaxBotInfo({ account: params.account });
  const botUserId = typeof botInfo.user_id === "number" ? botInfo.user_id : undefined;
  const webhookPath =
    normalizePluginHttpPath(
      params.account.config.webhookPath,
      `/max/${params.account.accountId}/webhook`,
    ) ?? `/max/${params.account.accountId}/webhook`;

  const unregisterHttp = registerPluginHttpRoute({
    path: webhookPath,
    auth: "plugin",
    replaceExisting: true,
    pluginId: "max",
    accountId: params.account.accountId,
    log: (entry) => params.runtime.log?.(entry),
    handler: createMaxWebhookHandler({
      runtime: params.runtime,
      expectedSecret: params.account.config.webhookSecret?.trim(),
      onUpdate: async (update) => {
        const normalized = normalizeMaxUpdate({
          update,
          botUserId,
        });
        if (!normalized) {
          return;
        }
        await handleMaxInbound({
          message: normalized,
          account: params.account,
          config: params.config,
          runtime: params.runtime,
          statusSink: params.statusSink,
        });
      },
    }),
  });

  await subscribeMaxWebhook({
    account: params.account,
    url: webhookUrl,
    secret: params.account.config.webhookSecret?.trim(),
    updateTypes: [...DEFAULT_MAX_UPDATE_TYPES],
  });

  params.statusSink({
    configured: Boolean(params.account.token?.trim()),
    running: true,
    lastStartAt: Date.now(),
    lastError: null,
  });

  let stopped = false;
  const stop = async () => {
    if (stopped) {
      return;
    }
    stopped = true;
    unregisterHttp();
    await unsubscribeMaxWebhook({
      account: params.account,
      url: webhookUrl,
    }).catch(() => {});
    params.statusSink({
      running: false,
      lastStopAt: Date.now(),
    });
  };

  if (params.abortSignal.aborted) {
    await stop();
  }

  return { stop };
}

export async function startMaxGatewayAccount(params: {
  account: ResolvedMaxAccount;
  cfg: OpenClawConfig;
  runtime: RuntimeEnv;
  abortSignal: AbortSignal;
  accountId: string;
  setStatus: (next: { accountId: string } & Record<string, unknown>) => void;
  log?: { info?: (message: string) => void };
}): Promise<void> {
  params.log?.info?.(`[${params.account.accountId}] starting MAX webhook provider`);
  const statusSink = createAccountStatusSink({
    accountId: params.accountId,
    setStatus: params.setStatus,
  });

  try {
    await runStoppablePassiveMonitor({
      abortSignal: params.abortSignal,
      start: async () =>
        await monitorMaxProvider({
          account: params.account,
          config: params.cfg,
          runtime: params.runtime,
          abortSignal: params.abortSignal,
          statusSink,
        }),
    });
  } catch (error) {
    statusSink({
      running: false,
      lastError: String(error),
      lastStopAt: Date.now(),
    });
    throw error;
  }
}
