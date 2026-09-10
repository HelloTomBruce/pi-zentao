/**
 * 项目级禅道上下文：读取项目根目录的 zentao.config.json，
 * 作为 zentao 工具/概览的范围参数默认值（显式参数 > 配置文件）。
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const CONTEXT_FILENAME = "zentao.config.json";

export interface ZentaoContext {
  product?: number;
  project?: number;
  execution?: number;
}

const CONTEXT_KEYS = ["product", "project", "execution"] as const;

/** 解析配置文本；字段缺失/类型不符/非正整数一律忽略，非法输入返回空上下文。 */
export function parseContext(raw: string): ZentaoContext {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const obj = parsed as Record<string, unknown>;
  const out: ZentaoContext = {};
  for (const key of CONTEXT_KEYS) {
    const v = obj[key];
    if (typeof v === "number" && Number.isInteger(v) && v > 0) out[key] = v;
  }
  return out;
}

/** 项目根目录的配置文件路径。 */
export function contextPath(cwd: string): string {
  return join(cwd, CONTEXT_FILENAME);
}

/** 读取项目上下文；文件缺失/损坏/不可读均返回空上下文（best-effort）。 */
export function loadContext(cwd: string): ZentaoContext {
  try {
    const path = contextPath(cwd);
    if (!existsSync(path)) return {};
    return parseContext(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

/** 人类可读描述（如 "产品26/执行168"）；空上下文返回空串。 */
export function describeContext(ctx: ZentaoContext): string {
  const parts: string[] = [];
  if (ctx.product !== undefined) parts.push(`产品${ctx.product}`);
  if (ctx.project !== undefined) parts.push(`项目${ctx.project}`);
  if (ctx.execution !== undefined) parts.push(`执行${ctx.execution}`);
  return parts.join("/");
}
