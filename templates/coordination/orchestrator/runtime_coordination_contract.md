# Runtime Coordination Contract

Code owner:
- `extensions/orchestrator-dashboard/orchestrate-runtime-contract.ts`

Purpose:
- normalize runtime coordination signals into stable machine-facing structures
- keep runtime truth separate from response rendering and command text formatting

## Producer / Consumer

- Producer: planner apply/consume outputs, runtime consistency controller, task runtime state.
- Consumer: entry-agent meta projection, status/summary renderers, hook context builder.

## Contract Types

- `RuntimeReplanSignals`
- `ExecutionGuardSignals`
- `OrchestrateRuntimeCoordinationState`
- `EntryAgentToolPolicyView`
- `WorkerSemanticContract`
- `WorkerDispatchContract`
- `WorkerBudgetContract`
- `WorkerConvergenceContract`
- `WorkerCollaborationContract`
- `WorkerRuntimeView`
- `WorkerRuntimeCoordinationSignals`

## Allowed Semantics

- normalized replan signal extraction from split planner/runtime task meta
- runtime mismatch and planner pause guard signals
- command recommendation policy view for entry agent
- worker runtime assembly before dispatch
- token-lane budget degradation and reclaim signaling
- rebuild-ready coordination and keeper feedback candidate routing
- worker convergence reporting for ops/keeper consumption
- task-cluster mailbox target/ack/expiry metadata and collaboration counters

## Forbidden Semantics

- user wording templates
- planner decision generation
- receptionist intake normalization
- treating worker runtime view as planner or scheduler authority

## Compatibility

- Runtime contract is additive-first; unknown fields must be ignored by consumers.
- Guard defaults must fail safe (`should_block_side_effects` true only on explicit mismatch/pause).
- Task amendment runtime breadcrumbs must prefer task-folder authority (`meta.json` + `log.ndjson`); markdown mirrors are legacy artifacts and must not drive status/runtime projection.
- Worker runtime contracts are owner-split:
  - planner owns semantic slice inputs
  - scheduler/ops owns dispatch and budget lane
  - worker owns convergence reports
  - task-cluster workspace metadata is runtime-owned collaboration state
  - tester owns mailbox consume/ack/archive side effects
