# `plugin_runtime.py` Explain

## Purpose

Runs plugin compatibility checks and executes plugin hook entrypoints as subprocesses with bounded resources.

## Inputs And Outputs

Inputs:
- plugin manifest
- plugin id
- hook entry script path
- hook name
- JSON payload

Outputs:
- `HookResult` containing success state, payload, and any normalized error text

## Step-By-Step Flow

1. Compare the plugin manifest API version to the backend's supported API version window.
2. For hook execution, validate that the entry script exists.
3. Build a lightweight resource limiter on Unix systems.
4. Launch the hook subprocess with JSON stdin and capture stdout/stderr.
5. Convert timeouts, non-zero exits, and invalid JSON into normalized `HookResult` failures.
6. Return parsed JSON output when the hook succeeds.

## Failure Modes And Safety Checks

- Rejects incompatible major versions and out-of-window minor versions.
- Applies CPU and memory limits on supported Unix hosts.
- Treats invalid JSON output as a plugin failure instead of surfacing a parser exception.
- Returns structured failures for timeouts and missing entry scripts.

## Key Dependencies

- `PluginManifest`
- backend `PLUGIN_API_VERSION`
- Python `subprocess`

## Maintenance Notes

- If hook protocol changes, update both the subprocess invocation contract and the JSON parsing expectations.
- Keep compatibility logic aligned with any manifest schema changes in `app.models`.
