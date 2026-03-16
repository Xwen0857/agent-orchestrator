"""Webhook subscription storage and delivery for backend events.

This module persists subscriptions, signs outbound requests, and writes deadletter
records when delivery retries are exhausted.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import urllib.request
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from app.models import CreateWebhookSubscriptionRequest, EventRecord, WebhookSubscription
from app.services.file_store import append_ndjson, read_json, write_json_atomic


class WebhookService:
    """Create/list subscriptions and deliver events with signed HTTP POST retries."""

    def __init__(self, store_path, deadletter_path) -> None:
        self.store_path = store_path
        self.deadletter_path = deadletter_path

    def _load(self) -> dict[str, Any]:
        """Load the subscription store with a stable empty default."""
        return read_json(self.store_path, default={"subscriptions": []})

    def list(self) -> list[WebhookSubscription]:
        """Return all webhook subscriptions as validated models."""
        data = self._load()
        return [WebhookSubscription.model_validate(x) for x in data.get("subscriptions", [])]

    def create(self, req: CreateWebhookSubscriptionRequest) -> WebhookSubscription:
        """Persist a new webhook subscription and return the non-secret response model."""
        data = self._load()
        now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        item = {
            "id": str(uuid4()),
            "name": req.name,
            "targetUrl": req.targetUrl,
            "secret": req.secret,
            "eventTypes": req.eventTypes,
            "enabled": req.enabled,
            "maxRetries": req.maxRetries,
            "createdAt": now,
            "updatedAt": now,
        }
        data["subscriptions"].append(item)
        write_json_atomic(self.store_path, data)
        clean = {k: v for k, v in item.items() if k != "secret"}
        return WebhookSubscription.model_validate(clean)

    def deliver(self, event: EventRecord) -> None:
        """Deliver one event to all enabled subscriptions that match the event-type filter."""
        data = self._load()
        for sub in data.get("subscriptions", []):
            if not sub.get("enabled", True):
                continue
            types = sub.get("eventTypes", [])
            if types and event.event_type not in types:
                continue
            self._send_with_retry(sub, event)

    def _send_with_retry(self, sub: dict[str, Any], event: EventRecord) -> None:
        """Send one event with retries, then deadletter it if all attempts fail."""
        payload = event.model_dump()
        body = json.dumps(payload).encode("utf-8")
        secret = sub.get("secret", "")
        signature = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
        max_retries = max(0, int(sub.get("maxRetries", 3)))
        for attempt in range(max_retries + 1):
            req = urllib.request.Request(
                sub["targetUrl"],
                data=body,
                method="POST",
                headers={
                    "Content-Type": "application/json",
                    "X-Orchestrator-Signature": f"sha256={signature}",
                    "X-Orchestrator-Event-Id": event.event_id,
                    "Idempotency-Key": event.event_id,
                },
            )
            try:
                with urllib.request.urlopen(req, timeout=5) as resp:
                    if 200 <= resp.status < 300:
                        return
            except Exception as exc:
                if attempt >= max_retries:
                    # Deadletter preserves the final delivery error and the dropped event payload
                    # so operators can inspect what failed.
                    append_ndjson(
                        self.deadletter_path,
                        {
                            "failed_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                            "subscription_id": sub.get("id"),
                            "event": payload,
                            "error": str(exc),
                            "attempts": attempt + 1,
                        },
                    )
