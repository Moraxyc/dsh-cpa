# dsh-cpa

> **English** | [简体中文](README.md)

A dsh plugin that provides the `cpa` provider to use models and accounts managed by CLI Proxy API (CPA).

## Install

Requires Node.js 24+ and dsh.

```sh
npx @deepseek-ai/dsh plugin --profile web add dsh-cpa
```

For the headless profile, replace `web` with `headless`.

## Modes

Configure in the settings panel:

- **Internal** (default): Automatically manages a local `cli-proxy-api` process (requires the binary on `PATH` or configured in settings).
- **External**: Connects to an existing CPA URL and API key. Management panel and quota queries require a management key.

## Behavior

- **Models and images**: Model catalog refreshes every 5 minutes. Requests with images route only to models declaring image input.
- **Failover**: Before stream output starts, rate limits, timeouts, network errors, or quota exhaustion fail over to the next candidate; once output starts, requests are not retried.
- **Quota**: Codex and Claude quotas are extracted from inference response headers (external CPA requires `requests.passthrough-headers`).
- **Session compatibility**: Execution records are saved to `$DSH_HOME/cpa/executions.json`. Sessions record `plugin:dsh-cpa/execution` events; legacy `cpa/execution` events cannot be restored on dsh 0.2.2+.

## Development

```sh
npm run build    # Build server and client bundle
npm run check    # Type-check and lint
npm test         # Run test suite
```

Local installation:

```sh
npm run build && npx @deepseek-ai/dsh plugin --profile web add .
```

The plugin uses the CPA v8 management API and sends `client_version=dsh-cpa` with `/v1/models` to retrieve full model metadata.

