# `keeper_run.sh` Explain

## Purpose

Runs the keeper maintenance cycle that ingests candidate KB entries, recomputes scores, suggests splits, and generates operator-facing reports.

## Inputs And Outputs

Inputs:
- planner config and properties
- knowledge-base entries directory
- KB feedback file

Outputs:
- `keeper-report.json`
- `keeper-report.md`

## Step-By-Step Flow

1. Check whether keeper is enabled in planner config.
2. If disabled, write a minimal disabled report and exit.
3. Run candidate ingestion.
4. Recompute KB scores.
5. Generate split suggestions.
6. Use the embedded Python block to aggregate:
   - entry counts and status breakdowns
   - merge/watch/archive candidates
   - low-score candidates
   - 7-day trend metrics from feedback events
7. Write the JSON report, then render the Markdown report from it.

## Failure Modes And Safety Checks

- Produces an explicit DISABLED report instead of silently skipping output.
- Keeps reporting best-effort around split suggestions by defaulting to `[]` on failure.
- Rewrites JSON first so Markdown rendering always starts from one generated source of truth.

## Key Dependencies

- `keeper_ingest_candidates.sh`
- `kb_recompute_scores.sh`
- `kb_split_suggest.py`
- knowledge-base entry markdown
- feedback NDJSON

## Maintenance Notes

- The JSON report is the canonical data source; keep the Markdown report as a rendered view of that data.
- If feedback schema changes, update the trend aggregation logic before changing report consumers.
