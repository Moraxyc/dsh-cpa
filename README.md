# dsh-cpa

> [English](README.en.md) | **简体中文**

为 dsh 接入 CLI Proxy API（CPA）的插件。安装后注册 `cpa` provider，dsh 对话可以使用 CPA 管理的模型和账号。

## 安装

需要 dsh 和 Node.js 24 或更新版本。内部模式还需要 `cli-proxy-api` 在 `PATH` 中，或在设置里填写它的路径。

```sh
npx @deepseek-ai/dsh plugin --profile web add dsh-cpa
```

headless profile 把 `web` 换成 `headless`。

## 连接 CPA

在设置面板的 CPA 页面选择模式：

- **内部**（默认）：插件写入 `$DSH_HOME/cpa/config.yaml`，启动 `cli-proxy-api`，并注入生成的 key。
- **外部**：填写 URL 和 API key；需要管理面板、额度和诊断时再填 management key，然后点击“保存”。

管理面板在弹窗中打开；“停止”只在内部 CPA 运行时出现。

## 使用

- **模型**：默认每 5 分钟从 CPA 同步一次模型列表；同步失败时保留上一次的列表并退避重试。用户消息中的图片只发送给声明支持图片输入的模型，带图片的请求也只路由到这类模型。
- **路由**：所选模型始终是第一候选。只有回复尚未开始输出、且遇到额度耗尽、限流、超时、网络或服务端错误、空响应或无法解析的响应时，才切换到下一候选；开始输出后请求不再重试。路由策略只影响候选排序，账号切换仍由 CPA 决定。
- **额度与状态行**：输入框下方显示当前连接的额度；没有额度时显示模型。Codex 和 Claude 显示 5 小时窗口，7 天窗口在剩余额度不高于 20% 时追加；其他服务商显示最紧张的窗口。点击状态行可查看额度、账号、来源和请求详情。
- **额度来源**：Codex 和 Claude 的额度取自推理响应头，只反映最近一次实际路由的账号。内部 CPA 已开启 `requests.passthrough-headers`；外部 CPA 需要自行开启。WebSocket 路由没有额度。
- **用量**：内部 CPA 默认开启用量统计，可在设置中关闭。每日请求提醒是软阈值（默认关闭），达到阈值只在诊断中提示，请求照常放行。
- **诊断**：设置面板的“CPA 连接诊断”检查运行状态、模型同步、管理接口、账号和额度，并显示模型能力、可用账号和最近 24 小时的本地执行统计。诊断报告可导出为脱敏 JSON。

## 数据与隐私

- 浏览器只收到脱敏数据，不含 management key 或凭据字段。
- 执行记录保存在 `$DSH_HOME/cpa/executions.json`，写入前已脱敏。
- 会话执行记录使用 `plugin:dsh-cpa/execution` 并标记为 `ignorable`；插件也读取旧的 `cpa/execution` 记录，但 dsh 0.2.2 及以后版本拒绝恢复含有这种记录的会话。

## 开发

```sh
npm run build    # 编译服务端并打包浏览器端
npm run check    # 构建、类型检查和 lint
npm test         # 构建并运行测试
```

从源码安装：先 `npm run build`，再执行 `npx @deepseek-ai/dsh plugin --profile web add .`。

源码在 `src/`，构建产物在 `lib/`（不要手改）。HTTP 接口都挂在 `/dsh-cpa` 下。

CPA 管理集成只使用 v8 接口，托管配置按 `config-version: 8` 生成。`/v1/models` 请求带 `client_version=dsh-cpa`，CPA 据此返回完整的 Codex 模型目录。
