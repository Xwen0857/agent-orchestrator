#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "usage: $0 <task_dir> <query>"
  exit 2
fi

TASK_DIR="$1"
QUERY="$2"
META="$TASK_DIR/meta.json"
SEARCH_SCRIPT="agent-orchestrator/scripts/kb_ranked_search.sh"

if [[ ! -f "$META" ]]; then
  echo "meta.json missing: $META"
  exit 1
fi

matches="$("$SEARCH_SCRIPT" "$QUERY" 5 || true)"
if [[ -z "$matches" ]]; then
  echo "no kb matches"
  exit 0
fi

ids_json="$(printf "%s\n" "$matches" | cut -d'|' -f1 | jq -R . | jq -s 'map(select(length>0)) | unique')"
tmp="$(mktemp "$TASK_DIR/.meta.XXXXXX")"
jq --argjson ids "$ids_json" '.knowledge_refs = ((.knowledge_refs // []) + $ids | unique)' "$META" > "$tmp"
mv "$tmp" "$META"

echo "linked_kb_ids=$(printf "%s" "$ids_json" | jq -r 'join(",")')"
