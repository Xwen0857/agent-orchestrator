"""Plugin hook execution utilities for the backend runtime.

This module validates plugin API compatibility and invokes plugin hook entrypoints
with bounded resources and JSON payload handling.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.models import PLUGIN_API_VERSION, PluginManifest


@dataclass
class HookResult:
    """Normalized result for one plugin hook invocation."""

    ok: bool
    payload: dict[str, Any]
    error: str | None = None


class PluginRuntime:
    """Runs backend plugin compatibility checks and subprocess hook calls."""

    def __init__(self, repo_root: Path) -> None:
        self.repo_root = repo_root

    def check_compat(self, manifest: PluginManifest) -> tuple[bool, str]:
        """Validate plugin API compatibility against the backend's supported version window."""
        try:
            major, minor, _ = [int(x) for x in manifest.apiVersion.split(".")]
            c_major, c_minor, _ = [int(x) for x in PLUGIN_API_VERSION.split(".")]
        except Exception:
            return False, "invalid apiVersion format"
        if major != c_major:
            return False, "incompatible major apiVersion"
        if minor not in {c_minor, max(c_minor - 1, 0)}:
            return False, "minor apiVersion outside compatibility window"
        return True, "ok"

    def invoke_hook(
        self,
        plugin_id: str,
        entry_script: Path,
        hook: str,
        payload: dict[str, Any],
        timeout_sec: int = 8,
    ) -> HookResult:
        """Execute one plugin hook subprocess and normalize its JSON response."""
        if not entry_script.exists():
            return HookResult(ok=False, payload={}, error=f"entrypoint not found: {entry_script}")

        def _limit_resources() -> None:
            """Apply lightweight CPU and memory limits for Unix subprocess hooks."""
            try:
                import resource

                resource.setrlimit(resource.RLIMIT_CPU, (timeout_sec, timeout_sec + 1))
                resource.setrlimit(resource.RLIMIT_AS, (256 * 1024 * 1024, 256 * 1024 * 1024))
            except Exception:
                pass

        try:
            completed = subprocess.run(
                [sys.executable, str(entry_script), "--hook", hook],
                input=json.dumps(payload),
                text=True,
                capture_output=True,
                timeout=timeout_sec,
                cwd=str(self.repo_root),
                preexec_fn=_limit_resources if os.name != "nt" else None,
                check=False,
            )
        except subprocess.TimeoutExpired:
            return HookResult(ok=False, payload={}, error=f"hook timeout: {plugin_id}:{hook}")

        if completed.returncode != 0:
            return HookResult(ok=False, payload={}, error=completed.stderr.strip() or "hook failed")

        # Hooks return JSON on stdout; invalid JSON is treated as a plugin failure
        # rather than leaking a parsing exception to the caller.
        try:
            out = json.loads(completed.stdout.strip() or "{}")
        except json.JSONDecodeError:
            return HookResult(ok=False, payload={}, error="hook returned invalid json")
        return HookResult(ok=bool(out.get("ok", True)), payload=out)
