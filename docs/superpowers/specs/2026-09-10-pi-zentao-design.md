# pi-zentao 设计规格

日期：2026-09-10
状态：已批准（头脑风暴阶段完成）

## 1. 背景与目标

为 pi（@earendil-works/pi-coding-agent）开发一个禅道（ZenTao）插件，让用户在 pi 会话中查询和操作禅道数据。

现有资产：

- `zentao-cli`（npm 包，本机已装 0.2.0）：覆盖 18 个禅道模块的 CRUD 与状态流转，自动处理认证/分页，凭证缓存于 `~/.config/zentao/zentao.json`。
- `~/code/dsh-zentao`：DSH（deepseek-harness）平台的同类插件，其 `src/lib/cli.ts`（CLI 调用层）与 `src/schema.ts`（参数映射）已验证，可移植。

目标形态（用户已确认）：**完整形态** = LLM 工具 + 斜杠命令 + TUI 增强（状态栏 / 表格渲染 / 概览面板），独立工程、以 pi package 形式分发。

## 2. 工程结构

仓库：`~/code/pi-zentao`，TypeScript，pi 通过 jiti 直接运行 TS，无需编译产物。

```
pi-zentao/
├── package.json        # deps: zentao-cli；"pi": { "extensions": ["./src/index.ts"] }
├── tsconfig.json       # 仅用于 typecheck
├── README.md
├── docs/superpowers/specs/2026-09-10-pi-zentao-design.md（本文档）
└── src/
    ├── index.ts          # 入口 factory：组装下列各模块
    ├── lib/cli.ts        # CLI 调用层
    ├── lib/schema.ts     # module/action → CLI argv 映射
    ├── lib/overview.ts   # 聚合逻辑：我的待办 / 项目健康度
    ├── tools/zentao.ts   # LLM 工具 1：通用薄代理
    ├── tools/my-overview.ts # LLM 工具 2：zentao_my_overview
    ├── commands.ts       # /zentao /zentao-login /zentao-overview
    └── ui.ts             # 表格渲染、状态栏、widget
```

## 3. CLI 调用层（lib/cli.ts）

移植 dsh-zentao 的 `src/lib/cli.ts`，**一处关键改动**：不设置 `ZENTAO_CONFIG_FILE` 环境变量，使用 CLI 默认配置路径 `~/.config/zentao/zentao.json`——用户在终端 `zentao login` 一次，插件与终端共享凭证。

行为：

- 优先使用 npm 依赖内的 bundled zentao-cli（`createRequire` 解析 `zentao-cli/package.json`，以 `process.execPath` 直接执行其 bin 脚本，不依赖 PATH）；解析失败时回退全局 `zentao` 命令。
- 所有调用自动追加 `--format=json`；超时 30s；maxBuffer 8MB；stdout 为空时回退读 stderr（login 等命令把错误 JSON 写到 stderr）。
- 返回 CLI JSON 输出的 `data` 字段；`error` 字段映射为 `CliError`（带 `code`）。
- 错误码处理：E1001/E1004 → 提示执行 `/zentao-login`；ENOENT → 提示重装插件或全局安装 zentao-cli；E5001 → 提示检查网络/服务状态。
- 插件不读取、不接触任何凭证文件与环境变量。

## 4. LLM 工具

### 4.1 `zentao`（通用薄代理）

参数（typebox；字符串枚举用 `@earendil-works/pi-ai` 的 `StringEnum`，Google 兼容）：

| 参数 | 类型 | 说明 |
|------|------|------|
| `module` | StringEnum，必填 | 18 个模块：program/product/project/execution/story/epic/requirement/bug/task/testcase/testtask/productplan/build/release/feedback/ticket/system/user/file |
| `action` | StringEnum，必填 | list/get/create/update/delete/activate/close/resolve/start/finish/change |
| `id` | number，可选 | get/update/delete/状态动作需要 |
| `product` | number，可选 | 列表范围参数（story/bug/testcase 映射 `--product`；epic/requirement/testtask/productplan/release/feedback/ticket/system 映射 `--productID`，插件自动处理） |
| `project` | number，可选 | 列表范围参数（execution/build 映射 `--project`） |
| `executionID` | number，可选 | task 列表的范围参数（映射 `--executionID`，注意不是 `--execution`） |
| `fields` | object，可选 | create/update/状态动作的字段键值对 |

description 移植 dsh-zentao 已验证版本，要点：范围参数映射规则、`bug resolve` 必须同时提供 resolution + assignedTo + resolvedBuild + comment（服务端强制）、列表上限 200 行需客户端过滤、需提前登录。

执行：

- `lib/schema.ts` 的 `buildCliArgs()` 把参数映射为 CLI argv → `runZentao()`。
- 返回 `content` = 截断后的 JSON 文本（`truncateHead`，上限 50KB / 2000 行，截断时告知 LLM）；`details` = 结构化数据（供渲染层使用）。
- 列表调用统一加 `--recPerPage=200`，避免 `--filter` 与分页参数联用不生效的已知 pitfall；过滤在插件层/LLM 层进行。
- 错误通过 `throw` 抛出（pi 标记 isError 并把错误信息反馈给 LLM，便于自我纠正）。

prompt 元数据：`promptSnippet` 一行简介 + `promptGuidelines`（每条指南显式写出工具名）。

### 4.2 `zentao_my_overview`（场景化聚合）

参数：`view`（StringEnum `me|project`，默认 `me`）。

- 调用 §5 的聚合逻辑，返回结构化概览数据。
- 与概览面板复用同一份聚合代码与 TTL 缓存。

## 5. 聚合逻辑（lib/overview.ts）

- **me 视图**：`zentao profile` 取当前账号 → 遍历活跃产品/执行 → 过滤 `assignedTo=me` 的激活 Bug（status:active）与未完成任务（status 非 done/closed/cancel）→ 按 pri 升序。
- **project 视图**：`zentao project` 过滤 status:doing → 每个项目查 Bug 统计（激活/已解决/已关闭计数）。
- 会话内 TTL 缓存 5 分钟（键：`view`），避免重复触发十几次串行 CLI 调用；`session_shutdown` 时清理。

## 6. 命令与 TUI

### 6.1 `/zentao <原始参数>`

- 不经过 LLM（零 token），参数原样透传给 CLI，结果用 `pi.appendEntry("zentao-card", data)` + `pi.registerEntryRenderer` 渲染为**表格卡片**，留在对话流中但**不进入 LLM 上下文**。
- 列表渲染为对齐表格（默认列：id/title/status/pri/assignedTo，按模块微调）；详情渲染为 KV 列表；写操作渲染 ✓ 摘要。

### 6.2 `/zentao-login`

- 先跑 `zentao profile` 检查状态：已登录 → 显示当前账号与服务器。
- 未登录 → 用 `ctx.ui.input` 依次收集 server / account / password（本地 TUI 输入，不进入对话、不发送给 LLM），通过**环境变量**（`ZENTAO_URL` / `ZENTAO_ACCOUNT` / `ZENTAO_PASSWORD`）传给 `zentao login`，避免密码出现在进程参数列表中。
- 登录成功后刷新状态栏。

### 6.3 `/zentao-overview [me|project]`

- 拉取概览数据，用 `ctx.ui.setWidget("zentao-overview", ...)`（placement: belowEditor）渲染为常驻面板。
- 面板切换规则：面板未显示 → 按指定 view（缺省 me）显示；面板已显示且 view 不同 → 切换到新 view；面板已显示且 view 相同（或无参时与当前视图相同）→ 关闭面板。
- 面板内容：me 视图 = 我的激活 Bug / 未完成任务列表（id + 标题 + 优先级）；project 视图 = 进行中项目 + Bug 统计。

### 6.4 状态栏

- `session_start` 时异步执行 `zentao profile`，成功 → `ctx.ui.setStatus("zentao", "禅道 <account>@<host>")`；失败 → 灰色 `禅道 未登录`。
- `ctx.mode === "tui"` 才启用；`session_shutdown` 清理。

### 6.5 工具结果渲染（renderCall / renderResult）

- `renderCall`：`zentao <module> <action> [#id]` 一行摘要。
- `renderResult`：
  - 列表 → 对齐表格，默认紧凑（前 10 行 + `共 N 条`），`expanded` 时全量；
  - 详情 → KV 列表；
  - 写操作/状态流转 → `✓` + 摘要；
  - `isPartial` → 进行中提示。
- 数据取自 `result.details`，不解析 `content` 文本。

## 7. 错误处理

| 场景 | 工具路径 | 命令路径 |
|------|---------|---------|
| 未登录 / token 失效（E1001/E1004） | throw，消息含"请执行 /zentao-login" | notify error，同样提示 |
| CLI 缺失（ENOENT） | throw，提示重装插件或 `npm i -g zentao-cli` | notify error |
| 超时（E5001） | throw，提示检查网络/禅道服务 | notify error |
| 对象不存在（E2002）等 | throw，透传 CLI 错误码与消息 | notify error |

非 TUI 模式（print/json/rpc）下：工具照常工作；`setStatus`/`setWidget`/对话框按 `ctx.mode` / `ctx.hasUI` 守卫。

## 8. 测试

- vitest 单测（不依赖真实禅道服务，CLI 层注入 mock exec）：
  - `buildCliArgs`：18 模块 × 动作 × 范围参数的映射矩阵，重点覆盖 product/productID 自动映射、task 的 executionID、bug resolve 四字段；
  - `parseOutput`：正常 data、error 字段映射、非 JSON 输出、stderr 回退；
  - `overview.ts`：me/project 聚合逻辑与过滤、TTL 缓存命中。
- `npm run verify` = `tsc --noEmit` + `vitest run`。
- 手动验收清单：
  1. `pi -e ~/code/pi-zentao/src/index.ts` 加载无报错；
  2. 状态栏显示当前禅道账号；
  3. `/zentao product` 出表格卡片；
  4. LLM 对话"查一下产品 26 的激活 Bug"正确调用 zentao 工具并渲染表格；
  5. "我今天该干什么"触发 `zentao_my_overview`；
  6. `/zentao-overview me` / `/zentao-overview project` 面板切换正常；
  7. 退出登录态后调用工具，错误信息提示 `/zentao-login`。

## 9. 开发与分发

- 开发期：`~/.pi/agent/settings.json` 的 `extensions` 数组加入 `~/code/pi-zentao/src/index.ts`，`/reload` 热重载。
- 分发：仓库含 `package.json`（`"pi": { "extensions": ["./src/index.ts"] }`，`zentao-cli` 在 `dependencies`），成熟后 `npm publish`，用户 `pi install npm:pi-zentao`（pi 以 `--omit=dev` 安装）。

## 10. 明确不做（YAGNI）

- `#bug` 自动补全（autocomplete provider）
- 自定义 footer / 快捷键
- 晨会日报等高层场景模板
- 插件私有凭证文件（与终端 CLI 共享 `~/.config/zentao/zentao.json` 即可）
- Bug 附件图片提取（steps 内嵌图片下载）
