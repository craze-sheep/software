from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import api_router
from app.core.config import get_settings
from app.services import registry
from app.services.redis_client import get_redis_client
from app.services.reports import ReportService
from app.services.tasks import TaskService
from app.workers.processor import TaskWorker


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    redis_client = get_redis_client()
    registry.redis_client = redis_client
    registry.task_service = TaskService(settings.upload_dir, settings.processed_dir, redis_client)
    registry.report_service = ReportService(registry.task_service.get_task)
    worker = TaskWorker(registry.task_service, redis_client, settings.upload_dir, settings.processed_dir)
    worker.start()
    try:
        yield
    finally:
        worker.stop()
        registry.redis_client = None
        registry.task_service = None
        registry.report_service = None
        redis_client.close()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[str(origin) for origin in settings.allowed_origins],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(api_router, prefix=settings.api_prefix)
    return app


app = create_app()
