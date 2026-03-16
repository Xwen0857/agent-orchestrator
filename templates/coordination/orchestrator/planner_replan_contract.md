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
- Candidate ingress producer (non-authoritative): observer bridge packet consumer.
- Observer bridge consume path: `agent-orchestrator/scripts/planner_consume_observer_bridge.sh`
- Observer bridge handoff artifact: `planner_observer_bridge_intake.json` (candidate-only, task-local, non-authoritative)

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
- observer bridge packets may nominate a task for re-refinement intake, but they must not pre-write `planner_replan.*`
- observer bridge packets remain latest-summary-plus-index ingress only; full fact-chain assembly belongs to core-side merge keyed by `module_id + refinement_task_id + failure_chain_id`
- observer bridge consume uses a shared core-ingress builder; shell adapters may handle ACL / idempotency / state transitions, but they must not fork intake schema semantics
- observer bridge packet shaping may live in a scheduler-side bridge adapter, but planner replan judgement remains outside that adapter; bridge adapters may only detect that scheduler-configured escalation conditions have already been satisfied and then compact/summarize the resulting observation chain

## Forbidden Semantics

- entry-agent wording/interaction strategy
- direct mutation of user-facing conversational history
- bypassing planner contract with raw message payloads
- direct acceptance of raw `scheduler_escalation_request.json` as planner authority input

## Compatibility

- New status/policy enums must be additive unless schema version is bumped.
- Existing consumers must treat unknown enums as non-fatal and degrade to safe behavior.
- `planner-amendment-batch-v1` may remain as a breadcrumb path in `meta.json`, but it is not the planner authority input.
- runtime consumers must not treat legacy `planner_replan_execution_status` as authoritative.
- observer bridge ingress is candidate-only; impact, worker policy, and scope remain planner-owned decisions.
- `scheduler_escalation_request.json` is never a valid planner authority input; planner only consumes `observer_refinement_packet.json` through the observer bridge consumer.
- observer bridge may dedupe/coalesce packets lightly for hygiene, but it must not construct planner-side full narrative or root-cause judgement before planner/core merge.
