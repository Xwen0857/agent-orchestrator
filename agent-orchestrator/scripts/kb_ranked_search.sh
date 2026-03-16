#!/usr/bin/env bash
set -euo pipefail

# Ranks knowledge-base entries by lexical hits plus stored score metadata.
# Inputs: query string and optional top-k result count.
# Side effects: none.
# Failure model: exits non-zero only for invalid usage or Python runtime errors.

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <query> [top_k]"
  exit 2
fi

QUERY="$1"
TOP_K="${2:-5}"
ENTRIES_DIR="knowledge-base/entries"

# Python keeps the ranking logic readable while still returning a shell-friendly
# pipe-delimited format.
python3 - "$QUERY" "$TOP_K" "$ENTRIES_DIR" <<'PY'
import os
import re
import sys

query = sys.argv[1].lower()
top_k = int(sys.argv[2])
entries_dir = sys.argv[3]

def read_field(text, key, default=""):
    m = re.search(rf"^{re.escape(key)}:\s*(.*)$", text, flags=re.MULTILINE)
    return m.group(1).strip() if m else default

def lexical_hits(query_tokens, text):
    t = text.lower()
    return sum(t.count(tok) for tok in query_tokens if tok)

query_tokens = re.findall(r"[a-zA-Z0-9_]+", query)
rows = []

if os.path.isdir(entries_dir):
    for name in sorted(os.listdir(entries_dir)):
        if not name.endswith(".md"):
            continue
        path = os.path.join(entries_dir, name)
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
        entry_id = read_field(content, "entry_id")
        title = read_field(content, "title")
        status = read_field(content, "status", "CANDIDATE")
        if status == "DEPRECATED":
            continue
        score = int(read_field(content, "score", "50") or "50")
        lex = lexical_hits(query_tokens, content)
        if lex == 0:
            continue
        final_score = lex * 10 + int(score * 0.3)
        rows.append((final_score, score, lex, entry_id, path, title, status))

rows.sort(key=lambda x: (-x[0], -x[1], -x[2], x[3]))
for row in rows[:top_k]:
    final_score, score, lex, entry_id, path, title, status = row
    print(f"{entry_id}|{path}|{title}|{final_score}|{score}|{lex}|{status}")
PY
