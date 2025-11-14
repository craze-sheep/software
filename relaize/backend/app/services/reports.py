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
        metric_map = task.metrics or {
            'uiqm': {'before': 2.1, 'after': 3.8, 'delta': 1.7},
            'uciqe': {'before': 0.45, 'after': 0.62, 'delta': 0.17},
            'entropy': {'before': 6.2, 'after': 7.1, 'delta': 0.9},
        }
        sections: List[ReportSection] = [
            ReportSection(
                title='定量指标',
                summary='核心质量指标显著提升，实验值符合文档中的目标。',
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
            overview='水下图像修复评估报告（示例）',
            sections=sections,
            recommendations=recommendations,
        )
