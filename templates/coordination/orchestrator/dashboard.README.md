# Dashboard Output

`dashboard.md` and `dashboard.json` are runtime-generated orchestrator status artifacts.

They are intentionally treated as mutable output files rather than source-controlled documentation because they are continuously refreshed by orchestration scripts during normal operation.

## Runtime Files

- `templates/coordination/orchestrator/dashboard.md`
- `templates/coordination/orchestrator/dashboard.json`

## Source-Control Policy

- keep this README tracked
- do not rely on `dashboard.md` as a static document
- allow the runner and dashboard scripts to rewrite the runtime files freely

## Producers

The main producers are:

- `agent-orchestrator/scripts/dashboard_summary.sh`
- `agent-orchestrator/scripts/orchestrate_once.sh`
- `agent-orchestrator/scripts/orchestrate_multi_once.sh`

## Why This Exists

This file exists so the repository can document the dashboard contract without forcing the live dashboard output itself to remain in version control.
