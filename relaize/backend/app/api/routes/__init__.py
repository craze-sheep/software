from fastapi import APIRouter

from . import health, uploads, tasks, reports

api_router = APIRouter()
api_router.include_router(health.router, prefix="/health")
api_router.include_router(uploads.router, prefix="/uploads")
api_router.include_router(tasks.router, prefix="/tasks")
api_router.include_router(reports.router, prefix="/reports")
