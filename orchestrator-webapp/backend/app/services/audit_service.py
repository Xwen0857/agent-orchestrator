from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from app.services.file_store import append_ndjson


class AuditService:
    def __init__(self, audit_path) -> None:
        self.audit_path = audit_path

    def record(self, *, actor: str, action: str, resource: str, status: str, details: dict[str, Any], trace_id: str) -> None:
        append_ndjson(
            self.audit_path,
            {
                "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "actor": actor,
                "action": action,
                "resource": resource,
                "status": status,
                "details": details,
                "trace_id": trace_id,
            },
        )
