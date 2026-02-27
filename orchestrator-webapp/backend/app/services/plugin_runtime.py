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
    ok: bool
    payload: dict[str, Any]
    error: str | None = None


class PluginRuntime:
    def __init__(self, repo_root: Path) -> None:
        self.repo_root = repo_root

    def check_compat(self, manifest: PluginManifest) -> tuple[bool, str]:
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
        if not entry_script.exists():
            return HookResult(ok=False, payload={}, error=f"entrypoint not found: {entry_script}")

        def _limit_resources() -> None:
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

        try:
            out = json.loads(completed.stdout.strip() or "{}")
        except json.JSONDecodeError:
            return HookResult(ok=False, payload={}, error="hook returned invalid json")
        return HookResult(ok=bool(out.get("ok", True)), payload=out)
