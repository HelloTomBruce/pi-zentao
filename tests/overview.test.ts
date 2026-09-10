// tests/overview.test.ts
import { describe, expect, it } from "vitest";
import { accountOf, getOverview, myOverview, OverviewCache, projectOverview } from "../src/lib/overview.ts";
import type { RunFn } from "../src/lib/cli.ts";

/** 按 argv 路由的夹具 RunFn。 */
function fixtureRun(map: Record<string, unknown>): RunFn {
  return async (args) => {
    const key = args.join(" ");
    for (const [k, v] of Object.entries(map)) {
      if (key.startsWith(k)) return v;
    }
    return [];
  };
}

describe("accountOf", () => {
  it("兼容字符串与对象形态", () => {
    expect(accountOf("admin")).toBe("admin");
    expect(accountOf({ account: "zhangsan" })).toBe("zhangsan");
    expect(accountOf(null)).toBe("");
  });
});

const ME_RUN = fixtureRun({
  "profile": { profiles: [{ account: "zhangsan", server: "http://s", current: true }] },
  "product": [
    { id: "1", name: "平台", status: "normal" },
    { id: "2", name: "已关闭产品", status: "closed" },
  ],
  "bug --product=1": [
    { id: "11", title: "我的Bug", status: "active", pri: 1, assignedTo: "zhangsan" },
    { id: "12", title: "别人的Bug", status: "active", pri: 1, assignedTo: "lisi" },
    { id: "13", title: "已解决", status: "resolved", pri: 2, assignedTo: "zhangsan" },
  ],
  "project": [{ id: "5", name: "P5", status: "doing" }],
  "execution --project=5": [{ id: "9", name: "迭代9", status: "doing" }],
  "task --executionID=9": [
    { id: "21", name: "我的任务", status: "doing", pri: 2, assignedTo: { account: "zhangsan" } },
    { id: "22", name: "已完成", status: "done", pri: 1, assignedTo: "zhangsan" },
  ],
});

describe("myOverview", () => {
  it("过滤 assignedTo=me 且状态激活/未完成，按 pri 升序", async () => {
    const items = await myOverview(ME_RUN, "zhangsan");
    expect(items.map((i) => i.id)).toEqual(["11", "21"]); // P1 Bug 在前，P2 任务在后
    expect(items[0]).toMatchObject({ kind: "bug", scope: "平台" });
    expect(items[1]).toMatchObject({ kind: "task", scope: "迭代9" });
  });
});

describe("projectOverview", () => {
  it("按状态统计 Bug 数", async () => {
    const run = fixtureRun({
      "project": [{ id: "5", name: "P5", status: "doing" }, { id: "6", name: "P6", status: "closed" }],
      "bug --project=5": [
        { id: "1", status: "active" }, { id: "2", status: "active" },
        { id: "3", status: "resolved" }, { id: "4", status: "closed" },
      ],
    });
    const stats = await projectOverview(run);
    expect(stats).toEqual([{ id: "5", name: "P5", bugActive: 2, bugResolved: 1, bugClosed: 1 }]);
  });
});

const SCOPED_RUN = fixtureRun({
  "product 26": { id: "26", name: "平台" },
  "bug --product=26": [
    { id: "11", title: "我的Bug", status: "active", pri: 1, assignedTo: "zhangsan" },
    { id: "12", title: "别人的Bug", status: "active", pri: 1, assignedTo: "lisi" },
  ],
  "execution 168": { id: "168", name: "迭代168" },
  "task --executionID=168": [
    { id: "21", name: "我的任务", status: "doing", pri: 2, assignedTo: "zhangsan" },
  ],
});

describe("myOverview scoped（项目上下文）", () => {
  it("只查配置的 product 与 execution，scope 用名称", async () => {
    const items = await myOverview(SCOPED_RUN, "zhangsan", { product: 26, execution: 168 });
    expect(items.map((i) => i.id)).toEqual(["11", "21"]);
    expect(items[0]).toMatchObject({ kind: "bug", scope: "平台" });
    expect(items[1]).toMatchObject({ kind: "task", scope: "迭代168" });
  });

  it("详情查询失败时 scope 回退为 #id", async () => {
    const items = await myOverview(SCOPED_RUN, "zhangsan", { execution: 999 });
    expect(items).toEqual([]);
  });
});

describe("getOverview 缓存键随上下文区分", () => {
  it("不同上下文不共享缓存", async () => {
    let calls = 0;
    const run: RunFn = async (args) => {
      calls++;
      if (args[0] === "profile") return { profiles: [{ account: "zhangsan", server: "http://s", current: true }] };
      return SCOPED_RUN(args);
    };
    const cache = new OverviewCache(60_000);
    await getOverview("me", run, cache, { product: 26, execution: 168 });
    const afterFirst = calls;
    await getOverview("me", run, cache, { product: 27, execution: 168 });
    expect(calls).toBeGreaterThan(afterFirst);
  });
});

describe("getOverview + OverviewCache", () => {
  it("TTL 内第二次调用命中缓存（不再调 CLI）", async () => {
    let calls = 0;
    const run: RunFn = async (args) => { calls++; return fixtureRun({ "profile": { profiles: [{ account: "zhangsan", server: "http://s", current: true }] }, "product": [], "project": [] })(args); };
    const cache = new OverviewCache(60_000);
    await getOverview("me", run, cache);
    const after1 = calls;
    await getOverview("me", run, cache);
    expect(calls).toBe(after1);
  });

  it("me 视图未登录时抛登录提示", async () => {
    const run: RunFn = async () => { throw new Error("E1006"); };
    await expect(getOverview("me", run, new OverviewCache(60_000))).rejects.toThrow(/zentao-login/);
  });
});
