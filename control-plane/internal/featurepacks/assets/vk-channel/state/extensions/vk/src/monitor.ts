import { createAccountStatusSink } from "openclaw/plugin-sdk/channel-lifecycle";
import { runStoppablePassiveMonitor } from "openclaw/plugin-sdk/extension-shared";
import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import type { RuntimeEnv } from "openclaw/plugin-sdk/runtime";
import { normalizePluginHttpPath, registerPluginHttpRoute } from "openclaw/plugin-sdk/webhook-ingress";
import type { ResolvedVkAccount } from "./accounts.js";
import { handleVkInbound } from "./inbound.js";
import { createVkWebhookHandler } from "./webhook-node.js";

export async function monitorVkProvider(params: {
  account: ResolvedVkAccount;
  config: OpenClawConfig;
  runtime: RuntimeEnv;
  abortSignal: AbortSignal;
  statusSink: ReturnType<typeof createAccountStatusSink>;
}): Promise<{ stop: () => void }> {
  const webhookPath =
    normalizePluginHttpPath(
      params.account.config.webhookPath,
      `/vk/${params.account.accountId}/webhook`,
    ) ?? `/vk/${params.account.accountId}/webhook`;

  const unregisterHttp = registerPluginHttpRoute({
    path: webhookPath,
    auth: "plugin",
    replaceExisting: true,
    pluginId: "vk",
    accountId: params.account.accountId,
    log: (entry) => params.runtime.log?.(entry),
    handler: createVkWebhookHandler({
      account: params.account,
      runtime: params.runtime,
      onMessage: async (message) => {
        await handleVkInbound({
          message,
          account: params.account,
          config: params.config,
          runtime: params.runtime,
          statusSink: params.statusSink,
        });
      },
    }),
  });

  params.statusSink({
    configured: Boolean(params.account.token?.trim() && params.account.groupId?.trim()),
    running: true,
    lastStartAt: Date.now(),
    lastError: null,
  });

  let stopped = false;
  const stop = () => {
    if (stopped) {
      return;
    }
    stopped = true;
    unregisterHttp();
    params.statusSink({
      running: false,
      lastStopAt: Date.now(),
    });
  };

  if (params.abortSignal.aborted) {
    stop();
  }

  return { stop };
}

export async function startVkGatewayAccount(params: {
  account: ResolvedVkAccount;
  cfg: OpenClawConfig;
  runtime: RuntimeEnv;
  abortSignal: AbortSignal;
  accountId: string;
  setStatus: (next: { accountId: string } & Record<string, unknown>) => void;
  log?: { info?: (message: string) => void };
}): Promise<void> {
  params.log?.info?.(`[${params.account.accountId}] starting VK webhook provider`);
  const statusSink = createAccountStatusSink({
    accountId: params.accountId,
    setStatus: params.setStatus,
  });

  try {
    await runStoppablePassiveMonitor({
      abortSignal: params.abortSignal,
      start: async () =>
        await monitorVkProvider({
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
