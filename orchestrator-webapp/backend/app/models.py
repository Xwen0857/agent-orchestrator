from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


CORE_API_VERSION = "1.0.0"
PLUGIN_API_VERSION = "1.0.0"


class Role(str, Enum):
    viewer = "Viewer"
    operator = "Operator"
    approver = "Approver"


class UserContext(BaseModel):
    user_id: str
    email: str
    role: Role


class OverviewResponse(BaseModel):
    coreApiVersion: str = CORE_API_VERSION
    dashboard: dict[str, Any]
    systemHealth: dict[str, Any]


class CurrentConfigResponse(BaseModel):
    plannerCurrent: dict[str, Any]
    plannerProperties: dict[str, Any]
    auditPolicy: dict[str, Any]


class ValidationIssue(BaseModel):
    source: str
    key: str
    level: str
    message: str


class ValidateDraftRequest(BaseModel):
    draft: CurrentConfigResponse
    reason: str = Field(min_length=3)


class ValidateDraftResponse(BaseModel):
    valid: bool
    requiresApproval: bool
    riskLevel: str
    issues: list[ValidationIssue]
    changedKeys: dict[str, list[str]]


class CommitDraftRequest(BaseModel):
    draft: CurrentConfigResponse
    reason: str = Field(min_length=3)
    approvalId: str | None = None


class CommitDraftResponse(BaseModel):
    committed: bool
    snapshotVersion: str
    traceId: str


class RollbackRequest(BaseModel):
    targetVersionId: str = Field(min_length=3)
    reason: str = Field(min_length=3)


class PluginManifest(BaseModel):
    id: str
    name: str
    version: str
    apiVersion: str
    capabilities: list[str]
    permissions: list[str]
    entrypoints: dict[str, str]


class RegisteredPlugin(BaseModel):
    id: str
    manifestPath: str
    enabled: bool
    installedAt: str
    disabledReason: str | None = None


class RegisterPluginRequest(BaseModel):
    manifestPath: str


class EventRecord(BaseModel):
    event_id: str
    event_type: str
    occurred_at: str
    actor: str
    resource: str
    payload: dict[str, Any]
    trace_id: str
    plugin_id: str | None = None


class CreateWebhookSubscriptionRequest(BaseModel):
    name: str
    targetUrl: str
    secret: str
    eventTypes: list[str] = Field(default_factory=list)
    enabled: bool = True
    maxRetries: int = 3


class WebhookSubscription(BaseModel):
    id: str
    name: str
    targetUrl: str
    eventTypes: list[str]
    enabled: bool
    maxRetries: int
    createdAt: str
    updatedAt: str
