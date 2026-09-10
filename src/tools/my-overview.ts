/** LLM 工具：zentao_my_overview —— 我的待办 / 项目健康度一键聚合。 */

import { type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { hintOf, runZentao, type RunFn } from "../lib/cli.ts";
import { getOverview, OverviewCache, type MyItem, type ProjectStat } from "../lib/overview.ts";
import { overviewLines } from "../ui.ts";

export interface OverviewDetails { view: "me" | "project"; data: MyItem[] | ProjectStat[]; count: number; }

export interface OverviewToolResult {
  content: { type: "text"; text: string }[];
  details: OverviewDetails;
}

/** 工具执行体（与 pi 注册解耦，便于单测）。 */
export async function executeMyOverview(
  view: "me" | "project",
  run: RunFn,
  cache: OverviewCache,
): Promise<OverviewToolResult> {
  let data: MyItem[] | ProjectStat[];
  try {
    data = await getOverview(view, run, cache);
  } catch (err) {
    throw new Error(hintOf(err));
  }
  return {
    content: [{ type: "text", text: JSON.stringify({ view, data }, null, 2) }],
    details: { view, data, count: data.length },
  };
}

export function registerMyOverviewTool(pi: ExtensionAPI, run: RunFn = (a) => runZentao(a), cache: OverviewCache): void {
  pi.registerTool({
    name: "zentao_my_overview",
    label: "ZenTao 我的概览",
    description:
      "Get the current ZenTao user's overview in one call: view=me returns my active bugs and unfinished tasks sorted by priority; view=project returns per-project bug statistics (active/resolved/closed) for ongoing projects. Results are cached for 5 minutes.",
    promptSnippet: "Show the current user's ZenTao todos (my bugs/tasks) or project bug statistics",
    promptGuidelines: [
      "Use zentao_my_overview when the user asks what they should work on today, their open bugs/tasks, or overall project health in 禅道.",
    ],
    parameters: Type.Object({
      view: Type.Optional(StringEnum(["me", "project"] as unknown as string[])),
    }),
    async execute(_toolCallId, params) {
      const p = params as { view?: "me" | "project" };
      return executeMyOverview(p.view ?? "me", run, cache);
    },
    renderCall(_args, theme) {
      return new Text(theme.fg("toolTitle", theme.bold("zentao_my_overview")), 0, 0);
    },
    renderResult(result, { isPartial }, theme) {
      const text = new Text("", 0, 0);
      if (isPartial) {
        text.setText(theme.fg("warning", "聚合禅道数据中…"));
        return text;
      }
      const d = result.details as OverviewDetails | undefined;
      if (d === undefined) return text;
      text.setText(overviewLines(d.view, d.data).join("\n"));
      return text;
    },
  });
}
