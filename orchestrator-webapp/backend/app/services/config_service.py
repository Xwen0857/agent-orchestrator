"""Configuration read/validate/commit orchestration for the backend.

This module parses planner and audit config surfaces, validates draft changes,
persists committed changes, and coordinates audit/event/plugin hooks around config updates.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import HTTPException

from app.models import (
    CommitDraftRequest,
    CommitDraftResponse,
    CurrentConfigResponse,
    Role,
    UserContext,
    ValidateDraftRequest,
    ValidateDraftResponse,
    ValidationIssue,
)
from app.services.audit_service import AuditService
from app.services.event_bus import EventBus
from app.services.file_store import read_json, read_ndjson, read_text, write_json_atomic, write_text_atomic
from app.services.plugin_registry import PluginRegistryService
from app.services.plugin_runtime import PluginRuntime


KV_RE = re.compile(r"^([A-Za-z0-9_./-]+):\s*(.*)$")
LIST_KV_RE = re.compile(r"^-\s+([A-Za-z0-9_./-]+):\s*(.*)$")
BOOL_RE = {"true": True, "false": False}


class ConfigService:
    """Manage current config reads, draft validation, commits, and rollback execution."""

    def __init__(
        self,
        *,
        planner_current_md: Path,
        planner_properties_md: Path,
        audit_policy_json: Path,
        history_ndjson: Path,
        lock_path: Path,
        snapshot_script: Path,
        rollback_script: Path,
        plugin_registry: PluginRegistryService,
        runtime: PluginRuntime,
        event_bus: EventBus,
        audit: AuditService,
    ) -> None:
        self.planner_current_md = planner_current_md
        self.planner_properties_md = planner_properties_md
        self.audit_policy_json = audit_policy_json
        self.history_ndjson = history_ndjson
        self.lock_path = lock_path
        self.snapshot_script = snapshot_script
        self.rollback_script = rollback_script
        self.plugin_registry = plugin_registry
        self.runtime = runtime
        self.event_bus = event_bus
        self.audit = audit

    def read_current(self) -> CurrentConfigResponse:
        """Return the current planner and audit config from disk in API response form."""
        return CurrentConfigResponse(
            plannerCurrent=self._parse_plain_kv(read_text(self.planner_current_md)),
            plannerProperties=self._parse_list_kv(read_text(self.planner_properties_md)),
            auditPolicy=read_json(self.audit_policy_json),
        )

    def validate(self, req: ValidateDraftRequest, user: UserContext, trace_id: str) -> ValidateDraftResponse:
        """Validate a draft config, infer risk, and emit audit/event records for the attempt."""
        base = self.read_current()
        issues: list[ValidationIssue] = []

        changed = {
            "plannerCurrent": sorted(k for k in set(base.plannerCurrent) | set(req.draft.plannerCurrent) if base.plannerCurrent.get(k) != req.draft.plannerCurrent.get(k)),
            "plannerProperties": sorted(k for k in set(base.plannerProperties) | set(req.draft.plannerProperties) if base.plannerProperties.get(k) != req.draft.plannerProperties.get(k)),
            "auditPolicy": ["rules", "version"] if base.auditPolicy != req.draft.auditPolicy else [],
        }

        required_current = ["version", "state_machine", "transition_script", "audit_gate_script"]
        for key in required_current:
            if key not in req.draft.plannerCurrent or str(req.draft.plannerCurrent[key]).strip() == "":
                issues.append(ValidationIssue(source="plannerCurrent", key=key, level="ERROR", message="required key missing"))

        numeric_props = [
            "worker_timeout_minutes",
            "pass_rate_window_size",
            "pass_rate_replace_threshold",
            "budget_warn_threshold_ratio",
            "budget_block_threshold_ratio",
            "dashboard_refresh_minutes",
            "health_check_interval_minutes",
            "stale_in_progress_minutes",
            "keeper_cycle_minutes",
        ]
        for key in numeric_props:
            val = req.draft.plannerProperties.get(key)
            if val in (None, ""):
                continue
            try:
                _ = float(val)
            except ValueError:
                issues.append(ValidationIssue(source="plannerProperties", key=key, level="ERROR", message="must be numeric"))

        if not isinstance(req.draft.auditPolicy.get("rules", []), list):
            issues.append(ValidationIssue(source="auditPolicy", key="rules", level="ERROR", message="rules must be a list"))

        risk = self._infer_risk(base, req.draft)
        requires_approval = risk in {"HIGH", "CRITICAL"}

        plugin_issues = self._run_validator_plugins(req.draft, trace_id)
        issues.extend(plugin_issues)

        valid = not any(item.level == "ERROR" for item in issues)
        response = ValidateDraftResponse(
            valid=valid,
            requiresApproval=requires_approval,
            riskLevel=risk,
            issues=issues,
            changedKeys=changed,
        )
        self.event_bus.emit(
            event_type="config.draft.validated",
            actor=user.user_id,
            resource="config",
            payload=response.model_dump(),
            trace_id=trace_id,
        )
        self.audit.record(
            actor=user.user_id,
            action="CONFIG_VALIDATE",
            resource="config",
            status="OK" if valid else "FAILED",
            details={"risk": risk, "requiresApproval": requires_approval, "issueCount": len(issues)},
            trace_id=trace_id,
        )
        return response

    def commit(self, req: CommitDraftRequest, user: UserContext) -> CommitDraftResponse:
        """Validate and commit a config draft, then snapshot and emit post-commit hooks."""
        trace_id = f"trace_{uuid4().hex}"
        validation = self.validate(ValidateDraftRequest(draft=req.draft, reason=req.reason), user, trace_id)
        if not validation.valid:
            raise HTTPException(status_code=400, detail={"message": "draft validation failed", "issues": [x.model_dump() for x in validation.issues]})
        if validation.requiresApproval and user.role != Role.approver and not req.approvalId:
            raise HTTPException(status_code=403, detail="approval required for high-risk config change")

        with self._acquire_lock():
            self._write_configs(req.draft)
            snapshot_version = f"webapp-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}-{uuid4().hex[:6]}"
            self._run_script(self.snapshot_script, [snapshot_version, user.user_id, req.reason])

        payload = {
            "snapshotVersion": snapshot_version,
            "approvalId": req.approvalId,
            "riskLevel": validation.riskLevel,
            "changedKeys": validation.changedKeys,
        }
        self.event_bus.emit(
            event_type="config.committed",
            actor=user.user_id,
            resource="config",
            payload=payload,
            trace_id=trace_id,
        )
        self.audit.record(
            actor=user.user_id,
            action="CONFIG_COMMIT",
            resource="config",
            status="OK",
            details=payload,
            trace_id=trace_id,
        )
        self._run_event_handlers("config.committed", payload, trace_id)
        return CommitDraftResponse(committed=True, snapshotVersion=snapshot_version, traceId=trace_id)

    def rollback(self, target_version_id: str, reason: str, user: UserContext) -> dict[str, Any]:
        """Run the configured rollback script and emit the resulting rollback events."""
        trace_id = f"trace_{uuid4().hex}"
        if user.role not in {Role.operator, Role.approver}:
            raise HTTPException(status_code=403, detail="insufficient role")
        output = self._run_script(self.rollback_script, [target_version_id, user.user_id, reason])
        payload = {
            "targetVersionId": target_version_id,
            "reason": reason,
            "output": output,
        }
        self.event_bus.emit(
            event_type="config.rollback.executed",
            actor=user.user_id,
            resource="config",
            payload=payload,
            trace_id=trace_id,
        )
        self.audit.record(
            actor=user.user_id,
            action="CONFIG_ROLLBACK",
            resource="config",
            status="OK",
            details=payload,
            trace_id=trace_id,
        )
        self._run_event_handlers("config.rollback.executed", payload, trace_id)
        return payload

    def history(self) -> list[dict[str, Any]]:
        """Return config history records from the NDJSON history store."""
        return read_ndjson(self.history_ndjson)

    def _infer_risk(self, before: CurrentConfigResponse, after: CurrentConfigResponse) -> str:
        """Infer config-change risk from changed keys, audit rules, and property deltas."""
        high_keys = {
            "transition_script",
            "audit_gate_script",
            "approval_grant_script",
            "config_rollback_script",
        }
        for key in high_keys:
            if before.plannerCurrent.get(key) != after.plannerCurrent.get(key):
                return "HIGH"

        before_rules = before.auditPolicy.get("rules", [])
        after_rules = after.auditPolicy.get("rules", [])
        if before_rules != after_rules:
            for rule in after_rules:
                if rule.get("tier") == "CRITICAL" and rule.get("enabled") is False:
                    return "CRITICAL"
            return "HIGH"

        if before.plannerProperties != after.plannerProperties:
            return "MEDIUM"
        return "LOW"

    def _run_validator_plugins(self, draft: CurrentConfigResponse, trace_id: str) -> list[ValidationIssue]:
        """Run enabled plugin validation hooks and convert results into validation issues."""
        issues: list[ValidationIssue] = []
        for rec, manifest in self.plugin_registry.get_enabled_manifests():
            if "validator" not in manifest.capabilities:
                continue
            if "register_validator" not in manifest.permissions:
                continue
            backend = manifest.entrypoints.get("backend")
            if not backend:
                continue
            result = self.runtime.invoke_hook(
                rec.id,
                (Path(rec.manifestPath).resolve().parent / backend).resolve(),
                "validate",
                {"draft": draft.model_dump(), "trace_id": trace_id},
            )
            if result.ok and result.payload.get("issues"):
                for issue in result.payload.get("issues", []):
                    issues.append(ValidationIssue.model_validate(issue))
            elif not result.ok:
                issues.append(
                    ValidationIssue(
                        source=f"plugin:{rec.id}",
                        key="validate",
                        level="ERROR",
                        message=result.error or "validator failed",
                    )
                )
        return issues

    def _run_event_handlers(self, event_type: str, payload: dict[str, Any], trace_id: str) -> None:
        """Fan out post-commit or rollback lifecycle events to enabled plugin hooks."""
        for rec, manifest in self.plugin_registry.get_enabled_manifests():
            if "event.handler" not in manifest.capabilities:
                continue
            if "register_event_handler" not in manifest.permissions:
                continue
            backend = manifest.entrypoints.get("backend")
            if not backend:
                continue
            self.runtime.invoke_hook(
                rec.id,
                (Path(rec.manifestPath).resolve().parent / backend).resolve(),
                "event",
                {"event_type": event_type, "payload": payload, "trace_id": trace_id},
            )

    @contextmanager
    def _acquire_lock(self):
        """Acquire and release the config lock file using exclusive create semantics."""
        self.lock_path.parent.mkdir(parents=True, exist_ok=True)
        fd = None
        try:
            fd = os.open(self.lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, str(os.getpid()).encode("utf-8"))
            yield
        except FileExistsError:
            raise HTTPException(status_code=409, detail="config transaction in progress")
        finally:
            if fd is not None:
                os.close(fd)
            try:
                os.unlink(self.lock_path)
            except FileNotFoundError:
                pass

    def _write_configs(self, cfg: CurrentConfigResponse) -> None:
        """Persist the planner and audit config surfaces using atomic file-store helpers."""
        current_text = read_text(self.planner_current_md)
        props_text = read_text(self.planner_properties_md)
        next_current = self._update_plain_kv_text(current_text, cfg.plannerCurrent)
        next_props = self._update_list_kv_text(props_text, cfg.plannerProperties)
        write_text_atomic(self.planner_current_md, next_current)
        write_text_atomic(self.planner_properties_md, next_props)
        write_json_atomic(self.audit_policy_json, cfg.auditPolicy)

    def _run_script(self, script: Path, args: list[str]) -> str:
        """Execute one helper script and raise an HTTP error if it fails."""
        cp = subprocess.run(
            [str(script)] + args,
            cwd=str(self.planner_current_md.parents[4]),
            capture_output=True,
            text=True,
            check=False,
        )
        if cp.returncode != 0:
            raise HTTPException(status_code=500, detail={"script": str(script), "stderr": cp.stderr.strip(), "stdout": cp.stdout.strip()})
        return cp.stdout.strip()

    def _parse_plain_kv(self, text: str) -> dict[str, Any]:
        """Parse `key: value` lines from the planner current config surface."""
        data: dict[str, Any] = {}
        for line in text.splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            m = KV_RE.match(line)
            if not m:
                continue
            data[m.group(1)] = self._coerce(m.group(2))
        return data

    def _parse_list_kv(self, text: str) -> dict[str, Any]:
        """Parse `- key: value` lines from the planner properties config surface."""
        data: dict[str, Any] = {}
        for raw in text.splitlines():
            line = raw.strip()
            m = LIST_KV_RE.match(line)
            if not m:
                continue
            data[m.group(1)] = self._coerce(m.group(2))
        return data

    def _update_plain_kv_text(self, original: str, values: dict[str, Any]) -> str:
        """Update or append plain key/value lines while preserving unrelated content."""
        remaining = {k: self._fmt(v) for k, v in values.items()}
        out: list[str] = []
        for raw in original.splitlines():
            m = KV_RE.match(raw.strip())
            if m:
                key = m.group(1)
                if key in remaining:
                    out.append(f"{key}: {remaining.pop(key)}")
                    continue
            out.append(raw)
        if remaining:
            if out and out[-1].strip() != "":
                out.append("")
            for key in sorted(remaining):
                out.append(f"{key}: {remaining[key]}")
        return "\n".join(out).rstrip() + "\n"

    def _update_list_kv_text(self, original: str, values: dict[str, Any]) -> str:
        """Update or append list-style key/value lines while preserving unrelated content."""
        remaining = {k: self._fmt(v) for k, v in values.items()}
        out: list[str] = []
        for raw in original.splitlines():
            stripped = raw.strip()
            m = LIST_KV_RE.match(stripped)
            if m:
                key = m.group(1)
                if key in remaining:
                    out.append(f"- {key}: {remaining.pop(key)}")
                    continue
            out.append(raw)
        if remaining:
            if out and out[-1].strip() != "":
                out.append("")
            for key in sorted(remaining):
                out.append(f"- {key}: {remaining[key]}")
        return "\n".join(out).rstrip() + "\n"

    def _coerce(self, value: str) -> Any:
        """Coerce text scalars into bool, int, float, or leave them as strings."""
        v = value.strip()
        if v.lower() in BOOL_RE:
            return BOOL_RE[v.lower()]
        if v == "":
            return None
        try:
            if "." in v:
                return float(v)
            return int(v)
        except ValueError:
            return v

    def _fmt(self, value: Any) -> str:
        """Render one config scalar back into the text config file format."""
        if value is None:
            return ""
        if isinstance(value, bool):
            return "true" if value else "false"
        if isinstance(value, (dict, list)):
            return json.dumps(value, ensure_ascii=True)
        return str(value)
