# Planner Replan Apply Contract

Primary contract owners:
- Planner decision/apply pipeline (`planner_replan.*`)
- Runtime replan projection markers on task `meta.json` (`runtime_replan.*`)

Related schemas:
- `planner-effective-patch-v2`
- `planner-amendment-watermark-v2`
- `planner-request-v1`
- `planner-decision-v1`
- `planner-core-v2` compatibility contract

Legacy breadcrumb schema:
- `planner-amendment-batch-v1`

## Producer / Consumer

- Producer: receptionist effective-patch release + planner amendment apply script.
- Consumer: runner replan consumer, planner runtime files, scheduler loop.

## Canonical Replan Signals

Planner authority:
- `planner_replan.status`: `queued|applied|resolved`
- `planner_replan.impact`: `soft|refresh_required|hard`
- `planner_replan.worker_policy`: `continue|revalidate_then_resume|pause_and_require_replan`
- `planner_replan.requested_at`
- `planner_replan.applied_at`
- `planner_replan.scope_summary`
- `planner_replan.latest_effective_patch_path`
- `planner_replan.latest_amendment_batch_path`

Runtime coordination:
- `runtime_replan.consume_status`: `pending_consume|ready|awaiting_revalidation|paused`
- `runtime_replan.consumed_at`
- `runtime_replan.resumed_at`
- `runtime_replan.blocked_reason`
- `runtime_replan.last_runtime_actor`
- `runtime_replan.last_runtime_transition`
- `runtime_replan.source_planner_requested_at`
- `runtime_replan.source_planner_policy`
- `runtime_replan.source_planner_impact`

## Allowed Semantics

- structured increment absorption and replan stage transition
- explicit execution safety boundaries after apply
- planner-owned status markers consumable by scheduler/runtime
- one-way projection from `planner_replan.*` into `runtime_replan.*`
- watermark-aligned release/consume bookkeeping for amendment application

## Forbidden Semantics

- entry-agent wording/interaction strategy
- direct mutation of user-facing conversational history
- bypassing planner contract with raw message payloads

## Compatibility

- New status/policy enums must be additive unless schema version is bumped.
- Existing consumers must treat unknown enums as non-fatal and degrade to safe behavior.
- `planner-amendment-batch-v1` may remain as a breadcrumb path in `meta.json`, but it is not the planner authority input.
- runtime consumers must not treat legacy `planner_replan_execution_status` as authoritative.
