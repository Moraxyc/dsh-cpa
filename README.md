# dsh-cpa

> [English](README.en.md) | **简体中文**

dsh 的 CLI Proxy API (CPA) 插件。注册 `cpa` provider，让对话使用 CPA 代理的模型与账号。

## 安装

环境要求：Node.js 24+ 与 dsh。

```sh
npx @deepseek-ai/dsh plugin --profile web add dsh-cpa
```

headless profile 将 `web` 替换为 `headless`。

## 运行模式

在设置中选择模式：

- **内部**（默认）：自动启动本地 `cli-proxy-api` 进程（需在 `PATH` 或设置中指定路径）。
- **外部**：连接已有 CPA 服务的 URL 与 API Key。管理面板与额度查询需要 management key。

## 行为与约定

- **模型与图片**：模型列表每 5 分钟自动同步。图片输入仅路由至声明支持图片输入的模型。
- **故障切换**：流式输出开始前，遇到限流、超时、网络错误或额度耗尽会自动切换到下一候选；产生输出后不再重试。
- **额度来源**：Codex 与 Claude 额度从响应头提取（外部 CPA 需开启 `requests.passthrough-headers`）。
- **会话兼容性**：执行记录保存在 `$DSH_HOME/cpa/executions.json`，会话事件使用 `plugin:dsh-cpa/execution`。旧版 `cpa/execution` 事件在 dsh 0.2.2+ 中无法恢复。

## 开发

```sh
npm run build    # 编译服务端并打包前端
npm run check    # 类型检查与 lint
npm test         # 运行测试
```

本地安装测试：

```sh
npm run build && npx @deepseek-ai/dsh plugin --profile web add .
```

插件使用 CPA v8 管理接口，并在 `/v1/models` 请求中携带 `client_version=dsh-cpa` 以拉取完整模型元数据。

