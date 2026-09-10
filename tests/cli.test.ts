import { describe, expect, it } from "vitest";
import { currentProfile, runList, runZentao, type ExecFn, type RunFn } from "../src/lib/cli.ts";

/** 构造返回固定 stdout（或错误）的 mock exec。 */
function mockExec(stdout: string, error: Error | null = null): ExecFn {
  return (_cmd, _args, cb) => cb(error, stdout);
}

describe("runZentao", () => {
  it("返回 data 字段（列表为数组）", async () => {
    const exec = mockExec(JSON.stringify({ status: "success", data: [{ id: "1" }] }));
    expect(await runZentao(["product"], exec)).toEqual([{ id: "1" }]);
  });

  it("无 data 字段时返回整个解析对象（profile 等命令）", async () => {
    const exec = mockExec(JSON.stringify({ status: "success", currentProfile: "a@s", profiles: [] }));
    const res = (await runZentao(["profile"], exec)) as { currentProfile: string };
    expect(res.currentProfile).toBe("a@s");
  });

  it("error 字段映射为带 code 的 Error", async () => {
    const exec = mockExec(JSON.stringify({ error: { code: "E1001", message: "未登录" } }));
    await expect(runZentao(["bug"], exec)).rejects.toMatchObject({ code: "E1001" });
  });

  it("非 JSON 输出抛 E5001", async () => {
    const exec = mockExec("not json at all");
    await expect(runZentao(["bug"], exec)).rejects.toMatchObject({ code: "E5001" });
  });

  it("ENOENT 时给出重装提示", async () => {
    const err = Object.assign(new Error("spawn zentao ENOENT"), { code: "ENOENT" });
    await expect(runZentao(["bug"], mockExec("", err))).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("currentProfile", () => {
  it("取 current=true 的 profile", async () => {
    const exec = mockExec(JSON.stringify({
      status: "success",
      profiles: [
        { account: "a", server: "http://s1", current: false },
        { account: "b", server: "http://s2", current: true },
      ],
    }));
    expect(await currentProfile((args) => runZentao(args, exec))).toEqual({ account: "b", server: "http://s2" });
  });

  it("CLI 报错（未登录）时返回 null", async () => {
    const exec = mockExec(JSON.stringify({ error: { code: "E1006", message: "无配置" } }));
    expect(await currentProfile((args) => runZentao(args, exec))).toBeNull();
  });
});

describe("runList（坏节点重试取最大）", () => {
  it("首次返回伪造单条时重试并取最大响应", async () => {
    const responses: unknown[] = [
      [{ id: "15320", name: "开发" }],
      [{ id: "1" }, { id: "2" }],
    ];
    let i = 0;
    const run: RunFn = async () => responses[i++] ?? [];
    const res = await runList(run, ["task", "--executionID=65"]);
    expect(res).toEqual([{ id: "1" }, { id: "2" }]);
    expect(i).toBe(2);
  });

  it("首次为空数组时重试", async () => {
    const responses: unknown[] = [[], [{ id: "1" }]];
    let i = 0;
    const run: RunFn = async () => responses[i++] ?? [];
    const res = await runList(run, ["bug", "--product=1"]);
    expect(res).toEqual([{ id: "1" }]);
  });

  it("正常多条响应不重试", async () => {
    let i = 0;
    const run: RunFn = async () => { i++; return [{ id: "1" }, { id: "2" }]; };
    await runList(run, ["task", "--executionID=1"]);
    expect(i).toBe(1);
  });

  it("持续异常时返回最后一次响应（不无限重试）", async () => {
    let i = 0;
    const run: RunFn = async () => { i++; return []; };
    const res = await runList(run, ["task", "--executionID=1"]);
    expect(res).toEqual([]);
    expect(i).toBe(3); // LIST_MAX_ATTEMPTS
  });

  it("非数组响应直接返回", async () => {
    let i = 0;
    const run: RunFn = async () => { i++; return { id: "1" }; };
    const res = await runList(run, ["product", "1"]);
    expect(res).toEqual({ id: "1" });
    expect(i).toBe(1);
  });
});
