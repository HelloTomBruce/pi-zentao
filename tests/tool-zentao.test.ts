// tests/tool-zentao.test.ts
import { describe, expect, it } from "vitest";
import { executeZentao } from "../src/tools/zentao.ts";
import type { RunFn } from "../src/lib/cli.ts";

const RUN: RunFn = async (args) => {
  if (args[0] === "bug") return [{ id: "1", title: "登录失败", status: "active" }];
  return { id: "1", name: "平台" };
};

describe("executeZentao", () => {
  it("列表结果：details 带 count，content 是 JSON 文本", async () => {
    const res = await executeZentao({ module: "bug", action: "list", product: 26 }, RUN);
    expect(res.details).toMatchObject({ module: "bug", action: "list", count: 1 });
    expect(res.content[0].text).toContain("登录失败");
  });

  it("参数非法时抛出中文提示（buildCliArgs 校验）", async () => {
    await expect(executeZentao({ module: "bug", action: "list" }, RUN)).rejects.toThrow(/product/);
  });

  it("CLI 登录类错误附带 /zentao-login 引导", async () => {
    const run: RunFn = async () => {
      const e = new Error("zentao: 未登录") as Error & { code: string };
      e.code = "E1001";
      throw e;
    };
    await expect(executeZentao({ module: "bug", action: "list", product: 1 }, run)).rejects.toThrow(/zentao-login/);
  });

  it("list 缺范围参数时从项目上下文补全", async () => {
    const res = await executeZentao({ module: "bug", action: "list" }, RUN, { product: 26 });
    expect(res.details.count).toBe(1);
  });
});
