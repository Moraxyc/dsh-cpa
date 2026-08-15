# dsh-cpa

> [English](README.en.md) | **简体中文**

CLI Proxy API（CPA）的 `dsh` bundle 插件。注册 `cpa` provider，请求走
CPA 的 `/v1/chat/completions`，同步 `/v1/models` 模型列表。

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

未设置 `CPA_URL` 时，生成 `$DSH_HOME/cpa/config.yaml`，启动
`cli-proxy-api`，并把生成的 key 写入 `CPA_API_KEY`。启动前会先在 PATH
中解析可执行文件；二进制不在 PATH 时用 `CPA_BIN` 指定，或在 CPA 设置页的
内部 CPA 路径中填写绝对路径。

模型每 5 分钟从 `/v1/models` 同步一次。

## 设置面板

CPA 页面使用 dsh web-app 原生组件，支持内部、外部两种启动方式，保存到
`$DSH_HOME/cpa/settings.json`。只有内部 CPA 运行时显示停止操作。管理面板
在原生大弹窗中打开。外部模式可配置 `URL`、API key、management key；内部
模式可配置 CPA 可执行文件路径。

可选环境变量：`CPA_URL`、`CPA_API_KEY`、`CPA_MANAGEMENT_KEY`、`CPA_BIN`、
`CPA_CONFIG`、`CPA_SETTINGS`、`CPA_REFRESH_INTERVAL_MS`。
