// tests/commands.test.ts
import { describe, expect, it } from "vitest";
import {
  isValidId,
  buildListArgs,
  buildGetArgs,
  buildProjectDetailArgs,
  buildExecutionDetailArgs,
  buildProductExecutionsArgs,
  splitArgs,
  splitViewArgs,
  buildScopedModuleArgs,
  buildMyTodosArgs,
  buildProductDocsArgs,
} from "../src/commands.ts";

describe("isValidId", () => {
  it("正整数通过", () => {
    expect(isValidId("1")).toBe(true);
    expect(isValidId("167")).toBe(true);
    expect(isValidId("999999")).toBe(true);
  });

  it("非数字/空/负数/浮点不通过", () => {
    expect(isValidId("")).toBe(false);
    expect(isValidId("abc")).toBe(false);
    expect(isValidId("12a")).toBe(false);
    expect(isValidId("-1")).toBe(false);
    expect(isValidId("1.5")).toBe(false);
  });
});

describe("buildListArgs", () => {
  it("默认页大小 200", () => {
    expect(buildListArgs("product")).toEqual(["product", "--recPerPage=200"]);
    expect(buildListArgs("project")).toEqual(["project", "--recPerPage=200"]);
  });

  it("可指定页大小", () => {
    expect(buildListArgs("bug", 500)).toEqual(["bug", "--recPerPage=500"]);
  });
});

describe("buildGetArgs", () => {
  it("构造 module + id 参数", () => {
    expect(buildGetArgs("task", "42")).toEqual(["task", "42"]);
    expect(buildGetArgs("bug", "123")).toEqual(["bug", "123"]);
    expect(buildGetArgs("story", "45")).toEqual(["story", "45"]);
  });
});

describe("buildProjectDetailArgs", () => {
  const args = buildProjectDetailArgs("167");

  it("detail 是 project --search（因为 CLI 不支持 project <id>）", () => {
    expect(args.detail).toEqual(["project", "--search", "167", "--recPerPage=200"]);
  });

  it("children 是 execution 按 project 列表", () => {
    expect(args.children).toEqual(["execution", "--project=167", "--recPerPage=200"]);
  });
});

describe("buildExecutionDetailArgs", () => {
  const args = buildExecutionDetailArgs("168");

  it("detail 是 execution get", () => {
    expect(args.detail).toEqual(["execution", "168"]);
  });

  it("children 是 task 按 executionID 列表", () => {
    expect(args.children).toEqual(["task", "--executionID=168", "--recPerPage=200"]);
  });
});

describe("buildProductExecutionsArgs", () => {
  const args = buildProductExecutionsArgs("26");

  it("product 是 product get", () => {
    expect(args.product).toEqual(["product", "26"]);
  });

  it("executions 是 execution 按 product 列表", () => {
    expect(args.executions).toEqual(["execution", "--product=26", "--recPerPage=200"]);
  });
});

describe("splitArgs", () => {
  it("按空格切分简单参数", () => {
    expect(splitArgs("bug --product=26")).toEqual(["bug", "--product=26"]);
  });

  it("空字符串返回空数组", () => {
    expect(splitArgs("")).toEqual([]);
  });

  it("多余空格不产生空元素", () => {
    expect(splitArgs("  bug   --product=26  ")).toEqual(["bug", "--product=26"]);
  });

  it("支持单引号包裹含空格的参数", () => {
    expect(splitArgs("task '--title=hello world'")).toEqual([
      "task",
      "--title=hello world",
    ]);
  });

  it("支持双引号包裹含空格的参数", () => {
    expect(splitArgs('task "--title=hello world"')).toEqual([
      "task",
      "--title=hello world",
    ]);
  });

  it("无参数的模块名", () => {
    expect(splitArgs("product")).toEqual(["product"]);
  });
});

describe("splitViewArgs", () => {
  it("解析可选 ID 与 --filter/--sort/--pick/--limit 标志", () => {
    expect(splitViewArgs("167 --sort=pri:asc")).toEqual({ id: "167", flags: ["--sort=pri:asc"] });
    expect(splitViewArgs("--filter=status=doing --limit=5")).toEqual({ id: undefined, flags: ["--filter=status=doing", "--limit=5"] });
  });

  it("非法参数返回 null", () => {
    expect(splitViewArgs("--bogus=1")).toBeNull();
    expect(splitViewArgs("167 168")).toBeNull();
    expect(splitViewArgs("abc")).toBeNull();
  });
});

describe("buildScopedModuleArgs（issue/risk/meeting）", () => {
  it("带项目 ID → projectX 操作", () => {
    expect(buildScopedModuleArgs("issue", "167")).toEqual(["issue", "projectIssues", "--projectID=167", "--recPerPage=200"]);
    expect(buildScopedModuleArgs("risk", "167")).toEqual(["risk", "projectRisks", "--projectID=167", "--recPerPage=200"]);
    expect(buildScopedModuleArgs("meeting", "167")).toEqual(["meeting", "projectMeetings", "--projectID=167", "--recPerPage=200"]);
  });

  it("无 ID → 全局列表", () => {
    expect(buildScopedModuleArgs("issue", undefined)).toEqual(["issue", "--recPerPage=200"]);
  });
});

describe("buildMyTodosArgs / buildProductDocsArgs", () => {
  it("我的待办", () => {
    expect(buildMyTodosArgs()).toEqual(["my", "todos", "--recPerPage=200"]);
  });

  it("产品文档：先列库再按库取文档", () => {
    const { libs, docs } = buildProductDocsArgs("26");
    expect(libs).toEqual(["doc", "productLibs", "--productID=26", "--recPerPage=200"]);
    expect(docs("7")).toEqual(["doc", "productDocs", "--productID=26", "--libID=7", "--recPerPage=200"]);
  });
});
