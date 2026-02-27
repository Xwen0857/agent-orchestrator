# Task Event Log Schema (`log.ndjson`)

Each line is one JSON object. File is append-only.

## Required fields

- `event_id`: unique id for this event.
- `timestamp`: RFC3339 datetime.
- `task_id`: stable task id.
- `operation_id`: idempotency key for this mutation attempt.
- `actor`: `agent-orchestrator|planner-ops|planner-core|scheduler-ops|worker-delivery|tester-ephemeral|audit-guard|governance-config`.
- `action`: action name such as `STATE_TRANSITION`, `WARN_BUDGET`, `LOCK_ACQUIRED`, `LOCK_RELEASED`.
- `before_state`: previous state.
- `after_state`: new state.
- `before_version`: expected old `meta.version`.
- `after_version`: new `meta.version`.
- `budget_snapshot`: object with current budget usage.
- `artifacts_delta`: created/updated artifact list.
- `approval_id`: optional when approval is required.
- `reason`: short human-readable reason.
- `hash_prev`: previous event hash, empty for first event.
- `hash_self`: hash of canonical current event payload with `hash_prev`.

## Constraints

1. `operation_id` must be reused for retries of the same semantic operation.
2. If an `operation_id` already exists in `log.ndjson`, mutation is idempotent and must not be applied again.
3. `before_version` must match current `meta.version`, otherwise reject write.
4. `hash_prev` must equal previous line `hash_self`.
5. Historical lines must never be edited or deleted.

## Minimal example

```json
{"event_id":"evt_001","timestamp":"2026-02-13T10:00:00Z","task_id":"task_demo_001","operation_id":"op_assign_001","actor":"planner-ops","action":"STATE_TRANSITION","before_state":"PLANNED","after_state":"ASSIGNED","before_version":2,"after_version":3,"budget_snapshot":{"token_cost_used":120,"execution_time_used_seconds":35,"external_calls_used":0},"artifacts_delta":["plan.md"],"approval_id":"","reason":"worker assigned","hash_prev":"2a8f...","hash_self":"45bc..."}
```
