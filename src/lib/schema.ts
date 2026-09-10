/**
 * zentao 工具的模块/动作白名单与 CLI 参数构造。所有列表统一
 * --recPerPage=200 拉全量（--filter 与分页不兼容的 pitfall 规避），
 * 程序侧再按需过滤。
 */

export type ZentaoModule =
  | "program" | "product" | "project" | "execution"
  | "story" | "epic" | "requirement"
  | "bug" | "task" | "testcase" | "testtask"
  | "productplan" | "build" | "release"
  | "feedback" | "ticket" | "system" | "user" | "file";

export type ZentaoAction = "list" | "get" | "create" | "update" | "delete" | "activate" | "close" | "resolve" | "start" | "finish" | "change";

interface ModuleInfo {
  /** 中文名（错误提示用）。 */
  readonly label: string;
  /** 列表时必须提供的范围参数名（无则 null）。 */
  readonly scopeFlag: string | null;
  /** scope 可选：提供则过滤，缺省则列表全部（真实 CLI：execution 无 scope 可列表）。 */
  readonly scopeOptional?: boolean;
  /** 允许的动作集合。 */
  readonly actions: ReadonlySet<ZentaoAction>;
}

const set = (...xs: ZentaoAction[]): ReadonlySet<ZentaoAction> => new Set(xs);

export const MODULE_INFO: Record<ZentaoModule, ModuleInfo> = {
  program:     { label: "项目集", scopeFlag: null, actions: set("list", "get", "create", "update", "delete") },
  product:     { label: "产品",   scopeFlag: null, actions: set("list", "get", "create", "update", "delete") },
  project:     { label: "项目",   scopeFlag: null, actions: set("list", "get", "create", "update", "delete") },
  execution:   { label: "执行",   scopeFlag: "--project", scopeOptional: true, actions: set("list", "get", "create", "update", "delete") },
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

  if (action === "list") {
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
        ? [module, "--recPerPage=200"]
        : [module, `${scope}=${value}`, "--recPerPage=200"];
    }
    return [module, "--recPerPage=200"];
  }

  if (action === "get") {
    if (id === undefined) throw new Error(`${info.label}(${module}) get 需要 id`);
    return [module, String(id)];
  }

  if (action === "create") {
    return [module, "create", ...flagArgs(fields)];
  }

  if (action === "update") {
    if (id === undefined) throw new Error(`${info.label}(${module}) update 需要 id`);
    return [module, "update", String(id), ...flagArgs(fields)];
  }

  if (action === "delete") {
    if (id === undefined) throw new Error(`${info.label}(${module}) delete 需要 id`);
    return [module, "delete", String(id), "--yes"];
  }

  // 状态流转动作（activate/close/resolve/start/finish/change）
  if (action === "resolve") {
    if (id === undefined) throw new Error(`${info.label}(${module}) resolve 需要 id`);
    const missing = RESOLVE_REQUIRED.filter((k) => fields?.[k] === undefined);
    if (missing.length > 0) {
      throw new Error(`bug resolve 必须提供 ${missing.join("、")}（resolution/assignedTo/resolvedBuild/comment 四项）`);
    }
    return [module, "resolve", String(id), ...flagArgs(fields)];
  }
  if (action === "start" && module === "task") {
    if (id === undefined) throw new Error(`${info.label}(${module}) start 需要 id`);
    const missing = ["realStarted"].filter((k) => fields?.[k] === undefined);
    if (missing.length > 0) {
      throw new Error(`task start 必须提供 ${missing.join("、")}（realStarted 实际开始，必填）`);
    }
    return [module, "start", String(id), ...flagArgs(fields)];
  }
  if (action === "finish" && module === "task") {
    if (id === undefined) throw new Error(`${info.label}(${module}) finish 需要 id`);
    const missing = ["currentConsumed", "realStarted", "finishedDate"].filter((k) => fields?.[k] === undefined);
    if (missing.length > 0) {
      throw new Error(`task finish 必须提供 ${missing.join("、")}（currentConsumed/realStarted/finishedDate，必填）`);
    }
    return [module, "finish", String(id), ...flagArgs(fields)];
  }
  if (id === undefined) throw new Error(`${info.label}(${module}) ${action} 需要 id`);
  return [module, action, String(id), ...flagArgs(fields)];
}

function flagArgs(fields: Record<string, string | number | boolean> | undefined): string[] {
  if (fields === undefined) return [];
  return Object.entries(fields).map(([k, v]) => `--${k}=${String(v)}`);
}
