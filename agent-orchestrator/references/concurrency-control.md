# Concurrency Control (Phase 1.3)

## Required Mechanics

1. Lock file: `templates/coordination/tasks/task_folders/<task_id>/.lock`.
2. Optimistic versioning: every mutation checks and increments `meta.version`.
3. Atomic writes: update through temp file and `mv`.
4. Idempotency key: `operation_id` must be unique per semantic mutation.

## Write Protocol

1. Acquire lock.
2. Read `meta.json`; validate `state` and expected `version`.
3. If `operation_id` exists in `log.ndjson`, return success as no-op.
4. Write updated `meta.json` to temp file; atomically replace original.
5. Append immutable event to `log.ndjson` with hash chaining.
6. Release lock.

## Failure Handling

1. Lock timeout: fail fast and retry with jitter.
2. Version mismatch: re-read `meta.json` and retry transition decision.
3. Partial write detected: mark task `BLOCKED_SYSTEM_ERROR` and emit audit event.

## Reference Script

Use `agent-orchestrator/scripts/transition_task_state.sh` as baseline implementation.
