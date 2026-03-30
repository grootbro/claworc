import type { PluginRuntime } from "openclaw/plugin-sdk/core";
import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";

const {
  setRuntime: setMaxRuntime,
  clearRuntime: clearMaxRuntime,
  getRuntime: getMaxRuntime,
} = createPluginRuntimeStore<PluginRuntime>("MAX runtime not initialized");

export { clearMaxRuntime, getMaxRuntime, setMaxRuntime };
