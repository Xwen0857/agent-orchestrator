# Entry Action Contract

Schema ownership:
- `extensions/orchestrator-dashboard/orchestrate-entry-action-contract.ts`

Primary goal:
- deterministic routing at entry action stage for `RUNNING` sessions:
  - `amend_existing_task`
  - `intake_new_task`
  - `clarify_target`

## Producer / Consumer

- Producer: `orchestrate-entry-action-orchestrator` (pure orchestration logic).
- Consumer: receptionist handlers, `orchestrate-agent-meta.ts`, entry-agent decode/tool-policy.
- `before_agent_start` hook is a contract consumer (I/O + injection), not the state-machine owner.

## Decision Rules (canonical)

1. Slash command messages bypass action routing.
2. Running + bound `last_run.task_id` defaults to existing-task context.
3. Explicit `task_id`:
- match current bound task => `amend_existing_task`
- mismatch => `clarify_target`
4. New-task intent keywords during running => `clarify_target` (confirm first).
5. Existing-task intent keywords => `amend_existing_task`.
6. Ambiguous running input => `clarify_target`.

## Clarification Safety

- clarification uses one closed question only.
- before clarification is resolved:
  - no amendment queue write
  - no planner batch flush
  - no run binding change
- clarification is a hard gate: amendment intent keywords must not bypass it.

## Allowed Semantics

- intent signal extraction
- deterministic route resolution
- missing configuration hints for guided intake
- when running-session clarification resolves to `intake_new_task`, the session transitions to `ACTIVE_DRAFTING`.

## Forbidden Semantics

- planner mode/split semantics
- scheduler strategy decisions
- user-facing prose templates as canonical contract
