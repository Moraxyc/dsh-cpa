# dsh-cpa

> **English** | [简体中文](README.md)

A `dsh` bundle plugin for CLI Proxy API (CPA). It registers the `cpa`
provider, sends requests to `/v1/chat/completions`, and syncs models from
`/v1/models`.

## Install

```sh
npx @deepseek-ai/dsh plugin --profile web add .
```

Headless profile:

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

When `CPA_URL` is unset, write `$DSH_HOME/cpa/config.yaml`, start
`cli-proxy-api`, and export the generated key into `CPA_API_KEY`. Before
starting, the plugin resolves the executable from `PATH`; if it is missing,
set `CPA_BIN` or enter an absolute path in the internal CPA setting.

Models sync from `/v1/models` every 5 minutes.

## Settings Panel

The CPA page uses dsh web-app native components and supports internal and
external startup modes, saved to `$DSH_HOME/cpa/settings.json`. Stop is only
shown while the internal CPA is running. The management panel opens in a
native modal. External mode configures URL, API key, and management key;
internal mode configures the CPA executable path.

Optional environment variables: `CPA_URL`, `CPA_API_KEY`,
`CPA_MANAGEMENT_KEY`, `CPA_BIN`, `CPA_CONFIG`, `CPA_SETTINGS`,
`CPA_REFRESH_INTERVAL_MS`.
