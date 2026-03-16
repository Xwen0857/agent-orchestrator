#!/usr/bin/env bash
set -euo pipefail

TASK_DIR="$1"
RUNTIME_VIEW="$2"
DELIVERY_DIR="$(jq -r '.worker_stage.delivery_root // empty' "$RUNTIME_VIEW" 2>/dev/null || true)"
[[ -n "$DELIVERY_DIR" ]] || DELIVERY_DIR="${ORCH_WORKER_STAGE_DELIVERY_ROOT:-$TASK_DIR/delivery}"
mkdir -p "$DELIVERY_DIR/src"

TEST_MODE="$(jq -r '.implementation_topology.custom_overlay_layer.config.default_test_mode // ""' "$RUNTIME_VIEW" 2>/dev/null || true)"
DELIVERY_EXPECTATIONS="$(jq -r '(.implementation_topology.custom_overlay_layer.config.delivery_expectations // []) | join(", ")' "$RUNTIME_VIEW" 2>/dev/null || true)"
[[ -n "$TEST_MODE" ]] || TEST_MODE="npm_smoke"

cat > "$DELIVERY_DIR/package.json" <<'JSON'
{
  "name": "worker-template-react-app",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "smoke": "node smoke.test.js"
  }
}
JSON

cat > "$DELIVERY_DIR/src/App.tsx" <<'TS'
export function App(): string {
  return `
    <main class="app-shell">
      <h1>Worker Role Template</h1>
      <p>React + TypeScript frontend placeholder app.</p>
    </main>
  `;
}
TS

cat > "$DELIVERY_DIR/src/styles.css" <<'CSS'
:root {
  color-scheme: light;
  font-family: "Helvetica Neue", sans-serif;
  background: #f4efe6;
  color: #1d2329;
}

.app-shell {
  margin: 3rem auto;
  max-width: 42rem;
  padding: 2rem;
  border: 1px solid #d5c5a8;
  background: linear-gradient(180deg, #fffdf8 0%, #f6efe1 100%);
}
CSS

cat > "$DELIVERY_DIR/smoke.test.js" <<'JS'
import { readFileSync } from "node:fs";

const content = readFileSync(new URL("./src/App.tsx", import.meta.url), "utf8");
if (!content.includes("Worker Role Template")) {
  throw new Error("expected App.tsx to include template heading");
}
console.log("frontend smoke passed");
JS

cat > "$DELIVERY_DIR/RUNBOOK.md" <<MD
# React Frontend Runbook

## Delivery
- Entry component: \`src/App.tsx\`
- Styles: \`src/styles.css\`
- Smoke test: \`node smoke.test.js\`

## Template Defaults
- test_mode: ${TEST_MODE}
MD

jq -cn \
  --arg summary "generated react typescript frontend delivery skeleton" \
  --arg test_command "cd delivery && node smoke.test.js" \
  --argjson changed_files '[
    "delivery/package.json",
    "delivery/src/App.tsx",
    "delivery/src/styles.css",
    "delivery/smoke.test.js",
    "delivery/RUNBOOK.md"
  ]' \
  --argjson delivery_manifest '[
    "delivery/package.json",
    "delivery/src/App.tsx",
    "delivery/src/styles.css",
    "delivery/smoke.test.js",
    "delivery/RUNBOOK.md"
  ]' \
  --argjson evidence_notes "[\"test_mode=${TEST_MODE}\", \"delivery_expectations=${DELIVERY_EXPECTATIONS:-ui_bundle}\"]" \
  '{schema_version:"worker-template-result-contract-v1", summary:$summary, test_command:$test_command, changed_files:$changed_files, delivery_manifest:$delivery_manifest, evidence_notes:$evidence_notes}'
