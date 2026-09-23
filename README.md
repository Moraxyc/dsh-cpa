# dsh-cpa

> [English](README.en.md) | **简体中文**

CLI Proxy API（CPA）的 `dsh` bundle 插件。注册 `cpa` provider，请求走
CPA 的 `/v1/chat/completions`，同步 `/v1/models` 模型列表。

## 运行要求

`dsh` 需要 `0.1.7-alpha.1` 或更高版本。Web 服务重启后，管理路由依然可用。

## 快速开始

```sh
npx @deepseek-ai/dsh plugin --profile web add dsh-cpa
```

headless profile 同理：

```sh
npx @deepseek-ai/dsh plugin --profile headless add dsh-cpa
```

## 从源码安装

开发或本地构建时使用：

```sh
npx @deepseek-ai/dsh plugin --profile web add .
```

headless profile 同理：

```sh
npx @deepseek-ai/dsh plugin --profile headless add .
```

## 使用已有 CPA

在设置面板切换到“外部 CPA”，填写 `URL`、API key、management key 后点击
“应用”。

## 自动启动 CPA

默认生成 `$DSH_HOME/cpa/config.yaml`，启动 `cli-proxy-api`，并把生成的 key
注入 provider 适配器。启动前会先在 PATH 中解析可执行文件；二进制不在 PATH
时，在 CPA 设置页的内部 CPA 路径中填写绝对路径。

模型每 5 分钟从 `/v1/models` 同步一次。

## Agent 路由与故障切换

请求进入 agent 的 `cpa` provider 时，插件会使用 CPA 已同步的模型能力、上下文窗口、认证账号可用模型和 quota 快照生成候选顺序。用户指定的模型始终是第一候选；只有在请求尚未产生任何流内容，并且 CPA 返回额度耗尽、限流、服务端、传输或空响应类错误时，才会按候选顺序重试。流已经开始后不会重放请求，避免 agent 收到重复内容或产生重复副作用。

路由同时会执行请求预检，记录模型目录、推理级别、上下文窗口、账号健康度和 quota 风险。quota 窗口统一标记为正常、额度偏低、风险高或未知，并参与候选排序。每次尝试会保存候选路由、预检结果、失败代码和自动切换来源；composer 的 CPA 状态详情会展示实际执行链路和切换原因。

management API 临时不可用时，插件会继续使用最近一次脱敏的账号/quota snapshot 做基础路由；snapshot 过期或不存在时仍保持请求可用性优先，不会把管理查询失败伪装成新的实时额度。

账号凭据和账号切换仍由 CPA 管理，插件只消费其脱敏后的账号/quota 数据，不复制 CPA 的账号管理能力。

## 设置面板

CPA 页面位于 Plugins 的 `plugins.item` 插槽，使用 dsh 的 profile-backed
Config/settings 表单。设置会保存到当前 active profile 的 `dsh-cpa` 配置中；旧版
`$DSH_HOME/cpa/settings.json` 只用于首次迁移，以及兼容旧的管理 API。只有内部
CPA 运行时显示停止操作。管理面板在弹窗中打开。外部模式可配置 `URL`、API key、
management key；内部模式可配置 CPA 可执行文件路径。高级设置可配置端口、模型刷新间隔、
quota 缓存与并发，以及配置、设置、执行记录路径。其中端口、配置路径和
“使用统计”只对内部 CPA 生效；模型刷新间隔、quota 缓存/并发、设置路径和执行记录
路径对两种模式都生效。

高级设置中的“路由策略”可选择平衡、质量、可用性或额度优先。它只影响 dsh-cpa 的候选模型排序，不改变 CPA 的账号切换和凭据所有权。

“每日请求提醒”是软预算阈值，默认 `0` 关闭；达到阈值后只在 diagnostics 和设置页告警，不会静默阻断请求。由于 CPA 不提供统一价格模型，插件不把请求量换算成金额。

## 使用状态

插件会解析成功与失败响应中的 `x-cpa-trace-id`，把脱敏后的执行记录写入
`$DSH_HOME/cpa/executions.json`，并给当前会话提供 `cpaUsage` 投影。
`/dsh-cpa/execution-status?sessionId=...` 返回脱敏后的账号、额度快照、最近一次执行记录和当前会话的最近尝试，供 composer 下方的紧凑状态行读取。浏览器无法调用 CPA 的
`/v0/management/api-call`，该接口仅由服务端 quota 查询使用。状态行只展示 CPA
集成特有的信息：当前使用服务商/套餐、失败/不可用状态和一个主额度窗口，不重复
dsh 已展示的 token、耗时和性能统计。服务商同时从认证文件和 API key 配置读取；
有执行记录时按 CPA trace 的账号定位当前服务商；trace 没有账号或账号不在已读取
配置中时，只按模型推断服务商。点击可展开账号、来源、Base URL/前缀、额度、
模型/用途和 CPA trace/request 标识。同一会话仍按 CPA 账号聚合请求、失败与
token，作为 `cpaUsage` 投影保留；无管理 API 时状态行自动隐藏。

内部 CPA 的 `usage-statistics-enabled` 默认开启，可在 CPA 设置面板中关闭。

## CPA 摘要

只读 `/dsh-cpa/summary` 接口由服务端使用 management key 调用 CPA 管理 API，
浏览器只收到脱敏汇总数据，不包含 management key 或账号凭据。摘要包含版本/更新
状态、白名单过滤的运行时配置、`/v0/management/api-key-usage` 与认证文件计数聚合
的请求统计、脱敏账号，以及认证文件提供的模型到账号可用性。CPA 管理 API 不暴露
token 汇总，因此 token 项保持为 0。服务端做短时缓存；单个来源失败只记录错误，
不影响其他数据。

设置页提供紧凑的“CPA 摘要”区域：版本/更新、运行配置、用量总计、用量明细、账号。
composer 状态详情在有 `requestId` 时提供“日志”链接，打开 CPA 原始 management
日志界面。管理面板仍是完整管理入口。

只读 `/dsh-cpa/diagnostics` 接口返回脱敏的运行、模型同步、management API、账号和 quota 检查，以及模型到账号的可用性矩阵；同时提供最近 24 小时 dsh-cpa 本地执行记录的请求、失败和 token 汇总。这个本地汇总与 CPA 官方 usage 分开标注。设置页的“CPA 连接诊断”可以手动重新检查这些状态。

`POST /dsh-cpa/preflight` 可接收 `{ model, inputTokens, maxTokens, reasoningEffort }`，返回候选路由和请求预检结果。它只计算路由，不发送模型请求；为避免 prompt 出现在诊断链路中，接口不接受或转发消息内容。

`GET /dsh-cpa/report` 返回可下载的脱敏 JSON 报告，包含 diagnostics、本地用量和最近的执行链路。报告不包含 API key、management key、账号 ID、project ID 或凭据。
