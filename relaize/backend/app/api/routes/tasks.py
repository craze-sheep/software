from __future__ import annotations

from datetime import datetime
from pathlib import Path as FilePath
import traceback

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from fastapi.responses import FileResponse

from app.api.dependencies import get_task_service
from app.schemas.tasks import (
    AdjustmentPayload,
    TaskDetail,
    TaskPreviewResponse,
    TaskStatus,
    TaskSummary,
    TaskUpdate,
)
from app.services.tasks import TaskService
from app.services.processor import generate_preview_image

router = APIRouter(tags=["Tasks"])
PREVIEW_ERROR_LOG = FilePath(__file__).resolve().parents[3] / "preview-errors.log"


@router.get("", response_model=list[TaskSummary])
def list_tasks(
    status: TaskStatus | None = Query(default=None, description="按状态筛选"),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    task_service: TaskService = Depends(get_task_service),
) -> list[TaskSummary]:
    return task_service.list_tasks(status_filter=status, offset=offset, limit=limit)


@router.get("/{task_id}", response_model=TaskDetail)
def get_task(
    task_id: str = Path(..., description="Task identifier"),
    task_service: TaskService = Depends(get_task_service),
) -> TaskDetail:
    try:
        return task_service.get_task(task_id)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found") from exc


@router.patch("/{task_id}", response_model=TaskDetail)
def update_task(
    payload: TaskUpdate,
    task_id: str = Path(...),
    task_service: TaskService = Depends(get_task_service),
) -> TaskDetail:
    try:
        return task_service.update_task(task_id, payload)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found") from exc


@router.get("/{task_id}/preview")
def get_task_preview(
    task_id: str,
    task_service: TaskService = Depends(get_task_service),
) -> FileResponse:
    try:
        task = task_service.get_task(task_id)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found") from exc

    output_path = task_service.get_processed_path(task)
    if not output_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Preview not available yet")
    return FileResponse(output_path)


@router.get("/{task_id}/source")
def get_task_source(
    task_id: str,
    task_service: TaskService = Depends(get_task_service),
) -> FileResponse:
    try:
        task = task_service.get_task(task_id)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found") from exc

    source_path = task_service.get_source_path(task)
    if not source_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source not found")
    return FileResponse(source_path)


@router.post("/{task_id}/process", response_model=TaskDetail)
def reprocess_task(
    task_id: str,
    task_service: TaskService = Depends(get_task_service),
) -> TaskDetail:
    try:
        return task_service.enqueue_task(task_id)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found") from exc


@router.post("/{task_id}/adjust", response_model=TaskDetail)
def adjust_task(
    payload: AdjustmentPayload,
    task_id: str,
    task_service: TaskService = Depends(get_task_service),
) -> TaskDetail:
    try:
        return task_service.apply_adjustments(task_id, payload)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found") from exc


@router.post("/{task_id}/cancel", response_model=TaskDetail)
def cancel_task(
    task_id: str,
    task_service: TaskService = Depends(get_task_service),
) -> TaskDetail:
    try:
        return task_service.cancel_task(task_id)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found") from exc


@router.post("/{task_id}/preview-adjust", response_model=TaskPreviewResponse)
def preview_adjustments(
    payload: AdjustmentPayload | None,
    task_id: str,
    task_service: TaskService = Depends(get_task_service),
) -> TaskPreviewResponse:
    try:
        task = task_service.get_task(task_id)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found") from exc

    parameters = (
        (payload.parameters if payload else None)
        or (task.adjustments.get("parameters") if task.adjustments else None)
        or {}
    )
    preset_id = (
        (payload.preset_id if payload else None)
        or (task.adjustments.get("preset_id") if task.adjustments else None)
    )
    model_name = (
        (payload.model_name if payload else None)
        or (task.adjustments.get("model_name") if task.adjustments else None)
    )
    target_scale = (
        (payload.target_scale if payload else None)
        or (task.adjustments.get("target_scale") if task.adjustments else None)
    )

    adjustments = {
        "parameters": parameters,
        "preset_id": preset_id,
        "model_name": model_name,
        "target_scale": target_scale,
    }

    try:
        preview = generate_preview_image(task_service.get_source_path(task), adjustments)
    except Exception as exc:  # pragma: no cover - diagnostic guard
        with PREVIEW_ERROR_LOG.open("a", encoding="utf-8") as log:
            log.write(
                f"[{datetime.now().isoformat()}] preview-adjust failed for task {task_id}: {exc}\n"
            )
            traceback.print_exc(file=log)
            log.write("\n")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="预览生成失败") from exc
    return TaskPreviewResponse(**preview)
