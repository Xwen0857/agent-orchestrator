# Worker Lifecycle Governance Contract

Code owners:
- `extensions/orchestrator-dashboard/orchestrate-worker-runtime-contract.ts`
- `agent-orchestrator/scripts/worker_realize_task.sh`

Producer:
- `scheduler-ops` / runtime assembler

Consumer:
- worker wrapper (`worker_realize_task.sh`)

## Versioned Schemas

- `worker-lifecycle-governance-contract-v1`
- `worker-lifecycle-policy-template-v1`

## Purpose

Provide a scheduler/runtime-owned governance downlink that constrains template execution, result validation, overlay usage, mailbox defaults, `workerStage` allocation/export policy, and rebuild allowance without exposing raw scheduler config to the worker wrapper.

Compatibility note:
- despite its name, `worker_lifecycle_governance` is currently a historical governance bundle, not a lifecycle-only config surface
- it already carries template, overlay, mailbox, result, evidence, and worker-stage governance that are largely topology-derived or template-derived outcomes rather than lifecycle config itself
- new scheduler->worker config semantics must be split explicitly instead of being absorbed into this bundled field

## Required Semantics

- `scheduler/ops` remain the authority for dispatch, retry, degrade, reclaim, and rebuild decisions.
- `worker_runtime_view.json.lifecycle_governance` is a runtime-assembled effective governance view, not planner authority and not a task state machine.
- `worker_runtime_view.json.lifecycle_governance` should be treated as a `worker governance bundle` for compatibility. It is not the canonical name for topology config, milestone config, template-stage governance, or artifact retention execution state.
- `selected_template` is a topology-driven derived output. The governance bundle may project facts about the resolved template, but it is not the authority source for template selection.
- `meta.json` remains the source of truth; governance fields written under `meta.worker_runtime` are observability summaries only.
- custom templates may extend capability only; governance blocks any attempt to introduce new topology dimensions, runtime states, mailbox schema, or result schema.
- `workerStage` allocation is scheduler/runtime-owned; worker wrappers only consume `worker_stage` and `worker_stage_governance`, and must not invent broader write scope.
- task-cluster collaboration stays mailbox-only; `workerStage` files may leave the instance only through wrapper-controlled export.

## Required Fields

- `task_id`
- `operation_id`
- `dispatch_seq`
- `budget_governance`
- `template_governance`
- `overlay_governance`
- `mailbox_governance`
- `result_governance`
- `evidence_governance`
- `worker_stage_governance`
- `worker_stage_governance.stage_isolation_mode`
- `worker_stage_governance.stage_runtime_class`
- `worker_stage_governance.allowed_execution_mode`
- `worker_stage_governance.success_cleanup_rule`
- `worker_stage_governance.failure_cleanup_rule`
- `worker_stage_governance.export_policy.purge_artifacts_after_archive`
- `worker_stage_governance.export_policy.retain_archive_manifest`
- `rebuild_governance`

## Notes

- `policy_id` identifies the scheduler/runtime policy mapping used for this assembly.
- `allowed_template_origins` gates builtin/custom template execution before handler launch.
- coarse template classification belongs to topology config, and fine template resolution remains derived. This contract only carries the effective governance outcome for the resolved template.
- `require_enabled_custom_registration=true` means a selected custom template must resolve to an enabled normalized registration.
- `required_result_contract_version` is validated by the worker wrapper; handlers do not define their own result schema.
- mailbox defaults come from the effective governance view, not directly from scheduler config or handler output.
- `worker_stage_governance` defines effective per-instance `workerStage` budget, binary allowance, retention policy, export policy, and mailbox attachment policy.
- `worker_stage_governance` belongs to derived template/stage governance, not to lifecycle config itself.
- `evidence_governance` defines the effective evidence profile consumed by the worker wrapper, including `evidence_profile`, minimum evidence requirements, role-aware `RUNBOOK` requirement, and whether missing test commands may be justified by notes.
- scheduler-owned milestone targets and completion windows are separate execution-target inputs; they must not be renamed or reinterpreted as lifecycle policy.
- `archive_ready`, `reclaim_ready`, `purge_ready`, and `retention_decision` remain runtime control / artifact retention execution signals and template-level execution outcomes, not lifecycle config authority.
- `stage_isolation_mode` is an execution-envelope summary for the wrapper/runtime boundary. Current default is `wrapper_enforced`; this does not imply container or kernel-level isolation.
- `stage_isolation_mode = sandbox_mount` is now a real wrapper/runtime path with read-only inputs and runtime-root execution, but it is still wrapper-enforced rather than kernel/container isolated.
- `stage_runtime_class` and `allowed_execution_mode` are scheduler/runtime-owned downlink fields. Worker wrappers may branch launch behavior from them, but must not select new runtime authority on their own.
- `success_cleanup_rule` and `failure_cleanup_rule` make cleanup semantics explicit without giving the worker policy authority.
- exported mailbox attachments must reference wrapper-exported artifacts only; raw `workerStage` paths are invalid.
- policy templates may additionally define `fault_handling_policy` and `evidence_policy`; worker wrappers consume the effective outcome but do not become policy truth.
- `worker_stage_governance.export_policy` may define lifecycle flags such as `retain_on_success`, `retain_on_failure`, `archive_on_tester_consume`, `archive_failed_export_evidence`, `retain_export_records_when_stage_purged`, `purge_artifacts_after_archive`, and `retain_archive_manifest`.
- custom template governance may expose `selected_custom_runtime_gate_status` and `selected_custom_capability_gate_reason` so runtime assembly can block incompatible registrations before handler execution.
- worker wrappers consume this view but do not own, persist, or reinterpret lifecycle policy authority.
