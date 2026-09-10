import { describe, expect, it } from "vitest";
import { currentProfile, runZentao, type ExecFn } from "../src/lib/cli.ts";

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
