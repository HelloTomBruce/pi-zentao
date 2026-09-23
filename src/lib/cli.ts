/**
 * zentao CLI 调用层。所有禅道数据都通过 CLI 子进程获取，凭证由 CLI 内部
 * 管理（~/.config/zentao/zentao.json），本层不读取、不接触任何凭证。
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/** CLI 返回的结构化错误（code 来自 CLI 错误码或 ENOENT）。 */
export interface CliError extends Error {
  code: string;
  raw?: string;
}

function cliErrorOf(code: string, message: string, raw?: string): CliError {
  const err = new Error(message) as CliError;
  err.code = code;
  if (raw !== undefined) err.raw = raw;
  return err;
}

/** execFile 回调签名（便于测试注入）；extraEnv 仅 login 使用。 */
export type ExecFn = (
  cmd: string,
  args: string[],
  cb: (error: Error | null, stdout: string) => void,
  extraEnv?: Record<string, string>,
) => void;

/**
 * 解析依赖内的 zentao-cli bin（无需全局安装）。解析失败返回 null，
 * 回退到 PATH 中的全局 zentao。
 */
function resolveBundledCliBin(): string | null {
  try {
    const pkgJson = createRequire(import.meta.url).resolve("zentao-cli/package.json");
    const bin = join(dirname(pkgJson), "bin", "zentao.js");
    return existsSync(bin) ? bin : null;
  } catch {
    return null;
  }
}

const defaultExec: ExecFn = (cmd, args, cb, extraEnv) => {
  // 优先使用依赖中的 zentao-cli，并以当前 node（process.execPath）直接执行
  // bin 脚本——不依赖 PATH 中的全局 zentao / node；解析不到才回退全局命令。
  const bundledBin = resolveBundledCliBin();
  const [runCmd, runArgs]: [string, string[]] = bundledBin
    ? [process.execPath, [bundledBin, ...args]]
    : [cmd, args];
  execFile(
    runCmd,
    runArgs,
    { timeout: 30_000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, ...extraEnv } },
    (error, stdout, stderr) => {
      // 部分命令（如 login）把错误 JSON 写到 stderr：stdout 为空时回退 stderr。
      const out = String(stdout).trim() !== "" ? String(stdout) : String(stderr);
      cb(error, out);
    },
  );
};

/** 解析 CLI JSON 输出；错误统一映射为 CliError。 */
function parseOutput(stdout: string, cliFailed: boolean): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw cliErrorOf(
      "E5001",
      cliFailed
        ? `zentao CLI 执行失败：${stdout.slice(0, 200)}`
        : `zentao CLI 输出无法解析：${stdout.slice(0, 200)}`,
      stdout,
    );
  }
  const obj = parsed as { status?: unknown; error?: { code?: unknown; message?: unknown }; data?: unknown };
  if (obj?.error !== undefined) {
    const code = String(obj.error.code ?? "E5001");
    const message = String(obj.error.message ?? "zentao 请求失败");
    throw cliErrorOf(code, `zentao: ${message}`);
  }
  if (cliFailed) {
    throw cliErrorOf("E5001", `zentao CLI 退出码非 0：${stdout.slice(0, 200)}`, stdout);
  }
  // profile 等命令无 data 字段，返回整个解析对象。
  return obj?.data !== undefined ? obj.data : parsed;
}

/** 把未知错误规范化为 CliError。 */
export function asCliError(error: unknown): CliError {
  if (error instanceof Error && "code" in error) return error as CliError;
  return cliErrorOf("E5001", error instanceof Error ? error.message : String(error));
}

/** 版本/操作不支持错误（CLI 调用前版本检查）：code 无 E 前缀（2010），兼容带前缀形态（E2010）。 */
export function isVersionUnsupported(error: unknown): boolean {
  const code = asCliError(error).code;
  return code === "2010" || code === "E2010";
}

function handleExec(error: Error | null, stdout: string, resolve: (v: unknown) => void, reject: (e: unknown) => void): void {
  if (error !== null) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      reject(cliErrorOf("ENOENT", "未找到 zentao CLI：依赖 zentao-cli 缺失且 PATH 中无全局命令，请重新安装插件（或 npm i -g zentao-cli）"));
      return;
    }
    try { resolve(parseOutput(stdout, true)); } catch (e) { reject(e); }
    return;
  }
  try { resolve(parseOutput(stdout, false)); } catch (e) { reject(e); }
}

/**
 * 执行 zentao CLI。args 不含 --format=json（自动追加）。
 * @returns CLI JSON 输出的 data 字段；无 data 字段的命令（profile）返回整个解析对象。
 */
export async function runZentao(args: string[], exec: ExecFn = defaultExec): Promise<unknown> {
  const fullArgs = [...args, "--format=json"];
  return new Promise((resolve, reject) => {
    exec("zentao", fullArgs, (error, stdout) => handleExec(error, stdout, resolve, reject));
  });
}

/**
 * 执行 zentao CLI 但不强制 JSON 解析（login 成功时输出纯文本）。
 * extraEnv 用于给 login --useEnv 传递凭证（避免密码出现在进程参数中）。
 */
export async function runZentaoLoose(
  args: string[],
  exec: ExecFn = defaultExec,
  extraEnv?: Record<string, string>,
): Promise<string> {
  const fullArgs = [...args, "--format=json"];
  return new Promise((resolve, reject) => {
    exec("zentao", fullArgs, (error, stdout) => {
      if (error === null) { resolve(stdout); return; }
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        reject(cliErrorOf("ENOENT", "未找到 zentao CLI：依赖 zentao-cli 缺失且 PATH 中无全局命令，请重新安装插件（或 npm i -g zentao-cli）"));
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as { error?: { code?: unknown; message?: unknown } };
        if (parsed?.error !== undefined) {
          reject(cliErrorOf(String(parsed.error.code ?? "E5001"), `zentao: ${String(parsed.error.message ?? "zentao 请求失败")}`, stdout));
          return;
        }
      } catch { /* 输出非 JSON，走通用错误 */ }
      reject(cliErrorOf("E5001", `zentao CLI 执行失败：${stdout.slice(0, 200)}`, stdout));
    }, extraEnv);
  });
}

/** 当前登录的 profile；未登录或出错返回 null。 */
export interface ZentaoProfile { account: string; server: string; }

export type RunFn = (args: string[]) => Promise<unknown>;

/** 列表重试次数：负载均衡后有坏节点会以空/伪造单条响应，重试取条数最多者。
 *  健康节点上重试幂等（列表只读），代价仅是多一次 CLI 调用。 */
export const LIST_MAX_ATTEMPTS = 3;

/** 列表查询包装：响应为 ≤1 条的数组（空或伪造单条）时重试，取条数最多的响应。 */
export async function runList(run: RunFn, args: string[]): Promise<unknown> {
  let best: unknown = await run(args);
  for (let attempt = 1; attempt < LIST_MAX_ATTEMPTS; attempt++) {
    if (!Array.isArray(best) || best.length > 1) break;
    const next: unknown = await run(args);
    if (Array.isArray(next) && (!Array.isArray(best) || next.length > best.length)) best = next;
  }
  return best;
}

export async function currentProfile(run: RunFn = (a) => runZentao(a)): Promise<ZentaoProfile | null> {
  try {
    const res = (await run(["profile"])) as
      | { profiles?: { account?: unknown; server?: unknown; current?: unknown }[] }
      | undefined;
    const cur = res?.profiles?.find((p) => p.current === true);
    if (cur?.account === undefined || cur?.server === undefined) return null;
    return { account: String(cur.account), server: String(cur.server) };
  } catch {
    return null;
  }
}

/** 通过环境变量登录（zentao login --useEnv），凭证不出现在进程参数中。 */
export async function login(
  server: string,
  account: string,
  password: string,
  exec: ExecFn = defaultExec,
): Promise<string> {
  return runZentaoLoose(["login", "--useEnv"], exec, {
    ZENTAO_URL: server,
    ZENTAO_ACCOUNT: account,
    ZENTAO_PASSWORD: password,
  });
}

/** 面向用户的错误消息：登录类错误附带引导。 */
export function hintOf(err: unknown): string {
  const e = asCliError(err);
  if (e.code === "2010" || e.code === "E2010") {
    return `${e.message}（可升级禅道版本，或改用其他操作/模块）`;
  }
  if (e.code === "E1001" || e.code === "E1004" || e.code === "E1006") {
    return `${e.message}（请执行 /zentao-login 登录禅道）`;
  }
  return e.message;
}
