# `orchestrate_runner_daemon.sh` Explain

## Purpose

Manages a background process that repeatedly runs `orchestrate_multi_once.sh` outside the in-process plugin runner.

## Inputs And Outputs

Inputs:
- action: `start`, `stop`, `status`
- optional interval seconds
- optional `--json` status format

Outputs:
- pid file
- runner state JSON
- appended runner log
- human-readable or JSON status output

## Step-By-Step Flow

1. Parse the requested action.
2. On `start`, validate the interval and required batch runner dependency.
3. Spawn a detached `_loop` subprocess via `nohup`.
4. In `_loop`, run `orchestrate_multi_once.sh` on every tick and rewrite the state file with the last tick timestamp and exit code.
5. On `stop`, terminate the recorded pid and remove the pid file.
6. On `status`, combine pid liveness with the state file to report current health.

## Failure Modes And Safety Checks

- Rejects invalid intervals.
- Refuses to start when the batch runner script is missing.
- Checks process liveness instead of trusting the pid file blindly.
- Reuses the same script in `_loop` mode so start/stop/status stay aligned with one implementation.

## Key Dependencies

- `orchestrate_multi_once.sh`
- state dir under `templates/coordination/orchestrator`

## Maintenance Notes

- This script intentionally keeps no complex locking; it assumes one external runner daemon per repo.
- If the daemon gains richer lifecycle rules later, preserve the current pid-file and state-file contract for compatibility.
