# dsh-cpa

> **English** | [简体中文](README.md)

A plugin that connects dsh to CLI Proxy API (CPA). After installation it registers the `cpa` provider, so dsh conversations can use the models and accounts managed by CPA.

---

## User Guide

### Requirements

- Node.js `>=26.13.0`
- dsh installed
- For auto-start mode, `cli-proxy-api` must be on `PATH`, or you must set its absolute path in the settings

### Install

```sh
npx @deepseek-ai/dsh plugin --profile web add dsh-cpa
```

Headless profile:

```sh
npx @deepseek-ai/dsh plugin --profile headless add dsh-cpa
```

### Connect to CPA

On the CPA page in the settings panel, choose one mode:

- **Auto-start (internal)**: the default. The plugin writes `$DSH_HOME/cpa/config.yaml`, starts `cli-proxy-api`, and injects the generated keys automatically.
- **Existing CPA (external)**: enter the URL, API key, and management key, then click "Apply".

CPA's management panel opens in a modal. The "Stop" action appears only while the internal CPA is running.

### Models

- The plugin syncs the model list from CPA's `/v1/models` every 5 minutes.
- If a sync fails, the previous list is kept and retries use exponential backoff.
- For models that declare image input, images in user messages are sent with the request. Requests with images are routed only to models that also accept images.

### Routing and Failover

- The model you select is always the first candidate.
- Failover to the next candidate happens only before any output has been produced, and only for quota exhaustion, rate limits, server errors, network errors, or empty responses.
- Once output has started, the request is not retried, which prevents duplicate content or duplicate side effects.
- The "routing strategy" in advanced settings (balanced, quality, availability, quota-first) only changes candidate ordering. It does not change CPA's account switching.
- CPA owns accounts and credentials. If CPA's management API is temporarily unavailable, the plugin routes with the last account and quota snapshot. If no snapshot exists, request availability still takes priority, and a failed lookup is never shown as fresh quota.

### Status Line and Quota

The status line below the composer shows the quota for the current connection. When no quota is available, it shows the current model.

- ChatGPT/Codex and Claude accounts show the 5-hour window. The 7-day window appears only when 20% or less remains.
- Other providers show their tightest quota window.
- Low quota or failed requests use dsh's native warning or error colors.
- The status line is hidden when the current session does not use the `cpa` provider.
- Click the status line to expand quota, account, source, Base URL, prefix, model, CPA trace ID, and request ID. When a request ID exists, you can also open CPA's original request log.

Codex and Claude quota comes from inference response headers and reflects only the most recently routed account:

- The managed internal CPA config enables `requests.passthrough-headers`. An external CPA must enable it yourself.
- WebSocket routes do not return quota headers, so this quota is unavailable for them.
- The plugin never polls Anthropic's quota endpoint, because it is heavily rate-limited.

### Usage and Alerts

- Internal CPA enables usage statistics by default (`observability.usage.usage-statistics-enabled`). You can turn it off in the settings panel.
- The "Daily request alert" is a soft threshold, `0` (disabled) by default. When reached, it shows a warning in diagnostics and settings but does not block requests.
- CPA has no unified price model, so the plugin does not estimate costs.

### Settings

| Mode | Settings |
| --- | --- |
| External | URL, API key, management key |
| Internal | CPA executable path (default `cli-proxy-api`) |
| Both | Model refresh interval, quota cache and concurrency, routing strategy, daily request alert, execution record path |
| Internal only | Port, config path, usage statistics toggle |

Settings are saved in the `dsh-cpa` configuration of the active profile.

### Diagnostics

Use "CPA Connection Diagnostics" in the settings panel to re-check on demand:

- Runtime status, model sync, management API, accounts, and quota
- A model-to-account availability matrix
- Local execution totals for the last 24 hours (requests, failures, tokens), labeled separately from CPA's official usage
- CPA summary: version and update status, runtime config, usage, and accounts

The diagnostics report can be exported as sanitized JSON. It excludes API keys, management keys, account IDs, project IDs, and credentials.

---

## Developer Guide

### Source Layout

| Path | Description |
| --- | --- |
| `src/index.ts` | Plugin entry point |
| `src/core/` | Config, adapter, router, services, quota header parsing |
| `src/server/` | Runtime, management routes, data aggregation, quota queries |
| `src/client/` | Browser side: settings panel, status line, composer docking |
| `lib/` | Build output, git-ignored, do not edit by hand |
| `tests/` | Tests; the build runs first |

### Build and Check

```sh
npm run build    # tsc compiles the server side to lib/; esbuild bundles the client into lib/client.js
npm run check    # build + type checks for client and tests + oxlint
npm test         # builds first, then runs tests/**/*.test.ts
```

Install a local build into dsh:

```sh
npm run build
npx @deepseek-ai/dsh plugin --profile web add .
```

For the headless profile, replace `web` with `headless`.

### Server Endpoints

All endpoints are served by the plugin under the `/dsh-cpa` prefix:

| Path | Description |
| --- | --- |
| `/dsh-cpa/status` | Runtime status |
| `/dsh-cpa/settings` | Read and save settings |
| `/dsh-cpa/summary` | CPA summary (read-only, briefly cached on the server) |
| `/dsh-cpa/diagnostics` | Connection diagnostics and availability matrix (read-only) |
| `/dsh-cpa/execution-status?sessionId=...` | Status line data for a session (read-only) |
| `POST /dsh-cpa/preflight` | Accepts `{ model, inputTokens, maxTokens, reasoningEffort }` and returns the candidate route and preflight result. It only computes routing, never sends a model request, and does not accept message content |
| `GET /dsh-cpa/report` | Sanitized JSON diagnostics report |
| `/dsh-cpa/management` | Serves CPA's management panel |

### Management API Conventions

- Only CPA's v8 management API (`/v8/management`) is used.
- Managed config is generated in the nested `config-version: 8` layout, and reads parse only v8 fields.
- The summary uses `/v8/management/observability/usage/api-keys`, `/v8/management/credentials`, `/v8/management/credentials/models`, and `/v8/management/config/api-keys`. API-key providers are merged with credentials by `auth_index`.
- Quota queries run on the server through `/v8/management/requests/api-call`.
- The CPA management API does not expose token totals, so token values in the summary stay at `0`.
- A failure in one data source is recorded as an error and does not affect the others.

### Data and Privacy

- The browser receives only sanitized data, never the management key or credential fields.
- Execution records are stored in `$DSH_HOME/cpa/executions.json` after sanitization.
- The legacy `$DSH_HOME/cpa/settings.json` is read only for compatibility.
- The default model refresh interval is `300000` ms (`src/core/config.ts`).
