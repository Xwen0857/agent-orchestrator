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
- `worker_runtime_view.json`: task-local assembled worker runtime input, derived from planner + scheduler + runtime state.

## Source-of-truth policy

1. Task state and stage are read from `meta.json` only.
2. `*.md` files are evidence artifacts and must not be parsed as primary state.
3. `log.ndjson` is the immutable history and supports replay/audit.
4. `worker_runtime_view.json` is a derived runtime artifact; it must not become a new authority source.
5. lifecycle governance is scheduler/runtime-owned; any governance fields mirrored into `meta.worker_runtime` are observability summaries only.

## Worker runtime extensions

`meta.json` may include additive runtime-owned summaries:

- `worker_runtime`: assembled runtime summary for the current worker instance.
  - includes `semantic_topology`, `implementation_topology`, `cluster_projection`, and the selected template summary
  - `dispatch.role_type` remains the orchestrator runtime role; topology-owned coarse template classification lives under `implementation_topology.coarse_template_role`, with `implementation_topology.role_layer` retained as a compatibility projection
  - may carry `custom_coarse_template_roles` and `custom_template_registrations` as standardized runtime-owned inputs provided by the user/entry/keeper
  - custom template registrations must declare explicit `mount_tree` and `mount_path`; runtime must not infer custom template placement
  - may expose `selected_template_origin`, `selected_template_source_id`, `template_version`, `registration_source`, and `default_message_type` for builtin/custom observability
  - may expose `governance_policy_id`, `result_contract_version`, `allowed_template_origins`, and `custom_registration_required` as runtime-assembled governance summaries
- `worker_budget`: token-lane budget snapshot (`fast|degraded|reclaim_pending`).
- `worker_convergence`: latest convergence signal written by worker execution.
- `task_cluster`: derived cluster workspace and mailbox counters.
  - may expose `last_published_message_type` as the latest wrapper-emitted collaboration summary
- `runtime_worker_control`: scheduler/ops-owned budget, reclaim, and rebuild signals.
- `keeper_feedback`: latest runtime-to-keeper feedback summary, fingerprints, and submission timestamps.

These fields are additive and machine-facing. They do not change the top-level task state machine.

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
