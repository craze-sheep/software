from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class TaskStatus(str, Enum):
    pending = 'pending'
    processing = 'processing'
    completed = 'completed'
    failed = 'failed'
    cancelled = 'cancelled'


class TaskBase(BaseModel):
    id: str
    filename: str
    size: Optional[int] = None
    content_type: Optional[str] = None
    status: TaskStatus = TaskStatus.pending
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class TaskSummary(TaskBase):
    source_url: Optional[str] = None
    processed_at: Optional[datetime] = None
    metrics: Optional[dict] = None
    adjustments: Optional[dict] = None


class TaskDetail(TaskSummary):
    message: Optional[str] = None


class TaskCreate(BaseModel):
    filename: str
    size: Optional[int]
    content_type: Optional[str]


class TaskUpdate(BaseModel):
    status: Optional[TaskStatus] = None
    metrics: Optional[dict] = None
    message: Optional[str] = None
    processed_at: Optional[datetime] = None
    adjustments: Optional[dict] = None


class AdjustmentPayload(BaseModel):
    model_config = {"protected_namespaces": ()}

    parameters: dict = Field(default_factory=dict)
    preset_id: Optional[str] = None
    note: Optional[str] = None
    model_name: Optional[str] = None
    target_scale: Optional[float] = Field(default=None, ge=0.1, le=8.0)
    face_restore_enabled: Optional[bool] = None
    face_restore_provider: Optional[str] = None
    face_restore_fidelity: Optional[float] = Field(default=None, ge=0.0, le=1.0)
