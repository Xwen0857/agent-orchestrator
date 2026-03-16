# `auto_recovery.sh` Explain

## Purpose

Performs automatic hygiene recovery by releasing stale locks, re-blocking stale in-progress tasks, and refreshing operator-facing health outputs.

## Inputs And Outputs

Inputs:
- optional task root
- stale lock threshold
- stale in-progress threshold

Outputs:
- removed stale lock files
- state transitions to `BLOCKED_SYSTEM_ERROR`
- refreshed dashboard and system-health artifacts
- one recovery summary line

## Step-By-Step Flow

1. Validate the task root.
2. Compute current time and keeper lock thresholds.
3. Walk each task directory independently.
4. Remove stale `.lock` files when the age threshold is exceeded.
5. Move stale `IN_PROGRESS` tasks to `BLOCKED_SYSTEM_ERROR` through `transition_task_state.sh`.
6. Optionally clear a stale keeper scheduler lock.
7. Refresh dashboard and system health outputs.

## Failure Modes And Safety Checks

- Fails immediately if the task root does not exist.
- Uses age thresholds before deleting any lock file.
- Uses the normal transition script instead of directly rewriting task state.
- Treats some cleanup steps as best-effort so one broken artifact does not halt all recovery.

## Key Dependencies

- `transition_task_state.sh`
- `dashboard_summary.sh`
- `system_health_check.sh`

## Maintenance Notes

- Keep the stale thresholds aligned with real scheduler cadence.
- This script intentionally favors recovery continuity over strict all-or-nothing behavior.
