from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from app.models import EventRecord
from app.services.file_store import append_ndjson, read_ndjson
from app.services.webhook_service import WebhookService


class EventBus:
    def __init__(self, event_store_path, webhook_service: WebhookService) -> None:
        self.event_store_path = event_store_path
        self.webhook_service = webhook_service

    def emit(self, *, event_type: str, actor: str, resource: str, payload: dict, trace_id: str, plugin_id: str | None = None) -> EventRecord:
        evt = EventRecord(
            event_id=f"evt_{uuid4().hex}",
            event_type=event_type,
            occurred_at=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            actor=actor,
            resource=resource,
            payload=payload,
            trace_id=trace_id,
            plugin_id=plugin_id,
        )
        append_ndjson(self.event_store_path, evt.model_dump())
        self.webhook_service.deliver(evt)
        return evt

    def list_events(self, limit: int = 200, event_type: str | None = None) -> list[EventRecord]:
        rows = read_ndjson(self.event_store_path)
        if event_type:
            rows = [r for r in rows if r.get("event_type") == event_type]
        rows = rows[-limit:]
        return [EventRecord.model_validate(r) for r in rows]
