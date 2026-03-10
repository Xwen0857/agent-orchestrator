#!/usr/bin/env bash
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

# Interprets the task-local planning request under auto-only ingress, decides
# the first-layer initial split, emits a structured planner decision, then
# applies that decision by dispatching the current refinement preparation path.
# Inputs: `--task-dir`.
# Side effects: reads task strategy/runtime config, may call an LLM-backed decision path,
# appends planner events, and generates worker/planner artifacts.
# Failure model: exits non-zero on invalid args, missing dependencies, invalid task inputs, or planner dispatch failures.

ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
TASK_DIR=""
APPEND_SCRIPT="$ROOT/agent-orchestrator/scripts/append_task_event.sh"
PLANNER_SINGLE_SCRIPT="$ROOT/agent-orchestrator/scripts/planner_prepare_single_worker.sh"
PLANNER_MULTI_SCRIPT="$ROOT/agent-orchestrator/scripts/planner_prepare_workers.sh"
PLANNER_APPLY_SCRIPT="$ROOT/agent-orchestrator/scripts/planner_apply_decision.sh"
PLANNER_SUMMARY_SCRIPT="$ROOT/agent-orchestrator/scripts/planner_strategy_summary.sh"
AGENT_RUNTIME_CONFIG="${PLANNER_AGENT_RUNTIME_CONFIG:-$ROOT/templates/coordination/orchestrator/agent_runtime.json}"
PLANNER_POLICY_CONFIG="${PLANNER_POLICY_CONFIG:-$ROOT/templates/coordination/orchestrator/planner_policy.json}"
EXECUTION_RUNTIME_CONFIG="${PLANNER_EXECUTION_RUNTIME_CONFIG:-$ROOT/templates/coordination/orchestrator/execution_runtime.json}"

usage() {
  echo "usage: $0 --task-dir <task_dir>"
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --task-dir)
      [[ $# -ge 2 ]] || usage
      TASK_DIR="$2"
      shift 2
      ;;
    *)
      usage
      ;;
  esac
done

[[ -n "$TASK_DIR" ]] || usage

if [[ ! -x "$PLANNER_SINGLE_SCRIPT" || ! -x "$PLANNER_MULTI_SCRIPT" || ! -x "$PLANNER_APPLY_SCRIPT" || ! -x "$APPEND_SCRIPT" || ! -f "$PLANNER_SUMMARY_SCRIPT" ]]; then
  echo "planner dependencies missing"
  exit 1
fi
source "$PLANNER_SUMMARY_SCRIPT"

if [[ "$TASK_DIR" != /* ]]; then
  TASK_DIR="$ROOT/$TASK_DIR"
fi
TASK_DIR="$(cd "$TASK_DIR" && pwd -P)"
META="$TASK_DIR/meta.json"
[[ -f "$META" ]] || { echo "meta.json missing: $META"; exit 1; }

TASK_ID="$(jq -r '.id // empty' "$META")"
[[ -n "$TASK_ID" ]] || { echo "task id missing in meta"; exit 1; }
STRATEGY="$TASK_DIR/${TASK_ID}.strategy.json"
[[ -f "$STRATEGY" ]] || { echo "strategy missing: $STRATEGY"; exit 1; }
load_planner_strategy_summary "$STRATEGY"

worker_id="$(printf '%s' "${TASK_ID#task_}" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '_' | sed -E 's/^_+|_+$//g' | cut -c1-48)"
worker_id="worker_${worker_id:-generic}"

PLANNER_OUTPUT_JSON="$(
  python3 - "$STRATEGY" "$META" "$PLANNER_POLICY_CONFIG" "$AGENT_RUNTIME_CONFIG" "$EXECUTION_RUNTIME_CONFIG" "$TASK_GOAL" "$PLANNER_GOAL" "$SUMMARY_CONSTRAINTS" "$SUMMARY_DELIVERABLES" "$SUMMARY_NOTES" <<'PY'
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

strategy_path = Path(sys.argv[1])
meta_path = Path(sys.argv[2])
planner_policy_path = Path(sys.argv[3])
agent_runtime_path = Path(sys.argv[4])
execution_runtime_path = Path(sys.argv[5])
task_goal = sys.argv[6]
planner_goal = sys.argv[7]
summary_constraints = sys.argv[8]
summary_deliverables = sys.argv[9]
summary_notes = sys.argv[10]

strategy = json.loads(strategy_path.read_text(encoding="utf-8"))
meta = json.loads(meta_path.read_text(encoding="utf-8"))
planner_policy = {}
agent_runtime = {}
agent_runtime_local = {}
execution_runtime = {}
if planner_policy_path.exists():
    planner_policy = json.loads(planner_policy_path.read_text(encoding="utf-8"))
if agent_runtime_path.exists():
    agent_runtime = json.loads(agent_runtime_path.read_text(encoding="utf-8"))
if agent_runtime_path.name.endswith(".json"):
    agent_runtime_local_path = agent_runtime_path.with_name(agent_runtime_path.name[:-5] + ".local.json")
else:
    agent_runtime_local_path = Path(str(agent_runtime_path) + ".local")
if agent_runtime_local_path.exists():
    agent_runtime_local = json.loads(agent_runtime_local_path.read_text(encoding="utf-8"))
if execution_runtime_path.exists():
    execution_runtime = json.loads(execution_runtime_path.read_text(encoding="utf-8"))

agent_runtime_effective = {}
if isinstance(agent_runtime, dict):
    agent_runtime_effective.update(agent_runtime)
if isinstance(agent_runtime_local, dict):
    agent_runtime_effective.update(agent_runtime_local)
agent_runtime_effective["llm"] = {
    **((agent_runtime.get("llm") or {}) if isinstance(agent_runtime, dict) else {}),
    **((agent_runtime_local.get("llm") or {}) if isinstance(agent_runtime_local, dict) else {}),
}

budget = strategy.get("budget", {}) or {}
budget_seconds = int(budget.get("max_execution_time_seconds", 3600) or 3600)
budget_tokens = int(budget.get("max_token_cost", 50000) or 50000)
child_task = bool(meta.get("parent_task_id"))

def estimate_minutes(text: str, seconds: int) -> int:
    match = re.search(r"([0-9]{1,4})\s*分钟", text)
    if match:
        return max(1, int(match.group(1)))
    match = re.search(r"([0-9]{1,3})\s*(小时|h|hour|hours)", text, re.IGNORECASE)
    if match:
        return max(1, int(match.group(1)) * 60)
    return max(1, (seconds + 59) // 60)

def planner_agent_policy(raw: dict) -> dict:
    planner = raw if isinstance(raw, dict) else {}
    if isinstance(planner.get("planner_agent"), dict):
        planner = planner.get("planner_agent") or {}
    token = (planner.get("token_priority") or {}) if isinstance(planner, dict) else {}
    mcp = (planner.get("mcp_soft_boundary") or {}) if isinstance(planner, dict) else {}
    guardrails = (planner.get("granularity_guardrails") or {}) if isinstance(planner, dict) else {}
    meta_units = (guardrails.get("meta_units") or {}) if isinstance(guardrails, dict) else {}
    leaf_units = (guardrails.get("leaf_units_per_meta") or {}) if isinstance(guardrails, dict) else {}
    return {
        "llm_role": "primary",
        "token_priority": {
            "tier": "highest",
            "reserved_ratio": float(token.get("reserved_ratio", 0.35) or 0.35),
            "min_planning_tokens": max(1, int(token.get("min_planning_tokens", 1200) or 1200)),
            "max_planning_tokens": max(1, int(token.get("max_planning_tokens", 6000) or 6000)),
            "allow_inline_override": bool(token.get("allow_inline_override", True)),
        },
        "mcp_soft_boundary": {
            "mode": "bias_plan",
            "include_namespace": bool(mcp.get("include_namespace", True)),
            "include_read_only": bool(mcp.get("include_read_only", True)),
            "include_profile_name": bool(mcp.get("include_profile_name", True)),
            "include_isolation_enabled": bool(mcp.get("include_isolation_enabled", True)),
        },
        "granularity_guardrails": {
            "mode": "soft",
            "meta_units": {
                "min": max(1, int(meta_units.get("min", 1) or 1)),
                "max": max(1, int(meta_units.get("max", 4) or 4)),
            },
            "leaf_units_per_meta": {
                "min_meaningful_scope": "component_sized",
                "max": max(1, int(leaf_units.get("max", 8) or 8)),
            },
            "allow_agent_override_with_reason": bool(
                guardrails.get("allow_agent_override_with_reason", True)
            ),
        },
    }

def planner_execution_targets(raw: dict) -> dict:
    targets = (raw.get("execution_targets") or {}) if isinstance(raw, dict) else {}
    local_threads = (targets.get("local_threads") or {}) if isinstance(targets, dict) else {}
    container = (targets.get("container") or {}) if isinstance(targets, dict) else {}
    distributed = (targets.get("distributed") or {}) if isinstance(targets, dict) else {}
    return {
        "local_threads": {
            "enabled": bool(local_threads.get("enabled", True)),
        },
        "container": {
            "enabled": bool(container.get("enabled", False)),
            "planner_transport": str(container.get("planner_transport") or "reserved"),
        },
        "distributed": {
            "enabled": bool(distributed.get("enabled", False)),
            "planner_transport": str(distributed.get("planner_transport") or "reserved"),
            "dispatch_endpoint": str(distributed.get("dispatch_endpoint") or ""),
        },
    }

def merge_legacy_planner_agent(base_raw: dict, local_raw: dict):
    base_planner = (base_raw.get("planner_agent") or {}) if isinstance(base_raw, dict) else {}
    local_planner = (local_raw.get("planner_agent") or {}) if isinstance(local_raw, dict) else {}
    if not isinstance(base_planner, dict):
        base_planner = {}
    if not isinstance(local_planner, dict):
        local_planner = {}
    if not base_planner and not local_planner:
        return {}
    return {
        **base_planner,
        **local_planner,
        "token_priority": {
            **((base_planner.get("token_priority") or {}) if isinstance(base_planner, dict) else {}),
            **((local_planner.get("token_priority") or {}) if isinstance(local_planner, dict) else {}),
        },
        "mcp_soft_boundary": {
            **((base_planner.get("mcp_soft_boundary") or {}) if isinstance(base_planner, dict) else {}),
            **((local_planner.get("mcp_soft_boundary") or {}) if isinstance(local_planner, dict) else {}),
        },
    }

def planner_policy_document(raw: dict) -> dict:
    defaults = {
        "schema_version": "planner-policy-v1",
        "policy_id": "planner_default",
        "updated_at": "2026-03-03T00:00:00Z",
        "planner_agent": planner_agent_policy({}),
        "execution_targets": planner_execution_targets({}),
        "compat": {
            "allow_agent_runtime_fallback": True,
        },
    }
    compat = (raw.get("compat") or {}) if isinstance(raw, dict) else {}
    return {
        "schema_version": "planner-policy-v1",
        "policy_id": str(raw.get("policy_id") or defaults["policy_id"]),
        "updated_at": str(raw.get("updated_at") or defaults["updated_at"]),
        "planner_agent": planner_agent_policy((raw.get("planner_agent") or {}) if isinstance(raw, dict) else {}),
        "execution_targets": planner_execution_targets(raw),
        "compat": {
            "allow_agent_runtime_fallback": bool(
                compat.get("allow_agent_runtime_fallback", defaults["compat"]["allow_agent_runtime_fallback"])
            ),
        },
    }

legacy_planner_agent = merge_legacy_planner_agent(agent_runtime, agent_runtime_local)
if isinstance(planner_policy, dict) and planner_policy:
    policy_document = planner_policy_document(planner_policy)
    local_override_planner = merge_legacy_planner_agent({}, agent_runtime_local)
    if policy_document["compat"]["allow_agent_runtime_fallback"] and local_override_planner:
        policy_document["planner_agent"] = planner_agent_policy(
            {
                "planner_agent": merge_legacy_planner_agent(
                    {"planner_agent": policy_document["planner_agent"]},
                    {"planner_agent": local_override_planner},
                )
            }
        )
elif legacy_planner_agent:
    policy_document = planner_policy_document(
        {
            "policy_id": "planner_legacy_fallback",
            "planner_agent": legacy_planner_agent,
            "compat": {
                "allow_agent_runtime_fallback": True,
            },
        }
    )
else:
    policy_document = planner_policy_document({})

policy = policy_document["planner_agent"]

runtime_isolation = (execution_runtime.get("agent_runtime_isolation") or {}) if isinstance(execution_runtime, dict) else {}
orchestrator_namespace = (runtime_isolation.get("orchestrator_namespace") or {}) if isinstance(runtime_isolation, dict) else {}
project_namespace = (runtime_isolation.get("project_namespace") or {}) if isinstance(runtime_isolation, dict) else {}
execution_target = str(execution_runtime.get("mode") or "local_threads")
if execution_target not in {"local_threads", "container", "distributed"}:
    execution_target = "local_threads"

mcp_soft_boundary_signals = {
    "mode": "bias_plan",
    "isolation_enabled": bool(runtime_isolation.get("enabled", False)),
    "orchestrator_profile_name": str(runtime_isolation.get("orchestrator_profile_name", "")),
    "project_profile_name": str(runtime_isolation.get("project_profile_name", "")),
    "orchestrator_mcp_dir": str(orchestrator_namespace.get("mcp_dir", "")),
    "project_mcp_dir": str(project_namespace.get("mcp_dir", "")),
    "orchestrator_namespace_read_only": bool(orchestrator_namespace.get("read_only", False)),
    "project_namespace_read_only": bool(project_namespace.get("read_only", False)),
}

keyword_map = {
    "split": ["拆分", "split"],
    "parallel": ["并行", "parallel"],
    "multi_module": ["多个模块", "模块", "protocol", "core", "test", "doc", "协议层", "核心", "测试", "文档"],
    "platform": ["平台", "platform"],
}

signals = []
goal_text = planner_goal or ""
constraints_text = summary_constraints or ""
deliverables_text = summary_deliverables or ""
notes_text = summary_notes or ""
summary_context_text = " ".join(
    segment for segment in [goal_text, constraints_text, deliverables_text, notes_text] if segment
)
goal_lower = goal_text.lower()
constraints_lower = constraints_text.lower()
deliverables_lower = deliverables_text.lower()
notes_lower = notes_text.lower()
summary_lower = summary_context_text.lower()

def contains_en_word_in(text: str, word: str) -> bool:
    return bool(re.search(r"\b" + re.escape(word.lower()) + r"(?:s)?\b", text.lower()))

def contains_en_word(word: str) -> bool:
    return contains_en_word_in(summary_context_text, word)

def contains_cn_in(text: str, token: str) -> bool:
    return token in text

def has_goal_word(word: str, cn_token: str = "") -> bool:
    return contains_en_word_in(goal_text, word) or (bool(cn_token) and contains_cn_in(goal_text, cn_token))

def has_constraints_word(word: str, cn_token: str = "") -> bool:
    return contains_en_word_in(constraints_text, word) or (
        bool(cn_token) and contains_cn_in(constraints_text, cn_token)
    )

def has_deliverables_word(word: str, cn_token: str = "") -> bool:
    return contains_en_word_in(deliverables_text, word) or (
        bool(cn_token) and contains_cn_in(deliverables_text, cn_token)
    )

def has_notes_word(word: str, cn_token: str = "") -> bool:
    return contains_en_word_in(notes_text, word) or (bool(cn_token) and contains_cn_in(notes_text, cn_token))

def contains_signal(pattern: str) -> bool:
    lowered = pattern.lower()
    if re.fullmatch(r"[a-z_]+", lowered):
        if "_" in lowered:
            return lowered in summary_lower
        return contains_en_word(lowered)
    return lowered in summary_lower

for label, patterns in keyword_map.items():
    if any(contains_signal(p) for p in patterns):
        signals.append(label)

artifact_count_hint = 1
if contains_en_word("test") or "测试" in summary_context_text:
    artifact_count_hint += 1
if contains_en_word("doc") or contains_en_word("runbook") or "文档" in summary_context_text:
    artifact_count_hint += 1

estimated_minutes = estimate_minutes(planner_goal, budget_seconds)
strong_multi = (
    estimated_minutes >= 180
    or budget_seconds >= 10800
    or artifact_count_hint >= 3
    or bool(signals)
)

base_tokens = max(
    policy["token_priority"]["min_planning_tokens"],
    int(policy["token_priority"]["max_planning_tokens"] * policy["token_priority"]["reserved_ratio"]),
)
effective_tokens = min(budget_tokens, policy["token_priority"]["max_planning_tokens"], base_tokens)
inline_override_applied = False
if policy["token_priority"]["allow_inline_override"] and strong_multi:
    candidate = max(effective_tokens, policy["token_priority"]["min_planning_tokens"] * 2)
    effective_tokens = min(budget_tokens, policy["token_priority"]["max_planning_tokens"], candidate)
    inline_override_applied = effective_tokens > base_tokens
effective_tokens = max(1, effective_tokens)

token_priority_context = {
    "tier": "highest",
    "reserved_ratio": policy["token_priority"]["reserved_ratio"],
    "min_planning_tokens": policy["token_priority"]["min_planning_tokens"],
    "max_planning_tokens": policy["token_priority"]["max_planning_tokens"],
    "inline_override_applied": inline_override_applied,
    "effective_planning_tokens": effective_tokens,
}

request_id = f"planner_request_{meta.get('id') or strategy.get('task_id') or 'unknown'}"
task_id = str(meta.get("id") or strategy.get("task_id") or "")
planner_request = {
    "schema_version": "planner-request-v1",
    "request_id": request_id,
    "task": {
        "task_id": task_id,
        "parent_task_id": str(meta.get("parent_task_id") or ""),
        "task_goal": str((strategy.get("summary_input") or {}).get("task_goal") or strategy.get("goal") or ""),
    },
    "source": {
        "summary_input": (strategy.get("summary_input") or {}) if isinstance(strategy, dict) else {},
        "budget": (strategy.get("budget") or {}) if isinstance(strategy, dict) else {},
        "workspace": (strategy.get("workspace") or {}) if isinstance(strategy, dict) else {},
    },
    "policy": policy_document,
    "runtime_context": {
        "agent_runtime_isolation": runtime_isolation if isinstance(runtime_isolation, dict) else {},
        "execution_target": execution_target,
    },
    "compat": {
        "request_authority": "task_local_strategy_meta",
    },
}

def default_single_module_spec() -> dict:
    return {
        "title": "root_meta_unit",
        "rationale": "no strong functional boundary detected",
    }

def infer_functional_module_specs() -> list:
    inferred = []
    if has_constraints_word("protocol", "协议") or has_goal_word("protocol", "协议"):
        rationale = (
            "constraints describe a protocol-facing boundary"
            if has_constraints_word("protocol", "协议")
            else "protocol boundary can evolve independently"
        )
        inferred.append({"title": "protocol_surface", "rationale": rationale})
    if has_constraints_word("api", "接口") or has_goal_word("api", "接口"):
        rationale = (
            "constraints define an interface-facing boundary"
            if has_constraints_word("api", "接口")
            else "api surface can be evolved with low coupling"
        )
        inferred.append({"title": "api_surface", "rationale": rationale})
    if has_goal_word("core", "核心") or has_constraints_word("core", "核心"):
        inferred.append({"title": "core_logic", "rationale": "core logic has a distinct responsibility boundary"})
    if has_goal_word("adapter", "适配") or has_notes_word("adapter", "适配"):
        inferred.append({"title": "adapter_layer", "rationale": "adapter layer can be implemented independently"})
    if (
        has_deliverables_word("test", "测试")
        or has_notes_word("test", "测试")
        or has_notes_word("verify", "验证")
    ):
        inferred.append(
            {"title": "test_harness", "rationale": "deliverables require a standalone verification boundary"}
        )
    if (
        has_deliverables_word("doc", "文档")
        or has_deliverables_word("runbook")
        or has_notes_word("doc", "文档")
        or has_notes_word("runbook")
    ):
        inferred.append(
            {"title": "docs_rollout", "rationale": "deliverables include standalone documentation and rollout guidance"}
        )
    return inferred

def normalize_module_specs(proposed_modules) -> list:
    if not isinstance(proposed_modules, list):
        return [default_single_module_spec()]
    normalized = []
    fallback_specs = infer_functional_module_specs() or [
        {"title": "core_logic", "rationale": "primary implementation logic"},
        {"title": "verification_docs", "rationale": "verification and supporting delivery"},
        {"title": "integration_surface", "rationale": "integration-facing wrapper"},
        {"title": "supporting_components", "rationale": "supporting implementation components"},
    ]
    fallback_index = 0
    for raw in proposed_modules:
        title = ""
        rationale = ""
        if isinstance(raw, dict):
            title = str(raw.get("title") or raw.get("module_title") or "").strip()
            rationale = str(raw.get("rationale") or "").strip()
        elif isinstance(raw, str):
            title = raw.strip()
        if not title:
            title = fallback_specs[min(fallback_index, len(fallback_specs) - 1)]["title"]
        title = re.sub(r"[^a-z0-9_]+", "_", title.lower()).strip("_") or f"meta_component_{len(normalized) + 1:03d}"
        if not rationale:
            rationale = fallback_specs[min(fallback_index, len(fallback_specs) - 1)]["rationale"]
        normalized.append({"title": title, "rationale": rationale})
        fallback_index += 1
    if not normalized:
        normalized.append(default_single_module_spec())
    return normalized

def build_initial_partition(module_specs) -> dict:
    normalized = normalize_module_specs(module_specs)
    if len(normalized) <= 1:
        spec = normalized[0]
        return {
            "strategy": "meta_single_unit",
            "modules": [
                {
                    "module_id": "meta_unit_001",
                    "module_title": spec["title"],
                    "rationale": spec["rationale"],
                    "child_tasks": [],
                }
            ],
        }
    modules = []
    for index, spec in enumerate(normalized, start=1):
        modules.append(
            {
                "module_id": f"meta_unit_{index:03d}",
                "module_title": spec["title"],
                "rationale": spec["rationale"],
                "child_tasks": [],
            }
        )
    return {
        "strategy": "meta_module_partition",
        "modules": modules,
    }

def derive_component_candidates(initial_partition: dict) -> list:
    modules = initial_partition.get("modules") if isinstance(initial_partition, dict) else []
    if not isinstance(modules, list):
        return ["implementation_unit"]
    candidates = []
    for module in modules:
        title = ""
        if isinstance(module, dict):
            title = str(module.get("module_title") or "").strip().lower()
        if title == "protocol_surface":
            candidates.extend(["protocol_schema", "transport_adapter"])
        elif title == "api_surface":
            candidates.extend(["api_contract", "request_handler"])
        elif title == "core_logic":
            candidates.extend(["core_model", "execution_flow"])
        elif title == "adapter_layer":
            candidates.extend(["adapter_interface", "integration_adapter"])
        elif title == "test_harness":
            candidates.extend(["test_cases", "verification_runner"])
        elif title == "docs_rollout":
            candidates.extend(["runbook_patch", "docs_notes"])
        elif title:
            candidates.append(f"{title}_implementation")
    ordered = []
    seen = set()
    for candidate in candidates or ["implementation_unit"]:
        if candidate and candidate not in seen:
            ordered.append(candidate)
            seen.add(candidate)
    return ordered[:8]

def base_result(proposed_modules, source: str, reason: str, llm_decision_used: bool) -> dict:
    normalized_modules = normalize_module_specs(proposed_modules)
    guardrail_cfg = policy["granularity_guardrails"]
    guardrail_notes = []
    guardrail_triggered = False
    if len(normalized_modules) < guardrail_cfg["meta_units"]["min"]:
        guardrail_triggered = True
        guardrail_notes.append("below meaningful fragment floor")
        while len(normalized_modules) < guardrail_cfg["meta_units"]["min"]:
            normalized_modules.append(default_single_module_spec())
    if len(normalized_modules) > guardrail_cfg["meta_units"]["max"]:
        guardrail_triggered = True
        guardrail_notes.append("above meta unit ceiling")
        normalized_modules = normalized_modules[: guardrail_cfg["meta_units"]["max"]]
    initial_partition = build_initial_partition(normalized_modules)
    meta_units = len(initial_partition["modules"])
    meta_strategy = initial_partition["strategy"]
    refinement_scope = "multi_meta_input" if meta_units > 1 else "single_meta_input"
    component_candidates = derive_component_candidates(initial_partition)
    decoupling_confidence = "high" if meta_units > 1 and signals else "medium" if meta_units > 1 else "low"
    decoupling_rationale = []
    for module in initial_partition["modules"]:
        rationale = str(module.get("rationale") or "").strip()
        if rationale:
            decoupling_rationale.append(rationale)
    if not decoupling_rationale:
        decoupling_rationale.append("no strong functional boundary detected")
    return {
        "decision_source": source,
        "decision_reason": reason,
        "decision_signals": {
            "estimated_minutes": estimated_minutes,
            "artifact_count_hint": artifact_count_hint,
            "complexity_keywords": signals,
            "budget_seconds": budget_seconds,
        },
        "planner_phase": "initial_plan",
        "decomposition_strategy": "module_first" if meta_units > 1 else "single_path",
        "release_policy": "immediate_first_wave",
        "request_authority": "task_local_strategy_meta",
        "llm_role": "primary",
        "llm_decision_used": llm_decision_used,
        "token_priority_context": token_priority_context,
        "mcp_soft_boundary_signals": mcp_soft_boundary_signals,
        "meta_decomposition": {
            "decision_source": source,
            "decomposition_strategy": meta_strategy,
            "meta_unit_count": meta_units,
            "primary_principle": "functional_decoupling",
            "decoupling_confidence": decoupling_confidence,
            "decoupling_rationale": decoupling_rationale,
        },
        "worker_refinement": {
            "required": True,
            "refinement_strategy": "linear_split_units_placeholder",
            "refinement_scope": refinement_scope,
            "primary_principle": "engineering_decoupling",
            "component_candidates": component_candidates,
            "refinement_rationale": [
                "component candidates reflect engineering decoupling placeholders while leaf refinement keeps the current component-sized placeholder granularity"
            ],
        },
        "granularity_guardrails": {
            "mode": "soft",
            "fragment_upper_bound": {
                "max_meta_units": guardrail_cfg["meta_units"]["max"],
                "max_leaf_units_per_meta": guardrail_cfg["leaf_units_per_meta"]["max"],
            },
            "fragment_lower_bound": {
                "min_meaningful_meta_units": guardrail_cfg["meta_units"]["min"],
                "min_meaningful_leaf_scope": "component_sized",
            },
            "guardrail_triggered": guardrail_triggered,
            "guardrail_notes": guardrail_notes,
        },
        "initial_partition": initial_partition,
        "agent_contract_version": "planner-core-v2",
    }

def emit_result(result: dict):
    decision_envelope = {
        "schema_version": "planner-decision-v1",
        "decision_id": f"planner_decision_{task_id or 'unknown'}",
        "request_id": request_id,
        "task_id": task_id,
        "planner_decision": result,
        "initial_partition": result.get("initial_partition", build_initial_partition([default_single_module_spec()])),
        "split_plan_summary": {
            "planner_phase": result.get("planner_phase", "initial_plan"),
            "decomposition_strategy": result.get("decomposition_strategy", "(none)"),
            "release_policy": result.get("release_policy", "immediate_first_wave"),
        },
        "apply_contract": {
            "initial_partition": result.get("initial_partition", build_initial_partition([default_single_module_spec()])),
            "worker_refinement": {
                "required": True,
                "refinement_strategy": "linear_split_units_placeholder",
                "refinement_scope": result.get("worker_refinement", {}).get("refinement_scope", "single_meta_input"),
                "component_candidates": result.get("worker_refinement", {}).get("component_candidates", ["implementation_unit"]),
            },
            "decomposition_strategy": result.get("decomposition_strategy", "(none)"),
            "release_policy": result.get("release_policy", "immediate_first_wave"),
        },
        "execution_target": execution_target,
        "compat": {
            "agent_contract_version": result.get("agent_contract_version"),
        },
    }
    print(
        json.dumps(
            {
                "planner_request": planner_request,
                "planner_decision_envelope": decision_envelope,
                "planner_decision": result,
            },
            ensure_ascii=True,
        )
    )
    raise SystemExit

def rules_result(reason_prefix: str, llm_decision_used: bool = False):
    proposed_modules = infer_functional_module_specs()
    if strong_multi:
        if not proposed_modules:
            proposed_modules = [
                {"title": "core_logic", "rationale": "primary implementation logic"},
                {"title": "verification_docs", "rationale": "verification and supporting delivery"},
            ]
        while len(proposed_modules) < 2:
            proposed_modules.append(
                {"title": "verification_docs", "rationale": "verification and supporting delivery"}
            )
        proposed_modules = proposed_modules[:2]
    else:
        proposed_modules = [default_single_module_spec()]
    return base_result(
        proposed_modules,
        "planner_rules_fallback",
        f"{reason_prefix}: {'strong multi signals' if strong_multi else 'single-task default'}",
        llm_decision_used,
    )

if child_task:
    result = base_result(
        [{"title": "root_meta_unit", "rationale": "child task scope stays within a single functional boundary"}],
        "planner_rules_fallback",
        "child task forced single: single-task default",
        False,
    )
    result["decomposition_strategy"] = "single_path"
    result["meta_decomposition"] = {
        "decision_source": result["decision_source"],
        "decomposition_strategy": "meta_single_unit",
        "meta_unit_count": 1,
        "primary_principle": "functional_decoupling",
        "decoupling_confidence": "low",
        "decoupling_rationale": [
            "child task scope stays within a single functional boundary",
        ],
    }
    emit_result(result)

llm = (agent_runtime_effective.get("llm") or {}) if isinstance(agent_runtime_effective, dict) else {}
llm_enabled = bool(llm.get("enabled"))
api_key = str(llm.get("api_key") or "").strip()
api_key_env = str(llm.get("api_key_env") or "OPENAI_API_KEY").strip()
if not api_key and api_key_env:
    api_key = str(os.getenv(api_key_env, "")).strip()

if policy["llm_role"] == "primary" and llm_enabled and api_key:
    try:
        system_prompt = str(llm.get("system_prompt") or "").strip() or (
            "Return JSON only: {\"modules\":[{\"title\":\"...\",\"rationale\":\"...\"}],\"reason\":\"...\"}"
        )
        llm_runtime_max_tokens = max(1, int(llm.get("max_tokens") or 500))
        request_max_tokens = max(1, min(effective_tokens, llm_runtime_max_tokens))
        payload = {
            "model": str(llm.get("model") or "gpt-4.1-mini"),
            "temperature": float(llm.get("temperature") or 0.1),
            "max_tokens": request_max_tokens,
            "messages": [
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": "\n".join(
                        [
                            "Propose the initial meta decomposition result as strict JSON only.",
                            f"Goal: {task_goal}",
                            f"Constraints: {summary_constraints or '(none)'}",
                            f"Deliverables: {summary_deliverables or '(none)'}",
                            f"Notes: {summary_notes or '(none)'}",
                            f"Budget seconds: {budget_seconds}",
                            f"Estimated minutes: {estimated_minutes}",
                            f"Artifact count hint: {artifact_count_hint}",
                            f"Signals: {', '.join(signals) if signals else '(none)'}",
                            f"Planner token tier: {token_priority_context['tier']}",
                            f"Planner effective tokens: {token_priority_context['effective_planning_tokens']}",
                            f"MCP bias mode: {mcp_soft_boundary_signals['mode']}",
                            f"MCP isolation enabled: {mcp_soft_boundary_signals['isolation_enabled']}",
                            f"Orchestrator profile: {mcp_soft_boundary_signals['orchestrator_profile_name'] or '(none)'}",
                            f"Project profile: {mcp_soft_boundary_signals['project_profile_name'] or '(none)'}",
                            f"Orchestrator MCP root: {mcp_soft_boundary_signals['orchestrator_mcp_dir'] or '(none)'}",
                            f"Project MCP root: {mcp_soft_boundary_signals['project_mcp_dir'] or '(none)'}",
                            f"Orchestrator namespace read only: {mcp_soft_boundary_signals['orchestrator_namespace_read_only']}",
                            f"Project namespace read only: {mcp_soft_boundary_signals['project_namespace_read_only']}",
                            "Bias decomposition and release choices toward compliant actions under these boundaries.",
                            "Primary principle: identify functional decoupling boundaries first.",
                            "Rules are soft granularity guardrails, not the primary planner.",
                            'Return {"modules":[{"title":"...","rationale":"..."}],"reason":"..."} only. If no meaningful boundary exists, return a single module.',
                        ]
                    ),
                },
            ],
        }
        req = urllib.request.Request(
            str(llm.get("api_base_url") or "https://api.openai.com/v1").rstrip("/") + "/chat/completions",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
            method="POST",
        )
        timeout = max(1, int(llm.get("timeout_ms") or 20000) / 1000)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = json.loads(resp.read().decode("utf-8"))
        content = (((body.get("choices") or [{}])[0].get("message") or {}).get("content") or "").strip()
        parsed = json.loads(content) if content.startswith("{") else {}
        modules = parsed.get("modules") if isinstance(parsed.get("modules"), list) else []
        llm_meta_units = len(modules)
        llm_reason = str(parsed.get("reason") or "llm mode decision").strip()
        if llm_meta_units <= 0:
            llm_meta_units = int(parsed.get("meta_unit_count") or 0)
        if llm_meta_units <= 0:
            raise ValueError("invalid llm decomposition proposal")
        if llm_meta_units == 1 and strong_multi:
            guardrail_modules = infer_functional_module_specs()[:2]
            if len(guardrail_modules) < 2:
                guardrail_modules = [
                    {"title": "core_logic", "rationale": "primary implementation logic"},
                    {"title": "verification_docs", "rationale": "verification and supporting delivery"},
                ]
            result = base_result(
                guardrail_modules,
                "planner_rules_fallback",
                "soft boundary escalated by hard guardrail (LLM overridden): strong multi signals",
                True,
            )
            result["decomposition_strategy"] = "module_first"
            result["meta_decomposition"] = {
                "decision_source": result["decision_source"],
                "decomposition_strategy": "meta_module_partition",
                "meta_unit_count": 2,
                "primary_principle": "functional_decoupling",
                "decoupling_confidence": "medium",
                "decoupling_rationale": [
                    "functional boundaries remained coarse under agent proposal",
                    "soft guardrails expanded the initial partition because the task is materially broad",
                ],
            }
            result["granularity_guardrails"]["guardrail_triggered"] = True
            result["granularity_guardrails"]["guardrail_notes"] = [
                "soft guardrails expanded the initial partition to avoid an over-large fragment"
            ]
            emit_result(result)
        result = base_result(
            modules,
            "planner_llm",
            llm_reason,
            True,
        )
        emit_result(result)
    except Exception as exc:
        result = rules_result(f"llm fallback ({exc.__class__.__name__})")
        emit_result(result)

result = rules_result("llm unavailable")
emit_result(result)
PY
)"

REQUEST_ENVELOPE_JSON="$(jq -c '.planner_request' <<<"$PLANNER_OUTPUT_JSON")"
DECISION_ENVELOPE_JSON="$(jq -c '.planner_decision_envelope' <<<"$PLANNER_OUTPUT_JSON")"
DECISION_JSON="$(jq -c '.planner_decision' <<<"$PLANNER_OUTPUT_JSON")"

printf '%s\n' "$REQUEST_ENVELOPE_JSON" > "$TASK_DIR/planner_request.json"
printf '%s\n' "$DECISION_ENVELOPE_JSON" > "$TASK_DIR/planner_decision.json"

decision_source="$(jq -r '.decision_source' <<<"$DECISION_JSON")"
decision_reason="$(jq -r '.decision_reason' <<<"$DECISION_JSON")"

tmp_meta="$(mktemp "$TASK_DIR/.meta.planner_entry.XXXXXX.json")"
jq \
  --argjson planning_decision "$DECISION_JSON" \
  --arg planning_actor "planner-core" \
  --arg scheduling_actor "scheduler-ops" \
  --arg now "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
  '
  .planning_decision = $planning_decision
  | .updated_at = $now
  | .execution_roles = ((.execution_roles // {}) + {
      planning_actor: $planning_actor,
      scheduling_actor: $scheduling_actor,
      compat_mode: ((.execution_roles.compat_mode // false) | .),
      compat_hits: ((.execution_roles.compat_hits // 0) | .)
    })
  ' "$META" > "$tmp_meta" && mv "$tmp_meta" "$META"

op_base="op_planner_entry_${TASK_ID}_$(date -u +%Y%m%d%H%M%S)_$$"
"$APPEND_SCRIPT" "$TASK_DIR" "planner-core" "${op_base}_decide" "PLANNER_MODE_DECIDED" "$decision_source:$decision_reason" "CREATED" "CREATED" >/dev/null

"$PLANNER_APPLY_SCRIPT" "$TASK_DIR" "$DECISION_ENVELOPE_JSON" "$worker_id" "$op_base" >/dev/null

if [[ "$decision_source" == "planner_rules_fallback" ]]; then
  "$APPEND_SCRIPT" "$TASK_DIR" "planner-core" "${op_base}_fallback" "PLANNER_MODE_FALLBACK_USED" "$decision_reason" "CREATED" "CREATED" >/dev/null
fi

jq -cn \
  --arg task_id "$TASK_ID" \
  --arg decision_source "$decision_source" \
  --arg decision_reason "$decision_reason" \
  '{task_id:$task_id,decision_source:$decision_source,decision_reason:$decision_reason}'
