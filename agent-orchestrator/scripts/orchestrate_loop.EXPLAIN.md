# `orchestrate_loop.sh` Explain

## Purpose

Wraps `orchestrate_once.sh` in a simple timed loop for local daemon-style execution.

## Inputs And Outputs

Inputs:
- optional tasks root
- interval in seconds
- iteration count (`0` means unbounded)

Outputs:
- repeated invocations of `orchestrate_once.sh`
- one final loop summary line

## Step-By-Step Flow

1. Resolve the repository root and locate `orchestrate_once.sh`.
2. Validate the loop parameters.
3. Repeatedly call the single-cycle script.
4. Stop when the requested iteration count is reached, or continue forever if set to `0`.

## Failure Modes And Safety Checks

- Exits immediately if `orchestrate_once.sh` is not executable.
- Rejects non-numeric interval or iteration inputs.
- Defers all workflow safety to `orchestrate_once.sh`.

## Key Dependencies

- `orchestrate_once.sh`

## Maintenance Notes

- Keep this file intentionally simple; do not duplicate scheduling logic from `orchestrate_once.sh`.
- If retry/backoff behavior is needed later, add it here rather than inflating the single-cycle script.
