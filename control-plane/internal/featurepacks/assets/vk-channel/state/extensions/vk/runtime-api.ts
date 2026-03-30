// Private runtime barrel for the bundled VK extension.
// Keep this barrel thin and aligned with the local extension surface.

export type { ChannelPlugin, OpenClawConfig, PluginRuntime } from "openclaw/plugin-sdk/core";
export { buildChannelConfigSchema } from "openclaw/plugin-sdk/channel-config-schema";
export { buildPassiveChannelStatusSummary } from "openclaw/plugin-sdk/extension-shared";
export { createDefaultChannelRuntimeState } from "openclaw/plugin-sdk/status-helpers";

export * from "./src/accounts.js";
export * from "./src/api.js";
export * from "./src/config-schema.js";
export * from "./src/send.js";
export type { ResolvedVkAccount, VkAccountConfig, VkConfig, VkTokenSource } from "./src/types.js";
