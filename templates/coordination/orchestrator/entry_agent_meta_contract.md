# Entry Agent Meta Contract

Schema ownership:
- `extensions/orchestrator-dashboard/orchestrate-agent-meta.ts`

Primary schema:
- `orchestrate-agent-meta-v1`

Injection boundary:

```text
BEGIN_ORCHESTRATE_AGENT_META
{ ...json... }
END_ORCHESTRATE_AGENT_META
```

## Producer / Consumer

- Producer: before-agent hook context assembly.
- Consumer: entry agent decode logic / skills.

## Allowed Semantics

- session + draft state projection
- planner ingress boundary flags
- run binding context
- amendment queue state plus watermark summary (`head/applying/consumed/release_reason`)
- entry action routing state (`amend_existing_task|intake_new_task|clarify_target`)
- runtime coordination projection (replan + guard)
- recommended trigger hints

## Forbidden Semantics

- raw user chat transcript forwarding
- planner split/mode decision authority
- user-facing prose policy

## Relationship to Other Contracts

- Consumes Session State Contract and Runtime Coordination Contract.
- Interpreted by Entry Agent Decode Contract and Entry Agent Tool Policy Contract.

## Compatibility

- Schema changes require explicit `schema_version` evolution.
- Entry agents must tolerate additive fields.
