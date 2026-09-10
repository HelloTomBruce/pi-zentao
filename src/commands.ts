/** 斜杠命令：/zentao（CLI 透传卡片）、/zentao-executions、/zentao-login、/zentao-overview（widget 面板）。 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { currentProfile, hintOf, login, type RunFn } from "./lib/cli.ts";
import { contextPath, describeContext, loadContext } from "./lib/context.ts";
import { getOverview, OverviewCache } from "./lib/overview.ts";
import { cellText, columnsFor, kvText, overviewLines, refreshZentaoStatus, tableText } from "./ui.ts";

/**  shell 风格参数切分（支持单双引号）。 */
export function splitArgs(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) {
    out.push(m[1] ?? m[2] ?? m[3] ?? "");
  }
  return out;
}

export interface CommandDeps {
  run: RunFn;
  cache: OverviewCache;
}

export function registerCommands(pi: ExtensionAPI, deps: CommandDeps): void {
  const run = deps.run;

  // /zentao 结果卡片：进对话流、不进 LLM 上下文。
  pi.registerEntryRenderer("zentao-card", (entry, { expanded }, theme) => {
    const { argv, data } = entry.data as { argv: string[]; data: unknown };
    const header = theme.fg("accent", `zentao ${argv.join(" ")}`);
    let body: string;
    if (Array.isArray(data)) {
      body = tableText(data as Record<string, unknown>[], columnsFor(argv[0] ?? ""), expanded ? 200 : 10);
    } else if (data !== null && typeof data === "object") {
      body = kvText(data as Record<string, unknown>, expanded);
    } else {
      body = data === undefined || data === null ? "(无数据)" : String(data);
    }
    return new Text(`${header}\n${body}`, 0, 0);
  });

  pi.registerCommand("zentao", {
    description: "直接执行 zentao CLI（不经过 LLM），结果以卡片展示。例：/zentao bug --product=26",
    handler: async (args, ctx) => {
      const argv = splitArgs(args.trim());
      if (argv.length === 0) {
        ctx.ui.notify("用法：/zentao <module> [args]，如 /zentao bug --product=26", "warning");
        return;
      }
      try {
        const data = await run(argv);
        pi.appendEntry("zentao-card", { argv, data });
      } catch (err) {
        ctx.ui.notify(hintOf(err), "error");
      }
    },
  });

  // /zentao-executions 卡片：产品详情 + 执行表格。
  pi.registerEntryRenderer("zentao-executions", (entry, { expanded }, theme) => {
    const { product, executions } = entry.data as {
      product: Record<string, unknown>;
      executions: Record<string, unknown>[];
    };
    const header = theme.fg("accent", `zentao executions --product=${cellText(product.id)}  ${cellText(product.name)}`);
    const cols = [
      { key: "id", label: "ID" },
      { key: "name", label: "名称" },
      { key: "status", label: "状态" },
      { key: "begin", label: "开始" },
      { key: "end", label: "结束" },
    ];
    const body = executions.length === 0
      ? "（该产品下没有执行）"
      : tableText(executions, cols, expanded ? 200 : 10);
    return new Text(`${header}\n${body}`, 0, 0);
  });

  pi.registerCommand("zentao-executions", {
    description: "查看产品下的所有执行：/zentao-executions <产品ID>",
    handler: async (args, ctx) => {
      const id = args.trim();
      if (!/^\d+$/.test(id)) {
        ctx.ui.notify("用法：/zentao-executions <产品ID>，如 /zentao-executions 26", "warning");
        return;
      }
      try {
        const [product, executions] = await Promise.all([
          run(["product", id]),
          run(["execution", `--product=${id}`, "--recPerPage=200"]),
        ]);
        pi.appendEntry("zentao-executions", {
          product: product as Record<string, unknown>,
          executions: Array.isArray(executions) ? (executions as Record<string, unknown>[]) : [],
        });
      } catch (err) {
        ctx.ui.notify(hintOf(err), "error");
      }
    },
  });

  pi.registerCommand("zentao-context", {
    description: "显示当前项目的禅道上下文（zentao.config.json 的解析结果）",
    handler: async (_args, ctx) => {
      const path = contextPath(ctx.cwd);
      const cfg = loadContext(ctx.cwd);
      const desc = describeContext(cfg);
      ctx.ui.notify(
        `配置文件：${path}\n上下文：${desc === "" ? "（未配置，list 操作需显式传范围参数）" : desc}`,
        "info",
      );
    },
  });

  pi.registerCommand("zentao-login", {
    description: "检查/执行禅道登录（凭证由 zentao CLI 管理，不进入对话）",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("当前模式不支持交互登录，请在终端执行 zentao login", "warning");
        return;
      }
      const cur = await currentProfile(run);
      if (cur !== null) {
        ctx.ui.notify(`已登录：${cur.account} @ ${cur.server}`, "info");
        return;
      }
      const server = await ctx.ui.input("禅道服务地址：", "http://");
      if (server === undefined || server.trim() === "") return;
      const account = await ctx.ui.input("账号：");
      if (account === undefined || account.trim() === "") return;
      const password = await ctx.ui.input("密码（本地输入，不会进入对话）：");
      if (password === undefined || password === "") return;
      try {
        await login(server.trim(), account.trim(), password);
        ctx.ui.notify(`登录成功：${account.trim()} @ ${server.trim()}`, "info");
        await refreshZentaoStatus(ctx, run);
      } catch (err) {
        ctx.ui.notify(hintOf(err), "error");
      }
    },
  });

  let overviewView: "me" | "project" | null = null;

  pi.registerCommand("zentao-overview", {
    description: "显示/切换/关闭禅道概览面板：/zentao-overview [me|project]",
    handler: async (args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("概览面板仅在 TUI 模式可用", "warning");
        return;
      }
      const arg = args.trim();
      if (arg !== "" && arg !== "me" && arg !== "project") {
        ctx.ui.notify("用法：/zentao-overview [me|project]", "warning");
        return;
      }
      const requested = (arg === "" ? (overviewView ?? "me") : arg) as "me" | "project";
      if (overviewView === requested) {
        overviewView = null;
        ctx.ui.setWidget("zentao-overview", undefined);
        return;
      }
      overviewView = requested;
      ctx.ui.setWidget("zentao-overview", [`禅道概览（${requested === "me" ? "我的待办" : "项目健康度"}）加载中…`], { placement: "belowEditor" });
      try {
        const data = await getOverview(requested, run, deps.cache);
        if (overviewView !== requested) return; // 加载期间已被切换/关闭
        ctx.ui.setWidget("zentao-overview", overviewLines(requested, data), { placement: "belowEditor" });
      } catch (err) {
        overviewView = null;
        ctx.ui.setWidget("zentao-overview", undefined);
        ctx.ui.notify(hintOf(err), "error");
      }
    },
  });
}

/** session_start 时的状态栏初始化（best-effort）。 */
export async function initStatus(ctx: ExtensionContext, run: RunFn): Promise<void> {
  if (ctx.mode !== "tui") return;
  await refreshZentaoStatus(ctx, run);
}
