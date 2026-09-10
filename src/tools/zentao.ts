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
import { hintOf, runZentao, type RunFn } from "../lib/cli.ts";
import { buildCliArgs, MODULES, type ZentaoArgs } from "../lib/schema.ts";
import { columnsFor, kvText, tableText } from "../ui.ts";

const DESCRIPTION = `Query or operate ZenTao (禅道) project data through the installed zentao CLI.

Usage: pick a module and an action:
- list: fetch rows (pass the module's scope param)
- get <id>: fetch one object
- create: pass fields (e.g. title, assignedTo, pri)
- update <id>: pass changed fields only (CLI backfills the rest)
- delete <id>
- status actions per module: bug -> activate/close/resolve; task -> activate/close/start/finish; story/epic/requirement -> activate/close/change

Scope params: story/bug/testcase -> product; epic/requirement/testtask/productplan/release/feedback/ticket/system -> product; execution/build -> project; task -> executionID.

Notes:
- bug resolve requires fields: resolution + assignedTo + resolvedBuild + comment (server-enforced).
- task start requires fields.realStarted; task finish requires currentConsumed + realStarted + finishedDate.
- Lists return up to 200 rows — filter client-side via the status / assignedTo fields in the JSON.
- Requires zentao CLI login done beforehand (user runs /zentao-login or zentao login; credentials are managed by the CLI).`;

export interface ZentaoDetails { module: string; action: string; data: unknown; count: number; }

export interface ZentaoToolResult {
  content: { type: "text"; text: string }[];
  details: ZentaoDetails;
}

/** 工具执行体（与 pi 注册解耦，便于单测）。 */
export async function executeZentao(args: ZentaoArgs, run: RunFn): Promise<ZentaoToolResult> {
  let data: unknown;
  try {
    data = await run(buildCliArgs(args));
  } catch (err) {
    throw new Error(hintOf(err));
  }
  const count = Array.isArray(data) ? data.length : data === undefined || data === null ? 0 : 1;
  const json = JSON.stringify(data, null, 2) ?? "null";
  const t = truncateHead(json, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
  const text = t.truncated
    ? `${t.content}\n\n[输出已截断：仅显示前 ${t.outputLines}/${t.totalLines} 行，请用更精确的范围参数缩小结果]`
    : t.content;
  return { content: [{ type: "text", text }], details: { module: args.module, action: args.action, data, count } };
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
      "Use the zentao tool with action=list and the module's scope param (bug/story/testcase -> product; task -> executionID; execution/build -> project).",
      "Use the zentao tool bug resolve with fields containing resolution + assignedTo + resolvedBuild + comment (all four required).",
    ],
    parameters: Type.Object({
      module: StringEnum(MODULES as unknown as string[]),
      action: StringEnum(ACTIONS as unknown as string[]),
      id: Type.Optional(Type.Number({ description: "对象 ID（get/update/delete/状态动作需要）" })),
      product: Type.Optional(Type.Number({ description: "产品 ID（story/bug/testcase 及 productID 系模块的列表范围参数，插件自动映射）" })),
      project: Type.Optional(Type.Number({ description: "项目 ID（execution/build 的列表范围参数）" })),
      executionID: Type.Optional(Type.Number({ description: "执行 ID（task 列表的范围参数）" })),
      fields: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: "create/update/状态动作的字段键值对" })),
    }),
    async execute(_toolCallId, params) {
      return executeZentao(params as ZentaoArgs, run);
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
