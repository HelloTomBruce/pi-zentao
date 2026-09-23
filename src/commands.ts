/** 斜杠命令：/zentao（CLI 透传卡片）、/zentao-executions、语义化查看命令、
 *  /zentao-login、/zentao-overview（widget 面板）。 */

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

/** 查看命令的合法透传标志（新 CLI 本地处理能力）。 */
const VIEW_FLAG_RE = /^--(filter|sort|pick|limit)=/;

/** 解析"查看类"命令参数：至多一个数字 ID + 若干 --filter/--sort/--pick/--limit 标志。
 *  非法输入返回 null（调用方提示用法）。 */
export function splitViewArgs(raw: string): { id: string | undefined; flags: string[] } | null {
  let id: string | undefined;
  const flags: string[] = [];
  for (const a of splitArgs(raw.trim())) {
    if (VIEW_FLAG_RE.test(a)) { flags.push(a); continue; }
    if (id === undefined && isValidId(a)) { id = a; continue; }
    return null;
  }
  return { id, flags };
}

/** issue/risk/meeting：带项目 ID 走 projectX 操作，否则全局列表。 */
export function buildScopedModuleArgs(module: "issue" | "risk" | "meeting", id: string | undefined): string[] {
  const op = { issue: "projectIssues", risk: "projectRisks", meeting: "projectMeetings" }[module];
  return id === undefined
    ? [module, "--recPerPage=200"]
    : [module, op, `--projectID=${id}`, "--recPerPage=200"];
}

/** 我的禅道待办（要求服务器 22.5+，版本不足由 hintOf 提示）。 */
export function buildMyTodosArgs(): string[] {
  return ["my", "todos", "--recPerPage=200"];
}

/** 产品文档：先取文档库列表，再逐个库取文档（productDocs 必填 libID）。 */
export function buildProductDocsArgs(id: string): { libs: string[]; docs: (libId: string) => string[] } {
  return {
    libs: ["doc", "productLibs", `--productID=${id}`, "--recPerPage=200"],
    docs: (libId) => ["doc", "productDocs", `--productID=${id}`, `--libID=${libId}`, "--recPerPage=200"],
  };
}

/** 执行/项目子列表通用列。 */
const EXEC_COLS = [
  { key: "id", label: "ID" },
  { key: "name", label: "名称" },
  { key: "status", label: "状态" },
  { key: "begin", label: "开始" },
  { key: "end", label: "结束" },
];

/** 任务子列表列。 */
const TASK_COLS = [
  { key: "id", label: "ID" },
  { key: "name", label: "名称" },
  { key: "pri", label: "优先级" },
  { key: "status", label: "状态" },
  { key: "assignedTo", label: "指派给" },
];


/** 判断是否为合法数字 ID。 */
export function isValidId(s: string): boolean {
  return /^\d+$/.test(s);
}

/** 列表命令的 CLI 参数（复用 zentao-card 渲染）。 */
export function buildListArgs(module: string, pageSize = 200): string[] {
  return [module, `--recPerPage=${pageSize}`];
}

/** 单对象详情命令的 CLI 参数。 */
export function buildGetArgs(module: string, id: string): string[] {
  return [module, id];
}

/** 项目详情 + 下辖执行的并行查询参数。
 *  注意：禅道 API 无 project get-by-id（get project <id> → 2005），
 *  只能 project --search=<id> 后客户端精确匹配——workaround 必须保留。 */
export function buildProjectDetailArgs(id: string): { detail: string[]; children: string[] } {
  return {
    detail: ["project", "--search", id, "--recPerPage=200"],
    children: ["execution", `--project=${id}`, "--recPerPage=200"],
  };
}

/** 执行详情 + 下辖任务的并行查询参数。 */
export function buildExecutionDetailArgs(id: string): { detail: string[]; children: string[] } {
  return {
    detail: ["execution", id],
    children: ["task", `--executionID=${id}`, "--recPerPage=200"],
  };
}

/** zentao-executions（产品→执行）的并行查询参数。 */
export function buildProductExecutionsArgs(id: string): { product: string[]; executions: string[] } {
  return {
    product: ["product", id],
    executions: ["execution", `--product=${id}`, "--recPerPage=200"],
  };
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
    return new Text(`${header}
${body}`, 0, 0);
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
    const body = executions.length === 0
      ? "（该产品下没有执行）"
      : tableText(executions, EXEC_COLS, expanded ? 200 : 10);
    return new Text(`${header}
${body}`, 0, 0);
  });

  pi.registerCommand("zentao-executions", {
    description: "查看产品下的所有执行：/zentao-executions <产品ID>",
    handler: async (args, ctx) => {
      const id = args.trim();
      if (!isValidId(id)) {
        ctx.ui.notify("用法：/zentao-executions <产品ID>，如 /zentao-executions 26", "warning");
        return;
      }
      try {
        const { product: productArgs, executions: execArgs } = buildProductExecutionsArgs(id);
        const [product, executions] = await Promise.all([
          run(productArgs),
          run(execArgs),
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

  // /zentao-todos：我的禅道待办（my 模块，22.5+；版本不足友好提示）
  pi.registerCommand("zentao-todos", {
    description: "查看我的禅道待办（要求禅道 22.5+）：/zentao-todos",
    handler: async (_args, ctx) => {
      try {
        const data = await run(buildMyTodosArgs());
        pi.appendEntry("zentao-card", { argv: ["my", "todos"], data });
      } catch (err) {
        ctx.ui.notify(hintOf(err), "error");
      }
    },
  });

  // /zentao-docs <产品ID>：产品下所有文档库中的文档
  pi.registerCommand("zentao-docs", {
    description: "查看产品下所有文档：/zentao-docs <产品ID>",
    handler: async (args, ctx) => {
      const id = args.trim();
      if (!isValidId(id)) {
        ctx.ui.notify("用法：/zentao-docs <产品ID>，如 /zentao-docs 26", "warning");
        return;
      }
      try {
        const { libs, docs } = buildProductDocsArgs(id);
        const libsData = await run(libs);
        const libList = Array.isArray(libsData) ? (libsData as Record<string, unknown>[]) : [];
        if (libList.length === 0) {
          ctx.ui.notify("该产品下没有文档库", "info");
          return;
        }
        const all: Record<string, unknown>[] = [];
        for (const lib of libList) {
          const d = await run(docs(String(lib.id)));
          if (Array.isArray(d)) all.push(...(d as Record<string, unknown>[]));
        }
        pi.appendEntry("zentao-card", { argv: ["doc", "productDocs", `--productID=${id}`], data: all });
      } catch (err) {
        ctx.ui.notify(hintOf(err), "error");
      }
    },
  });

  // issue/risk/meeting 三件套：带项目 ID 走 projectX，无参走全局列表
  const scopedDefs: { cmd: string; module: "issue" | "risk" | "meeting"; label: string }[] = [
    { cmd: "zentao-issues", module: "issue", label: "问题" },
    { cmd: "zentao-risks", module: "risk", label: "风险" },
    { cmd: "zentao-meetings", module: "meeting", label: "会议" },
  ];
  for (const def of scopedDefs) {
    pi.registerCommand(def.cmd, {
      description: `查看${def.label}列表（可选按项目过滤）：/${def.cmd} [项目ID]`,
      handler: async (args, ctx) => {
        const parsed = splitViewArgs(args);
        if (parsed === null || (parsed.id === undefined && parsed.flags.length > 0)) {
          ctx.ui.notify(`用法：/${def.cmd} [项目ID]，如 /${def.cmd} 167`, "warning");
          return;
        }
        try {
          const data = await run([...buildScopedModuleArgs(def.module, parsed.id), ...parsed.flags]);
          pi.appendEntry("zentao-card", { argv: [def.module], data });
        } catch (err) {
          ctx.ui.notify(hintOf(err), "error");
        }
      },
    });
  }

  // ─── 语义化查看命令 ─────────────────────────────────────

  // 列表命令（复用 zentao-card 渲染）
  const registerListCommand = (name: string, description: string, module: string, pageSize = 200) => {
    pi.registerCommand(name, {
      description,
      handler: async (args, ctx) => {
        const parsed = splitViewArgs(args);
        if (parsed === null) {
          ctx.ui.notify(`用法：/${name} [--filter=…] [--sort=…] [--pick=…] [--limit=N]`, "warning");
          return;
        }
        try {
          const data = await run([...buildListArgs(module, pageSize), ...parsed.flags]);
          pi.appendEntry("zentao-card", { argv: [module], data });
        } catch (err) {
          ctx.ui.notify(hintOf(err), "error");
        }
      },
    });
  };

  // 单对象详情命令（复用 zentao-card 渲染）
  const registerGetCommand = (name: string, description: string, module: string) => {
    pi.registerCommand(name, {
      description,
      handler: async (args, ctx) => {
        const parsed = splitViewArgs(args);
        if (parsed?.id === undefined) {
          ctx.ui.notify(`用法：/${name} <${module}ID> [--pick=字段1,字段2]，如 /${name} 42`, "warning");
          return;
        }
        try {
          const data = await run([...buildGetArgs(module, parsed.id), ...parsed.flags]);
          pi.appendEntry("zentao-card", { argv: [module, parsed.id], data });
        } catch (err) {
          ctx.ui.notify(hintOf(err), "error");
        }
      },
    });
  };

  // "主详情 KV + 子列表" 组合渲染器
  const registerDetailRenderer = (
    name: string,
    label: string,
    childLabel: string,
    childCols: { key: string; label: string }[],
  ) => {
    pi.registerEntryRenderer(name, (entry, { expanded }, theme) => {
      const data = entry.data as {
        detail: Record<string, unknown>;
        children: Record<string, unknown>[];
        productHint?: string;
      };
      const suffix = data.productHint ? `（${data.productHint}）` : "";
      const header = theme.fg("accent", `zentao ${label} ${cellText(data.detail.id)}  ${cellText(data.detail.name)}${suffix}`);
      const kv = kvText(data.detail, expanded);
      const childBody = data.children.length === 0
        ? `（该${label}下没有${childLabel}）`
        : tableText(data.children, childCols, expanded ? 200 : 10);
      return new Text(`${header}
${kv}

${childLabel}（${data.children.length} 个）：
${childBody}`, 0, 0);
    });
  };

  // 列表：产品 / 项目
  registerListCommand("zentao-products", "查看所有产品列表", "product");
  registerListCommand("zentao-projects", "查看所有项目列表", "project");

  // 详情：任务 / Bug / 需求
  registerGetCommand("zentao-task", "查看任务详情：/zentao-task <任务ID>", "task");
  registerGetCommand("zentao-bug", "查看 Bug 详情：/zentao-bug <BugID>", "bug");
  registerGetCommand("zentao-story", "查看需求详情：/zentao-story <需求ID>", "story");

  // 项目详情 + 下辖执行
  registerDetailRenderer("zentao-project-detail", "project", "执行", EXEC_COLS);
  pi.registerCommand("zentao-project", {
    description: "查看项目详情及下辖执行：/zentao-project <项目ID>",
    handler: async (args, ctx) => {
      const id = args.trim();
      if (!isValidId(id)) {
        ctx.ui.notify("用法：/zentao-project <项目ID>，如 /zentao-project 167", "warning");
        return;
      }
      try {
        const { detail: detailArgs, children: childrenArgs } = buildProjectDetailArgs(id);
        const [projectResults, executions] = await Promise.all([
          run(detailArgs),
          run(childrenArgs),
        ]);
        // project get 不走单对象查询（CLI 不支持 project <id>），
        // 改用列表搜索并从结果中精确匹配 ID
        const projList = Array.isArray(projectResults) ? (projectResults as Record<string, unknown>[]) : [];
        const project = projList.find((p) => String(p.id) === id) ?? projList[0] ?? {};
        pi.appendEntry("zentao-project-detail", {
          detail: project as Record<string, unknown>,
          children: Array.isArray(executions) ? (executions as Record<string, unknown>[]) : [],
        });
      } catch (err) {
        ctx.ui.notify(hintOf(err), "error");
      }
    },
  });

  // 执行详情 + 下辖任务
  registerDetailRenderer("zentao-execution-detail", "execution", "任务", TASK_COLS);
  pi.registerCommand("zentao-execution", {
    description: "查看执行详情及下辖任务：/zentao-execution <执行ID>",
    handler: async (args, ctx) => {
      const id = args.trim();
      if (!isValidId(id)) {
        ctx.ui.notify("用法：/zentao-execution <执行ID>，如 /zentao-execution 168", "warning");
        return;
      }
      try {
        const { detail: detailArgs, children: childrenArgs } = buildExecutionDetailArgs(id);
        const [execution, tasks] = await Promise.all([
          run(detailArgs),
          run(childrenArgs),
        ]);
        // 获取所属产品名（best-effort）
        let productHint: string | undefined;
        const execObj = execution as Record<string, unknown> | undefined;
        if (execObj?.product) {
          try {
            const prod = await run(["product", String(execObj.product)]) as Record<string, unknown>;
            if (prod?.name) productHint = String(prod.name);
          } catch { /* best-effort */ }
        }
        pi.appendEntry("zentao-execution-detail", {
          detail: execution as Record<string, unknown>,
          children: Array.isArray(tasks) ? (tasks as Record<string, unknown>[]) : [],
          productHint,
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
        `配置文件：${path}
上下文：${desc === "" ? "（未配置，list 操作需显式传范围参数）" : desc}`,
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
        const overview = await getOverview(requested, run, deps.cache, loadContext(ctx.cwd));
        if (overviewView !== requested) return;
        const lines = overviewLines(requested, overview.items);
        if (overview.truncated) lines.push(`⚠ 结果可能不完整：某个列表超过 1000 条被截断`);
        ctx.ui.setWidget("zentao-overview", lines, { placement: "belowEditor" });
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
