# dsh-cpa

> **English** | [简体中文](README.md)

A plugin that connects dsh to CLI Proxy API (CPA). It registers the `cpa` provider, so dsh conversations can use the models and accounts managed by CPA.

## Install

Requires dsh and Node.js 24 or newer. Internal mode also needs `cli-proxy-api` on `PATH`, or its path set in the settings.

```sh
npx @deepseek-ai/dsh plugin --profile web add dsh-cpa
```

For the headless profile, replace `web` with `headless`.

## Connect to CPA

In the settings panel, open the CPA page and choose a mode:

- **Internal** (default): the plugin writes `$DSH_HOME/cpa/config.yaml`, starts `cli-proxy-api`, and injects the generated keys.
- **External**: enter the URL and API key; add the management key for the management panel, quota, and diagnostics, then click "Save".

The management panel opens in a modal. "Stop" appears only while the internal CPA is running.

## Use

- **Models**: the list syncs from CPA every 5 minutes by default. A failed sync keeps the last list and retries with backoff. Images in user messages are sent only to models that declare image input, and requests with images route only to those models.
- **Routing**: the selected model is always the first candidate. The plugin switches to the next candidate only before any output and only on quota exhaustion, rate limits, timeouts, network or server errors, empty responses, or unparsable responses. Once output starts, the request is not retried. The routing strategy changes candidate order only; CPA still decides account switching.
- **Quota and status line**: the line below the composer shows the current connection's quota, or the model when no quota is available. Codex and Claude show the 5-hour window; the 7-day window appears when 20% or less remains. Other providers show their tightest window. Click the line for quota, accounts, source, and request details.
- **Quota source**: Codex and Claude quota comes from inference response headers and reflects only the most recently routed account. The managed internal CPA enables `requests.passthrough-headers`; enable it yourself on an external CPA. WebSocket routes have no quota.
- **Usage**: internal CPA enables usage statistics by default; turn it off in the settings. The daily request alert is a soft threshold (off by default); reaching it only shows a note in diagnostics and requests still go through.
- **Diagnostics**: "CPA Connection Diagnostics" in the settings panel checks runtime, model sync, management API, accounts, and quota, and shows model capabilities, available accounts, and local execution totals for the last 24 hours. The report exports as sanitized JSON.

## Data and privacy

- The browser receives only sanitized data, never the management key or credential fields.
- Execution records are stored in `$DSH_HOME/cpa/executions.json` after sanitization.
- Session execution records use `plugin:dsh-cpa/execution` and are marked `ignorable`. The plugin also reads legacy `cpa/execution` records, but dsh 0.2.2 and later refuse to restore sessions containing them.

## Development

```sh
npm run build    # compile the server and bundle the browser client
npm run check    # build, type checks, and lint
npm test         # build and run the tests
```

To install a local build: run `npm run build`, then `npx @deepseek-ai/dsh plugin --profile web add .`.

Source lives in `src/`; build output goes to `lib/` (do not edit it). All HTTP endpoints sit under `/dsh-cpa`.

The CPA integration uses only v8 APIs, and managed config is generated in the `config-version: 8` layout. The `/v1/models` request carries `client_version=dsh-cpa`, which makes CPA return the full Codex model catalog.
