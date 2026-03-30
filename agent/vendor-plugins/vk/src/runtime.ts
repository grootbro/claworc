import type { PluginRuntime } from "openclaw/plugin-sdk/core";
import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";

const {
  setRuntime: setVkRuntime,
  clearRuntime: clearVkRuntime,
  getRuntime: getVkRuntime,
} = createPluginRuntimeStore<PluginRuntime>("VK runtime not initialized");

export { clearVkRuntime, getVkRuntime, setVkRuntime };
