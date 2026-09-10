// tests/ui.test.ts
import { describe, expect, it } from "vitest";
import { cellText, columnsFor, displayWidth, overviewLines, tableText } from "../src/ui.ts";

describe("displayWidth", () => {
  it("CJK 字符计 2 宽", () => {
    expect(displayWidth("ab禅道")).toBe(6);
    expect(displayWidth("")).toBe(0);
  });
});

describe("cellText", () => {
  it("对象取 account/realname/name/id", () => {
    expect(cellText({ account: "admin" })).toBe("admin");
    expect(cellText(null)).toBe("");
    expect(cellText(3)).toBe("3");
  });
});

describe("tableText", () => {
  const rows = [
    { id: "1", title: "登录失败", status: "active" },
    { id: "2", title: "页面样式错乱问题", status: "closed" },
  ];
  const cols = [
    { key: "id", label: "ID" },
    { key: "title", label: "标题" },
    { key: "status", label: "状态" },
  ];

  it("列按显示宽度对齐", () => {
    const out = tableText(rows, cols, 10);
    const lines = out.split("\n");
    expect(lines[0]).toContain("ID");
    expect(lines[1]).toMatch(/^1\s+登录失败/);
    expect(displayWidth(lines[1].split("登录失败")[0])).toBe(displayWidth(lines[2].split("页面样式错乱问题")[0]));
  });

  it("超过 maxRows 追加总数提示", () => {
    const out = tableText(rows, cols, 1);
    expect(out).toContain("共 2 条");
  });
});

describe("columnsFor", () => {
  it("bug 有 severity/pri 列", () => {
    expect(columnsFor("bug").map((c) => c.key)).toEqual(["id", "title", "severity", "pri", "status", "assignedTo"]);
  });
  it("未知模块回退默认列", () => {
    expect(columnsFor("nope")[0].key).toBe("id");
  });
});

describe("overviewLines", () => {
  it("me 视图空数据", () => {
    expect(overviewLines("me", [])[0]).toContain("没有待办");
  });
  it("project 视图输出统计行", () => {
    const lines = overviewLines("project", [{ id: "5", name: "存储平台", bugActive: 3, bugResolved: 2, bugClosed: 9 }]);
    expect(lines[1]).toContain("存储平台");
    expect(lines[1]).toContain("激活 3");
  });
});
