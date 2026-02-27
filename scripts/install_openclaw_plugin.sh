#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: $0 <path-to-openclaw>"
}

if [[ $# -ne 1 ]]; then
  usage
  exit 1
fi

TARGET_OPENCLAW="$(cd "$1" && pwd)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SOURCE_PLUGIN="$REPO_ROOT/extensions/orchestrator-dashboard"
DEST_PLUGIN="$TARGET_OPENCLAW/extensions/orchestrator-dashboard"

if [[ ! -d "$TARGET_OPENCLAW" ]]; then
  echo "target OpenClaw path not found: $TARGET_OPENCLAW" >&2
  exit 1
fi

if [[ ! -f "$TARGET_OPENCLAW/package.json" ]]; then
  echo "target path does not look like an OpenClaw repository: $TARGET_OPENCLAW" >&2
  exit 1
fi

if [[ ! -d "$SOURCE_PLUGIN" ]]; then
  echo "source plugin path missing: $SOURCE_PLUGIN" >&2
  exit 1
fi

mkdir -p "$(dirname "$DEST_PLUGIN")"

if [[ -e "$DEST_PLUGIN" || -L "$DEST_PLUGIN" ]]; then
  echo "destination already exists: $DEST_PLUGIN" >&2
  echo "remove or rename it first, then rerun this installer" >&2
  exit 1
fi

ln -s "$SOURCE_PLUGIN" "$DEST_PLUGIN"

cat <<EOF
plugin installed as symlink:
- source: $SOURCE_PLUGIN
- target: $DEST_PLUGIN

next steps:
1. cd "$TARGET_OPENCLAW"
2. pnpm install
3. configure the plugin in your OpenClaw host
EOF
