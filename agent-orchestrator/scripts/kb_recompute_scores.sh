#!/usr/bin/env bash
set -euo pipefail

ENTRIES_DIR="knowledge-base/entries"
FEEDBACK_FILE="knowledge-base/feedback/kb_feedback.ndjson"

python3 - "$ENTRIES_DIR" "$FEEDBACK_FILE" <<'PY'
import json
import os
import re
import sys
from datetime import datetime, timezone

entries_dir = sys.argv[1]
feedback_file = sys.argv[2]

feedback = []
if os.path.exists(feedback_file):
    with open(feedback_file, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                feedback.append(json.loads(line))
            except json.JSONDecodeError:
                pass

def parse_iso(dt):
    return datetime.strptime(dt, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)

def extract_field(content, key):
    m = re.search(rf"^{re.escape(key)}:\s*(.*)$", content, flags=re.MULTILINE)
    return m.group(1).strip() if m else ""

def upsert_field(content, key, value):
    pattern = re.compile(rf"^{re.escape(key)}:\s*.*$", flags=re.MULTILINE)
    line = f"{key}: {value}"
    if pattern.search(content):
        return pattern.sub(line, content, count=1)
    # Insert after applicability_scope if present, otherwise near header block.
    anchor = re.search(r"^applicability_scope:\s*.*$", content, flags=re.MULTILINE)
    if anchor:
        idx = anchor.end()
        return content[:idx] + "\n" + line + content[idx:]
    # Fallback: after first line
    parts = content.splitlines()
    if len(parts) >= 1:
        parts.insert(1, line)
    else:
        parts = [line]
    return "\n".join(parts) + ("\n" if not content.endswith("\n") else "")

now = datetime.now(timezone.utc)

for name in sorted(os.listdir(entries_dir)):
    if not name.endswith(".md"):
        continue
    path = os.path.join(entries_dir, name)
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    entry_id = extract_field(content, "entry_id")
    if not entry_id:
        continue
    last_verified = extract_field(content, "last_verified_at")
    verified_days = 9999
    if last_verified:
        try:
            verified_days = max(0, (now - parse_iso(last_verified)).days)
        except Exception:
            verified_days = 9999

    rows = [r for r in feedback if r.get("entry_id") == entry_id]
    reuse_rows = [r for r in rows if r.get("reused") is True]
    reuse_count = len(reuse_rows)
    success_count = sum(1 for r in reuse_rows if r.get("outcome") == "SUCCESS")
    self_heal_count = sum(1 for r in rows if r.get("intervention_source") == "SELF_HEAL")
    human_override_count = sum(1 for r in rows if r.get("intervention_source") == "HUMAN_OVERRIDE")

    auditor_signal = 0
    for r in rows:
        g = r.get("auditor_grade", "NONE")
        if g == "A":
            auditor_signal += 3
        elif g == "C":
            auditor_signal -= 3

    reuse_contrib = min(20, reuse_count * 2)
    success_contrib = int(20 * success_count / max(1, reuse_count))
    self_heal_contrib = min(10, self_heal_count)
    override_penalty = min(20, human_override_count * 3)
    if verified_days <= 7:
        recency_contrib = 5
    elif verified_days <= 30:
        recency_contrib = 2
    elif verified_days > 90:
        recency_contrib = -5
    else:
        recency_contrib = 0

    score = 50 + reuse_contrib + success_contrib + self_heal_contrib + recency_contrib - override_penalty + auditor_signal
    score = max(0, min(100, score))

    if reuse_count == 0:
        status = "CANDIDATE"
    elif score >= 75:
        status = "ACTIVE"
    elif score >= 45:
        status = "WATCHLIST"
    else:
        status = "DEPRECATED"

    content = upsert_field(content, "score", str(score))
    content = upsert_field(content, "status", status)
    content = upsert_field(content, "reuse_count", str(reuse_count))
    content = upsert_field(content, "success_count", str(success_count))
    content = upsert_field(content, "human_override_count", str(human_override_count))
    content = upsert_field(content, "auditor_signal", str(auditor_signal))
    content = upsert_field(content, "last_scored_at", now.strftime("%Y-%m-%dT%H:%M:%SZ"))

    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

print("kb scores recomputed")
PY
