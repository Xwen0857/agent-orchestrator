# Task Folder Spec V1

Canonical path:

- `templates/coordination/tasks/task_folders/<task_id>/`

Mandatory files:

- `meta.json`: current mutable snapshot (single source of truth for status).
- `plan.md`: planning decisions and scope boundaries.
- `work.md`: implementation record and blockers.
- `test.md`: test execution and verdict summary.
- `audit.md`: approvals, risk notes, and gate decisions.
- `log.ndjson`: immutable event stream.

Optional files:

- `approval.json`: approval payload for blocked tasks.
- `clarification_request.md`: questions waiting for user/master response.

## Source-of-truth policy

1. Task state and stage are read from `meta.json` only.
2. `*.md` files are evidence artifacts and must not be parsed as primary state.
3. `log.ndjson` is the immutable history and supports replay/audit.

## Concurrency policy

1. Before mutation, writer must acquire `templates/coordination/tasks/task_folders/<task_id>/.lock`.
2. Writer must check `meta.version` for optimistic concurrency.
3. Writes must be atomic: write temp file then rename.
4. On conflict, re-read `meta.json` and retry.

## Closure criteria

A task can transition to `CLOSED` only when:

1. `meta.state == APPROVED`.
2. Required artifacts (`plan.md`, `work.md`, `test.md`, `audit.md`) exist.
3. Final state transition event is appended in `log.ndjson`.
