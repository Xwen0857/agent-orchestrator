#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <target_version_id> [actor] [reason]"
  exit 2
fi

TARGET_VERSION_ID="$1"
ACTOR="${2:-agent-orchestrator}"
REASON="${3:-manual rollback}"

CONFIG_DIR="templates/coordination/planner/config"
CURRENT_CONFIG="$CONFIG_DIR/current.md"
HISTORY_DIR="$CONFIG_DIR/history"
POINTER_FILE="$CONFIG_DIR/current.pointer.json"
LOCK_FILE="$CONFIG_DIR/.config-version.lock"
AUDIT_LOG="$HISTORY_DIR/versions.ndjson"
TARGET_FILE="$HISTORY_DIR/$TARGET_VERSION_ID.md"

mkdir -p "$HISTORY_DIR"

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

if [[ ! -f "$TARGET_FILE" ]]; then
  echo "target version not found: $TARGET_FILE"
  exit 1
fi

if [[ -f "$POINTER_FILE" ]]; then
  current_version_id="$(jq -r '.current_version_id // ""' "$POINTER_FILE")"
else
  current_version_id=""
fi

if [[ "$current_version_id" == "$TARGET_VERSION_ID" ]]; then
  echo "already on target version: $TARGET_VERSION_ID"
  exit 0
fi

now="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
backup_version_id="rollback-pre-$(date -u +"%Y%m%d%H%M%S")-$$-$RANDOM"
backup_file="$HISTORY_DIR/$backup_version_id.md"

if [[ -f "$CURRENT_CONFIG" ]]; then
  cp "$CURRENT_CONFIG" "$backup_file"
else
  : > "$backup_file"
fi
cp "$TARGET_FILE" "$CURRENT_CONFIG"

target_checksum="$(shasum -a 256 "$TARGET_FILE" | awk '{print $1}')"
backup_checksum="$(shasum -a 256 "$backup_file" | awk '{print $1}')"

jq -n \
  --arg current_version_id "$TARGET_VERSION_ID" \
  --arg previous_version_id "$current_version_id" \
  --arg current_file "$CURRENT_CONFIG" \
  --arg history_dir "$HISTORY_DIR" \
  --arg updated_at "$now" \
  --arg updated_by "$ACTOR" \
  --arg rollback_backup_version_id "$backup_version_id" \
  '{
    current_version_id: $current_version_id,
    previous_version_id: $previous_version_id,
    current_file: $current_file,
    history_dir: $history_dir,
    updated_at: $updated_at,
    updated_by: $updated_by,
    rollback_backup_version_id: $rollback_backup_version_id
  }' > "$POINTER_FILE"

jq -cn \
  --arg timestamp "$now" \
  --arg action "ROLLBACK" \
  --arg from_version_id "$current_version_id" \
  --arg to_version_id "$TARGET_VERSION_ID" \
  --arg rollback_backup_version_id "$backup_version_id" \
  --arg actor "$ACTOR" \
  --arg reason "$REASON" \
  --arg target_file "$TARGET_FILE" \
  --arg target_checksum_sha256 "$target_checksum" \
  --arg backup_file "$backup_file" \
  --arg backup_checksum_sha256 "$backup_checksum" \
  '{
    timestamp: $timestamp,
    action: $action,
    from_version_id: $from_version_id,
    to_version_id: $to_version_id,
    rollback_backup_version_id: $rollback_backup_version_id,
    actor: $actor,
    reason: $reason,
    target_file: $target_file,
    target_checksum_sha256: $target_checksum_sha256,
    backup_file: $backup_file,
    backup_checksum_sha256: $backup_checksum_sha256
  }' >> "$AUDIT_LOG"

echo "config rolled back: from=$current_version_id to=$TARGET_VERSION_ID backup=$backup_version_id"
