#!/usr/bin/env bash
set -euo pipefail

# Ingests pending keeper candidates into the knowledge base, rejecting incomplete
# candidates and merging near-duplicates when similarity thresholds are met.
# Inputs: keeper inbox directories, planner property thresholds, and KB add/dedupe helpers.
# Side effects: moves candidate JSON files between pending/processed/rejected folders
# and may append merge notes into existing KB entry markdown.
# Failure model: exits non-zero on shell-level failures; individual candidates are accepted, merged, or rejected.

PENDING_DIR="knowledge-base/inbox/pending"
PROCESSED_DIR="knowledge-base/inbox/processed"
REJECTED_DIR="knowledge-base/inbox/rejected"
ADD_SCRIPT="agent-orchestrator/scripts/kb_add_entry.sh"
SEMANTIC_DEDUPE_SCRIPT="keeper/scripts/kb_semantic_dedupe.py"
PROPS="templates/coordination/planner/properties.md"

mkdir -p "$PENDING_DIR" "$PROCESSED_DIR" "$REJECTED_DIR"
threshold="$(sed -n 's/^- keeper_merge_similarity_threshold:[[:space:]]*//p' "$PROPS" | tail -n 1 | tr -d '\r')"
if [[ -z "$threshold" ]]; then
  threshold="0.85"
fi
title_merge_threshold="$(sed -n 's/^- keeper_title_match_merge_threshold:[[:space:]]*//p' "$PROPS" | tail -n 1 | tr -d '\r')"
if [[ -z "$title_merge_threshold" ]]; then
  title_merge_threshold="0.65"
fi

processed=0
rejected=0
merged=0

for file in "$PENDING_DIR"/*.json; do
  [[ -e "$file" ]] || break

  title="$(jq -r '.title' "$file")"
  tags="$(jq -r '.tags' "$file")"
  problem="$(jq -r '.problem' "$file")"
  fix="$(jq -r '.fix_pattern' "$file")"
  scope="$(jq -r '.applicability_scope' "$file")"
  candidate_id="$(jq -r '.candidate_id' "$file")"

  # Semantic dedupe rule: merge when top similarity crosses threshold.
  dedupe_json="$(python3 "$SEMANTIC_DEDUPE_SCRIPT" --title "$title" --problem "$problem" --fix "$fix" --top-k 1 2>/dev/null || echo '[]')"
  top_similarity="$(printf "%s" "$dedupe_json" | jq -r '.[0].similarity // 0')"
  existing_entry_id="$(printf "%s" "$dedupe_json" | jq -r '.[0].entry_id // ""')"
  existing_path="$(printf "%s" "$dedupe_json" | jq -r '.[0].path // ""')"
  existing_title="$(printf "%s" "$dedupe_json" | jq -r '.[0].title // ""')"
  title_lc="$(printf "%s" "$title" | tr '[:upper:]' '[:lower:]')"
  existing_title_lc="$(printf "%s" "$existing_title" | tr '[:upper:]' '[:lower:]')"
  should_merge=false
  if awk "BEGIN {exit !($top_similarity >= $threshold)}"; then
    should_merge=true
  elif [[ -n "$existing_title" && "$existing_title_lc" == "$title_lc" ]] && awk "BEGIN {exit !($top_similarity >= $title_merge_threshold)}"; then
    should_merge=true
  fi
  if [[ "$should_merge" == "true" ]]; then
    if [[ -n "$existing_entry_id" && -n "$existing_path" ]]; then
      # Keep the merged candidate as an audit trail inside the surviving entry instead
      # of creating a second near-duplicate KB file.
      {
        echo ""
        echo "## Merged Candidate"
        echo "- candidate_id: $candidate_id"
        echo "- merged_at: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
        echo "- source: $file"
        echo "- similarity: $top_similarity"
        echo "- problem: $problem"
        echo "- fix_pattern: $fix"
      } >> "$existing_path"
      jq --arg merged_into "$existing_entry_id" --argjson similarity "$top_similarity" '.status="MERGED" | .merged_into=$merged_into | .merge_similarity=$similarity' "$file" > "$PROCESSED_DIR/$(basename "$file")"
      rm -f "$file"
      merged=$((merged + 1))
      continue
    fi
  fi

  # Missing core fields are rejected before attempting KB creation to keep
  # `kb_add_entry.sh` focused on valid candidate material.
  if [[ -z "$problem" || -z "$fix" ]]; then
    jq '.status="REJECTED" | .reject_reason="missing_problem_or_fix"' "$file" > "$REJECTED_DIR/$(basename "$file")"
    rm -f "$file"
    rejected=$((rejected + 1))
    continue
  fi

  if KEEPER_MODE=true "$ADD_SCRIPT" "$title" "$tags" "$problem" "$fix" "$scope" >/dev/null; then
    jq '.status="INGESTED"' "$file" > "$PROCESSED_DIR/$(basename "$file")"
    rm -f "$file"
    processed=$((processed + 1))
  else
    jq '.status="REJECTED" | .reject_reason="ingest_failed"' "$file" > "$REJECTED_DIR/$(basename "$file")"
    rm -f "$file"
    rejected=$((rejected + 1))
  fi
done

echo "keeper ingestion done: processed=$processed merged=$merged rejected=$rejected"
