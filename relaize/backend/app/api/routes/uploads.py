from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status

from app.api.dependencies import get_task_service
from app.schemas.uploads import UploadResponse
from app.services.tasks import TaskService

router = APIRouter(tags=["Uploads"])


@router.post("", response_model=UploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_file(
    file: UploadFile = File(...),
    task_service: TaskService = Depends(get_task_service),
) -> UploadResponse:
    if not file.filename:
        raise HTTPException(status_code=400, detail="Filename is required")
    task = task_service.create_from_upload(file)
    return UploadResponse(task_id=task.id, filename=task.filename)
