# Orchestrator Dashboard Plugin

OpenClaw plugin package for `Agent Orchestrator`.

This repository treats OpenClaw as an external host dependency. The plugin source lives here and is intended to be installed into a separate OpenClaw checkout or deployment.

The plugin also exposes `/orchestrate` as an async orchestrator entry command. `run` bootstraps a task and starts an in-process runner that calls `orchestrate_multi_once.sh` on an interval.

## Routes

- UI: `/plugins/orchestrator`
- API base: `/api/plugins/orchestrator`

## API

- `GET /overview`
- `GET /configs/current`
- `POST /configs/validate`
- `POST /configs/commit`
- `POST /configs/rollback`
- `GET /configs/history`
- `GET /events`
- `GET /meta`

## Config

Configured under `plugins.entries.orchestrator-dashboard.config` in the target OpenClaw host.

Minimal example:

```json
{
  "plugins": {
    "entries": {
      "orchestrator-dashboard": {
        "enabled": true,
        "config": {
          "repoRoot": "/path/to/agent-orchestrator",
          "basePath": "/plugins/orchestrator",
          "apiBasePath": "/api/plugins/orchestrator",
          "requireGatewayAuth": true,
          "runnerEnabled": true,
          "runnerIntervalSec": 10,
          "runnerExecutionMode": "local_threads",
          "runnerBatchSize": 4,
          "runnerMaxParallel": 2,
          "agentRuntimeConfigPath": "templates/coordination/orchestrator/agent_runtime.json"
        }
      }
    }
  }
}
```

## Installing Into OpenClaw

Use the helper script from the repository root:

```bash
bash scripts/install_openclaw_plugin.sh /path/to/openclaw
```

This will symlink `extensions/orchestrator-dashboard` from this repository into the target OpenClaw host.

Auth: when `requireGatewayAuth=true`, API calls require `Authorization: Bearer <gateway token or password>`.

Runner execution:

- `runnerExecutionMode` currently supports `local_threads` as the active implementation.
- `container` and `distributed` are reserved extension modes and currently fall back to local execution.
- `runnerBatchSize` controls max tasks dispatched per tick.
- `runnerMaxParallel` controls local concurrent dispatch width.

LLM planning: when `agentRuntimeConfigPath` points to a config with `llm.enabled=true`, `/orchestrate intake|run` will try an OpenAI-compatible planning call and automatically fall back to deterministic strategy generation on failure.
For secrets, keep `api_key` in `agent_runtime.local.json` (same path, `.local` suffix) and keep the shared `agent_runtime.json` non-secret.
`llm.auth_mode` supports both:

- `standalone`: use plugin-local key (`api_key` / `api_key_env`)
- `openclaw`: reuse OpenClaw model auth (`models.providers.<provider>.apiKey` / provider env)
- `auto`: standalone first, then openclaw
