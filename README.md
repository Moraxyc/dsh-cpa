# dsh-cpa

> [English](README.en.md) | **简体中文**

CLI Proxy API（CPA）的 `dsh` bundle 插件。安装后由插件自己的
`LlmAdapter` 注册 `cpa` provider，请求走 CPA 的 `/v1/chat/completions`，
并同步 `/v1/models` 的模型列表。

## 安装

```sh
npx @deepseek-ai/dsh plugin --profile web add .
```

headless profile 同理：

```sh
npx @deepseek-ai/dsh plugin --profile headless add .
```

## 使用已有 CPA

```sh
export CPA_URL=http://127.0.0.1:8317/v1
export CPA_API_KEY=...
export CPA_MANAGEMENT_KEY=...
npx @deepseek-ai/dsh web
```

## 自动启动 CPA

未设置 `CPA_URL` 时，插件会在
`$DSH_HOME/cpa/config.yaml` 生成本地配置，启动 `cli-proxy-api`，并把生成的
API key 写入当前进程的 `CPA_API_KEY`。二进制不在 PATH 时用 `CPA_BIN` 指定。

模型列表来自 CPA 的 `/v1/models`，默认每 5 分钟同步一次。

## 设置面板

Settings 里会显示 CPA 管理面板。自动启动时使用生成的 management key；
已有 CPA 需要设置 `CPA_MANAGEMENT_KEY`。

可选环境变量：`CPA_URL`、`CPA_API_KEY`、`CPA_MANAGEMENT_KEY`、`CPA_BIN`、
`CPA_CONFIG`、`CPA_REFRESH_INTERVAL_MS`。
