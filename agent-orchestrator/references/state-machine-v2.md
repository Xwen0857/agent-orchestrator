# Task State Machine V2 (Authoritative)

This table is authoritative. Any transition not listed below is invalid and must be rejected with an audit log entry.

| from_state | allowed_to | required_actor | required_files | guard_conditions |
|---|---|---|---|---|
| CREATED | PLANNED | planner-ops | `meta.json`, `plan.md` | `meta.version` matches expected write version |
| PLANNED | ASSIGNED | planner-ops | `meta.json`, `plan.md` | owner assigned, budget fields present |
| ASSIGNED | IN_PROGRESS | worker-delivery | `meta.json`, `work.md` | active lock exists: `tasks/<task_id>/.lock` |
| IN_PROGRESS | TESTING | worker-delivery | `meta.json`, `work.md`, `test.md` | delivery evidence recorded in `work.md` |
| TESTING | APPROVED | tester-ephemeral | `meta.json`, `test.md` | tester status PASS |
| TESTING | REJECTED | tester-ephemeral | `meta.json`, `test.md` | tester status FAIL with `failure_code` |
| APPROVED | CLOSED | agent-orchestrator | `meta.json`, `audit.md` | all mandatory artifacts present |
| REJECTED | IN_PROGRESS | planner-ops | `meta.json`, `work.md` | new retry attempt recorded |
| * | BLOCKED_AWAITING_CLARIFICATION | worker-delivery | `meta.json`, `audit.md` | clarification question written |
| * | BLOCKED_PENDING_APPROVAL | audit-guard | `meta.json`, `audit.md` | rule hit requiring approval |
| * | BLOCKED_SYSTEM_ERROR | agent-orchestrator | `meta.json`, `audit.md` | system failure detected and classified |
| BLOCKED_AWAITING_CLARIFICATION | IN_PROGRESS | agent-orchestrator | `meta.json`, `work.md` | clarification answer present |
| BLOCKED_PENDING_APPROVAL | IN_PROGRESS | agent-orchestrator | `meta.json`, `audit.md` | valid `approval.json` exists |
| BLOCKED_PENDING_APPROVAL | REJECTED | agent-orchestrator | `meta.json`, `audit.md` | approval explicitly denied |
| BLOCKED_SYSTEM_ERROR | ASSIGNED | planner-ops | `meta.json`, `audit.md` | recovery action succeeded |
| BLOCKED_SYSTEM_ERROR | REJECTED | planner-ops | `meta.json`, `audit.md` | recovery impossible, task canceled |

## Transition Rules

1. Every accepted transition increments `meta.version` by exactly 1.
2. Every accepted transition appends one immutable event into `log.ndjson`.
3. `meta.json` is a mutable snapshot; `log.ndjson` is the source for replay.
4. Writer must use atomic replace (`write temp -> fsync -> rename`).
5. If expected version mismatches current version, writer must retry by re-reading `meta.json`.

## Budget Rules

1. `consumption/token_cost_used` or `consumption/execution_time_used_seconds` reaching 80% of budget: append event with `action="WARN_BUDGET"`.
2. Reaching 100% or higher: transition to `BLOCKED_PENDING_APPROVAL`.
3. Approval for over-budget execution must be documented in `approval.json` and logged.
