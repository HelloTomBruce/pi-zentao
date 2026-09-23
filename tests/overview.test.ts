// tests/overview.test.ts
import { describe, expect, it } from "vitest";
import { accountOf, getOverview, myOverview, OverviewCache, projectOverview } from "../src/lib/overview.ts";
import type { RunFn } from "../src/lib/cli.ts";

/** 按 argv 路由的夹具 RunFn。值若为 Error 则抛出（模拟 CLI 错误）。 */
function fixtureRun(map: Record<string, unknown>): RunFn {
  return async (args) => {
    const key = args.join(" ");
    for (const [k, v] of Object.entries(map)) {
      if (key.startsWith(k)) {
        if (v instanceof Error) throw v;
        return v;
      }
    }
    return [];
  };
}

/** 构造带 code 的错误（模拟 CLI 错误码）。 */
function errOf(code: string): Error & { code: string } {
  const e = new Error(`zentao: ${code}`) as Error & { code: string };
  e.code = code;
  return e;
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
  // 服务器 22.0：my 模块不可用（2010），myOverview 回退到扫描路径
  "my bugs": errOf("2010"),
  "my tasks": errOf("2010"),
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
    const { items } = await myOverview(ME_RUN, "zhangsan");
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
    const { items: stats } = await projectOverview(run);
    expect(stats).toEqual([{ id: "5", name: "P5", bugActive: 2, bugResolved: 1, bugClosed: 1 }]);
  });
});

const SCOPED_RUN = fixtureRun({
  // 服务器 22.0：my 模块不可用（2010），myOverview 回退到 scoped 扫描
  "my bugs": errOf("2010"),
  "my tasks": errOf("2010"),
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
    const { items } = await myOverview(SCOPED_RUN, "zhangsan", { product: 26, execution: 168 });
    expect(items.map((i) => i.id)).toEqual(["11", "21"]);
    expect(items[0]).toMatchObject({ kind: "bug", scope: "平台" });
    expect(items[1]).toMatchObject({ kind: "task", scope: "迭代168" });
  });

  it("有项目上下文且 my 模块可用时走 scoped 路径，不调 my（P1 回归）", async () => {
    const run = fixtureRun({
      // my 若被调用则抛 E5001（非版本错误）——测试直接失败暴露
      "my bugs": errOf("E5001"),
      "my tasks": errOf("E5001"),
      "product 26": { id: "26", name: "平台" },
      "bug --product=26": [{ id: "11", title: "我的Bug", status: "active", pri: 1, assignedTo: "zhangsan" }],
      "execution 168": { id: "168", name: "迭代168" },
      "task --executionID=168": [{ id: "21", name: "我的任务", status: "doing", pri: 2, assignedTo: "zhangsan" }],
    });
    const { items } = await myOverview(run, "zhangsan", { product: 26, execution: 168 });
    expect(items.map((i) => i.id)).toEqual(["11", "21"]);
    expect(items[0]).toMatchObject({ kind: "bug", scope: "平台" });
    expect(items[1]).toMatchObject({ kind: "task", scope: "迭代168" });
  });

  it("详情查询失败时 scope 回退为 #id", async () => {
    const { items } = await myOverview(SCOPED_RUN, "zhangsan", { execution: 999 });
    expect(items).toEqual([]);
  });

  it("scoped 任务查询使用原生 --sort=id:desc（最新在前，不再用 --params orderBy）", async () => {
    const seen: string[][] = [];
    const run: RunFn = async (args) => {
      if (args[0] === "my") throw errOf("2010"); // 服务器 22.0：my 模块不可用
      seen.push(args);
      if (args[0] === "execution") return { id: "65", name: "巨型执行" };
      if (args[0] === "task") return [{ id: "16364", name: "能耗配置管理", status: "doing", pri: 3, assignedTo: "zhangsan" }];
      return [];
    };
    const res = await myOverview(run, "zhangsan", { execution: 65 });
    expect(res.items.map((i) => i.id)).toEqual(["16364"]);
    const taskCall = seen.find((a) => a[0] === "task");
    expect(taskCall).toContain("--sort=id:desc");
    expect(taskCall?.join(" ")).not.toContain("--params");
  });

  it("来源列表达到页大小上限时标记 truncated", async () => {
    const manyTasks = Array.from({ length: 1000 }, (_, i) => ({
      id: String(20000 + i), name: `t${i}`, status: "doing", pri: 3, assignedTo: "lisi",
    }));
    const run: RunFn = async (args) => {
      if (args[0] === "my") throw errOf("2010"); // 服务器 22.0：my 模块不可用
      if (args[0] === "execution") return { id: "65", name: "巨型执行" };
      if (args[0] === "task") return manyTasks;
      return [];
    };
    const res = await myOverview(run, "zhangsan", { execution: 65 });
    expect(res.truncated).toBe(true);
    expect(res.items).toEqual([]); // 列表里无 zhangsan 的任务，但不静默——靠 truncated 提示
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
    const run: RunFn = async (args) => { calls++; return fixtureRun({ "profile": { profiles: [{ account: "zhangsan", server: "http://s", current: true }] }, "my bugs": errOf("2010"), "my tasks": errOf("2010"), "product": [], "project": [] })(args); };
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

const MY_FAST_RUN = fixtureRun({
  "my bugs": [
    { id: "11", title: "我的Bug", status: "active", pri: 1, product: "26" },
    { id: "12", title: "已解决", status: "resolved", pri: 2, product: "26" },
  ],
  "my tasks": [
    { id: "21", name: "我的任务", status: "doing", pri: 2, execution: "168" },
    { id: "22", name: "已完成", status: "done", pri: 1, execution: "168" },
  ],
  "my todos": [
    { id: "31", name: "写周报", status: "wait", date: "2026-09-24" },
    { id: "32", name: "已完成待办", status: "done", date: "2026-09-23" },
  ],
});

describe("myOverview 快路径（my 模块）", () => {
  it("一次调用取回 bug/task/todo，过滤状态后按 pri 排序", async () => {
    const { items } = await myOverview(MY_FAST_RUN, "zhangsan");
    expect(items.map((i) => i.id)).toEqual(["11", "21", "31"]);
    expect(items[2]).toMatchObject({ kind: "todo", title: "写周报", pri: "", scope: "2026-09-24" });
  });

  it("my todos 报 2010 时跳过待办，bug/task 正常", async () => {
    const run = fixtureRun({
      "my bugs": [{ id: "11", title: "B", status: "active", pri: 1, product: "26" }],
      "my tasks": [],
      "my todos": errOf("2010"),
    });
    const { items } = await myOverview(run, "zhangsan");
    expect(items.map((i) => i.id)).toEqual(["11"]);
  });

  it("my bugs 报 2010 时整体回退到扫描路径", async () => {
    const run = fixtureRun({
      "my bugs": errOf("2010"),
      "profile": { profiles: [{ account: "zhangsan", server: "http://s", current: true }] },
      "product": [{ id: "1", name: "平台", status: "normal" }],
      "bug --product=1": [{ id: "11", title: "我的Bug", status: "active", pri: 1, assignedTo: "zhangsan" }],
      "project": [],
    });
    const { items } = await myOverview(run, "zhangsan");
    expect(items.map((i) => i.id)).toEqual(["11"]);
    expect(items[0]).toMatchObject({ kind: "bug", scope: "平台" });
  });

  it("scoped 任务列表使用原生 --sort=id:desc（不再用 --params orderBy）", async () => {
    const calls: string[][] = [];
    const run: RunFn = async (args) => {
      if (args[0] === "my") throw errOf("2010"); // 服务器 22.0：my 模块不可用，走 scoped
      calls.push(args);
      return [];
    };
    await myOverview(run, "zhangsan", { product: 26, execution: 168 });
    const taskCall = calls.find((c) => c[0] === "task");
    expect(taskCall).toContain("--sort=id:desc");
    expect(taskCall?.join(" ")).not.toContain("--params");
  });
});
