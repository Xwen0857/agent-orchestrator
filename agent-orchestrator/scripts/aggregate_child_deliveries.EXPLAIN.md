# `aggregate_child_deliveries.sh` Explain

## Purpose

Collects child-task delivery outputs into one staged parent delivery bundle and emits a manifest describing the aggregated files.

## Inputs And Outputs

Inputs:
- `--task-dir`
- `--run-root`
- `--children-json`

Outputs:
- `delivery_staging`
- `delivery_staging_manifest.json`
- JSON status summary on stdout

## Step-By-Step Flow

1. Parse and validate required arguments.
2. Resolve the parent task and run-root paths.
3. Use the embedded Python block to:
   - parse the child id list
   - validate each child task and its `run_root`
   - enumerate child `delivery` files
   - compute per-file hashes
   - detect path collisions across children
   - write the aggregate manifest
4. If there are no collisions or validation errors, rebuild `delivery_staging` and copy the selected files into it.

## Failure Modes And Safety Checks

- Fails on invalid or empty child lists.
- Fails when child metadata or child delivery trees are missing.
- Detects same-path collisions across different children and refuses to build a staging tree in that case.
- Rebuilds `delivery_staging` from scratch after a successful manifest pass.

## Key Dependencies

- parent task `meta.json`
- child task `meta.json`
- child `run_root/delivery`
- Python file hashing and copy logic

## Maintenance Notes

- Keep collision handling strict; silent last-write-wins behavior would make parent delivery provenance ambiguous.
- If the manifest schema changes, update both this file and any later aggregate audit/promotion scripts that consume it.
