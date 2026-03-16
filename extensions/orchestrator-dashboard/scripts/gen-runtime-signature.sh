#!/usr/bin/env bash
set -euo pipefail

# Generates the runtime signature consumed by the plugin consistency check.
# Inputs: the source files listed in FILES/FILE_IDS.
# Side effects: rewrites runtime.signature.json in the plugin directory.
# Failure model: exits non-zero if any input file is missing or hashing fails.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
PLUGIN_DIR="$(cd "$SCRIPT_DIR/.." && pwd -P)"

FILES=(
  "$PLUGIN_DIR/index.ts"
  "$PLUGIN_DIR/orchestrate-command.ts"
  "$PLUGIN_DIR/openclaw.plugin.json"
)
FILE_IDS=(
  "extensions/orchestrator-dashboard/index.ts"
  "extensions/orchestrator-dashboard/orchestrate-command.ts"
  "extensions/orchestrator-dashboard/openclaw.plugin.json"
)

# Fail before creating temp state so the signature file is never regenerated from
# a partial input set.
for f in "${FILES[@]}"; do
  [[ -f "$f" ]] || { echo "missing file: $f"; exit 1; }
done

tmp="$(mktemp)"
# Always remove the aggregation file, even when hashing or JSON emission fails.
trap 'rm -f "$tmp"' EXIT

# Hash both file ids and file contents so renaming a tracked input changes
# the signature even if the file bytes stay the same.
for i in "${!FILES[@]}"; do
  f="${FILES[$i]}"
  id="${FILE_IDS[$i]}"
  printf '%s\n' "$id" >> "$tmp"
  cat "$f" >> "$tmp"
  printf '\n' >> "$tmp"
done

sig="$(shasum -a 256 "$tmp" | awk '{print $1}')"
out="$PLUGIN_DIR/runtime.signature.json"

cat > "$out" <<EOF
{
  "signature": "$sig",
  "generated_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "files": [
    "extensions/orchestrator-dashboard/index.ts",
    "extensions/orchestrator-dashboard/orchestrate-command.ts",
    "extensions/orchestrator-dashboard/openclaw.plugin.json"
  ]
}
EOF

echo "generated: $out"
echo "signature: $sig"
