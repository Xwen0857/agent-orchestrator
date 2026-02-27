# Budget And Gate Rules (Phase 1.2)

## Inputs

From `meta.json`:

- `budget.max_token_cost`
- `budget.max_execution_time_seconds`
- `consumption.token_cost_used`
- `consumption.execution_time_used_seconds`

## Enforcement

1. At each key step, worker updates `consumption` and appends one event to `log.ndjson`.
2. If either usage ratio reaches `>=80%`, append `action="WARN_BUDGET"`.
3. If either usage ratio reaches `>=100%`, task must transition to `BLOCKED_PENDING_APPROVAL`.
4. Resume only if `approval.json` exists and is valid.
5. When valid `approval.json` already exists and is not expired, transition script may continue requested state without forced re-block.
6. Approval scope must match trigger type:
 - High-risk/destructive triggers require `high_risk_operation` or `break_glass`.
 - Budget-only continuation may use `over_budget_continue`.

## Approval Payload (`approval.json`) Minimal Fields

```json
{
  "approval_id": "APR-20260213-120000",
  "task_id": "task_demo_001",
  "approved_by": "master",
  "approved_at": "2026-02-13T12:00:00Z",
  "scope": "over_budget_continue",
  "expires_at": "2026-02-13T14:00:00Z"
}
```

## Dashboard Exposure

`dashboard_summary.sh` should show:

1. task-level token/time utilization percentages.
2. pending action `APPROVE_OVER_BUDGET` when ratio is `>=100%`.
