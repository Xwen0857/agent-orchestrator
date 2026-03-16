# `transition_task_state.sh` Explain

## Purpose

Performs one validated task state transition. It enforces allowed state edges, actor ownership, artifact guards, approval requirements, and audit-log writes.

## Inputs And Outputs

Inputs:
- task directory
- actor
- operation id
- from state
- to state
- reason string

Outputs:
- updated `meta.json`
- appended `log.ndjson`
- possible approval ticket artifacts

## Step-By-Step Flow

1. Validate arguments and required task files.
2. Build the transition allowlist and actor ownership requirements.
3. Run guard checks specific to the requested transition.
4. Apply compatibility shims for legacy actors only where explicitly allowed.
5. Enforce approval and artifact prerequisites for higher-risk state changes.
6. Rewrite task metadata and append the immutable log entry.

## Failure Modes And Safety Checks

- Rejects any unsupported state edge.
- Rejects actor mismatches outside the explicit compatibility window.
- Refuses transitions when required artifacts are missing or still contain placeholders.
- Requires aggregate delivery and child closure checks before parent close.
- Creates or checks approval artifacts when entering approval-blocked states.

## Key Dependencies

- task `meta.json`
- task `log.ndjson`
- task work/test/audit artifacts
- `audit-guard/scripts/create_approval_ticket.sh`

## Maintenance Notes

- This script is the shell-level source of truth for task state progression.
- Any new state must be added consistently to the allowlist, actor map, guard logic, and audit output.
- Be careful not to relax placeholder checks without verifying the worker/tester templates.
