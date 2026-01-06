from __future__ import annotations

from datetime import datetime
from typing import List

from app.schemas.reports import MetricPair, ReportResponse, ReportSection
from app.schemas.tasks import TaskDetail


class ReportService:
    def __init__(self, task_lookup):
        self._task_lookup = task_lookup

    def generate(self, task_id: str) -> ReportResponse:
        task: TaskDetail = self._task_lookup(task_id)
        metric_map = task.metrics or {}
        sections: List[ReportSection] = [
            ReportSection(
                title='定量指标',
                summary='',
                metrics=[
                    MetricPair(name=name.upper(), **values)
                    for name, values in metric_map.items()
                ],
            )
        ]
        recommendations = [
            '颜色恢复效果稳定，可用于后续分析任务',
            '如出现过增强，可在手动模式中降低锐化参数',
        ]
        return ReportResponse(
            task_id=task.id,
            generated_at=datetime.utcnow(),
            overview='图像修复评估报告',
            sections=sections,
            recommendations=recommendations,
        )
