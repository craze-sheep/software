from __future__ import annotations

import shutil
from datetime import datetime
from pathlib import Path
from typing import Iterable, List
from uuid import uuid4

from fastapi import UploadFile
from redis import Redis

from app.schemas.tasks import AdjustmentPayload, TaskDetail, TaskStatus, TaskSummary, TaskUpdate


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
                metrics=metrics,
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

    def apply_adjustments(self, task_id: str, payload: AdjustmentPayload) -> TaskDetail:
        original = self.get_task(task_id)
        source_path = self.get_source_path(original)
        if not source_path.exists():
            raise FileNotFoundError(f"源文件不存在，无法基于任务 {task_id} 创建新任务")

        adjustments = {
            "parameters": payload.parameters or {},
            "preset_id": payload.preset_id,
            "model_name": payload.model_name,
            "target_scale": payload.target_scale,
            "note": payload.note,
            "face_restore_enabled": payload.face_restore_enabled,
            "face_restore_provider": payload.face_restore_provider,
            "face_restore_fidelity": payload.face_restore_fidelity,
            "saved_at": datetime.utcnow().isoformat(),
        }

        new_task_id = str(uuid4())
        new_source_path = self.upload_dir / f"{new_task_id}_{original.filename}"
        shutil.copy2(source_path, new_source_path)

        new_task = TaskDetail(
            id=new_task_id,
            filename=original.filename,
            size=new_source_path.stat().st_size,
            content_type=original.content_type,
            status=TaskStatus.pending,
            source_url=f"/api/tasks/{new_task_id}/source",
            adjustments=adjustments,
            message=payload.note or "模型切换后新建任务",
        )
        self._save_task(new_task)
        self.redis.rpush(self.TASK_QUEUE_KEY, new_task_id)
        return new_task

    def cancel_task(self, task_id: str) -> TaskDetail:
        return self.update_task(
            task_id,
            TaskUpdate(status=TaskStatus.cancelled, message="任务被用户取消"),
        )

    def clear_all(self, delete_files: bool = True) -> int:
        task_ids = self.redis.zrevrange(self.TASK_INDEX_KEY, 0, -1)
        tasks: list[TaskDetail] = []
        if task_ids:
            raw_tasks = self._mget_tasks(task_ids)
            tasks = [self._deserialize(raw) for raw in raw_tasks if raw]

        if delete_files:
            for task in tasks:
                for path in (self.get_source_path(task), self.get_processed_path(task)):
                    try:
                        path.unlink(missing_ok=True)
                    except OSError:
                        continue

        pipeline = self.redis.pipeline()
        keys_to_delete = [self._task_key(task_id) for task_id in task_ids]
        if keys_to_delete:
            pipeline.delete(*keys_to_delete)
        pipeline.delete(self.TASK_INDEX_KEY, self.TASK_QUEUE_KEY)
        pipeline.execute()
        return len(tasks)
    def get_source_path(self, task: TaskDetail) -> Path:
        return self.upload_dir / f"{task.id}_{task.filename}"

    def get_processed_path(self, task: TaskDetail) -> Path:
        # Always store processed output as PNG to avoid lossy compression.
        return self.processed_dir / f"{task.id}.png"


def get_task_service(upload_dir: Path, processed_dir: Path, redis_client: Redis) -> TaskService:
    return TaskService(upload_dir, processed_dir, redis_client)
