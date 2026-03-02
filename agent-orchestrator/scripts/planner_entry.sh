#!/usr/bin/env bash
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
TASK_DIR=""
REQUESTED_MODE=""
APPEND_SCRIPT="$ROOT/agent-orchestrator/scripts/append_task_event.sh"
PLANNER_SINGLE_SCRIPT="$ROOT/agent-orchestrator/scripts/planner_prepare_single_worker.sh"
PLANNER_MULTI_SCRIPT="$ROOT/agent-orchestrator/scripts/planner_prepare_workers.sh"
RUNTIME_CONFIG="$ROOT/templates/coordination/orchestrator/agent_runtime.json"

usage() {
  echo "usage: $0 --task-dir <task_dir> [--requested-mode auto|single|multi]"
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --task-dir)
      [[ $# -ge 2 ]] || usage
      TASK_DIR="$2"
      shift 2
      ;;
    --requested-mode)
      [[ $# -ge 2 ]] || usage
      REQUESTED_MODE="$2"
      shift 2
      ;;
    *)
      usage
      ;;
  esac
done

[[ -n "$TASK_DIR" ]] || usage
case "${REQUESTED_MODE:-auto}" in
  auto|single|multi) ;;
  *) usage ;;
esac

if [[ ! -x "$PLANNER_SINGLE_SCRIPT" || ! -x "$PLANNER_MULTI_SCRIPT" || ! -x "$APPEND_SCRIPT" ]]; then
  echo "planner dependencies missing"
  exit 1
fi

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

worker_id="$(printf '%s' "${TASK_ID#task_}" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '_' | sed -E 's/^_+|_+$//g' | cut -c1-48)"
worker_id="worker_${worker_id:-generic}"

DECISION_JSON="$(
  python3 - "$STRATEGY" "$META" "$RUNTIME_CONFIG" "${REQUESTED_MODE:-auto}" <<'PY'
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

strategy_path = Path(sys.argv[1])
meta_path = Path(sys.argv[2])
runtime_path = Path(sys.argv[3])
requested_mode_arg = sys.argv[4]

strategy = json.loads(strategy_path.read_text(encoding="utf-8"))
meta = json.loads(meta_path.read_text(encoding="utf-8"))
runtime = {}
if runtime_path.exists():
    runtime = json.loads(runtime_path.read_text(encoding="utf-8"))

summary_input = strategy.get("summary_input") or {}
task_goal = str(summary_input.get("task_goal") or strategy.get("goal", "") or "")
constraints = [
    str(v).strip()
    for v in (summary_input.get("constraints") or [])
    if isinstance(v, str) and str(v).strip()
]
deliverables = [
    str(v).strip()
    for v in (summary_input.get("deliverables") or [])
    if isinstance(v, str) and str(v).strip()
]
notes = [
    str(v).strip()
    for v in (summary_input.get("notes") or [])
    if isinstance(v, str) and str(v).strip()
]
analysis_parts = [task_goal]
if constraints:
    analysis_parts.append("Constraints: " + "; ".join(constraints))
if deliverables:
    analysis_parts.append("Deliverables: " + "; ".join(deliverables))
if notes:
    analysis_parts.append("Notes: " + "; ".join(notes))
goal = "\n".join(part for part in analysis_parts if part.strip())
budget = strategy.get("budget", {}) or {}
budget_seconds = int(budget.get("max_execution_time_seconds", 3600) or 3600)
child_task = bool(meta.get("parent_task_id"))

requested_mode = requested_mode_arg or (
    (strategy.get("execution") or {}).get("requested_mode") or "auto"
)
if requested_mode not in {"auto", "single", "multi"}:
    requested_mode = "auto"

def estimate_minutes(text: str, seconds: int) -> int:
    match = re.search(r"([0-9]{1,4})\s*分钟", text)
    if match:
        return max(1, int(match.group(1)))
    match = re.search(r"([0-9]{1,3})\s*(小时|h|hour|hours)", text, re.IGNORECASE)
    if match:
        return max(1, int(match.group(1)) * 60)
    return max(1, (seconds + 59) // 60)

keyword_map = {
    "split": ["拆分", "split"],
    "parallel": ["并行", "parallel"],
    "multi_module": ["多个模块", "模块", "protocol", "core", "test", "doc", "协议层", "核心", "测试", "文档"],
    "platform": ["平台", "platform"],
}

signals = []
goal_lower = goal.lower()
for label, patterns in keyword_map.items():
    if any(p.lower() in goal_lower for p in patterns):
        signals.append(label)

artifact_count_hint = 1
if "test" in goal_lower or "测试" in goal:
    artifact_count_hint += 1
if "doc" in goal_lower or "runbook" in goal_lower or "文档" in goal:
    artifact_count_hint += 1

estimated_minutes = estimate_minutes(goal, budget_seconds)
strong_multi = (
    estimated_minutes >= 180
    or budget_seconds >= 10800
    or artifact_count_hint >= 3
    or bool(signals)
)

def rules_result(reason_prefix: str):
    mode = "multi" if strong_multi else "single"
    return {
        "requested_mode": requested_mode,
        "resolved_mode": mode,
        "decision_source": "planner_rules_fallback",
        "decision_reason": f"{reason_prefix}: {'strong multi signals' if strong_multi else 'single-task default'}",
        "decision_signals": {
            "estimated_minutes": estimated_minutes,
            "artifact_count_hint": artifact_count_hint,
            "complexity_keywords": signals,
            "budget_seconds": budget_seconds,
        },
    }

if child_task:
    result = rules_result("child task forced single")
    result["requested_mode"] = "single"
    result["resolved_mode"] = "single"
    print(json.dumps(result, ensure_ascii=True))
    raise SystemExit

if requested_mode == "single":
    result = rules_result("manual override single")
    result["decision_source"] = "manual_override"
    result["resolved_mode"] = "single"
    print(json.dumps(result, ensure_ascii=True))
    raise SystemExit

if requested_mode == "multi":
    result = rules_result("manual override multi")
    result["decision_source"] = "manual_override"
    result["resolved_mode"] = "multi"
    print(json.dumps(result, ensure_ascii=True))
    raise SystemExit

llm = runtime.get("llm") or {}
llm_enabled = bool(llm.get("enabled"))
api_key = str(llm.get("api_key") or "").strip()
api_key_env = str(llm.get("api_key_env") or "OPENAI_API_KEY").strip()
if not api_key and api_key_env:
    api_key = str(os.getenv(api_key_env, "")).strip()

if llm_enabled and api_key:
    try:
        system_prompt = str(llm.get("system_prompt") or "").strip() or (
            "Return JSON only: {\"mode\":\"single\"|\"multi\",\"reason\":\"...\"}"
        )
        payload = {
            "model": str(llm.get("model") or "gpt-4.1-mini"),
            "temperature": float(llm.get("temperature") or 0.1),
            "max_tokens": int(llm.get("max_tokens") or 120),
            "messages": [
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": "\n".join(
                        [
                            "Decide task mode as strict JSON only.",
                            f"Goal: {task_goal}",
                            f"Constraints: {'; '.join(constraints) if constraints else '(none)'}",
                            f"Deliverables: {'; '.join(deliverables) if deliverables else '(none)'}",
                            f"Notes: {'; '.join(notes) if notes else '(none)'}",
                            f"Budget seconds: {budget_seconds}",
                            f"Estimated minutes: {estimated_minutes}",
                            f"Artifact count hint: {artifact_count_hint}",
                            f"Signals: {', '.join(signals) if signals else '(none)'}",
                            'Return {"mode":"single"|"multi","reason":"..."} only.',
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
        parsed = json.loads(content) if content.startswith("{") else {"mode": content}
        llm_mode = str(parsed.get("mode") or "").strip().lower()
        llm_reason = str(parsed.get("reason") or "llm mode decision").strip()
        if llm_mode not in {"single", "multi"}:
            raise ValueError("invalid llm mode")
        if llm_mode == "single" and strong_multi:
            result = rules_result("LLM overridden by deterministic guard")
            print(json.dumps(result, ensure_ascii=True))
            raise SystemExit
        result = {
            "requested_mode": requested_mode,
            "resolved_mode": llm_mode,
            "decision_source": "planner_llm",
            "decision_reason": llm_reason,
            "decision_signals": {
                "estimated_minutes": estimated_minutes,
                "artifact_count_hint": artifact_count_hint,
                "complexity_keywords": signals,
                "budget_seconds": budget_seconds,
            },
        }
        print(json.dumps(result, ensure_ascii=True))
        raise SystemExit
    except Exception as exc:
        result = rules_result(f"llm fallback ({exc.__class__.__name__})")
        print(json.dumps(result, ensure_ascii=True))
        raise SystemExit

result = rules_result("llm unavailable")
print(json.dumps(result, ensure_ascii=True))
PY
)"

resolved_mode="$(jq -r '.resolved_mode' <<<"$DECISION_JSON")"
decision_source="$(jq -r '.decision_source' <<<"$DECISION_JSON")"
decision_reason="$(jq -r '.decision_reason' <<<"$DECISION_JSON")"

tmp_meta="$(mktemp "$TASK_DIR/.meta.planner_entry.XXXXXX.json")"
jq \
  --arg requested_mode "$(jq -r '.requested_mode' <<<"$DECISION_JSON")" \
  --arg execution_mode "$resolved_mode" \
  --argjson planning_decision "$DECISION_JSON" \
  --arg planning_actor "planner-core" \
  --arg scheduling_actor "scheduler-ops" \
  --arg now "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
  '
  .requested_mode = $requested_mode
  | .execution_mode = $execution_mode
  | .planning_decision = $planning_decision
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

if [[ "$resolved_mode" == "multi" ]]; then
  PLANNER_FORCE_MIN_SPLIT_UNITS=2 "$PLANNER_MULTI_SCRIPT" "$TASK_DIR" "$worker_id" >/dev/null
  "$APPEND_SCRIPT" "$TASK_DIR" "planner-core" "${op_base}_multi" "PLANNER_MULTI_PREPARED" "multi task prepared" "CREATED" "CREATED" >/dev/null
else
  "$PLANNER_SINGLE_SCRIPT" "$TASK_DIR" "$worker_id" >/dev/null
  "$APPEND_SCRIPT" "$TASK_DIR" "planner-core" "${op_base}_single" "PLANNER_SINGLE_PREPARED" "single task prepared" "CREATED" "CREATED" >/dev/null
fi

if [[ "$decision_source" == "planner_rules_fallback" ]]; then
  "$APPEND_SCRIPT" "$TASK_DIR" "planner-core" "${op_base}_fallback" "PLANNER_MODE_FALLBACK_USED" "$decision_reason" "CREATED" "CREATED" >/dev/null
fi

jq -cn \
  --arg task_id "$TASK_ID" \
  --arg requested_mode "$(jq -r '.requested_mode' <<<"$DECISION_JSON")" \
  --arg resolved_mode "$resolved_mode" \
  --arg decision_source "$decision_source" \
  --arg decision_reason "$decision_reason" \
  '{task_id:$task_id,requested_mode:$requested_mode,resolved_mode:$resolved_mode,decision_source:$decision_source,decision_reason:$decision_reason}'
