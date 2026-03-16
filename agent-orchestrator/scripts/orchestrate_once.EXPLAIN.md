# `orchestrate_once.sh` Explain

## Purpose

Runs one full orchestrator cycle. It selects a task, validates runtime dependencies, advances task state through planner/worker/tester/audit stages, and refreshes dashboard outputs.

## Inputs And Outputs

Inputs:
- optional tasks root
- optional `--task-id`
- optional `--role`
- optional `--work-domain-id`
- optional `--workspace-root`
- runtime config from `templates/coordination/orchestrator/execution_runtime.json`

Outputs:
- task state transitions
- appended task events
- worker/tester artifacts
- dashboard and health refreshes

## Step-By-Step Flow

1. Parse the optional positional task root and named overrides.
2. Resolve and validate the required child script graph.
3. Load runtime toggles such as policy mode, sandbox, workspace sync, and KB import behavior.
4. Select a target task (explicitly or by queue rules).
5. Run planner preparation, worker execution, tester validation, and audit/aggregate steps as needed.
6. Persist state transitions and event log entries through dedicated scripts.
7. Refresh dashboard outputs before exiting.

## Failure Modes And Safety Checks

- Exits early if any required child script is missing or not executable.
- Refuses invalid flag combinations before selecting a task.
- Delegates state safety to `transition_task_state.sh`.
- Uses child scripts for sandbox, ACL, aggregate promotion, and workspace guards instead of embedding those rules inline.

## Key Dependencies

- `planner_state_paths.sh`
- `transition_task_state.sh`
- `planner_prepare_workers.sh`
- `planner_prepare_single_worker.sh`
- `worker_realize_task.sh`
- `tester_run_task.sh`
- `launch_agent_sandbox.sh`
- `promote_or_rollback_aggregate.sh`
- `dashboard_summary.sh`

## Maintenance Notes

- Keep this script thin relative to child scripts; business rules should remain in specialized helpers where possible.
- If new workflow stages are added, document both the call site here and the transition semantics in the relevant child script.
- Re-check this file whenever runtime config keys are renamed because many toggles are read directly here.
