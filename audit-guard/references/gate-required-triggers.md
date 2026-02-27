# Gate Required Triggers (Phase 2.1)

Any trigger below requires gate evaluation. If approval is absent, decision must be `BLOCK_PENDING_APPROVAL`.

## Mandatory Approval Triggers

1. `risk_level` is `HIGH` or `CRITICAL`.
2. Budget exhausted (`token% >= 100` or `time% >= 100`).
3. Destructive operation (`delete`, `rm`, irreversible change).
4. External write outside workspace or external system side effects.
5. Overwrite/replace of critical artifacts.
6. Permission elevation (`sudo`, privilege boundary crossing).

## Enforced Outcome

1. Task state transitions to `BLOCKED_PENDING_APPROVAL`.
2. Approval ticket is created under `templates/coordination/audit/approvals/`.
3. Execution must stop until `approval.json` exists and validates.
