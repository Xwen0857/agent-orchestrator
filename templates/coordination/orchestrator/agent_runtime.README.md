# Agent Runtime Config

Path:
- planner policy (canonical): `templates/coordination/orchestrator/planner_policy.json`
- shared: `templates/coordination/orchestrator/agent_runtime.json`
- local override: `templates/coordination/orchestrator/agent_runtime.local.json`
- entry-agent decode contract: `templates/coordination/orchestrator/entry_agent_decode_contract.md`
- entry-agent meta contract: `templates/coordination/orchestrator/entry_agent_meta_contract.md`
- entry-agent tool policy contract: `templates/coordination/orchestrator/entry_agent_tool_policy_contract.md`
- entry action contract: `templates/coordination/orchestrator/entry_action_contract.md`
- runtime coordination contract: `templates/coordination/orchestrator/runtime_coordination_contract.md`
- receptionist ingress contract: `templates/coordination/orchestrator/receptionist_ingress_contract.md`
- planner replan contract: `templates/coordination/orchestrator/planner_replan_contract.md`
- session state contract: `templates/coordination/orchestrator/session_state_contract.md`
- scheduler contract: `templates/coordination/orchestrator/scheduler_contract.md`

Merge order:
1. `planner_policy.json` for planner strategy contract
2. `agent_runtime.local.json` as legacy `planner_agent` fallback override
3. `agent_runtime.json` as legacy `planner_agent` fallback base
4. built-in defaults

Role split:
- `planner_policy.json`: versioned planner strategy contract (`planner_agent`, execution target hints, compat flags)
- `agent_runtime.json`: runtime provider and auth config (`llm` and legacy `planner_agent` fallback)
- `entry_agent_decode_contract.md`: entry-agent interpretation contract for `BEGIN_ORCHESTRATE_AGENT_META ... END_ORCHESTRATE_AGENT_META`
- `entry_action_contract.md`: deterministic running-session action routing contract (`amend_existing_task|intake_new_task|clarify_target`)
- `receptionist_ingress_contract.md`: ingress authority is `log-v2 + effective_patch-v2 + watermark-v2`; `queue-v1` is local capture only

Planner decomposition semantics:
- Ingress no longer stores a mode field; planner-core always performs the first-layer Meta decomposition.
- The first layer is decoupling-first: functional boundaries are the primary principle.
- Worker refinement still happens before work enters workers and is treated as engineering decoupling.
- Runtime heuristics remain available, but only as soft granularity guardrails.
- `refinement_partition.leaf_units` dependency data is currently a minimal planning hint (`component_semantic_linearized`), not a scheduling DAG.
- Dependency summaries (`roots/blocked/cross-module`) are consumable by status/release output only in this phase.
- Escalate to full DAG only when scheduler/replan/tester/UI introduces a concrete dependency-graph consumer.
- Dashboard response assembly follows a projection boundary:
  - `orchestrate-planner-projection.ts` derives planner semantics.
  - `orchestrate-view-model.ts` composes render params.
- Dependency config split:
  - `planner_dependency_semantics.json`: component dependency map
  - `planner_dependency_defaults.json`: fallback mode/note/summary defaults
  - constants (`planner-split-plan-v1`, `component_semantic_linearized`, `planning_hint_not_scheduler_dag`) are protected by planner contract/config consistency tests.

Planner boundary matrix:
- `orchestrate-planner-contract.ts`: types + re-export barrel only
- `orchestrate-planner-split-plan-contract.ts`: split-plan normalize/validate/fail-fast
- `orchestrate-planner-projection.ts`: planner semantic projection
- `orchestrate-view-model.ts`: render param composition

Import direction policy:
1. allow `projection -> contract/errors/hints`
2. allow `view-model -> projection/response`
3. prohibit `view-model -> split-plan-contract`
4. prohibit `run/status/agent-runtime -> split-plan-contract`

Split-plan data flow:
1. `dependency_semantics/defaults` loaded as source-of-truth
2. split-plan schema normalized
3. split-plan parsed into strict internal shape
4. dependency and summary consistency validated (fail-fast)
5. validated split-plan consumed by projection/response layers

`planner_agent` in `agent_runtime.json` remains supported for backward compatibility, but it is no longer the primary planner policy source.

`llm` fields:
- `enabled`: enable/disable LLM planning enrichment
- `auth_mode`: `standalone | openclaw | auto`
- `api_base_url`: OpenAI-compatible base URL
- `api_key`: optional inline key (prefer local override only; used in `standalone/auto`)
- `api_key_env`: environment variable fallback for API key
- `model`: model id
- `temperature`: 0~1
- `max_tokens`: completion max tokens
- `timeout_ms`: request timeout
- `system_prompt`: planning system instruction

If LLM call fails, orchestrator falls back to deterministic strategy parsing.

Receptionist amendment authority:
- planner-facing amendment input is `planner-effective-patch-v2`
- release/consume consistency is tracked by `planner-amendment-watermark-v2`
- `planner-amendment-batch-v1` may exist as a compatibility breadcrumb only; it is not planner authority input

Auth mode behavior:
- `standalone`: use `api_key` then `api_key_env`.
- `openclaw`: prefer `api.config.models.providers.<provider>.apiKey`, then provider env (e.g. `OPENAI_API_KEY`, `GEMINI_API_KEY`).
- `auto`: try `standalone`, then `openclaw`.
