/**
 * 跨模块聚合：我的待办（me）与项目健康度（project）。
 * 所有数据经 RunFn（即 runZentao）获取，串行调用、结果带 TTL 缓存。
 */

import { currentProfile, type RunFn } from "./cli.ts";

export interface MyItem { kind: "bug" | "task"; id: string; title: string; pri: string; status: string; scope: string; }
export interface ProjectStat { id: string; name: string; bugActive: number; bugResolved: number; bugClosed: number; }

type Row = Record<string, unknown>;

const rows = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : []);

/** assignedTo 归一化：字符串账号或 { account } 对象。 */
export function accountOf(v: unknown): string {
  if (typeof v === "string") return v;
  if (v !== null && typeof v === "object") {
    const acc = (v as Row).account;
    return typeof acc === "string" ? acc : "";
  }
  return "";
}

const str = (v: unknown): string => (v === undefined || v === null ? "" : String(v));

/** 未完成任务状态。 */
const TASK_OPEN = new Set(["wait", "doing", "pause"]);

/** 我的待办：激活 Bug + 未完成任务，按 pri 数值升序（1 最高，空排最后）。 */
export async function myOverview(run: RunFn, account: string): Promise<MyItem[]> {
  const items: MyItem[] = [];

  const products = rows(await run(["product", "--recPerPage=200"])).filter((p) => p.status === "normal");
  for (const p of products) {
    const bugs = rows(await run(["bug", `--product=${str(p.id)}`, "--recPerPage=200"]));
    for (const b of bugs) {
      if (b.status === "active" && accountOf(b.assignedTo) === account) {
        items.push({ kind: "bug", id: str(b.id), title: str(b.title), pri: str(b.pri), status: str(b.status), scope: str(p.name) });
      }
    }
  }

  const projects = rows(await run(["project", "--recPerPage=200"])).filter((p) => p.status === "doing");
  for (const proj of projects) {
    const execs = rows(await run(["execution", `--project=${str(proj.id)}`, "--recPerPage=200"]));
    for (const ex of execs.filter((e) => e.status === "wait" || e.status === "doing")) {
      const tasks = rows(await run(["task", `--executionID=${str(ex.id)}`, "--recPerPage=200"]));
      for (const t of tasks) {
        if (TASK_OPEN.has(str(t.status)) && accountOf(t.assignedTo) === account) {
          items.push({ kind: "task", id: str(t.id), title: str(t.name), pri: str(t.pri), status: str(t.status), scope: str(ex.name) });
        }
      }
    }
  }

  const priKey = (i: MyItem): number => (i.pri === "" ? 99 : Number(i.pri) || 99);
  return items.sort((a, b) => priKey(a) - priKey(b));
}

/** 项目健康度：进行中项目的 Bug 状态统计。 */
export async function projectOverview(run: RunFn): Promise<ProjectStat[]> {
  const projects = rows(await run(["project", "--recPerPage=200"])).filter((p) => p.status === "doing");
  const stats: ProjectStat[] = [];
  for (const proj of projects) {
    const bugs = rows(await run(["bug", `--project=${str(proj.id)}`, "--recPerPage=200"]));
    stats.push({
      id: str(proj.id),
      name: str(proj.name),
      bugActive: bugs.filter((b) => b.status === "active").length,
      bugResolved: bugs.filter((b) => b.status === "resolved").length,
      bugClosed: bugs.filter((b) => b.status === "closed").length,
    });
  }
  return stats;
}

/** 会话内 TTL 缓存。 */
export class OverviewCache {
  private store = new Map<string, { at: number; data: MyItem[] | ProjectStat[] }>();
  constructor(private readonly ttlMs: number) {}
  get(key: string): MyItem[] | ProjectStat[] | undefined {
    const hit = this.store.get(key);
    if (hit === undefined || Date.now() - hit.at > this.ttlMs) return undefined;
    return hit.data;
  }
  set(key: string, data: MyItem[] | ProjectStat[]): void {
    this.store.set(key, { at: Date.now(), data });
  }
  clear(): void {
    this.store.clear();
  }
}

/** 聚合入口：me 视图内部取当前账号（未登录抛引导错误）。 */
export async function getOverview(
  view: "me" | "project",
  run: RunFn,
  cache: OverviewCache,
): Promise<MyItem[] | ProjectStat[]> {
  const cached = cache.get(view);
  if (cached !== undefined) return cached;
  const data = view === "me"
    ? await (async () => {
        const profile = await currentProfile(run);
        if (profile === null) throw new Error("未登录禅道，请执行 /zentao-login");
        return myOverview(run, profile.account);
      })()
    : await projectOverview(run);
  cache.set(view, data);
  return data;
}
