# dsh-cpa

> [English](README.en.md) | **简体中文**

为 dsh 接入 CLI Proxy API（CPA）的插件。安装后会注册 `cpa` provider，dsh 中的对话可以使用 CPA 管理的模型和账号。

---

## 用户指南

### 要求

- Node.js `>=26.13.0`
- 已安装 dsh
- 使用自动启动模式时，`cli-proxy-api` 需在 `PATH` 中，或在设置中填写它的绝对路径

### 安装

```sh
npx @deepseek-ai/dsh plugin --profile web add dsh-cpa
```

headless profile：

```sh
npx @deepseek-ai/dsh plugin --profile headless add dsh-cpa
```

### 连接 CPA

在设置面板的 CPA 页面选择一种模式：

- **自动启动（内部）**：默认模式。插件生成 `$DSH_HOME/cpa/config.yaml`，启动 `cli-proxy-api`，并自动注入所需的 key。
- **已有 CPA（外部）**：填写 URL、API key 和 management key，然后点击“应用”。

CPA 的管理面板会在弹窗中打开。只有内部 CPA 运行时，才显示“停止”操作。

### 模型

- 插件每 5 分钟从 CPA 的 `/v1/models` 同步一次模型列表。
- 同步失败时保留上一次的列表，并按指数退避重试。
- 模型声明支持图片输入时，用户消息中的图片会随请求发送。带图片的请求只会路由到同样支持图片的模型。

### 路由与故障切换

- 你选择的模型永远是第一候选。
- 只有在回复尚未输出任何内容时，遇到额度耗尽、限流、服务端错误、网络错误或空响应，才会切换到下一个候选。
- 回复开始输出后不会重试，避免重复内容或重复执行副作用。
- 高级设置中的“路由策略”（平衡、质量、可用性、额度优先）只影响候选排序，不改变 CPA 的账号切换。
- 账号和凭据始终由 CPA 管理。CPA 管理接口暂时不可用时，插件使用最近一次的账号和额度快照做路由；没有快照时，仍优先保证请求可用，不会把查询失败显示为最新额度。

### 状态行与额度

输入框下方的状态行显示当前连接的额度。没有可用额度时，显示当前模型。

- ChatGPT/Codex 和 Claude 账号显示 5 小时窗口；7 天窗口只在剩余额度不高于 20% 时追加显示。
- 其他服务商显示最紧张的额度窗口。
- 额度偏低或请求失败时，状态行使用 dsh 原生的警告或错误颜色。
- 当前会话未使用 `cpa` provider 时，状态行隐藏。
- 点击状态行可展开查看额度、账号、来源、Base URL、前缀、模型、CPA trace ID 和 request ID。有 request ID 时，还可打开 CPA 的原始请求日志。

Codex 和 Claude 的额度来自推理响应头，只反映最近一次实际路由到的账号：

- 内部 CPA 的托管配置会开启 `requests.passthrough-headers`。外部 CPA 需要自行开启。
- WebSocket 路由不会返回额度响应头，因此没有这部分额度。
- 插件不会轮询 Anthropic 额度接口，因为该接口限流很严格。

### 用量与提醒

- 内部 CPA 默认开启用量统计（`observability.usage.usage-statistics-enabled`），可在设置面板中关闭。
- “每日请求提醒”是软阈值，默认 `0`（关闭）。达到阈值后，只在诊断和设置页提示，不会阻断请求。
- CPA 没有统一的价格模型，插件不会估算金额。

### 设置项

| 模式 | 设置 |
| --- | --- |
| 外部 | URL、API key、management key |
| 内部 | CPA 可执行文件路径（默认 `cli-proxy-api`） |
| 两种模式 | 模型刷新间隔、额度缓存与并发、路由策略、每日请求提醒、执行记录路径 |
| 仅内部 | 端口、配置路径、用量统计开关 |

设置保存在当前 active profile 的 `dsh-cpa` 配置中。

### 诊断

在设置面板的“CPA 连接诊断”中可以手动重新检查：

- 运行状态、模型同步、管理接口、账号和额度
- 模型与账号的可用性矩阵
- 最近 24 小时的本地执行统计（请求、失败、token）。该统计与 CPA 官方用量分开标注。
- CPA 摘要：版本与更新状态、运行配置、用量、账号

诊断报告可导出为脱敏 JSON，不包含 API key、management key、账号 ID、project ID 或凭据。

---

## 开发者指南

### 源码结构

| 路径 | 说明 |
| --- | --- |
| `src/index.ts` | 插件入口 |
| `src/core/` | 配置、适配器、路由、服务、额度响应头解析 |
| `src/server/` | 运行时、管理路由、数据汇总、额度查询 |
| `src/client/` | 浏览器端：设置面板、状态行、输入框停靠 |
| `lib/` | 构建产物，已被 git 忽略，不要手动修改 |
| `tests/` | 测试，运行前会先构建 |

### 构建与检查

```sh
npm run build                                   # tsc 编译 Server 端到 lib/，esbuild 打包 client 为 lib/client.js
npm run check                                   # build + 客户端/测试类型检查 + oxlint
npm test                                        # 先构建，再运行 tests/**/*.test.ts
```

从源码安装到本地 dsh：

```sh
npm run build
npx @deepseek-ai/dsh plugin --profile web add .
```

headless profile 将 `web` 替换为 `headless`。

### 服务端接口

所有接口位于 `/dsh-cpa` 前缀下，由插件服务端提供：

| 路径 | 说明 |
| --- | --- |
| `/dsh-cpa/status` | 运行状态 |
| `/dsh-cpa/settings` | 读取和保存设置 |
| `/dsh-cpa/summary` | CPA 摘要（只读，服务端短时缓存） |
| `/dsh-cpa/diagnostics` | 连接诊断与可用性矩阵（只读） |
| `/dsh-cpa/execution-status?sessionId=...` | 当前会话的状态行数据（只读） |
| `POST /dsh-cpa/preflight` | 接收 `{ model, inputTokens, maxTokens, reasoningEffort }`，返回候选路由和预检结果；只计算路由，不发送模型请求，也不接收消息内容 |
| `GET /dsh-cpa/report` | 脱敏 JSON 诊断报告 |
| `/dsh-cpa/management` | 代理到 CPA 管理面板 |

### 管理 API 约定

- 只使用 CPA 的 v8 管理接口（`/v8/management`）。
- 托管配置按 `config-version: 8` 的嵌套结构生成，读取时只解析 v8 字段。
- 摘要使用的接口包括 `/v8/management/observability/usage/api-keys`、`/v8/management/credentials`、`/v8/management/credentials/models` 和 `/v8/management/config/api-keys`。API key 服务商通过 `auth_index` 与凭据合并。
- 额度查询通过 `/v8/management/requests/api-call` 在服务端完成。
- CPA 管理接口不提供 token 汇总，因此摘要中的 token 始终为 `0`。
- 单个数据源失败时只记录错误，不影响其他数据。

### 数据与隐私

- 浏览器只收到脱敏数据，不会收到 management key 或凭据字段。
- 执行记录保存在 `$DSH_HOME/cpa/executions.json`，写入前已脱敏。
- 旧版 `$DSH_HOME/cpa/settings.json` 只用于兼容读取。
- 模型刷新间隔默认为 `300000` ms（`src/core/config.ts`）。
