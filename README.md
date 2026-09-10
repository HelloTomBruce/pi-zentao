# pi-zentao

pi（[@earendil-works/pi-coding-agent](https://github.com/earendil-works/pi-mono)）的禅道（ZenTao）插件：在 pi 会话中查询和操作禅道数据。

所有禅道数据通过 `zentao` CLI 子进程获取——凭证由 zentao CLI 管理，插件不接触、不读取凭证文件。

## 功能

**LLM 工具（2 个）**

| 工具 | 说明 |
|------|------|
| `zentao` | 通用薄代理：`module`（19 个模块）× `action`（list/get/create/update/delete/状态流转），支持范围参数与字段透传 |
| `zentao_my_overview` | 一键聚合：`view=me` 我的待办（激活 Bug + 未完成任务，按优先级排序）；`view=project` 进行中项目的 Bug 统计 |

**斜杠命令（3 个）**

| 命令 | 说明 |
|------|------|
| `/zentao <module> [args]` | 直接执行 CLI，不经过 LLM（零 token），结果以表格卡片留在对话流（不进入 LLM 上下文） |
| `/zentao-executions <产品ID>` | 产品下的所有执行（产品名 + ID/名称/状态/起止时间表） |
| `/zentao-context` | 显示当前项目 `zentao.config.json` 解析出的上下文 |
| `/zentao-login` | 检查/执行登录；未登录时本地 TUI 收集地址/账号/密码（不进入对话） |
| `/zentao-overview [me\|project]` | 编辑器下方常驻概览面板；重复同视图关闭，不同视图切换 |

**TUI 增强**

- 状态栏：`禅道 <账号>@<主机>`，未登录显示灰色"禅道 未登录"
- 工具结果表格渲染：列表按模块取列（id/标题/严重/优先级/状态/指派人），CJK 宽字符对齐，默认紧凑 10 行，展开看全部
- 概览面板：我的待办或项目健康度，数据 5 分钟 TTL 缓存

## 安装

方式一：发布到 npm 后（或自托管 registry）：

```bash
pi install npm:pi-zentao
```

方式二：本地路径（开发/自用）——在 `~/.pi/agent/settings.json` 的 `extensions` 数组加入插件入口：

```json
{
  "extensions": ["/绝对路径/pi-zentao/src/index.ts"]
}
```

修改后执行 `/reload` 或重启 pi 生效。

## 前置条件

- Node.js >= 22
- 首次使用需登录禅道，二选一：
  - 在 pi 中执行 `/zentao-login`（对话内走完登录流程）
  - 在终端执行 `zentao login`（插件与终端 CLI 共享凭证）

登录凭证由 zentao CLI 管理于 `~/.config/zentao/zentao.json`，**插件不读取、不接触**该文件及 `ZENTAO_PASSWORD`/`ZENTAO_TOKEN` 环境变量。`/zentao-login` 通过环境变量把密码传给 CLI 子进程（不出现在进程参数中），密码也不进入对话或 LLM 上下文。

## 项目级上下文（zentao.config.json）

在项目根目录放置 `zentao.config.json`（字段全可选）：

```json
{ "product": 26, "project": 167, "execution": 168 }
```

效果（优先级：显式参数 > 配置文件 > 原有报错）：

- `zentao` 工具 list 动作缺范围参数时自动补全——对话直接问"有哪些激活 Bug""我的任务有哪些"即可，LLM 无需知道 ID
- `zentao_my_overview` 的 me 视图只查配置的 product（Bug）+ execution（任务），从全量扫描降为 2 次查询
- 状态栏追加上下文：`禅道 account@host · 产品26/执行168`

用 `/zentao-context` 查看当前解析结果；直接编辑文件即生效（每次调用实时读取，无需重载）。文件可提交到仓库与团队共享，也可加入 `.gitignore`。

## 使用示例

**对话（经 LLM）**

```
你：查一下产品 26 的激活 Bug
→ LLM 调用 zentao(module=bug, action=list, product=26)，表格渲染结果

你：我今天该干什么
→ LLM 调用 zentao_my_overview(view=me)
```

**命令（零 token）**

```
/zentao product                              # 产品列表表格卡片
/zentao bug --product=26                     # 产品 26 的 Bug
/zentao execution --product=26               # 产品 26 下的执行（LLM 工具同样支持 product 范围）
/zentao-executions 26                        # 同上，一键直达（产品名 + 执行表格）
/zentao-overview project                     # 切换到项目健康度
/zentao-overview project                     # 同视图 → 关闭面板
/zentao-login                                # 检查/执行登录
```

已知规则（LLM 工具 description 中同样有说明）：

- `bug resolve` 必须同时提供 `resolution` + `assignedTo` + `resolvedBuild` + `comment` 四个字段
- 列表统一拉取最多 200 行，请按 `status`/`assignedTo` 等字段自行过滤

## 开发

```bash
npm install
npm run verify        # tsc --noEmit + vitest run
```

- pi 用 jiti 直接运行 TypeScript，无需编译；核心逻辑（CLI 层/参数映射/聚合/渲染）均有 vitest 单测
- 修改后用 `/reload` 热重载扩展，无需重启 pi
- 本机开发接线：`~/.pi/agent/settings.json` → `extensions` 数组加入本仓库 `src/index.ts` 绝对路径

## 许可

MIT
