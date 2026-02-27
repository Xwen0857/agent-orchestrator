#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <query>"
  exit 2
fi

QUERY="$1"
ROOT="knowledge-base/entries"

if [[ ! -d "$ROOT" ]]; then
  exit 0
fi

# Return matching entry_id + file + title lines for quick reuse.
while IFS= read -r file; do
  entry_id="$(sed -n 's/^entry_id:[[:space:]]*//p' "$file" | head -n 1)"
  title="$(sed -n 's/^title:[[:space:]]*//p' "$file" | head -n 1)"
  printf "%s|%s|%s\n" "$entry_id" "$file" "$title"
done < <(rg -l -i --glob '*.md' "$QUERY" "$ROOT" | sort)
