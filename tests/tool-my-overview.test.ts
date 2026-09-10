// tests/tool-my-overview.test.ts
import { describe, expect, it } from "vitest";
import { executeMyOverview } from "../src/tools/my-overview.ts";
import { OverviewCache } from "../src/lib/overview.ts";
import type { RunFn } from "../src/lib/cli.ts";

const RUN: RunFn = async (args) => {
  const key = args.join(" ");
  if (key.startsWith("profile")) return { profiles: [{ account: "zhangsan", server: "http://s", current: true }] };
  if (key.startsWith("product")) return [{ id: "1", name: "平台", status: "normal" }];
  if (key.startsWith("bug --product=1")) return [{ id: "11", title: "我的Bug", status: "active", pri: 1, assignedTo: "zhangsan" }];
  if (key.startsWith("project")) return [];
  return [];
};

const LONG_TITLE = "x".repeat(1000);

const RUN_BIG: RunFn = async (args) => {
  const key = args.join(" ");
  if (key.startsWith("profile")) return { profiles: [{ account: "zhangsan", server: "http://s", current: true }] };
  if (key.startsWith("product")) return [{ id: "1", name: "平台", status: "normal" }];
  if (key.startsWith("bug --product=1")) {
    return Array.from({ length: 60 }, (_, i) => ({
      id: String(i + 1),
      title: LONG_TITLE,
      status: "active",
      pri: 1,
      assignedTo: "zhangsan",
    }));
  }
  return [];
};

describe("executeMyOverview", () => {
  it("me 视图返回我的待办", async () => {
    const res = await executeMyOverview("me", RUN, new OverviewCache(60_000));
    expect(res.details).toMatchObject({ view: "me", count: 1 });
    expect(res.content[0].text).toContain("我的Bug");
  });

  it("project 视图返回统计", async () => {
    const res = await executeMyOverview("project", RUN, new OverviewCache(60_000));
    expect(res.details).toMatchObject({ view: "project", count: 0 });
  });

  it("大数据触发截断", async () => {
    const res = await executeMyOverview("me", RUN_BIG, new OverviewCache(60_000));
    expect(res.content[0].text).toContain("[输出已截断");
  });
});
