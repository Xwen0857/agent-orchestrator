# Session State Contract

Schema ownership:
- `extensions/orchestrator-dashboard/orchestrate-session.ts`
- `extensions/orchestrator-dashboard/orchestrate-path.ts`

Primary schemas:
- `orchestrate-session-v1`
- `orchestrate-path-state-v1`

## Producer / Consumer

- Producer: receptionist/session command flow, before-agent hook updates.
- Consumer: run/session/summary/status commands, entry-agent meta builder.

## Allowed Semantics

- conversation lifecycle (`ACTIVE_DRAFTING|SUMMARY_READY|RUNNING|CLOSED`)
- receptionist lifecycle and pending questions
- normalized draft fields
- summary snapshot pointer and last run binding
- path state and workspace routing metadata

## Forbidden Semantics

- planner split strategy/decision semantics
- scheduler execution policy semantics
- user-facing decode wording rules
- entry-agent tool policy rules

## Compatibility

- Backward compatibility is schema-version based.
- Unknown fields must be ignored by consumers.
- New required fields require schema version bump.
