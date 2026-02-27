#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from pathlib import Path

CORE_PLUGIN_API = "1.0.0"


def parse(v: str) -> tuple[int, int, int]:
    p = v.split('.')
    if len(p) != 3:
        raise ValueError(f"invalid semver: {v}")
    return int(p[0]), int(p[1]), int(p[2])


def check(manifest: dict) -> tuple[bool, str]:
    api = manifest.get('apiVersion', '')
    try:
        major, minor, _ = parse(api)
        c_major, c_minor, _ = parse(CORE_PLUGIN_API)
    except Exception as exc:
        return False, str(exc)
    if major != c_major:
        return False, f"major mismatch core={c_major} plugin={major}"
    if minor not in {c_minor, max(c_minor - 1, 0)}:
        return False, f"minor outside support window core={c_minor} plugin={minor}"
    return True, "compatible"


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: check_plugin_compat.py <plugin.manifest.json>")
        return 2

    path = Path(sys.argv[1])
    data = json.loads(path.read_text(encoding='utf-8'))
    ok, msg = check(data)
    print(json.dumps({"ok": ok, "message": msg}, ensure_ascii=True))
    return 0 if ok else 1


if __name__ == '__main__':
    raise SystemExit(main())
