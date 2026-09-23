/** LLM 工具：zentao —— 通用薄代理（module/action → CLI → JSON）。 */

import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  truncateHead,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { hintOf, runList, runZentao, type RunFn } from "../lib/cli.ts";
import { loadContext, type ZentaoContext } from "../lib/context.ts";
import { applyContextDefaults, buildCliArgs, LIST_PAGE_SIZE, MODULES, type ZentaoArgs } from "../lib/schema.ts";
import { columnsFor, kvText, tableText } from "../ui.ts";

const DESCRIPTION = `Query or operate ZenTao (禅道) project data through the installed zentao CLI.

Usage: pick a module and an action:
- list: fetch rows (pass the module's scope param)
- get <id>: fetch one object
- create: pass fields (e.g. title, assignedTo, pri)
- update <id>: pass changed fields only (CLI backfills the rest)
- delete <id>
- status actions per module: bug -> activate/close/resolve; task -> activate/close/start/finish; story/epic/requirement -> activate/close/change

Scope params: story/bug/testcase -> product; epic/requirement/testtask/productplan/release/feedback/ticket/system -> product; execution -> product (preferred) or project; build -> project; task -> executionID.

Notes:
- bug resolve requires fields: resolution + assignedTo + resolvedBuild + comment (server-enforced).
- task start requires fields.realStarted; task finish requires currentConsumed + realStarted + finishedDate.
- Lists are capped at 1000 rows per query (server page limit); prefer pick/filter/sort/limit above over fetching everything.
- list supports local processing: pick (field selection), filter (e.g. "status=active,pri<=2"; multiple filters = OR), sort ("pri:asc"), search + searchFields, limit. Prefer them over fetching everything — results shrink a lot.
- New in CLI 0.3: issue/risk/meeting lists take project (=projectX op) or executionID (=executionX op), or no scope for a global list; todo supports create/update/delete only.
- Nested writes (arrays, long HTML text): pass data as a JSON string instead of flat fields.
- Version note: if the server is too old for an operation, the CLI fails with code 2010 and a clear message (e.g. my/* requires ZenTao 22.5+).
- Requires zentao CLI login done beforehand (user runs /zentao-login or zentao login; credentials are managed by the CLI).
- If the project root has zentao.config.json ({"product":N,"project":N,"execution":N}), list scope params fall back to it — you may omit product/project/executionID when the context makes them unambiguous.`;

export interface ZentaoDetails { module: string; action: string; data: unknown; count: number; truncated?: boolean; }

export interface ZentaoToolResult {
  content: { type: "text"; text: string }[];
  details: ZentaoDetails;
}

/** 工具执行体（与 pi 注册解耦，便于单测）。
 *  context 为项目级上下文（zentao.config.json），作为 list 范围参数默认值。 */
export async function executeZentao(args: ZentaoArgs, run: RunFn, context: ZentaoContext = {}): Promise<ZentaoToolResult> {
  const argv = buildCliArgs(applyContextDefaults(args, context));
  let data: unknown;
  try {
    // list 走 runList：坏节点（负载均衡后约 50%）返回空/伪造单条，重试取最大
    data = args.action === "list" ? await runList(run, argv) : await run(argv);
  } catch (err) {
    throw new Error(hintOf(err));
  }
  // list 返回条数恰等于页大小上限 → 可能截断（服务器分页偶数页有 bug，不做自动翻页）
  const truncated = args.action === "list" && Array.isArray(data) && data.length >= LIST_PAGE_SIZE;
  const count = Array.isArray(data) ? data.length : data === undefined || data === null ? 0 : 1;
  const json = JSON.stringify(data, null, 2) ?? "null";
  const t = truncateHead(json, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
  const note = truncated
    ? `\n\n[结果可能不完整：列表超过 ${LIST_PAGE_SIZE} 条，仅返回前 ${LIST_PAGE_SIZE} 条——建议缩小范围（按状态/关键词），或按 ID 直达查询]`
    : "";
  const text = (t.truncated
    ? `${t.content}\n\n[输出已截断：仅显示前 ${t.outputLines}/${t.totalLines} 行，请用更精确的范围参数缩小结果]`
    : t.content) + note;
  return { content: [{ type: "text", text }], details: { module: args.module, action: args.action, data, count, truncated: truncated || undefined } };
}

const ACTIONS = ["list", "get", "create", "update", "delete", "activate", "close", "resolve", "start", "finish", "change"] as const;

export function registerZentaoTool(pi: ExtensionAPI, run: RunFn = (a) => runZentao(a)): void {
  pi.registerTool({
    name: "zentao",
    label: "ZenTao",
    description: DESCRIPTION,
    promptSnippet: "Query or operate ZenTao (禅道) data: bug/story/task/project lists, details, creates, updates, status transitions",
    promptGuidelines: [
      "Use the zentao tool when the user asks about 禅道 data (bugs, stories, tasks, projects, executions, testcases) instead of asking them to paste lists.",
      "Use the zentao tool with action=list and the module's scope param (bug/story/testcase -> product; task -> executionID; execution -> product or project, product preferred; build -> project).",
      "Use the zentao tool bug resolve with fields containing resolution + assignedTo + resolvedBuild + comment (all four required).",
      "Prefer pick/filter/sort/limit on list actions to keep outputs small; use data (JSON) for nested write payloads.",
    ],
    parameters: Type.Object({
      // SAFETY: StringEnum 需要 string[]，MODULES/ACTIONS 是 readonly string[]，运行时值不变，仅类型收窄
      module: StringEnum(MODULES as unknown as string[]),
      // SAFETY: 同上（StringEnum 需要 string[]，ACTIONS 是 readonly string[]）
      action: StringEnum(ACTIONS as unknown as string[]),
      id: Type.Optional(Type.Number({ description: "对象 ID（get/update/delete/状态动作需要）" })),
      product: Type.Optional(Type.Number({ description: "产品 ID（story/bug/testcase、productID 系模块的列表范围参数；execution 列表亦可用，优先于 project）" })),
      project: Type.Optional(Type.Number({ description: "项目 ID（execution/build 的列表范围参数；execution 列表中 product 优先）" })),
      executionID: Type.Optional(Type.Number({ description: "执行 ID（task 列表的范围参数）" })),
      fields: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: "create/update/状态动作的字段键值对" })),
      pick: Type.Optional(Type.String({ description: "逗号分隔字段，只返回这些字段（list/get），可大幅减少输出" })),
      filter: Type.Optional(Type.Array(Type.String(), { description: '过滤表达式（如 "status=active,pri<=2"，元素内逗号=AND，多个元素=OR）；仅 list' })),
      sort: Type.Optional(Type.String({ description: "排序，如 pri:asc,severity:asc；仅 list" })),
      search: Type.Optional(Type.String({ description: "搜索关键词；仅 list" })),
      searchFields: Type.Optional(Type.String({ description: "搜索字段（逗号分隔），配合 search；仅 list" })),
      limit: Type.Optional(Type.Number({ description: "只返回前 N 条；仅 list" })),
      data: Type.Optional(Type.String({ description: "JSON 请求体（create/update/状态流转），用于嵌套对象/数组/长文本；与 fields 冲突时以 data 为准" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return executeZentao(params as ZentaoArgs, run, loadContext(ctx.cwd));
    },
    renderCall(args, theme) {
      const a = args as { module?: string; action?: string; id?: number };
      return new Text(
        theme.fg("toolTitle", theme.bold("zentao ")) +
          theme.fg("muted", `${a.module ?? ""} ${a.action ?? ""}${a.id !== undefined ? ` #${a.id}` : ""}`),
        0,
        0,
      );
    },
    renderResult(result, { expanded, isPartial }, theme) {
      const text = new Text("", 0, 0);
      if (isPartial) {
        text.setText(theme.fg("warning", "查询禅道中…"));
        return text;
      }
      const d = result.details as ZentaoDetails | undefined;
      if (d === undefined) return text;
      if (Array.isArray(d.data)) {
        text.setText(tableText(d.data as Record<string, unknown>[], columnsFor(d.module), expanded ? 200 : 10));
      } else if (d.data !== null && typeof d.data === "object") {
        text.setText(kvText(d.data as Record<string, unknown>, expanded));
      } else {
        text.setText(theme.fg("success", `✓ zentao ${d.module} ${d.action}`));
      }
      return text;
    },
  });
}
