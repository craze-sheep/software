from __future__ import annotations

"""
One-time migration: copy task records from Redis storage to MySQL.

Usage:
    python -m app.scripts.migrate_redis_to_mysql

Prerequisites:
    - .env 配置好 DATABASE_URL / REDIS_URL
    - MySQL 库已存在（脚本会自动建表）
"""

from datetime import datetime

from app.core.config import get_settings
from app.db import Base, SessionLocal, engine
from app.models.task import TaskRecord
from app.schemas.tasks import TaskDetail, TaskStatus
from app.services.redis_client import get_redis_client


REDIS_TASK_INDEX = "tasks:index"
REDIS_TASK_DATA_PREFIX = "tasks:data:"


def main() -> None:
    settings = get_settings()
    Base.metadata.create_all(bind=engine)
    redis_client = get_redis_client()

    task_ids = redis_client.zrevrange(REDIS_TASK_INDEX, 0, -1)
    if not task_ids:
        print("No tasks found in Redis, nothing to migrate.")
        return

    migrated = 0
    skipped = 0

    with SessionLocal() as session:
        for task_id in task_ids:
            raw = redis_client.get(f"{REDIS_TASK_DATA_PREFIX}{task_id}")
            if not raw:
                continue
            task = TaskDetail.parse_raw(raw)
            existing = session.get(TaskRecord, task.id)
            if existing:
                skipped += 1
                continue

            record = TaskRecord(
                id=task.id,
                filename=task.filename,
                size=task.size,
                content_type=task.content_type,
                status=task.status or TaskStatus.pending,
                created_at=task.created_at or datetime.utcnow(),
                updated_at=task.updated_at or datetime.utcnow(),
                processed_at=task.processed_at,
                preview_url=task.preview_url,
                source_url=task.source_url,
                metrics=task.metrics,
                adjustments=task.adjustments,
                message=task.message,
            )
            session.add(record)
            migrated += 1

        session.commit()

    print(
        f"Migration finished. Migrated: {migrated}, skipped(existing): {skipped}, total seen: {len(task_ids)}"
    )
    if migrated:
        print("Reminder: Redis 仍用于队列 (tasks:queue)，但任务状态已写入 MySQL。")


if __name__ == "__main__":
    main()
