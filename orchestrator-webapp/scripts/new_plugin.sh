#!/usr/bin/env bash
set -euo pipefail

# Scaffold a minimal backend plugin manifest and hook entrypoint.
# Inputs: plugin id and an optional display name.
# Side effects: creates a new plugin directory, writes a manifest and backend hook,
# and marks the generated hook executable.
# Failure model: exits non-zero on invalid args or when the plugin directory already exists.

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <plugin-id> [display-name]"
  exit 2
fi

PLUGIN_ID="$1"
DISPLAY_NAME="${2:-$PLUGIN_ID}"
ROOT="orchestrator-webapp/backend/plugins/$PLUGIN_ID"

if [[ -e "$ROOT" ]]; then
  echo "plugin already exists: $ROOT"
  exit 1
fi

mkdir -p "$ROOT"

# Seed a minimal validator-style manifest so the plugin can be registered and expanded later.
cat > "$ROOT/plugin.manifest.json" <<MANIFEST
{
  "id": "$PLUGIN_ID",
  "name": "$DISPLAY_NAME",
  "version": "0.1.0",
  "apiVersion": "1.0.0",
  "capabilities": ["validator"],
  "permissions": ["register_validator"],
  "entrypoints": {
    "backend": "backend_hook.py",
    "frontend": ""
  }
}
MANIFEST

# Generate a tiny backend hook that supports both validate and event hook modes.
cat > "$ROOT/backend_hook.py" <<'PY'
#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--hook", required=True)
    args = parser.parse_args()

    payload = json.loads((sys.stdin.read() or "{}").strip())
    if args.hook == "validate":
        out = {
            "ok": True,
            "issues": []
        }
    elif args.hook == "event":
        out = {"ok": True, "handled": payload.get("event_type")}
    else:
        out = {"ok": True}

    print(json.dumps(out, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
PY
chmod +x "$ROOT/backend_hook.py"

echo "plugin scaffold created: $ROOT"
