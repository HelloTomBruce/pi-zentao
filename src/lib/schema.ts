/**
 * zentao 工具的模块/动作白名单与 CLI 参数构造。列表用最大页
 * --recPerPage=1000 拉取（实测 1000 为禅道支持的最大合法页大小，
 * 500/2000 等值会触发服务器异常响应），程序侧再按需过滤。
 * 服务器分页偶数页返回伪造数据（已知 bug），不做自动翻页。
 */

export const LIST_PAGE_SIZE = 1000;

import type { ZentaoContext } from "./context.ts";

export type ZentaoModule =
  | "program" | "product" | "project" | "execution"
  | "story" | "epic" | "requirement"
  | "bug" | "task" | "testcase" | "testtask"
  | "productplan" | "build" | "release"
  | "feedback" | "ticket" | "system" | "user" | "file"
  | "issue" | "risk" | "meeting" | "todo";

export type ZentaoAction = "list" | "get" | "create" | "update" | "delete" | "activate" | "close" | "resolve" | "start" | "finish" | "change";

interface ModuleInfo {
  /** 中文名（错误提示用）。 */
  readonly label: string;
  /** 列表时必须提供的范围参数名（无则 null）。 */
  readonly scopeFlag: string | null;
  /** 备选范围参数名（如 execution 的 --product；提供时优先于 scopeFlag）。 */
  readonly altScopeFlag?: string;
  /** scope 可选：提供则过滤，缺省则列表全部（真实 CLI：execution 无 scope 可列表）。 */
  readonly scopeOptional?: boolean;
  /** scopedList 模块（issue/risk/meeting）：list 按 project/executionID 映射到 projectX/executionX 操作。 */
  readonly scopedList?: { readonly projectOp: string; readonly executionOp: string };
  /** 允许的动作集合。 */
  readonly actions: ReadonlySet<ZentaoAction>;
}

const set = (...xs: ZentaoAction[]): ReadonlySet<ZentaoAction> => new Set(xs);

export const MODULE_INFO: Record<ZentaoModule, ModuleInfo> = {
  program:     { label: "项目集", scopeFlag: null, actions: set("list", "get", "create", "update", "delete") },
  product:     { label: "产品",   scopeFlag: null, actions: set("list", "get", "create", "update", "delete") },
  project:     { label: "项目",   scopeFlag: null, actions: set("list", "get", "create", "update", "delete") },
  execution:   { label: "执行",   scopeFlag: "--project", altScopeFlag: "--product", scopeOptional: true, actions: set("list", "get", "create", "update", "delete") },
  story:       { label: "需求",   scopeFlag: "--product", actions: set("list", "get", "create", "update", "delete", "activate", "close", "change") },
  epic:        { label: "业务需求", scopeFlag: "--productID", actions: set("list", "get", "create", "update", "delete", "activate", "close", "change") },
  requirement: { label: "用户需求", scopeFlag: "--productID", actions: set("list", "get", "create", "update", "delete", "activate", "close", "change") },
  bug:         { label: "Bug",    scopeFlag: "--product", actions: set("list", "get", "create", "update", "delete", "activate", "close", "resolve") },
  task:        { label: "任务",   scopeFlag: "--executionID", actions: set("list", "get", "create", "update", "delete", "activate", "close", "start", "finish") },
  testcase:    { label: "测试用例", scopeFlag: "--product", actions: set("list", "get", "create", "update", "delete") },
  testtask:    { label: "测试单", scopeFlag: "--productID", actions: set("create", "update", "delete") },
  productplan: { label: "产品计划", scopeFlag: "--productID", actions: set("create", "update", "delete") },
  build:       { label: "版本",   scopeFlag: "--project", actions: set("create", "update", "delete") },
  release:     { label: "发布",   scopeFlag: "--productID", actions: set("create", "update", "delete") },
  feedback:    { label: "反馈",   scopeFlag: "--productID", actions: set("list", "get", "create", "update", "delete", "activate", "close") },
  ticket:      { label: "工单",   scopeFlag: "--productID", actions: set("list", "get", "create", "update", "delete", "activate", "close") },
  system:      { label: "应用",   scopeFlag: "--productID", actions: set("list", "create", "update") },
  user:        { label: "用户",   scopeFlag: null, actions: set("list", "get", "create", "update", "delete") },
  file:        { label: "附件",   scopeFlag: null, actions: set("create", "delete") },
  issue:       { label: "问题",   scopeFlag: null, scopedList: { projectOp: "projectIssues", executionOp: "executionIssues" }, actions: set("list", "get", "create", "update") },
  risk:        { label: "风险",   scopeFlag: null, scopedList: { projectOp: "projectRisks", executionOp: "executionRisks" }, actions: set("list", "get", "create", "update") },
  meeting:     { label: "会议",   scopeFlag: null, scopedList: { projectOp: "projectMeetings", executionOp: "executionMeetings" }, actions: set("list", "get", "create", "update", "delete") },
  todo:        { label: "待办",   scopeFlag: null, actions: set("create", "update", "delete") },
};

export const MODULES = Object.keys(MODULE_INFO) as readonly ZentaoModule[];

/** 工具入参（运行时 schema 校验后的扁平视图）。 */
export interface ZentaoArgs {
  module: ZentaoModule;
  action: ZentaoAction;
  id?: number;
  product?: number;
  project?: number;
  executionID?: number;
  fields?: Record<string, string | number | boolean>;
  /** list/get 字段摘取（逗号分隔）。 */
  pick?: string;
  /** list 过滤表达式（元素内逗号=AND，多个元素=OR），如 "status=active,pri<=2"。 */
  filter?: string[];
  /** list 排序，如 "pri:asc,severity:asc"。 */
  sort?: string;
  /** list 搜索关键词。 */
  search?: string;
  /** list 搜索字段（逗号分隔），配合 search。 */
  searchFields?: string;
  /** list 只返回前 N 条。 */
  limit?: number;
  /** create/update/状态动作的 JSON 请求体（嵌套对象/数组/长文本；与 fields 冲突时以 data 为准）。 */
  data?: string;
}

/** resolve 隐含必填 4 字段（服务端硬性要求，缺一个报 E2008）。 */
const RESOLVE_REQUIRED = ["resolution", "assignedTo", "resolvedBuild", "comment"] as const;

/**
 * 把工具入参构造成 CLI 参数数组（不含 --format=json，由调用层追加）。
 * 校验失败抛 Error（message 面向模型，含中文提示）。
 */
export function buildCliArgs(args: ZentaoArgs): string[] {
  const info = MODULE_INFO[args.module];
  if (info === undefined) {
    throw new Error(`未知模块 ${String(args.module)}，可选：${MODULES.join("/")}`);
  }
  const { module, action, id, fields } = args;
  if (!info.actions.has(action)) {
    throw new Error(`${info.label}(${module}) 不支持动作 ${action}，可选：${[...info.actions].join("/")}`);
  }

  const proc: string[] = [];
  if (args.pick !== undefined) proc.push(`--pick=${args.pick}`);
  if (action === "list") {
    for (const f of args.filter ?? []) proc.push(`--filter=${f}`);
    if (args.sort !== undefined) proc.push(`--sort=${args.sort}`);
    if (args.search !== undefined) proc.push(`--search=${args.search}`);
    if (args.searchFields !== undefined) proc.push(`--search-fields=${args.searchFields}`);
    if (args.limit !== undefined) proc.push(`--limit=${args.limit}`);
  }
  const dataArgs = args.data === undefined ? [] : [`--data=${args.data}`];

  if (action === "list") {
    if (info.scopedList !== undefined) {
      if (args.project !== undefined) {
        return [module, info.scopedList.projectOp, `--projectID=${args.project}`, `--recPerPage=${LIST_PAGE_SIZE}`, ...proc];
      }
      if (args.executionID !== undefined) {
        return [module, info.scopedList.executionOp, `--executionID=${args.executionID}`, `--recPerPage=${LIST_PAGE_SIZE}`, ...proc];
      }
      return [module, `--recPerPage=${LIST_PAGE_SIZE}`, ...proc];
    }
    // 备选范围参数优先（execution: --product 优先于 --project）。
    if (info.altScopeFlag !== undefined && args.product !== undefined) {
      return [module, `${info.altScopeFlag}=${args.product}`, `--recPerPage=${LIST_PAGE_SIZE}`, ...proc];
    }
    const scope = info.scopeFlag;
    if (scope !== null) {
      let value: number | undefined;
      if (scope === "--product" || scope === "--productID") value = args.product;
      else if (scope === "--project") value = args.project;
      else if (scope === "--executionID") value = args.executionID;
      if (value === undefined && info.scopeOptional !== true) {
        throw new Error(`${info.label}(${module}) 列表需要 ${scope.replace(/^--/, "")} 参数`);
      }
      return value === undefined
        ? [module, `--recPerPage=${LIST_PAGE_SIZE}`, ...proc]
        : [module, `${scope}=${value}`, `--recPerPage=${LIST_PAGE_SIZE}`, ...proc];
    }
    return [module, `--recPerPage=${LIST_PAGE_SIZE}`, ...proc];
  }

  if (action === "get") {
    if (id === undefined) throw new Error(`${info.label}(${module}) get 需要 id`);
    return [module, String(id), ...proc];
  }

  if (action === "create") {
    return [module, "create", ...flagArgs(fields), ...dataArgs];
  }

  if (action === "update") {
    if (id === undefined) throw new Error(`${info.label}(${module}) update 需要 id`);
    return [module, "update", String(id), ...flagArgs(fields), ...dataArgs];
  }

  if (action === "delete") {
    if (id === undefined) throw new Error(`${info.label}(${module}) delete 需要 id`);
    return [module, "delete", String(id), "--yes", ...dataArgs];
  }

  // 状态流转动作（activate/close/resolve/start/finish/change）
  if (action === "resolve") {
    if (id === undefined) throw new Error(`${info.label}(${module}) resolve 需要 id`);
    const missing = RESOLVE_REQUIRED.filter((k) => fields?.[k] === undefined);
    if (missing.length > 0) {
      throw new Error(`bug resolve 必须提供 ${missing.join("、")}（resolution/assignedTo/resolvedBuild/comment 四项）`);
    }
    return [module, "resolve", String(id), ...flagArgs(fields), ...dataArgs];
  }
  if (action === "start" && module === "task") {
    if (id === undefined) throw new Error(`${info.label}(${module}) start 需要 id`);
    const missing = ["realStarted"].filter((k) => fields?.[k] === undefined);
    if (missing.length > 0) {
      throw new Error(`task start 必须提供 ${missing.join("、")}（realStarted 实际开始，必填）`);
    }
    return [module, "start", String(id), ...flagArgs(fields), ...dataArgs];
  }
  if (action === "finish" && module === "task") {
    if (id === undefined) throw new Error(`${info.label}(${module}) finish 需要 id`);
    const missing = ["currentConsumed", "realStarted", "finishedDate"].filter((k) => fields?.[k] === undefined);
    if (missing.length > 0) {
      throw new Error(`task finish 必须提供 ${missing.join("、")}（currentConsumed/realStarted/finishedDate，必填）`);
    }
    return [module, "finish", String(id), ...flagArgs(fields), ...dataArgs];
  }
  if (id === undefined) throw new Error(`${info.label}(${module}) ${action} 需要 id`);
  return [module, action, String(id), ...flagArgs(fields), ...dataArgs];
}

/** 把项目上下文补为 list 动作的范围参数默认值（显式参数优先；非 list 不补）。 */
export function applyContextDefaults(args: ZentaoArgs, context: ZentaoContext): ZentaoArgs {
  if (args.action !== "list") return args;
  const filled: ZentaoArgs = { ...args };
  if (filled.product === undefined && context.product !== undefined) filled.product = context.product;
  if (filled.project === undefined && context.project !== undefined) filled.project = context.project;
  if (filled.executionID === undefined && context.execution !== undefined) filled.executionID = context.execution;
  return filled;
}

function flagArgs(fields: Record<string, string | number | boolean> | undefined): string[] {
  if (fields === undefined) return [];
  return Object.entries(fields).map(([k, v]) => `--${k}=${String(v)}`);
}
