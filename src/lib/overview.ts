/**
 * 跨模块聚合：我的待办（me）与项目健康度（project）。
 * 所有数据经 RunFn（即 runZentao）获取，串行调用、结果带 TTL 缓存。
 * 传入项目上下文时，me 视图只查配置的 product/execution。
 */

import { currentProfile, isVersionUnsupported, runList, type RunFn } from "./cli.ts";
import type { ZentaoContext } from "./context.ts";
import { LIST_PAGE_SIZE } from "./schema.ts";

export interface MyItem { kind: "bug" | "task" | "todo"; id: string; title: string; pri: string; status: string; scope: string; }
export interface ProjectStat { id: string; name: string; bugActive: number; bugResolved: number; bugClosed: number; }

/** 聚合结果：items + truncated（任一来源列表达到页大小上限，结果可能不完整）。 */
export interface OverviewData {
  items: MyItem[] | ProjectStat[];
  truncated: boolean;
}

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

/** 禅道待办开放状态：done 视为已完成，其余（wait/doing 等）均为待办。 */
const TODO_OPEN = (s: string): boolean => s !== "done";

/** my 快路径：zentao my bugs/tasks/todos 各一次调用（要求服务器 22.5+）。
 *  bugs/tasks 报 2010 → 返回 null（调用方回退扫描）；todos 报 2010 → 跳过待办。 */
async function myOverviewFast(run: RunFn): Promise<OverviewData | null> {
  let bugs: Row[];
  let tasks: Row[];
  try {
    bugs = rows(await runList(run, ["my", "bugs", `--recPerPage=${LIST_PAGE_SIZE}`]));
    tasks = rows(await runList(run, ["my", "tasks", `--recPerPage=${LIST_PAGE_SIZE}`]));
  } catch (err) {
    if (isVersionUnsupported(err)) return null;
    throw err;
  }
  let todos: Row[] = [];
  try {
    todos = rows(await run(["my", "todos", `--recPerPage=${LIST_PAGE_SIZE}`]));
  } catch (err) {
    if (!isVersionUnsupported(err)) throw err;
  }
  const items: MyItem[] = [
    ...bugs.filter((b) => b.status === "active").map((b) => ({
      kind: "bug" as const, id: str(b.id), title: str(b.title), pri: str(b.pri), status: str(b.status), scope: `#${str(b.product)}`,
    })),
    ...tasks.filter((t) => TASK_OPEN.has(str(t.status))).map((t) => ({
      kind: "task" as const, id: str(t.id), title: str(t.name), pri: str(t.pri), status: str(t.status), scope: `#${str(t.execution)}`,
    })),
    ...todos.filter((t) => TODO_OPEN(str(t.status))).map((t) => ({
      kind: "todo" as const, id: str(t.id), title: str(t.name), pri: "", status: str(t.status), scope: str(t.date),
    })),
  ];
  const truncated = [bugs, tasks, todos].some((l) => l.length >= LIST_PAGE_SIZE);
  return { items: sortByPri(items), truncated };
}

function sortByPri(items: MyItem[]): MyItem[] {
  const priKey = (i: MyItem): number => (i.pri === "" ? 99 : Number(i.pri) || 99);
  return items.sort((a, b) => priKey(a) - priKey(b));
}

/** 对象名称查询（product/execution 详情），失败或无名称回退 #id。 */
async function scopeName(run: RunFn, args: string[], fallback: string): Promise<string> {
  try {
    const res = (await run(args)) as Row | undefined;
    const name = res?.name;
    return typeof name === "string" && name !== "" ? name : fallback;
  } catch {
    return fallback;
  }
}

/** 配置了产品/执行时：只查这两处（各一次列表调用），不扫描全部产品/项目。 */
async function myOverviewScoped(run: RunFn, account: string, context: ZentaoContext): Promise<OverviewData> {
  const items: MyItem[] = [];
  let truncated = false;
  if (context.product !== undefined) {
    const scope = await scopeName(run, ["product", String(context.product)], `#${context.product}`);
    const bugs = rows(await runList(run, ["bug", `--product=${context.product}`, `--recPerPage=${LIST_PAGE_SIZE}`]));
    truncated ||= bugs.length >= LIST_PAGE_SIZE;
    for (const b of bugs) {
      if (b.status === "active" && accountOf(b.assignedTo) === account) {
        items.push({ kind: "bug", id: str(b.id), title: str(b.title), pri: str(b.pri), status: str(b.status), scope });
      }
    }
  }
  if (context.execution !== undefined) {
    const scope = await scopeName(run, ["execution", String(context.execution)], `#${context.execution}`);
    // --sort=id:desc：最新任务在前（截断只影响最老数据）；原生替代旧 --params orderBy hack
    const tasks = rows(await runList(run, [
      "task", `--executionID=${context.execution}`, `--recPerPage=${LIST_PAGE_SIZE}`, "--sort=id:desc",
    ]));
    truncated ||= tasks.length >= LIST_PAGE_SIZE;
    for (const t of tasks) {
      if (TASK_OPEN.has(str(t.status)) && accountOf(t.assignedTo) === account) {
        items.push({ kind: "task", id: str(t.id), title: str(t.name), pri: str(t.pri), status: str(t.status), scope });
      }
    }
  }
  return { items: sortByPri(items), truncated };
}

/** 我的待办：激活 Bug + 未完成任务，按 pri 数值升序（1 最高，空排最后）。
 *  传入项目上下文时只查配置的 product/execution。 */
export async function myOverview(run: RunFn, account: string, context?: ZentaoContext): Promise<OverviewData> {
  // 有项目上下文时只查配置的 product/execution（各一次 bug/task 列表调用），
  // 不扫全量、也不走 my 快路径（快路径不含上下文过滤，会丢失 scoped 过滤）。
  if (context !== undefined && (context.product !== undefined || context.execution !== undefined)) {
    return myOverviewScoped(run, account, context);
  }
  // 无项目上下文：优先 my 快路径（22.5+）一次调用取回 bug/task/todo；
  // my 不可用（2010）时回退下方全量扫描（22.0 及以下服务器）。
  const fast = await myOverviewFast(run);
  if (fast !== null) return fast;
  const items: MyItem[] = [];
  let truncated = false;

  const products = rows(await runList(run, ["product", `--recPerPage=${LIST_PAGE_SIZE}`])).filter((p) => p.status === "normal");
  truncated ||= products.length >= LIST_PAGE_SIZE;
  for (const p of products) {
    const bugs = rows(await runList(run, ["bug", `--product=${str(p.id)}`, `--recPerPage=${LIST_PAGE_SIZE}`]));
    truncated ||= bugs.length >= LIST_PAGE_SIZE;
    for (const b of bugs) {
      if (b.status === "active" && accountOf(b.assignedTo) === account) {
        items.push({ kind: "bug", id: str(b.id), title: str(b.title), pri: str(b.pri), status: str(b.status), scope: str(p.name) });
      }
    }
  }

  const projects = rows(await runList(run, ["project", `--recPerPage=${LIST_PAGE_SIZE}`])).filter((p) => p.status === "doing");
  truncated ||= projects.length >= LIST_PAGE_SIZE;
  for (const proj of projects) {
    const execs = rows(await runList(run, ["execution", `--project=${str(proj.id)}`, `--recPerPage=${LIST_PAGE_SIZE}`]));
    truncated ||= execs.length >= LIST_PAGE_SIZE;
    for (const ex of execs.filter((e) => e.status === "wait" || e.status === "doing")) {
      const tasks = rows(await runList(run, ["task", `--executionID=${str(ex.id)}`, `--recPerPage=${LIST_PAGE_SIZE}`]));
      truncated ||= tasks.length >= LIST_PAGE_SIZE;
      for (const t of tasks) {
        if (TASK_OPEN.has(str(t.status)) && accountOf(t.assignedTo) === account) {
          items.push({ kind: "task", id: str(t.id), title: str(t.name), pri: str(t.pri), status: str(t.status), scope: str(ex.name) });
        }
      }
    }
  }

  return { items: sortByPri(items), truncated };
}

/** 项目健康度：进行中项目的 Bug 状态统计。 */
export async function projectOverview(run: RunFn): Promise<OverviewData> {
  const projects = rows(await runList(run, ["project", `--recPerPage=${LIST_PAGE_SIZE}`])).filter((p) => p.status === "doing");
  let truncated = projects.length >= LIST_PAGE_SIZE;
  const stats: ProjectStat[] = [];
  for (const proj of projects) {
    const bugs = rows(await runList(run, ["bug", `--project=${str(proj.id)}`, `--recPerPage=${LIST_PAGE_SIZE}`]));
    truncated ||= bugs.length >= LIST_PAGE_SIZE;
    stats.push({
      id: str(proj.id),
      name: str(proj.name),
      bugActive: bugs.filter((b) => b.status === "active").length,
      bugResolved: bugs.filter((b) => b.status === "resolved").length,
      bugClosed: bugs.filter((b) => b.status === "closed").length,
    });
  }
  return { items: stats, truncated };
}

/** 会话内 TTL 缓存。 */
export class OverviewCache {
  private store = new Map<string, { at: number; data: OverviewData }>();
  constructor(private readonly ttlMs: number) {}
  get(key: string): OverviewData | undefined {
    const hit = this.store.get(key);
    if (hit === undefined || Date.now() - hit.at > this.ttlMs) return undefined;
    return hit.data;
  }
  set(key: string, data: OverviewData): void {
    this.store.set(key, { at: Date.now(), data });
  }
  clear(): void {
    this.store.clear();
  }
}

/** 聚合入口：me 视图内部取当前账号（未登录抛引导错误）。
 *  me 视图按项目上下文收窄（有配置时只查配置的 product/execution）。
 *  truncated=true 表示某个来源列表达到页大小上限，结果可能不完整。 */
export async function getOverview(
  view: "me" | "project",
  run: RunFn,
  cache: OverviewCache,
  context?: ZentaoContext,
): Promise<OverviewData> {
  const cacheKey = view === "me"
    ? `me:${context?.product ?? ""}:${context?.project ?? ""}:${context?.execution ?? ""}`
    : view;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;
  const data = view === "me"
    ? await (async () => {
        const profile = await currentProfile(run);
        if (profile === null) throw new Error("未登录禅道，请执行 /zentao-login");
        return myOverview(run, profile.account, context);
      })()
    : await projectOverview(run);
  cache.set(cacheKey, data);
  return data;
}
