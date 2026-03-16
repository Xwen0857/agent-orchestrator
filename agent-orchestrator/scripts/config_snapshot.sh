#!/usr/bin/env bash
set -euo pipefail

# Saves the current planner config as a versioned snapshot and updates the
# version pointer metadata.
# Inputs: required version id plus optional actor and reason.
# Side effects: copies current.md into history and appends to versions.ndjson.
# Failure model: exits non-zero on lock contention, invalid ids, or missing config.

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <version_id> [actor] [reason]"
  exit 2
fi

VERSION_ID="$1"
ACTOR="${2:-agent-orchestrator}"
REASON="${3:-manual snapshot}"

CONFIG_DIR="templates/coordination/planner/config"
CURRENT_CONFIG="$CONFIG_DIR/current.md"
HISTORY_DIR="$CONFIG_DIR/history"
POINTER_FILE="$CONFIG_DIR/current.pointer.json"
LOCK_FILE="$CONFIG_DIR/.config-version.lock"
AUDIT_LOG="$HISTORY_DIR/versions.ndjson"
TARGET_FILE="$HISTORY_DIR/$VERSION_ID.md"

mkdir -p "$HISTORY_DIR"

# Use a noclobber lock file so snapshot and rollback cannot mutate the pointer
# concurrently.
acquire_lock() {
  local i=0
  while ! (set -o noclobber; echo "$$" > "$LOCK_FILE") 2>/dev/null; do
    i=$((i + 1))
    if [[ "$i" -gt 50 ]]; then
      echo "failed to acquire config lock: $LOCK_FILE"
      exit 1
    fi
    sleep 0.1
  done
}

release_lock() {
  rm -f "$LOCK_FILE"
}

trap release_lock EXIT
acquire_lock

if [[ ! -f "$CURRENT_CONFIG" ]]; then
  echo "current config not found: $CURRENT_CONFIG"
  exit 1
fi

if [[ ! "$VERSION_ID" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "invalid version_id: $VERSION_ID"
  exit 1
fi

if [[ -f "$TARGET_FILE" ]]; then
  echo "version already exists: $VERSION_ID"
  exit 1
fi

# Copy the exact current config before recomputing pointer metadata so the
# archived file always matches the recorded checksum.
cp "$CURRENT_CONFIG" "$TARGET_FILE"
now="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
checksum="$(shasum -a 256 "$TARGET_FILE" | awk '{print $1}')"

if [[ -f "$POINTER_FILE" ]]; then
  previous_version_id="$(jq -r '.current_version_id // ""' "$POINTER_FILE")"
else
  previous_version_id=""
fi

# Rewrite the pointer file in one pass so readers never observe a partially
# updated metadata shape.
jq -n \
  --arg current_version_id "$VERSION_ID" \
  --arg previous_version_id "$previous_version_id" \
  --arg current_file "$CURRENT_CONFIG" \
  --arg history_dir "$HISTORY_DIR" \
  --arg updated_at "$now" \
  --arg updated_by "$ACTOR" \
  '{
    current_version_id: $current_version_id,
    previous_version_id: $previous_version_id,
    current_file: $current_file,
    history_dir: $history_dir,
    updated_at: $updated_at,
    updated_by: $updated_by
  }' > "$POINTER_FILE"

# Append-only audit history preserves snapshot lineage without rewriting
# existing events.
jq -cn \
  --arg timestamp "$now" \
  --arg action "SNAPSHOT" \
  --arg version_id "$VERSION_ID" \
  --arg previous_version_id "$previous_version_id" \
  --arg actor "$ACTOR" \
  --arg reason "$REASON" \
  --arg file "$TARGET_FILE" \
  --arg checksum_sha256 "$checksum" \
  '{
    timestamp: $timestamp,
    action: $action,
    version_id: $version_id,
    previous_version_id: $previous_version_id,
    actor: $actor,
    reason: $reason,
    file: $file,
    checksum_sha256: $checksum_sha256
  }' >> "$AUDIT_LOG"

echo "config snapshot created: version=$VERSION_ID file=$TARGET_FILE"
