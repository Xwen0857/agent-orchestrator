# `evaluate_gate.sh` Explain

## Purpose

Decides whether a requested operation should be allowed, monitored, or blocked pending approval, based on risk, budget, and operation attributes.

## Inputs And Outputs

Inputs:
- task directory
- operation request JSON

Outputs:
- gate decision JSON
- possible task state transition to `BLOCKED_PENDING_APPROVAL`
- possible approval ticket
- appended gate decision event
- appended audit note

## Step-By-Step Flow

1. Validate task and request inputs.
2. Read risk level, budget usage, and request flags such as destructive write or permission elevation.
3. Build the list of risk triggers.
4. Check whether an existing approval is present and whether its scope covers the active triggers.
5. Resolve the final decision:
   - `ALLOW`
   - `MONITOR`
   - `BLOCK_PENDING_APPROVAL`
6. If blocking is required, transition the task first, then create the approval ticket.
7. Append the gate-decision event and audit note.

## Failure Modes And Safety Checks

- Fails when task blocking cannot be enforced before a block decision is recorded.
- Compensates by removing a created approval ticket if event logging fails afterwards.
- Uses approval scope checks rather than merely checking approval presence.

## Key Dependencies

- `transition_task_state.sh`
- `append_task_event.sh`
- `validate_approval.sh`
- `create_approval_ticket.sh`

## Maintenance Notes

- Keep the trigger set and approval-scope mapping aligned with policy expectations.
- This script should remain the operational gatekeeper even if higher-level UIs also surface risk previews.
