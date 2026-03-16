# `planner_entry.sh` Explain

## Purpose

Chooses between single-worker and multi-worker planning for a task, then dispatches the corresponding planner preparation path.

## Inputs And Outputs

Inputs:
- `--task-dir`
- optional `--requested-mode`
- task strategy JSON
- agent runtime config JSON

Outputs:
- planner decision metadata
- appended planner events
- generated single-worker or multi-worker planner artifacts

## Step-By-Step Flow

1. Parse arguments and validate planner dependencies.
2. Resolve the task directory, metadata, and strategy file.
3. Build a default worker id for the single-worker path.
4. Run the embedded Python decision engine:
   - honor explicit single/multi overrides
   - force child tasks to single mode
   - optionally call an LLM planner when configured
   - otherwise fall back to deterministic rule-based signals
5. Append the planning decision as an event.
6. Call either `planner_prepare_single_worker.sh` or `planner_prepare_workers.sh`.

## Failure Modes And Safety Checks

- Rejects invalid requested modes.
- Fails early if any planner dependency is missing.
- Refuses to proceed when task metadata or strategy input is absent.
- Keeps deterministic fallback logic when LLM planning is disabled or unavailable.

## Key Dependencies

- `append_task_event.sh`
- `planner_prepare_single_worker.sh`
- `planner_prepare_workers.sh`
- `planner_strategy_summary.sh`
- runtime config for optional LLM planning

## Maintenance Notes

- The embedded Python block is the planning-mode decision engine; keep its contract synchronized with any UI or API that surfaces planning decisions.
- If the strategy schema changes, revisit both the shell jq extraction and the Python decision inputs together.
