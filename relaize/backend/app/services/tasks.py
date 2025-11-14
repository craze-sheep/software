from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Iterable, List
from uuid import uuid4

from fastapi import UploadFile
from redis import Redis

from app.schemas.tasks import TaskDetail, TaskStatus, TaskSummary, TaskUpdate


class TaskService:
    TASK_INDEX_KEY = "tasks:index"
    TASK_QUEUE_KEY = "tasks:queue"
    TASK_DATA_PREFIX = "tasks:data:"

    def __init__(self, upload_dir: Path, processed_dir: Path, redis_client: Redis):
        self.upload_dir = upload_dir
        self.processed_dir = processed_dir
        self.redis = redis_client

    def _task_key(self, task_id: str) -> str:
        return f"{self.TASK_DATA_PREFIX}{task_id}"

    def _save_task(self, task: TaskDetail) -> TaskDetail:
        pipeline = self.redis.pipeline()
        pipeline.set(self._task_key(task.id), task.model_dump_json())
        pipeline.zadd(self.TASK_INDEX_KEY, {task.id: task.created_at.timestamp()})
        pipeline.execute()
        return task

    def _deserialize(self, raw: str | None) -> TaskDetail:
        if not raw:
            raise KeyError("task not found")
        return TaskDetail.model_validate_json(raw)

    def create_from_upload(self, file: UploadFile) -> TaskDetail:
        task_id = str(uuid4())
        file_path = self.upload_dir / f"{task_id}_{file.filename}"
        file.file.seek(0)
        file_path.write_bytes(file.file.read())

        record = TaskDetail(
            id=task_id,
            filename=file.filename,
            size=file_path.stat().st_size,
            content_type=file.content_type,
            status=TaskStatus.pending,
            preview_url=None,
            source_url=f"/api/tasks/{task_id}/source",
        )
        self._save_task(record)
        self.redis.rpush(self.TASK_QUEUE_KEY, task_id)
        return record

    def list_tasks(
        self,
        status_filter: TaskStatus | None = None,
        offset: int = 0,
        limit: int = 50,
    ) -> List[TaskSummary]:
        end = offset + limit - 1
        task_ids = self.redis.zrevrange(self.TASK_INDEX_KEY, offset, end)
        if not task_ids:
            return []

        raw_tasks = self._mget_tasks(task_ids)
        summaries: List[TaskSummary] = []
        for raw in raw_tasks:
            if not raw:
                continue
            detail = TaskDetail.model_validate_json(raw)
            if status_filter and detail.status != status_filter:
                continue
            summaries.append(TaskSummary(**detail.model_dump()))
        return summaries

    def _mget_tasks(self, task_ids: Iterable[str]) -> List[str | None]:
        keys = [self._task_key(task_id) for task_id in task_ids]
        return self.redis.mget(keys)

    def get_task(self, task_id: str) -> TaskDetail:
        raw = self.redis.get(self._task_key(task_id))
        return self._deserialize(raw)

    def update_task(self, task_id: str, payload: TaskUpdate) -> TaskDetail:
        task = self.get_task(task_id)
        updated_data = task.model_dump()
        for field, value in payload.model_dump(exclude_none=True).items():
            updated_data[field] = value
        updated_data["updated_at"] = datetime.utcnow()
        updated_task = TaskDetail(**updated_data)
        self._save_task(updated_task)
        return updated_task

    def mark_completed(self, task_id: str, metrics: dict | None = None) -> TaskDetail:
        return self.update_task(
            task_id,
            TaskUpdate(
                status=TaskStatus.completed,
                metrics=metrics
                or {
                    "uiqm": {"before": 2.1, "after": 3.8, "delta": 1.7},
                    "uciqe": {"before": 0.45, "after": 0.62, "delta": 0.17},
                },
            ),
        )

    def fetch_next_pending(self) -> TaskDetail | None:
        task_id = self.redis.lpop(self.TASK_QUEUE_KEY)
        if not task_id:
            return None
        return self.get_task(task_id)

    def enqueue_task(self, task_id: str) -> TaskDetail:
        task = self.get_task(task_id)
        self.update_task(
            task.id,
            TaskUpdate(
                status=TaskStatus.pending,
                message="重新进入处理队列",
            ),
        )
        self.redis.rpush(self.TASK_QUEUE_KEY, task.id)
        return self.get_task(task_id)

    def cancel_task(self, task_id: str) -> TaskDetail:
        return self.update_task(
            task_id,
            TaskUpdate(status=TaskStatus.cancelled, message="任务被用户取消"),
        )
    def get_source_path(self, task: TaskDetail) -> Path:
        return self.upload_dir / f"{task.id}_{task.filename}"

    def get_processed_path(self, task: TaskDetail) -> Path:
        suffix = Path(task.filename).suffix or ".jpg"
        return self.processed_dir / f"{task.id}{suffix}"


def get_task_service(upload_dir: Path, processed_dir: Path, redis_client: Redis) -> TaskService:
    return TaskService(upload_dir, processed_dir, redis_client)
