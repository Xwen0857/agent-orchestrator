# `append_task_event.sh` Explain

## Purpose

Appends one immutable event to a task's NDJSON audit log while preserving a hash chain and idempotent operation semantics.

## Inputs And Outputs

Inputs:
- task dir
- actor
- operation id
- action
- reason
- optional before/after states

Outputs:
- one appended line in `log.ndjson`

## Step-By-Step Flow

1. Validate args and required task metadata.
2. Create the log file if it does not exist.
3. Acquire the task lock via noclobber file creation.
4. Check whether the same operation id already exists and return early if so.
5. Read task metadata and the previous event hash.
6. Build the event payload without `hash_self`.
7. Compute `hash_self`, append the final event line, and release the lock.

## Failure Modes And Safety Checks

- Fails if task metadata is missing.
- Retries lock acquisition before giving up.
- Uses operation-id idempotency to avoid duplicate log events during retries.
- Computes the hash from the payload without `hash_self` so the chain can be independently verified later.

## Key Dependencies

- task `meta.json`
- task `log.ndjson`
- task `.lock`

## Maintenance Notes

- This script is the append-only write path for the task event log.
- If the event schema changes, keep `verify_task_log_chain.sh` aligned with the new hashing behavior.
