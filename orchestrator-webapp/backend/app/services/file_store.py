"""Filesystem helpers for atomic JSON/text writes and NDJSON append/read access."""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any


def ensure_parent(path: Path) -> None:
    """Create the parent directory for a target path if it does not already exist."""
    path.parent.mkdir(parents=True, exist_ok=True)


def read_json(path: Path, default: Any | None = None) -> Any:
    """Read JSON from disk or return the provided default when the file is absent."""
    if not path.exists():
        if default is not None:
            return default
        raise FileNotFoundError(path)
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def write_json_atomic(path: Path, payload: Any) -> None:
    """Write JSON via a temporary file and atomic replace."""
    ensure_parent(path)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=True, indent=2)
            f.write("\n")
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_name, path)
    finally:
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)


def read_text(path: Path) -> str:
    """Read a UTF-8 text file."""
    with path.open("r", encoding="utf-8") as f:
        return f.read()


def write_text_atomic(path: Path, text: str) -> None:
    """Write UTF-8 text via a temporary file and atomic replace."""
    ensure_parent(path)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_name, path)
    finally:
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)


def read_ndjson(path: Path) -> list[dict[str, Any]]:
    """Read newline-delimited JSON into a list of decoded records."""
    if not path.exists():
        return []
    records: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            records.append(json.loads(line))
    return records


def append_ndjson(path: Path, record: dict[str, Any]) -> None:
    """Append one JSON record to an NDJSON file."""
    ensure_parent(path)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=True) + "\n")
