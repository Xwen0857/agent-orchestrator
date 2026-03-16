# `system_health_check.sh` Explain

## Purpose

Builds the top-level orchestrator health report by combining task health, config-pointer drift checks, dashboard refresh, and keeper scheduler status.

## Inputs And Outputs

Inputs:
- optional task root
- output JSON path
- output markdown path
- stale threshold

Outputs:
- `system-health.json`
- `system-health.md`

## Step-By-Step Flow

1. Ensure output directories exist.
2. Compute keeper freshness thresholds from planner properties.
3. Run `health_check.sh` to gather task-level health.
4. Refresh the dashboard.
5. Validate planner config pointer presence and detect checksum drift against the pointed history version.
6. Inspect keeper report freshness, scheduler pid liveness, and stale lock state.
7. Combine all issues into one overall health status and write the final output files.

## Failure Modes And Safety Checks

- Degrades subsystem problems into the generated health report rather than failing closed.
- Uses checksum comparison to detect config drift instead of trusting the pointer metadata alone.
- Detects stale keeper locks only when the scheduler pid is no longer alive.

## Key Dependencies

- `health_check.sh`
- `dashboard_summary.sh`
- planner config and pointer files
- keeper report and scheduler lock files

## Maintenance Notes

- Keep the config-health and keeper-health sections stable because operators and external dashboards may depend on their shape.
- If keeper cadence changes, update the derived staleness threshold logic here and in `auto_recovery.sh`.
