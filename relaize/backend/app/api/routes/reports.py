from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Path, status

from app.api.dependencies import get_report_service
from app.schemas.reports import ReportResponse
from app.services.reports import ReportService

router = APIRouter(tags=["Reports"])


@router.get("/{task_id}", response_model=ReportResponse)
def get_report(
    task_id: str = Path(..., description="Task identifier"),
    report_service: ReportService = Depends(get_report_service),
) -> ReportResponse:
    try:
        return report_service.generate(task_id)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found") from exc
