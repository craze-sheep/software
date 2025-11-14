from __future__ import annotations

from fastapi import Depends, HTTPException, status

from app.core.config import get_settings
from app.services import registry
from app.services.tasks import TaskService
from app.services.reports import ReportService


def get_task_service() -> TaskService:
    if not registry.task_service:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Task service is not ready",
        )
    return registry.task_service


def get_report_service(
    task_service: TaskService = Depends(get_task_service),
) -> ReportService:
    if not registry.report_service:
        # lazily attach report service if not yet created
        registry.report_service = ReportService(task_service.get_task)
    return registry.report_service


def get_settings_dep():
    return get_settings()
