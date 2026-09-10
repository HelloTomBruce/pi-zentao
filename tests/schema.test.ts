// tests/schema.test.ts
import { describe, expect, it } from "vitest";
import { buildCliArgs, applyContextDefaults, MODULES } from "../src/lib/schema.ts";

describe("buildCliArgs list", () => {
  it("bug 列表用 --product", () => {
    expect(buildCliArgs({ module: "bug", action: "list", product: 26 }))
      .toEqual(["bug", "--product=26", "--recPerPage=1000"]);
  });

  it("epic 列表用 --productID", () => {
    expect(buildCliArgs({ module: "epic", action: "list", product: 3 }))
      .toEqual(["epic", "--productID=3", "--recPerPage=1000"]);
  });

  it("task 列表用 --executionID", () => {
    expect(buildCliArgs({ module: "task", action: "list", executionID: 9 }))
      .toEqual(["task", "--executionID=9", "--recPerPage=1000"]);
  });

  it("execution 的 scope 可选，缺省列表全部", () => {
    expect(buildCliArgs({ module: "execution", action: "list" }))
      .toEqual(["execution", "--recPerPage=1000"]);
  });

  it("execution 列表可用 product 范围参数", () => {
    expect(buildCliArgs({ module: "execution", action: "list", product: 3 }))
      .toEqual(["execution", "--product=3", "--recPerPage=1000"]);
  });

  it("execution 列表 product 与 project 同时给出时 product 优先", () => {
    expect(buildCliArgs({ module: "execution", action: "list", product: 3, project: 5 }))
      .toEqual(["execution", "--product=3", "--recPerPage=1000"]);
  });

  it("execution 列表仍可用 project 范围参数", () => {
    expect(buildCliArgs({ module: "execution", action: "list", project: 5 }))
      .toEqual(["execution", "--project=5", "--recPerPage=1000"]);
  });

  it("无 scopeFlag 的模块直接列表", () => {
    expect(buildCliArgs({ module: "product", action: "list" }))
      .toEqual(["product", "--recPerPage=1000"]);
  });

  it("缺 scope 抛错并提示参数名", () => {
    expect(() => buildCliArgs({ module: "bug", action: "list" })).toThrow(/product/);
  });
});

describe("applyContextDefaults", () => {
  const ctx = { product: 26, project: 167, execution: 168 };

  it("list 动作从上下文补全三个范围键（buildCliArgs 按模块取用，未用字段无害）", () => {
    expect(applyContextDefaults({ module: "task", action: "list" } as const, ctx))
      .toEqual({ module: "task", action: "list", product: 26, project: 167, executionID: 168 });
    expect(applyContextDefaults({ module: "execution", action: "list" } as const, ctx))
      .toEqual({ module: "execution", action: "list", product: 26, project: 167, executionID: 168 });
  });

  it("显式参数优先，非 list 动作不补", () => {
    expect(applyContextDefaults({ module: "bug", action: "list", product: 99 } as const, ctx))
      .toEqual({ module: "bug", action: "list", product: 99, project: 167, executionID: 168 });
    expect(applyContextDefaults({ module: "bug", action: "get", id: 1 } as const, ctx))
      .toEqual({ module: "bug", action: "get", id: 1 });
  });

  it("空上下文原样返回", () => {
    const args = { module: "bug" as const, action: "list" as const };
    expect(applyContextDefaults(args, {})).toEqual(args);
  });
});

describe("buildCliArgs 对象操作", () => {
  it("get 需要 id", () => {
    expect(buildCliArgs({ module: "bug", action: "get", id: 42 })).toEqual(["bug", "42"]);
    expect(() => buildCliArgs({ module: "bug", action: "get" })).toThrow(/id/);
  });

  it("create 透传 fields 为 --k=v", () => {
    expect(buildCliArgs({ module: "story", action: "create", fields: { title: "t", pri: 3 } }))
      .toEqual(["story", "create", "--title=t", "--pri=3"]);
  });

  it("delete 自动加 --yes", () => {
    expect(buildCliArgs({ module: "bug", action: "delete", id: 1 }))
      .toEqual(["bug", "delete", "1", "--yes"]);
  });
});

describe("buildCliArgs 状态流转", () => {
  it("bug resolve 缺字段报错，齐全时透传", () => {
    expect(() => buildCliArgs({ module: "bug", action: "resolve", id: 1, fields: { resolution: "fixed" } }))
      .toThrow(/assignedTo/);
    expect(buildCliArgs({
      module: "bug", action: "resolve", id: 1,
      fields: { resolution: "fixed", assignedTo: "admin", resolvedBuild: "trunk", comment: "ok" },
    })).toEqual(["bug", "resolve", "1", "--resolution=fixed", "--assignedTo=admin", "--resolvedBuild=trunk", "--comment=ok"]);
  });

  it("模块不支持的动作报错", () => {
    expect(() => buildCliArgs({ module: "product", action: "resolve", id: 1 })).toThrow(/不支持/);
  });

  it("未知模块报错并列出可选", () => {
    // @ts-expect-error 故意传非法模块
    expect(() => buildCliArgs({ module: "nope", action: "list" })).toThrow(/未知模块/);
    expect(MODULES).toContain("bug");
  });
});
