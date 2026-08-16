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

Switch to "External CPA" in the settings panel, enter the URL, API key, and
management key, then apply.

## Auto-Start CPA

By default the plugin writes `$DSH_HOME/cpa/config.yaml`, starts
`cli-proxy-api`, and injects the generated key into the provider adapter.
Before starting, the plugin resolves the executable from `PATH`; if it is
missing, enter an absolute path in the internal CPA setting.

Models sync from `/v1/models` every 5 minutes.

## Settings Panel

The CPA page uses dsh web-app components and supports internal and
external startup modes, saved to `$DSH_HOME/cpa/settings.json`. Stop is only
shown while the internal CPA is running. The management panel opens in a
modal. External mode configures URL, API key, and management key;
internal mode configures the CPA executable path. Advanced settings cover the
port, model refresh interval, quota cache/concurrency, and config, settings,
and execution record paths. The port, config path, and usage statistics only
apply to internal CPA; model refresh, quota cache/concurrency, settings path,
and execution record path apply to both modes.

## Usage Status

The plugin parses `x-cpa-trace-id` from successful and failed responses, writes sanitized
execution records to `$DSH_HOME/cpa/executions.json`, and exposes a `cpaUsage`
projection for the current session. `/dsh-cpa/execution-status?sessionId=...`
returns sanitized accounts, a quota snapshot, and the latest execution record
for the compact composer readout. The browser cannot call CPA's
`/v0/management/api-call`; it is only used by the server-side quota query. The
readout shows only CPA-specific state: the currently used provider/plan, failure
or unavailable status, and one primary quota window, without repeating the token,
latency, or performance stats already shown by dsh. Providers are read from both
auth files and API key configuration. Execution records locate the current provider
by CPA trace account; when the trace has no account or the account is not present in
the loaded config, the readout infers the provider from the model. Clicking it
expands account, source, Base URL/prefix, quota, model/purpose, and CPA
trace/request details. The same session still keeps per-account request, failure,
and token totals for the `cpaUsage` projection, and the readout hides when no
management API is available.

The internal CPA `usage-statistics-enabled` setting is on by default and can be
disabled in the CPA settings panel.
