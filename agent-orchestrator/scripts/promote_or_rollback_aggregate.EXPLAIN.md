# `promote_or_rollback_aggregate.sh` Explain

## Purpose

Publishes a staged aggregate delivery bundle or rolls it back into preserved evidence for a parent task run.

## Inputs And Outputs

Inputs:
- `--task-dir`
- `--run-root`
- `--mode <promote|rollback>`
- optional `--reason`

Outputs:
- moved delivery directories
- rollback evidence copies
- updated aggregate metadata in `meta.json`
- JSON status summary on stdout

## Step-By-Step Flow

1. Parse and validate required flags.
2. Resolve staging, manifest, audit, delivery, and evidence paths.
3. Update aggregate metadata through a temp file helper.
4. In `promote` mode, verify aggregate audit pass status and swap staged delivery into the live location.
5. In `rollback` mode, copy staging evidence, remove the live staging tree, and mark the aggregate as rolled back.

## Failure Modes And Safety Checks

- Rejects invalid mode or missing task metadata.
- Promotion fails if aggregate audit is not `PASS`.
- Preserves the previous delivery bundle before replacing it.
- Copies rollback evidence before deleting staged content.

## Key Dependencies

- parent task `meta.json`
- `aggregate_audit.json`
- `delivery_staging`
- `delivery`
- `evidence`

## Maintenance Notes

- Keep metadata writes atomic because this script changes both filesystem layout and task state.
- If aggregate publish semantics change, update both this file and the transition guards that enforce parent close.
