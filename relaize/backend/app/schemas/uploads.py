from __future__ import annotations

from pydantic import BaseModel


class UploadResponse(BaseModel):
    task_id: str
    filename: str
    message: str = 'upload accepted'

