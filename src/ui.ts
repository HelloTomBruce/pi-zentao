/** TUI 渲染助手：表格、KV、概览面板行、状态栏。纯函数为主，便于单测。 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { currentProfile, type RunFn } from "./lib/cli.ts";
import { describeContext, loadContext } from "./lib/context.ts";
import type { MyItem, ProjectStat } from "./lib/overview.ts";

/** 显示宽度：码点 > 0xff 的字符（CJK 等）计 2 列。 */
export function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += (ch.codePointAt(0) ?? 0) > 0xff ? 2 : 1;
  return w;
}

function pad(s: string, width: number): string {
  const gap = width - displayWidth(s);
  return gap > 0 ? s + " ".repeat(gap) : s;
}

/** 单元格取值：对象归一化为 account/realname/name/id。 */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const pick = o.account ?? o.realname ?? o.name ?? o.id;
    return pick === undefined ? "" : String(pick);
  }
  return String(v);
}

export interface Column { key: string; label: string; }

const ID: Column = { key: "id", label: "ID" };
const STATUS: Column = { key: "status", label: "状态" };
const ASSIGNED: Column = { key: "assignedTo", label: "指派给" };

const COLUMNS: Record<string, Column[]> = {
  bug: [ID, { key: "title", label: "标题" }, { key: "severity", label: "严重" }, { key: "pri", label: "优先级" }, STATUS, ASSIGNED],
  story: [ID, { key: "title", label: "标题" }, { key: "pri", label: "优先级" }, STATUS, ASSIGNED],
  epic: [ID, { key: "title", label: "标题" }, { key: "pri", label: "优先级" }, STATUS, ASSIGNED],
  requirement: [ID, { key: "title", label: "标题" }, { key: "pri", label: "优先级" }, STATUS, ASSIGNED],
  task: [ID, { key: "name", label: "名称" }, { key: "pri", label: "优先级" }, STATUS, ASSIGNED],
  testcase: [ID, { key: "title", label: "标题" }, { key: "pri", label: "优先级" }, STATUS],
  user: [ID, { key: "account", label: "账号" }, { key: "realname", label: "姓名" }, { key: "role", label: "角色" }],
  feedback: [ID, { key: "title", label: "标题" }, STATUS, ASSIGNED],
  ticket: [ID, { key: "title", label: "标题" }, STATUS, ASSIGNED],
};

const NAME_MODULES = new Set(["program", "product", "project", "execution", "testtask", "productplan", "build", "release", "system"]);

/** 按模块取默认表格列；未知模块回退 id/name/status。 */
export function columnsFor(module: string): Column[] {
  const cols = COLUMNS[module];
  if (cols !== undefined) return cols;
  if (NAME_MODULES.has(module)) return [ID, { key: "name", label: "名称" }, STATUS];
  return [ID, { key: "name", label: "名称" }, { key: "title", label: "标题" }, STATUS];
}

/** 对齐表格文本；超过 maxRows 时追加总数提示。 */
export function tableText(rows: Record<string, unknown>[], columns: Column[], maxRows: number): string {
  if (rows.length === 0) return "（无数据）";
  const shown = rows.slice(0, maxRows);
  const widths = columns.map((c) =>
    Math.max(displayWidth(c.label), ...shown.map((r) => displayWidth(cellText(r[c.key])))),
  );
  const line = (cells: string[]): string =>
    cells.map((c, i) => pad(c, widths[i] ?? c.length)).join("  ").trimEnd();
  const out = [
    line(columns.map((c) => c.label)),
    ...shown.map((r) => line(columns.map((c) => cellText(r[c.key])))),
  ];
  if (rows.length > shown.length) out.push(`… 共 ${rows.length} 条（展开查看全部）`);
  return out.join("\n");
}

/** KV 渲染跳过的大字段。 */
const KV_SKIP = new Set(["files", "mailto", "children", "steps", "desc", "spec", "verify"]);

/** 详情对象 → KV 文本。expanded 时包含大字段（截断 300 字符）。 */
export function kvText(obj: Record<string, unknown>, expanded: boolean): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "object") continue;
    if (KV_SKIP.has(k) && !expanded) continue;
    const text = cellText(v);
    if (text === "") continue;
    lines.push(`${k}: ${text.length > 300 ? `${text.slice(0, 300)}…` : text}`);
    if (lines.length >= 40) { lines.push("…"); break; }
  }
  return lines.join("\n");
}

/** 概览面板行（widget 用）。 */
export function overviewLines(view: "me" | "project", data: MyItem[] | ProjectStat[]): string[] {
  if (view === "me") {
    const items = data as MyItem[];
    if (items.length === 0) return ["禅道 · 我的待办：🎉 没有待办事项"];
    const lines = items.slice(0, 12).map(
      (i) => `  [${i.kind === "bug" ? "Bug" : "任务"}] #${i.id} P${i.pri || "-"} ${i.title}（${i.scope}）`,
    );
    if (items.length > 12) lines.push(`  … 共 ${items.length} 项`);
    return ["禅道 · 我的待办", ...lines];
  }
  const stats = data as ProjectStat[];
  if (stats.length === 0) return ["禅道 · 项目健康度：无进行中的项目"];
  return [
    "禅道 · 项目健康度",
    ...stats.map((s) => `  ${s.name}：激活 ${s.bugActive} / 已解决 ${s.bugResolved} / 已关闭 ${s.bugClosed}`),
  ];
}

/** 刷新状态栏禅道账号显示（best-effort，永不抛出）。 */
export async function refreshZentaoStatus(ctx: ExtensionContext, run: RunFn): Promise<void> {
  if (!ctx.hasUI) return;
  const cur = await currentProfile(run);
  if (cur === null) {
    ctx.ui.setStatus("zentao", ctx.ui.theme.fg("dim", "禅道 未登录"));
    return;
  }
  const host = cur.server.replace(/^https?:\/\//, "");
  const contextSuffix = describeContext(loadContext(ctx.cwd));
  ctx.ui.setStatus("zentao", `禅道 ${cur.account}@${host}${contextSuffix === "" ? "" : ` · ${contextSuffix}`}`);
}
