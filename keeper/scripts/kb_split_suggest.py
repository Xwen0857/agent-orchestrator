#!/usr/bin/env python3
"""Suggest overly broad KB entries that may need to be split.

This heuristic scans existing entry markdown, looking for long entries, repeated merged
candidate accumulation, and large problem/fix sections.
"""

import json
import os
import re
import sys


def read_field(text: str, key: str, default: str = "") -> str:
    m = re.search(rf"^{re.escape(key)}:\s*(.*)$", text, flags=re.MULTILINE)
    return m.group(1).strip() if m else default


def main() -> int:
    """Scan entry files, collect split signals, and print JSON suggestions."""
    entries_dir = sys.argv[1] if len(sys.argv) > 1 else "knowledge-base/entries"
    if not os.path.isdir(entries_dir):
        print("[]")
        return 0

    suggestions = []
    for name in sorted(os.listdir(entries_dir)):
        if not name.endswith(".md"):
            continue
        path = os.path.join(entries_dir, name)
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
        eid = read_field(content, "entry_id")
        status = read_field(content, "status", "CANDIDATE")
        if status == "DEPRECATED":
            continue

        merged_count = len(re.findall(r"^## Merged Candidate$", content, flags=re.MULTILINE))
        problem_section = re.search(r"## Problem\s*(.*?)\s*## Fix Pattern", content, flags=re.DOTALL)
        fix_section = re.search(r"## Fix Pattern\s*(.*)$", content, flags=re.DOTALL)
        problem_len = len((problem_section.group(1).strip() if problem_section else "").splitlines())
        fix_len = len((fix_section.group(1).strip() if fix_section else "").splitlines())
        total_len = len(content.splitlines())

        reason = []
        if merged_count >= 3:
            reason.append("high_merge_accumulation")
        if problem_len >= 8 and fix_len >= 8:
            reason.append("long_multi_path_pattern")
        if total_len >= 120:
            reason.append("entry_too_long")

        if reason:
            suggestions.append(
                {
                    "entry_id": eid,
                    "path": path,
                    "merged_count": merged_count,
                    "lines": total_len,
                    "reasons": reason,
                }
            )

    print(json.dumps(suggestions, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
