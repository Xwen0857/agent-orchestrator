# Worker Template Result Contract

Code owner:
- `agent-orchestrator/scripts/worker_realize_task.sh`

Purpose:
- define the machine-facing result shape that every builtin or custom worker template handler must emit

## Producer / Consumer

- Producer: worker template handler
- Consumer: `worker_realize_task.sh`

## Required Shape

- `schema_version = worker-template-result-contract-v1`
- `summary`
- `test_command`
- `changed_files`
- `delivery_manifest`
- `evidence_notes`

## Evidence Minimum

- `summary`, `test_command`, `changed_files`, and `evidence_notes` must all be non-empty after normalization
- role-aware evidence may be enforced by wrapper policy; current deterministic code workers require `delivery/RUNBOOK.md` for `frontend`, `backend`, and `infra`
- handlers declare evidence only; they do not decide export authority, retention, or fault handling

## Compatibility Rules

- handlers may add unknown fields, but the wrapper only consumes the required contract fields
- invalid or incomplete result objects are treated as handler failure
- the result contract carries execution evidence only; it does not carry planner/scheduler authority or runtime state
