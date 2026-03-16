# `planner_prepare_workers.sh` Explain

## Purpose

Turns a parent task strategy into concrete planner artifacts and worker task assignments.

## Inputs And Outputs

Inputs:
- parent task directory
- optional worker prefix
- task strategy JSON
- planner properties and templates
- completed task context history

Outputs:
- planner primary file
- planner checklist file
- child worker task definitions

## Step-By-Step Flow

1. Validate the parent task metadata and strategy file.
2. Load planner path helpers and summarize the strategy.
3. Read historical completed-task context for related examples.
4. Resolve planner output paths and ensure their parent directories exist.
5. Load planner properties and runtime configuration defaults.
6. Generate planner-facing artifacts and create child worker tasks through helper scripts.

## Failure Modes And Safety Checks

- Exits if parent metadata or strategy input is missing.
- Treats planner properties as optional and falls back to defaults.
- Uses helper scripts and resolved state paths instead of hardcoding mutable runtime locations.

## Key Dependencies

- `planner_state_paths.sh`
- `planner_strategy_summary.sh`
- `create_task_from_strategy.sh`
- planner templates

## Maintenance Notes

- Keep path resolution centralized in `planner_state_paths.sh`; do not duplicate it here.
- If the strategy schema changes, update both the jq extraction logic and the worker creation payload format.
- Historical context lookup is advisory, not a gating dependency.
