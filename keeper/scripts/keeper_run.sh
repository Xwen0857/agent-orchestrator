#!/usr/bin/env bash
set -euo pipefail

# Runs the keeper maintenance cycle for knowledge-base ingestion, score recomputation,
# split suggestions, and health reporting.
# Inputs: planner config/properties plus the knowledge-base entry and feedback files.
# Side effects: may ingest new candidates, recompute KB scores, and rewrites keeper
# report outputs in JSON and Markdown form.
# Failure model: exits early with a DISABLED report when keeper is off; otherwise exits non-zero on script or report-generation failures.

CONFIG="templates/coordination/planner/config/current.md"
PROPS="templates/coordination/planner/properties.md"
ENTRIES_DIR="knowledge-base/entries"
FEEDBACK_FILE="knowledge-base/feedback/kb_feedback.ndjson"
REPORT_MD="templates/coordination/orchestrator/keeper-report.md"
REPORT_JSON="templates/coordination/orchestrator/keeper-report.json"
RECOMPUTE_SCRIPT="agent-orchestrator/scripts/kb_recompute_scores.sh"
INGEST_SCRIPT="keeper/scripts/keeper_ingest_candidates.sh"
SPLIT_SUGGEST_SCRIPT="keeper/scripts/kb_split_suggest.py"

mkdir -p "$(dirname "$REPORT_MD")"
mkdir -p "$(dirname "$REPORT_JSON")"

keeper_enabled="$(sed -n 's/^keeper_enabled:[[:space:]]*//p' "$CONFIG" | tail -n 1 | tr -d '\r')"
if [[ "$keeper_enabled" != "true" ]]; then
  now="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  cat > "$REPORT_JSON" <<EOF
{"generated_at":"$now","keeper_enabled":false,"status":"DISABLED","summary":{"entries_total":0}}
EOF
  cat > "$REPORT_MD" <<EOF
# Keeper Report

Generated at: $now

Status: DISABLED (keeper_enabled is not true)
EOF
  echo "keeper disabled"
  exit 0
fi

# Run ingestion first so recompute and reporting see the newest candidate set.
ingest_output="$("$INGEST_SCRIPT")"
"$RECOMPUTE_SCRIPT" >/dev/null
split_suggestions="$(python3 "$SPLIT_SUGGEST_SCRIPT" "$ENTRIES_DIR" 2>/dev/null || echo '[]')"

tmp_json="$(mktemp)"
# Use Python for aggregation because the report combines filesystem scans, markdown
# parsing, and feedback trend calculations.
python3 - "$ENTRIES_DIR" "$ingest_output" "$FEEDBACK_FILE" "$split_suggestions" > "$tmp_json" <<'PY'
import json
import os
import re
import sys
from datetime import datetime, timezone, timedelta

entries_dir = sys.argv[1]
ingest_summary = sys.argv[2]
feedback_file = sys.argv[3]
split_suggestions = json.loads(sys.argv[4] or "[]")
rows = []

def read_field(text, key, default=""):
    m = re.search(rf"^{re.escape(key)}:\s*(.*)$", text, flags=re.MULTILINE)
    return m.group(1).strip() if m else default

for name in sorted(os.listdir(entries_dir)):
    if not name.endswith(".md"):
        continue
    path = os.path.join(entries_dir, name)
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    entry_id = read_field(content, "entry_id")
    title = read_field(content, "title")
    status = read_field(content, "status", "CANDIDATE")
    score = int(read_field(content, "score", "50") or "50")
    rows.append({"entry_id": entry_id, "title": title, "status": status, "score": score})

titles = {}
merge_candidates = []
for r in rows:
    key = r["title"].strip().lower()
    if key in titles:
        merge_candidates.append({"primary": titles[key], "candidate": r["entry_id"], "reason": "same_title"})
    else:
        titles[key] = r["entry_id"]

deprecated = [r["entry_id"] for r in rows if r["status"] == "DEPRECATED"]
watch = [r["entry_id"] for r in rows if r["status"] == "WATCHLIST"]
low_score = [r["entry_id"] for r in rows if r["score"] < 45]

now = datetime.now(timezone.utc)
recent_start = now - timedelta(days=7)
prev_start = now - timedelta(days=14)
recent = {"events": 0, "success": 0, "fail": 0, "override": 0}
prev = {"events": 0, "success": 0, "fail": 0, "override": 0}

if os.path.exists(feedback_file):
    with open(feedback_file, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                e = json.loads(line)
                ts = datetime.strptime(e.get("timestamp", ""), "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
            except Exception:
                continue
            bucket = None
            if ts >= recent_start:
                bucket = recent
            elif ts >= prev_start:
                bucket = prev
            if bucket is None:
                continue
            bucket["events"] += 1
            if e.get("outcome") == "SUCCESS":
                bucket["success"] += 1
            if e.get("outcome") == "FAIL":
                bucket["fail"] += 1
            if e.get("intervention_source") == "HUMAN_OVERRIDE":
                bucket["override"] += 1

def safe_rate(s, n):
    return round((s / n), 4) if n else 0.0

out = {
    "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "keeper_enabled": True,
    "status": "OK",
    "ingest_summary": ingest_summary,
    "summary": {
        "entries_total": len(rows),
        "status_counts": {
            "ACTIVE": sum(1 for r in rows if r["status"] == "ACTIVE"),
            "WATCHLIST": sum(1 for r in rows if r["status"] == "WATCHLIST"),
            "CANDIDATE": sum(1 for r in rows if r["status"] == "CANDIDATE"),
            "DEPRECATED": sum(1 for r in rows if r["status"] == "DEPRECATED"),
        },
    },
    "merge_candidates": merge_candidates,
    "watch_candidates": watch,
    "archive_candidates": deprecated,
    "low_score_candidates": low_score,
    "split_candidates": split_suggestions,
    "trend": {
        "recent_7d": {
            "events": recent["events"],
            "success_rate": safe_rate(recent["success"], recent["events"]),
            "fail_rate": safe_rate(recent["fail"], recent["events"]),
            "override_count": recent["override"],
        },
        "prev_7d": {
            "events": prev["events"],
            "success_rate": safe_rate(prev["success"], prev["events"]),
            "fail_rate": safe_rate(prev["fail"], prev["events"]),
            "override_count": prev["override"],
        },
    },
}
print(json.dumps(out, ensure_ascii=False))
PY

cat "$tmp_json" > "$REPORT_JSON"

jq -r '
  "# Keeper Report\n\n"
  + "Generated at: \(.generated_at)\n\n"
  + "Status: \(.status)\n\n"
  + "Ingest: \(.ingest_summary)\n\n"
  + "## Summary\n\n"
  + "- entries_total: \(.summary.entries_total)\n"
  + "- ACTIVE: \(.summary.status_counts.ACTIVE)\n"
  + "- WATCHLIST: \(.summary.status_counts.WATCHLIST)\n"
  + "- CANDIDATE: \(.summary.status_counts.CANDIDATE)\n"
  + "- DEPRECATED: \(.summary.status_counts.DEPRECATED)\n"
  + "\n## Merge Candidates\n\n"
  + ((.merge_candidates | map("- " + .primary + " <- " + .candidate + " (" + .reason + ")")) | join("\n"))
  + "\n\n## Watch Candidates\n\n"
  + ((.watch_candidates | map("- " + .)) | join("\n"))
  + "\n\n## Archive Candidates\n\n"
  + ((.archive_candidates | map("- " + .)) | join("\n"))
  + "\n\n## Low Score Candidates\n\n"
  + ((.low_score_candidates | map("- " + .)) | join("\n"))
  + "\n\n## Split Candidates\n\n"
  + ((.split_candidates | map("- " + .entry_id + " (" + (.reasons | join(",")) + ")")) | join("\n"))
  + "\n\n## Trend\n\n"
  + "- recent_7d events: \(.trend.recent_7d.events)\n"
  + "- recent_7d success_rate: \(.trend.recent_7d.success_rate)\n"
  + "- recent_7d fail_rate: \(.trend.recent_7d.fail_rate)\n"
  + "- recent_7d override_count: \(.trend.recent_7d.override_count)\n"
  + "- prev_7d events: \(.trend.prev_7d.events)\n"
  + "- prev_7d success_rate: \(.trend.prev_7d.success_rate)\n"
  + "- prev_7d fail_rate: \(.trend.prev_7d.fail_rate)\n"
  + "- prev_7d override_count: \(.trend.prev_7d.override_count)\n"
' "$REPORT_JSON" > "$REPORT_MD"

rm -f "$tmp_json"
echo "keeper report updated"
