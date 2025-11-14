from __future__ import annotations

from datetime import datetime
from typing import Dict, List, Optional

from pydantic import BaseModel


class MetricPair(BaseModel):
    name: str
    before: float | int
    after: float | int
    delta: float | int


class ReportSection(BaseModel):
    title: str
    summary: str
    metrics: List[MetricPair]


class ReportResponse(BaseModel):
    task_id: str
    generated_at: datetime
    overview: str
    sections: List[ReportSection]
    recommendations: List[str]


class ReportListResponse(BaseModel):
    items: List[ReportResponse]
    total: int

