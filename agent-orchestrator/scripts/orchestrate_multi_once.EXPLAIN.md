# `orchestrate_multi_once.sh` Explain

## Purpose

Runs one batch-oriented orchestrator cycle that dispatches multiple eligible tasks in parallel, bounded by host capacity and runtime configuration.

## Inputs And Outputs

Inputs:
- optional tasks root
- optional `--mode`
- optional `--max-parallel`
- optional `--max-tasks`
- runtime config JSON
- planner properties markdown

Outputs:
- updated runtime concurrency snapshot
- dispatched tasks through `agent_dispatch.sh`
- refreshed dashboard summary
- JSON batch summary on stdout

## Step-By-Step Flow

1. Parse optional task root and concurrency overrides.
2. Load runtime defaults from JSON and planner properties.
3. Detect host logical threads and derive effective worker capacity.
4. Optionally rewrite the runtime config snapshot with the computed concurrency values.
5. Scan task folders and filter out ineligible or blocked states.
6. Auto-block stale `IN_PROGRESS` tasks through `transition_task_state.sh`.
7. Select the next batch, respecting queue order and configured limits.
8. Dispatch the selected tasks and emit a batch summary.

## Failure Modes And Safety Checks

- Invalid args fail through one centralized usage path.
- Missing dispatch script or task root aborts before batch selection.
- Concurrency values are normalized to positive integers.
- Runtime config updates use a temp file plus `mv` to avoid partial writes.

## Key Dependencies

- `agent_dispatch.sh`
- `transition_task_state.sh`
- `dashboard_summary.sh`
- runtime config JSON
- planner properties markdown

## Maintenance Notes

- Keep the host-capacity math synchronized with any future runner controller changes.
- If queue eligibility rules change, update both the filtering logic here and any UI/status surface that describes the queue.
- This file is one of the primary places where local thread mode behavior is defined.
