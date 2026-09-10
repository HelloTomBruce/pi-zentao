/** pi-zentao 入口：注册 2 个 LLM 工具、3 个命令、状态栏与概览面板生命周期。 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runZentao } from "./lib/cli.ts";
import { OverviewCache } from "./lib/overview.ts";
import { initStatus, registerCommands } from "./commands.ts";
import { registerMyOverviewTool } from "./tools/my-overview.ts";
import { registerZentaoTool } from "./tools/zentao.ts";

export default function (pi: ExtensionAPI): void {
  const cache = new OverviewCache(5 * 60_000);
  const run = (args: string[]): Promise<unknown> => runZentao(args);

  registerZentaoTool(pi, run);
  registerMyOverviewTool(pi, run, cache);
  registerCommands(pi, { run, cache });

  pi.on("session_start", async (_event, ctx) => {
    await initStatus(ctx, run);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    cache.clear();
    if (ctx.hasUI) ctx.ui.setStatus("zentao", undefined);
  });
}
