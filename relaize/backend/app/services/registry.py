from __future__ import annotations

from redis import Redis

from app.services.reports import ReportService
from app.services.tasks import TaskService

redis_client: Redis | None = None
task_service: TaskService | None = None
report_service: ReportService | None = None
