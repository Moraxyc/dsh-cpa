# dsh-cpa

> **English** | [简体中文](README.md)

A `dsh` bundle plugin for CLI Proxy API (CPA). It registers the `cpa`
provider through its own `LlmAdapter`, sends requests to CPA's
`/v1/chat/completions`, and keeps the model catalog synchronized from CPA's
`/v1/models`.

## Install

```sh
npx @deepseek-ai/dsh plugin --profile web add .
```

The headless profile works the same way:

```sh
npx @deepseek-ai/dsh plugin --profile headless add .
```

## Use An Existing CPA

```sh
export CPA_URL=http://127.0.0.1:8317/v1
export CPA_API_KEY=...
export CPA_MANAGEMENT_KEY=...
npx @deepseek-ai/dsh web
```

## Auto-Start CPA

When `CPA_URL` is unset, the plugin writes a local
config to `$DSH_HOME/cpa/config.yaml`, starts `cli-proxy-api`, and exports the
generated API key into `CPA_API_KEY` for the current process. Set `CPA_BIN` if
the binary is not on `PATH`.

Models come from CPA's `/v1/models` and are refreshed every 5 minutes by
default.

Optional environment variables: `CPA_URL`, `CPA_API_KEY`,
`CPA_MANAGEMENT_KEY`, `CPA_BIN`, `CPA_CONFIG`, `CPA_REFRESH_INTERVAL_MS`.
