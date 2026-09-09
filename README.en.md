# dsh-cpa

> **English** | [简体中文](README.md)

A `dsh` bundle plugin for CLI Proxy API (CPA). It registers the `cpa`
provider, sends requests to `/v1/chat/completions`, and syncs models from
`/v1/models`.

## Quickstart

```sh
npx @deepseek-ai/dsh plugin --profile web add dsh-cpa
```

Headless profile:

```sh
npx @deepseek-ai/dsh plugin --profile headless add dsh-cpa
```

## Install From Source

For development or local builds:

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

## Agent Routing and Failover

When an agent request enters the `cpa` provider, the plugin builds a candidate
order from CPA's synchronized model capabilities, context windows, available
models per account, and quota snapshot. The requested model always stays first.
Only a request that has not emitted stream content may fall through to another
candidate, and only for quota, rate-limit, server, transport, or empty-response
failures. Once content has started, the request is never replayed, preventing
duplicate agent output or side effects.

Routing also performs a request preflight and records model-catalog, reasoning,
context-window, account-health, and quota risks. Each attempt stores the
candidate route, preflight result, failure code, and fallback source; the
composer CPA readout shows the actual attempt chain and fallback reason.
Quota windows share normal, warning, critical, and unknown risk labels that are
also used by candidate routing.

When the management API is temporarily unavailable, the plugin keeps using the
last sanitized account/quota snapshot for basic routing. If no snapshot exists,
it preserves request availability and does not present a management failure as
fresh quota data.

Credential ownership and account switching remain inside CPA. The plugin
consumes sanitized account and quota data without reimplementing CPA account
management.

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

Advanced settings also expose balanced, quality, availability, and quota-first
routing strategies. The strategy only changes dsh-cpa candidate ordering; CPA
continues to own credentials and account switching.

"Daily request alert" is a soft budget threshold, disabled by default with
`0`. Reaching it produces a diagnostics/settings warning but does not silently
block requests. CPA does not expose a uniform price model, so the plugin does
not invent a monetary estimate.

## Usage Status

The plugin parses `x-cpa-trace-id` from successful and failed responses, writes sanitized
execution records to `$DSH_HOME/cpa/executions.json`, and exposes a `cpaUsage`
projection for the current session. `/dsh-cpa/execution-status?sessionId=...`
returns sanitized accounts, a quota snapshot, the latest execution record, and
recent attempts for the current session. The browser cannot call CPA's
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

## CPA Summary

A read-only `/dsh-cpa/summary` endpoint is served by the plugin. The server
uses the management key to call CPA's management API, and the browser only
receives sanitized summary data, never the management key or credential fields.
It includes version/update state, a whitelisted runtime config snapshot, usage
request totals aggregated from `/v0/management/api-key-usage` and auth-file
counters, sanitized accounts, and model-to-account availability from auth
files. The CPA management API does not expose aggregate token totals, so those
values stay at zero. Data is cached briefly; a failed source is recorded as an
error without hiding other data.

The settings page includes a compact "CPA Summary" section for version/update
state, runtime config, usage totals, usage details, and accounts. Composer status
details include a "日志" deep link when a recorded `requestId` exists, opening
CPA's original management log surface. The management panel remains the complete
management entry point.

The read-only `/dsh-cpa/diagnostics` endpoint returns sanitized runtime, model
sync, management API, account, and quota checks plus a model-to-account
availability matrix. It also includes the last 24 hours of dsh-cpa-local
execution totals for requests, failures, and tokens, kept separate from CPA's
official usage data. The settings page exposes these checks in "CPA Connection
Diagnostics" with a manual refresh action.

`POST /dsh-cpa/preflight` accepts `{ model, inputTokens, maxTokens,
reasoningEffort }` and returns the candidate route and request preflight result.
It only computes routing and never sends a model request; message content is not
accepted or forwarded so prompts do not enter the diagnostics path.

`GET /dsh-cpa/report` returns a downloadable sanitized JSON report containing
diagnostics, local usage, and recent execution traces. It excludes API keys,
management keys, account IDs, project IDs, and credentials.
