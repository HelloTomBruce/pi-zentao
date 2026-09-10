// tests/context.test.ts
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONTEXT_FILENAME, describeContext, loadContext, parseContext } from "../src/lib/context.ts";

describe("parseContext", () => {
  it("解析完整配置", () => {
    expect(parseContext('{"product":26,"project":167,"execution":168}')).toEqual({ product: 26, project: 167, execution: 168 });
  });

  it("字段可选、忽略未知字段", () => {
    expect(parseContext('{"product":26,"extra":"x"}')).toEqual({ product: 26 });
    expect(parseContext("{}")).toEqual({});
  });

  it("非正整数或类型错误时该字段忽略", () => {
    expect(parseContext('{"product":0,"project":-1,"execution":"168"}')).toEqual({});
    expect(parseContext('{"product":1.5}')).toEqual({});
  });

  it("非法 JSON / 非对象返回空上下文", () => {
    expect(parseContext("not json")).toEqual({});
    expect(parseContext("[1,2]")).toEqual({});
    expect(parseContext('"str"')).toEqual({});
  });
});

describe("loadContext", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "pi-zentao-ctx-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("文件缺失返回空上下文", () => {
    expect(loadContext(dir)).toEqual({});
  });

  it("读取 zentao.config.json", () => {
    writeFileSync(join(dir, CONTEXT_FILENAME), '{"product":26,"execution":168}');
    expect(loadContext(dir)).toEqual({ product: 26, execution: 168 });
  });

  it("文件损坏返回空上下文", () => {
    writeFileSync(join(dir, CONTEXT_FILENAME), "{broken");
    expect(loadContext(dir)).toEqual({});
  });
});

describe("describeContext", () => {
  it("按可用字段拼接中文描述", () => {
    expect(describeContext({ product: 26, project: 167, execution: 168 })).toBe("产品26/项目167/执行168");
    expect(describeContext({ execution: 168 })).toBe("执行168");
    expect(describeContext({})).toBe("");
  });
});
