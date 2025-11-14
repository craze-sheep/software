from __future__ import annotations

import logging
import threading
import time
from datetime import datetime
from pathlib import Path

from redis import Redis

from app.schemas.tasks import TaskStatus, TaskUpdate
from app.services.processor import enhance_image
from app.services.tasks import TaskService

logger = logging.getLogger(__name__)


class TaskWorker(threading.Thread):
    def __init__(self, task_service: TaskService, redis_client: Redis, upload_dir: Path, processed_dir: Path):
        super().__init__(daemon=True, name="task-worker")
        self.task_service = task_service
        self.redis = redis_client
        self.upload_dir = upload_dir
        self.processed_dir = processed_dir
        self._stop_event = threading.Event()

    def stop(self) -> None:
        self._stop_event.set()
        self.redis.lpush(self.task_service.TASK_QUEUE_KEY, "__shutdown__")

    def run(self) -> None:
        logger.info("Task worker started")
        while not self._stop_event.is_set():
            try:
                job = self.redis.blpop(self.task_service.TASK_QUEUE_KEY, timeout=5)
                if not job:
                    continue
                _, task_id = job
                if task_id == "__shutdown__":
                    break
                self._process_task(task_id)
            except Exception as exc:
                logger.exception("Task worker error: %s", exc)
                time.sleep(1)
        logger.info("Task worker stopped")

    def _process_task(self, task_id: str) -> None:
        try:
            task = self.task_service.get_task(task_id)
        except KeyError:
            logger.warning("Task %s not found in storage", task_id)
            return

        logger.info("Processing task %s (%s)", task.id, task.filename)
        source_path = self.task_service.get_source_path(task)
        output_path = self.task_service.get_processed_path(task)

        self.task_service.update_task(task.id, TaskUpdate(status=TaskStatus.processing))

        try:
            metrics = enhance_image(source_path, output_path)
            self.task_service.update_task(
                task.id,
                TaskUpdate(
                    status=TaskStatus.completed,
                    metrics=metrics,
                    preview_url=f"/api/tasks/{task.id}/preview",
                    processed_at=datetime.utcnow(),
                    message="处理完成",
                ),
            )
            logger.info("Task %s completed", task.id)
        except Exception as exc:
            logger.exception("Task %s failed: %s", task.id, exc)
            self.task_service.update_task(
                task.id,
                TaskUpdate(status=TaskStatus.failed, message=str(exc)),
            )
