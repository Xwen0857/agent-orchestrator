# Entry Agent Tool Policy Contract

Policy scope:
- command recommendation boundaries for entry agent
- does not define schema; consumes `orchestrate-agent-meta-v1`
- clarification-first gating when entry action route is ambiguous

Code owner:
- `extensions/orchestrator-dashboard/orchestrate-runtime-contract.ts` (`EntryAgentToolPolicyView`)

## Producer / Consumer

- Producer: runtime contract policy projection.
- Consumer: entry agent interaction layer.

## Supported Recommendations

- `/orchestrate summary`
- `/orchestrate status <task_id>`
- `/orchestrate resume <task_id>`

## Policy Rules

- summary hint allowed when in `ACTIVE_DRAFTING` with meaningful draft input.
- status hint allowed when in `RUNNING` with bound task id.
- resume hint allowed only when all are true:
  - `replan.impact = hard`
  - `replan.worker_policy = pause_and_require_replan`
  - `replan.execution_status = paused`
  - running task id exists

## Guard Interaction

- if `runtime_consistency = mismatch`, entry agent must avoid side-effectful recommendations beyond safe orchestrate recovery flow.
- if planner paused state is active, resume is the only recovery recommendation.
- if `action.clarification_required = true` or `recommended_triggers.clarify = true`, clarification is mandatory before amendment/new-intake action guidance.

## Forbidden Behavior

- invoking commands directly without user intent
- recommending out-of-policy commands based on free-form inference
- overriding planner/scheduler authority through agent wording
