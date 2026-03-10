# Scheduler Contract

Code owners:
- `extensions/orchestrator-dashboard/orchestrate-scheduler-contract.ts`
- `extensions/orchestrator-dashboard/orchestrate-scheduler-kernel.ts`

## Versioned Schemas

- `scheduler-config-v1`
- `scheduler-request-v1`
- `scheduler-decision-v1`
- `scheduler-dispatch-event-v1`

## Purpose

Provide a stable downlink contract from runtime policy + task meta into scheduler execution decisions.

## Required Semantics

- authority layering:
  - `L0` runtime guard hard boundary (no side-effect dispatch override)
  - `L1` planner semantic boundary (runtime replan lanes projected from planner authority are non-overridable)
  - `L2` scheduler operational override (`batch_selection|parallel_window|retry_policy|lane_route`) with audit
- `recovery > retry > assigned_ready` dispatch priority with lane quota minimums + scoring remainder fill
- unified retry backoff (`base_ms`, `max_ms`, `max_attempts`)
- runtime replan guard lanes (`runtime_replan.consume_status = paused|awaiting_revalidation`)
- mode adapters (`local_threads|container|distributed`)
- agent-profile-aware scheduling (`worker-delivery|tester-ephemeral|audit-guard|unknown`)

## Distributed Queue Topics

- `scheduler.dispatch.request`
- `scheduler.dispatch.ack`
- `scheduler.dispatch.result`
- `scheduler.worker.heartbeat`

## Notes

- distributed delivery is at-least-once; consumers must enforce idempotency using `task_id + dispatch_seq + operation_id`.
- scheduler kernel consumes `ack/result/heartbeat` in-process and writes inflight/retry metadata.
- distributed consumer state is persisted under queue root (`.consumer_state.json`) with topic offsets and bounded idempotency window (`idempotency_max_keys`, `idempotency_ttl_ms`).
- state transitions remain delegated to `transition_task_state.sh` and are orchestrated centrally by the scheduler kernel.
- `kernel_v2` is the only normal scheduler strategy exposed by config; `legacy_script` is retained only as an internal rollback path after runtime guard / rollback guard triggers.

## Metrics Semantics

- `summary.dispatch_attempts`: count of dispatch/retry adapter attempts in current tick.
- `summary.dispatch_successes`: count of dispatch/retry attempts that returned `ok=true`.
- `summary.recover_successes`: count of successful `BLOCKED_SYSTEM_ERROR -> ASSIGNED` recover transitions.
- `summary.recovery_applied`: compatibility alias for `recover_successes` (deprecated; keep one version window).
