#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: $0 --task-dir <parent_task_dir> --run-root <parent_run_root> --mode <promote|rollback> --reason <text>"
  exit 2
}

TASK_DIR=""
RUN_ROOT=""
MODE=""
REASON=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --task-dir)
      [[ $# -ge 2 ]] || usage
      TASK_DIR="$2"
      shift 2
      ;;
    --run-root)
      [[ $# -ge 2 ]] || usage
      RUN_ROOT="$2"
      shift 2
      ;;
    --mode)
      [[ $# -ge 2 ]] || usage
      MODE="$2"
      shift 2
      ;;
    --reason)
      [[ $# -ge 2 ]] || usage
      REASON="$2"
      shift 2
      ;;
    *)
      usage
      ;;
  esac
done

[[ -n "$TASK_DIR" && -n "$RUN_ROOT" && -n "$MODE" ]] || usage
[[ "$MODE" == "promote" || "$MODE" == "rollback" ]] || usage
[[ -f "$TASK_DIR/meta.json" ]] || { echo "meta missing: $TASK_DIR/meta.json"; exit 1; }

STAGING_ROOT="$RUN_ROOT/delivery_staging"
MANIFEST_PATH="$RUN_ROOT/delivery_staging_manifest.json"
AUDIT_PATH="$TASK_DIR/aggregate_audit.json"
DELIVERY_ROOT="$RUN_ROOT/delivery"
EVIDENCE_ROOT="$RUN_ROOT/evidence"
TS="$(date -u +%Y%m%d%H%M%S)"

update_meta() {
  local publish_status="$1"
  local reason="$2"
  local ts="$3"
  local tmp
  tmp="$(mktemp "$TASK_DIR/.meta.aggregate.XXXXXX.json")"
  jq \
    --arg publish_status "$publish_status" \
    --arg reason "$reason" \
    --arg staging_root "$STAGING_ROOT" \
    --arg manifest_path "$MANIFEST_PATH" \
    --arg audit_path "$AUDIT_PATH" \
    --arg ts "$ts" \
    '.aggregate = (.aggregate // {})
    | .aggregate.staging_root = $staging_root
    | .aggregate.manifest_path = $manifest_path
    | .aggregate.audit_path = $audit_path
    | .aggregate.publish_status = $publish_status
    | .aggregate.last_block_reason = $reason
    | if $publish_status == "published" then .aggregate.last_publish_at = $ts else . end
    | if $publish_status == "rolled_back" then .aggregate.last_rollback_at = $ts else . end
    | .updated_at = $ts' "$TASK_DIR/meta.json" > "$tmp" && mv "$tmp" "$TASK_DIR/meta.json"
}

if [[ "$MODE" == "promote" ]]; then
  [[ -f "$AUDIT_PATH" ]] || { echo "aggregate_audit.json missing"; exit 1; }
  if ! jq -e '.status == "PASS"' "$AUDIT_PATH" >/dev/null 2>&1; then
    echo "aggregate audit is not PASS"
    exit 1
  fi
  [[ -d "$STAGING_ROOT" ]] || { echo "staging root missing: $STAGING_ROOT"; exit 1; }
  mkdir -p "$EVIDENCE_ROOT/release_backup"
  if [[ -d "$DELIVERY_ROOT" ]]; then
    mv "$DELIVERY_ROOT" "$EVIDENCE_ROOT/release_backup/delivery_${TS}"
  fi
  mv "$STAGING_ROOT" "$DELIVERY_ROOT"
  update_meta "published" "${REASON:-aggregate promoted}" "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  jq -cn --arg status "ok" --arg mode "$MODE" --arg delivery_root "$DELIVERY_ROOT" '{status:$status,mode:$mode,delivery_root:$delivery_root}'
  exit 0
fi

mkdir -p "$EVIDENCE_ROOT/aggregate_failed/$TS"
if [[ -d "$STAGING_ROOT" ]]; then
  cp -R "$STAGING_ROOT/." "$EVIDENCE_ROOT/aggregate_failed/$TS/" 2>/dev/null || true
  rm -rf "$STAGING_ROOT"
fi
if [[ -f "$MANIFEST_PATH" ]]; then
  cp "$MANIFEST_PATH" "$EVIDENCE_ROOT/aggregate_failed/$TS/manifest.json" 2>/dev/null || true
fi
if [[ -f "$AUDIT_PATH" ]]; then
  cp "$AUDIT_PATH" "$EVIDENCE_ROOT/aggregate_failed/$TS/aggregate_audit.json" 2>/dev/null || true
fi

update_meta "rolled_back" "${REASON:-aggregate rollback}" "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
jq -cn --arg status "ok" --arg mode "$MODE" --arg evidence "$EVIDENCE_ROOT/aggregate_failed/$TS" '{status:$status,mode:$mode,evidence:$evidence}'

