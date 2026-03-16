# Receptionist Ingress Contract

Schema ownership:
- `extensions/orchestrator-dashboard/orchestrate-receptionist.ts`
- `extensions/orchestrator-dashboard/orchestrate-receptionist-state.ts`

Primary schemas:
- `receptionist-amendment-log-v2`
- `planner-effective-patch-v2`
- `planner-amendment-watermark-v2`

Legacy/local-only schemas:
- `receptionist-amendment-queue-v1`
- `planner-amendment-batch-v1`

## Producer / Consumer

- Producer: receptionist intake/amendment handlers.
- Consumer: planner apply script, runtime replan queue consumer, entry-agent meta projection.

## Allowed Semantics

- natural language intake normalization into structured draft deltas
- amendment queue collection with bounded window
- append-only amendment log ingestion
- deterministic `effective_patch` compilation per scope (`goal|constraints|deliverables|notes|workspace|budget`)
- watermark-based release and consumption tracking
- planner-facing structured incremental payload only through `planner-effective-patch-v2`

## Forbidden Semantics

- planner mode or split decision semantics
- scheduler policy override semantics
- raw user chat forwarding to planner
- entry-agent decode/tool policy wording

## Merge Rules (canonical)

- `goal/workspace/budget`: last `set` wins in same window
- `constraints/deliverables`: de-dup, apply append/remove net effect
- `notes`: append with de-dup

## Compatibility

- `planner-effective-patch-v2` and `planner-amendment-watermark-v2` are the planner ingress authority contracts.
- `receptionist-amendment-queue-v1` remains a receptionist-local persistence contract for session capture only.
- `planner-amendment-batch-v1` is legacy/audit-only; it must not be treated as planner authority input.
