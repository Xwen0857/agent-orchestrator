#!/usr/bin/env python3
import argparse
import json
import math
import os
import re
from collections import Counter


def read_field(text: str, key: str, default: str = "") -> str:
    m = re.search(rf"^{re.escape(key)}:\s*(.*)$", text, flags=re.MULTILINE)
    return m.group(1).strip() if m else default


def normalize_text(s: str) -> str:
    return re.sub(r"\s+", " ", s.strip().lower())


def word_counter(text: str) -> Counter:
    tokens = re.findall(r"[a-zA-Z0-9_\-\u4e00-\u9fff]+", normalize_text(text))
    return Counter(tokens)


def trigram_counter(text: str) -> Counter:
    text = normalize_text(text)
    if len(text) < 3:
        return Counter([text]) if text else Counter()
    return Counter(text[i : i + 3] for i in range(len(text) - 2))


def cosine(a: Counter, b: Counter) -> float:
    if not a or not b:
        return 0.0
    dot = sum(v * b.get(k, 0) for k, v in a.items())
    na = math.sqrt(sum(v * v for v in a.values()))
    nb = math.sqrt(sum(v * v for v in b.values()))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def entry_text(path: str) -> str:
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    title = read_field(content, "title")
    tags = read_field(content, "tags")
    problem = ""
    fix = ""
    m1 = re.search(r"## Problem\s*(.*?)\s*## Fix Pattern", content, flags=re.DOTALL)
    if m1:
        problem = m1.group(1).strip()
    m2 = re.search(r"## Fix Pattern\s*(.*)$", content, flags=re.DOTALL)
    if m2:
        fix = m2.group(1).strip()
    return "\n".join([title, tags, problem, fix]).strip()


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--title", required=True)
    p.add_argument("--problem", required=True)
    p.add_argument("--fix", required=True)
    p.add_argument("--entries-dir", default="knowledge-base/entries")
    p.add_argument("--top-k", type=int, default=3)
    args = p.parse_args()

    cand_text = "\n".join([args.title, args.problem, args.fix])
    cand_words = word_counter(cand_text)
    cand_tri = trigram_counter(cand_text)

    rows = []
    if not os.path.isdir(args.entries_dir):
        print("[]")
        return 0

    for name in sorted(os.listdir(args.entries_dir)):
        if not name.endswith(".md"):
            continue
        path = os.path.join(args.entries_dir, name)
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
        eid = read_field(content, "entry_id")
        title = read_field(content, "title")
        status = read_field(content, "status", "CANDIDATE")
        if status == "DEPRECATED":
            continue

        txt = entry_text(path)
        words = word_counter(txt)
        tri = trigram_counter(txt)
        word_sim = cosine(cand_words, words)
        tri_sim = cosine(cand_tri, tri)
        sim = 0.65 * word_sim + 0.35 * tri_sim
        rows.append(
            {
                "entry_id": eid,
                "path": path,
                "title": title,
                "similarity": round(sim, 4),
                "word_similarity": round(word_sim, 4),
                "trigram_similarity": round(tri_sim, 4),
            }
        )

    rows.sort(key=lambda x: x["similarity"], reverse=True)
    print(json.dumps(rows[: max(1, args.top_k)], ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
