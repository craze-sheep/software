from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from fastapi.responses import FileResponse

from app.api.dependencies import get_task_service
from app.schemas.tasks import TaskDetail, TaskStatus, TaskSummary, TaskUpdate
from app.services.tasks import TaskService

router = APIRouter(tags=["Tasks"])


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


@router.post("/{task_id}/cancel", response_model=TaskDetail)
def cancel_task(
    task_id: str,
    task_service: TaskService = Depends(get_task_service),
) -> TaskDetail:
    try:
        return task_service.cancel_task(task_id)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found") from exc
