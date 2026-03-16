# Custom Template Handler Contract

Code owner:
- `agent-orchestrator/scripts/worker_realize_task.sh`

Purpose:
- define the execution contract that a custom worker template handler must satisfy so it can run through the standard worker wrapper

## Producer / Consumer

- Producer: custom template provider
- Consumer: `worker_realize_task.sh`

## Required Interface

- input arguments:
  - `task_dir`
  - `worker_runtime_view.json`
- runtime environment:
  - `ORCH_WORKER_STAGE_ID`
  - `ORCH_WORKER_STAGE_ROOT`
  - `ORCH_WORKER_STAGE_INPUTS_ROOT`
  - `ORCH_WORKER_STAGE_RUNTIME_ROOT`
  - `ORCH_WORKER_STAGE_SCRATCH_ROOT`
  - `ORCH_WORKER_STAGE_DELIVERY_ROOT`
  - `ORCH_WORKER_STAGE_RUNTIME_CLASS`
  - `ORCH_WORKER_STAGE_ALLOWED_EXECUTION_MODE`
- stdout:
  - a single JSON object
- allowed side effects:
  - write only under the injected `workerStage` paths, especially `ORCH_WORKER_STAGE_DELIVERY_ROOT`
  - append evidence inputs that the wrapper will later record into `work.md`, `test.md`, and `RUNBOOK.md`

## Required JSON Result

- `schema_version = worker-template-result-contract-v1`
- `summary`
- `test_command`
- `changed_files`
- `delivery_manifest`
- `evidence_notes`

## Forbidden Behavior

- writing planner or scheduler authority
- inventing task states
- redefining mailbox or convergence schemas
- bypassing the wrapper to write nonstandard runtime signals
- writing authority paths, task-cluster mailbox files, or sibling `workerStage` roots directly
- inventing new export schemas, mailbox attachment formats, or fault enums

## Failure Semantics

- non-zero exit or invalid JSON is treated as handler failure
- evidence missing from the required result contract is treated as wrapper-side validation failure
- wrapper converts handler failure into the standard worker failure path:
  - `stalled`
  - `runtime_capability_insufficient`
