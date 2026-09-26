import type { PluginServerContext } from "@getpaseo/plugin/server";
import { decisionsJudge } from "./server/adapters/decisions.ts";
import { PaseoHost } from "./server/adapters/paseo/host.ts";
import { loadKit } from "./server/catalog/kit/kit.ts";
import { applyModels, readModels } from "./server/catalog/paseo/models.ts";
import { errorText } from "./server/core/errors.ts";
import { PLUGIN_ID, paseoConfigPath, pluginDir, stateRoot } from "./server/core/paths.ts";
import { refuseRpc, registerRpc } from "./server/runtime/panel/rpc.ts";
import { Runtime } from "./server/runtime/runtime.ts";
import { daemonLog } from "./server/core/logger.ts";

export default function contribute(server: PluginServerContext) {
  const dir = pluginDir();
  if (!dir) return refused(server, `this plugin's directory is not in ${paseoConfigPath()} under plugins.${PLUGIN_ID}`);
  const host = new PaseoHost();
  let runtime: Runtime;
  try {
    const kit = loadKit(dir, stateRoot());
    applyModels(kit, readModels(stateRoot()));
    runtime = new Runtime(kit, host, { sensor: decisionsJudge });
  } catch (error) {
    return refused(server, `the kit in ${dir} failed to load: ${errorText(error)}`, error);
  }
  void runtime.prepare();
  registerRpc(host.answering(server), runtime.panel);
  host.connect(server, runtime);
  runtime.start();
  return () => runtime.dispose();
}

/** Logged, and the answer to every panel call, since a plugin serving nothing leaves the panel with no reason to show. */
function refused(server: PluginServerContext, reason: string, cause?: unknown) {
  daemonLog.error(reason, cause);
  refuseRpc((contract, answer) => server.handle(contract, answer), reason);
  return () => {};
}
