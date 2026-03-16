#!/usr/bin/env bash
set -euo pipefail

TASK_DIR="$1"
RUNTIME_VIEW="$2"
DELIVERY_DIR="$(jq -r '.worker_stage.delivery_root // empty' "$RUNTIME_VIEW" 2>/dev/null || true)"
[[ -n "$DELIVERY_DIR" ]] || DELIVERY_DIR="${ORCH_WORKER_STAGE_DELIVERY_ROOT:-$TASK_DIR/delivery}"
mkdir -p "$DELIVERY_DIR"

WS_MAIN="$DELIVERY_DIR/websocket_calculator.py"
WS_TEST="$DELIVERY_DIR/test_websocket_calculator.py"
RUNBOOK_MD="$DELIVERY_DIR/RUNBOOK.md"
TEST_MODE="$(jq -r '.implementation_topology.custom_overlay_layer.config.default_test_mode // ""' "$RUNTIME_VIEW" 2>/dev/null || true)"
DELIVERY_EXPECTATIONS="$(jq -r '(.implementation_topology.custom_overlay_layer.config.delivery_expectations // []) | join(", ")' "$RUNTIME_VIEW" 2>/dev/null || true)"
[[ -n "$TEST_MODE" ]] || TEST_MODE="python_unittest"

cat > "$WS_MAIN" <<'PY'
"""Async WebSocket calculator core with safe expression evaluation."""

from __future__ import annotations

import ast
import json
from typing import Any


_ALLOWED_BINOPS = {
    ast.Add: lambda a, b: a + b,
    ast.Sub: lambda a, b: a - b,
    ast.Mult: lambda a, b: a * b,
    ast.Div: lambda a, b: a / b,
    ast.Mod: lambda a, b: a % b,
    ast.Pow: lambda a, b: a ** b,
}
_ALLOWED_UNARY = {
    ast.UAdd: lambda a: +a,
    ast.USub: lambda a: -a,
}


def _eval(node: ast.AST) -> float:
    if isinstance(node, ast.Expression):
        return _eval(node.body)
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return float(node.value)
    if isinstance(node, ast.BinOp) and type(node.op) in _ALLOWED_BINOPS:
        left = _eval(node.left)
        right = _eval(node.right)
        return float(_ALLOWED_BINOPS[type(node.op)](left, right))
    if isinstance(node, ast.UnaryOp) and type(node.op) in _ALLOWED_UNARY:
        return float(_ALLOWED_UNARY[type(node.op)](_eval(node.operand)))
    raise ValueError("unsupported expression")


def evaluate_expression(expr: str) -> float:
    parsed = ast.parse(expr, mode="eval")
    return _eval(parsed)


def process_message(raw: str) -> str:
    try:
        payload: Any = json.loads(raw)
        expr = str(payload.get("expression", "")).strip()
        if not expr:
            raise ValueError("missing expression")
        result = evaluate_expression(expr)
        return json.dumps({"ok": True, "result": result})
    except Exception as exc:  # noqa: BLE001
        return json.dumps({"ok": False, "error": str(exc)})
PY

cat > "$WS_TEST" <<'PY'
import json
import unittest

from websocket_calculator import evaluate_expression, process_message


class WebSocketCalculatorTests(unittest.TestCase):
    def test_eval_expression(self):
        self.assertEqual(evaluate_expression("1+2*3"), 7.0)

    def test_process_message_ok(self):
        res = json.loads(process_message('{"expression":"(2+3)*4"}'))
        self.assertTrue(res["ok"])
        self.assertEqual(res["result"], 20.0)

    def test_process_message_error(self):
        res = json.loads(process_message('{"expression":"import os"}'))
        self.assertFalse(res["ok"])
        self.assertIn("error", res)


if __name__ == "__main__":
    unittest.main()
PY

cat > "$RUNBOOK_MD" <<MD
# WebSocket Calculator Runbook

## Run
1. \`cd delivery\`
2. Optional dependency install: \`python3 -m pip install websockets\`
3. Start server: \`python3 websocket_calculator.py\`
4. Unit tests: \`python3 -m unittest -q\`

## Template Defaults
- test_mode: ${TEST_MODE}
MD

jq -cn \
  --arg summary "implemented websocket calculator template" \
  --arg test_command "cd delivery && python3 -m unittest -q" \
  --argjson changed_files '[
    "delivery/websocket_calculator.py",
    "delivery/test_websocket_calculator.py",
    "delivery/RUNBOOK.md"
  ]' \
  --argjson delivery_manifest '[
    "delivery/websocket_calculator.py",
    "delivery/test_websocket_calculator.py",
    "delivery/RUNBOOK.md"
  ]' \
  --argjson evidence_notes "[\"test_mode=${TEST_MODE}\", \"delivery_expectations=${DELIVERY_EXPECTATIONS:-default_bundle}\"]" \
  '{schema_version:"worker-template-result-contract-v1", summary:$summary, test_command:$test_command, changed_files:$changed_files, delivery_manifest:$delivery_manifest, evidence_notes:$evidence_notes}'
