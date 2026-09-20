"""Pydantic request/response models."""
from datetime import datetime
from pydantic import BaseModel


class EngagementCreate(BaseModel):
    name: str
    kind: str = "pentest"
    scope_notes: str = ""


class EngagementOut(BaseModel):
    id: int
    name: str
    kind: str
    scope_notes: str
    created_at: datetime

    class Config:
        from_attributes = True


class ScopeUpdate(BaseModel):
    scope_notes: str


class TargetCreate(BaseModel):
    value: str
    notes: str = ""


class TargetOut(BaseModel):
    id: int
    engagement_id: int
    value: str
    notes: str
    created_at: datetime

    class Config:
        from_attributes = True


class FindingCreate(BaseModel):
    title: str
    severity: str = "info"
    status: str = "open"
    description: str = ""
    evidence: str = ""
    remediation: str = ""


class FindingUpdate(BaseModel):
    title: str | None = None
    severity: str | None = None
    status: str | None = None
    description: str | None = None
    evidence: str | None = None
    remediation: str | None = None


class FindingOut(BaseModel):
    id: int
    engagement_id: int
    title: str
    severity: str
    status: str
    description: str
    evidence: str
    remediation: str
    created_at: datetime

    class Config:
        from_attributes = True


class ToolRunCreate(BaseModel):
    tool: str
    args: str = ""


class ToolRunOut(BaseModel):
    id: int
    target_id: int
    tool: str
    args: str
    output: str
    exit_code: int
    started_at: datetime
    finished_at: datetime | None

    class Config:
        from_attributes = True


class ChatRequest(BaseModel):
    message: str
    engagement_id: int | None = None
    history_limit: int = 20


class ChatResponse(BaseModel):
    reply: str
    context: dict | None = None
