#!/usr/bin/env bash
set -euo pipefail

# Submits a pending knowledge-base candidate into the keeper inbox.
# Inputs: source task/actor plus candidate content fields.
# Side effects: writes a JSON candidate under knowledge-base/inbox/pending.
# Failure model: exits non-zero on invalid usage or file write failure.

if [[ $# -lt 7 ]]; then
  echo "usage: $0 <source_task_id> <source_actor> <title> <tags_csv> <problem> <fix_pattern> <applicability_scope>"
  exit 2
fi

SOURCE_TASK_ID="$1"
SOURCE_ACTOR="$2"
TITLE="$3"
TAGS="$4"
PROBLEM="$5"
FIX_PATTERN="$6"
SCOPE="$7"

NOW="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
TS="$(date -u +%Y%m%d-%H%M%S)"
SLUG="$(printf "%s" "$TITLE" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/^-//;s/-$//')"
CANDIDATE_ID="cand_${TS}_$$"
FILE="knowledge-base/inbox/pending/${TS}-${SLUG}.json"

# Candidates stay in JSON so keeper tooling can review and normalize them before
# creating a canonical markdown entry.
jq -cn \
  --arg candidate_id "$CANDIDATE_ID" \
  --arg created_at "$NOW" \
  --arg source_task_id "$SOURCE_TASK_ID" \
  --arg source_actor "$SOURCE_ACTOR" \
  --arg title "$TITLE" \
  --arg tags "$TAGS" \
  --arg problem "$PROBLEM" \
  --arg fix_pattern "$FIX_PATTERN" \
  --arg applicability_scope "$SCOPE" \
  '{
    candidate_id: $candidate_id,
    created_at: $created_at,
    source_task_id: $source_task_id,
    source_actor: $source_actor,
    title: $title,
    tags: $tags,
    problem: $problem,
    fix_pattern: $fix_pattern,
    applicability_scope: $applicability_scope,
    status: "PENDING"
  }' > "$FILE"

echo "$CANDIDATE_ID|$FILE"
