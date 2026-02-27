#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys


def _validate(payload: dict) -> dict:
    draft = payload.get("draft", {})
    props = draft.get("plannerProperties", {})
    issues = []
    warn_ratio = props.get("budget_warn_threshold_ratio")
    block_ratio = props.get("budget_block_threshold_ratio")
    if isinstance(warn_ratio, (int, float)) and isinstance(block_ratio, (int, float)):
        if warn_ratio >= block_ratio:
            issues.append(
                {
                    "source": "plugin:sample-observability",
                    "key": "budget_warn_threshold_ratio",
                    "level": "ERROR",
                    "message": "budget_warn_threshold_ratio must be less than budget_block_threshold_ratio"
                }
            )
    return {"ok": True, "issues": issues}


def _event(payload: dict) -> dict:
    return {"ok": True, "handled": payload.get("event_type")}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--hook", required=True)
    args = parser.parse_args()
    raw = sys.stdin.read().strip()
    payload = json.loads(raw or "{}")

    if args.hook == "validate":
        out = _validate(payload)
    elif args.hook == "event":
        out = _event(payload)
    else:
        out = {"ok": True}

    print(json.dumps(out, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
