#!/usr/bin/env bash
set -euo pipefail

TASK_DIR="$1"
RUNTIME_VIEW="$2"
DELIVERY_DIR="$(jq -r '.worker_stage.delivery_root // empty' "$RUNTIME_VIEW" 2>/dev/null || true)"
[[ -n "$DELIVERY_DIR" ]] || DELIVERY_DIR="${ORCH_WORKER_STAGE_DELIVERY_ROOT:-$TASK_DIR/delivery}"
mkdir -p "$DELIVERY_DIR/migrations"

TEST_MODE="$(jq -r '.implementation_topology.custom_overlay_layer.config.default_test_mode // ""' "$RUNTIME_VIEW" 2>/dev/null || true)"
DELIVERY_EXPECTATIONS="$(jq -r '(.implementation_topology.custom_overlay_layer.config.delivery_expectations // []) | join(", ")' "$RUNTIME_VIEW" 2>/dev/null || true)"
[[ -n "$TEST_MODE" ]] || TEST_MODE="sql_lint"

cat > "$DELIVERY_DIR/migrations/001_create_example_table.sql" <<'SQL'
CREATE TABLE IF NOT EXISTS example_records (
  id INTEGER PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
SQL

cat > "$DELIVERY_DIR/migrations/001_create_example_table.rollback.sql" <<'SQL'
DROP TABLE IF EXISTS example_records;
SQL

cat > "$DELIVERY_DIR/CHANGELOG.md" <<'MD'
# SQL Migration Bundle

- Adds `example_records`
- Includes forward and rollback migration files
MD

cat > "$DELIVERY_DIR/RUNBOOK.md" <<MD
# SQL Migration Runbook

## Delivery
- Forward migration: \`migrations/001_create_example_table.sql\`
- Rollback migration: \`migrations/001_create_example_table.rollback.sql\`
- Changelog: \`CHANGELOG.md\`

## Validation
- Confirm forward file contains \`CREATE TABLE\`
- Confirm rollback file contains \`DROP TABLE\`
- test_mode: ${TEST_MODE}
MD

jq -cn \
  --arg summary "generated sql migration delivery bundle" \
  --arg test_command "cd delivery && grep -q \"CREATE TABLE\" migrations/001_create_example_table.sql && grep -q \"DROP TABLE\" migrations/001_create_example_table.rollback.sql" \
  --argjson changed_files '[
    "delivery/migrations/001_create_example_table.sql",
    "delivery/migrations/001_create_example_table.rollback.sql",
    "delivery/CHANGELOG.md",
    "delivery/RUNBOOK.md"
  ]' \
  --argjson delivery_manifest '[
    "delivery/migrations/001_create_example_table.sql",
    "delivery/migrations/001_create_example_table.rollback.sql",
    "delivery/CHANGELOG.md",
    "delivery/RUNBOOK.md"
  ]' \
  --argjson evidence_notes "[\"test_mode=${TEST_MODE}\", \"delivery_expectations=${DELIVERY_EXPECTATIONS:-migration_bundle}\"]" \
  '{schema_version:"worker-template-result-contract-v1", summary:$summary, test_command:$test_command, changed_files:$changed_files, delivery_manifest:$delivery_manifest, evidence_notes:$evidence_notes}'
