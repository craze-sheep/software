from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Dict, Mapping

import numpy as np
from loguru import logger

from app.models.catalog import PipelineSpec, PipelineStageSpec, get_model_spec, get_pipeline_spec
from app.services.model_wrappers import StageNotConfiguredError, run_model_stage

DEFAULT_PIPELINE_ID = "superres_basic"


@dataclass
class PipelineRunResult:
    image_rgb: np.ndarray
    summary: Dict[str, Any]


def _resolve_pipeline(pipeline_id: str | None) -> PipelineSpec:
    if pipeline_id:
        spec = get_pipeline_spec(pipeline_id)
        if spec:
            return spec
        logger.warning("未知的管线 ID %s，回退到默认管线", pipeline_id)
    fallback = get_pipeline_spec(DEFAULT_PIPELINE_ID)
    if not fallback:  # pragma: no cover - catalog misconfiguration
        raise RuntimeError("Pipeline catalog 未注册默认管线 superres_basic")
    return fallback


def _build_stage_summary(
    stage: PipelineStageSpec,
    model_id: str,
    status: str,
    duration_ms: float,
    message: str | None = None,
) -> Dict[str, Any]:
    model_spec = get_model_spec(model_id)
    return {
        "stage_id": stage.id,
        "stage_name": stage.name,
        "model_id": model_id,
        "model_label": model_spec.name if model_spec else model_id,
        "status": status,
        "duration_ms": round(duration_ms, 2),
        "message": message,
    }


def run_pipeline(
    image_rgb: np.ndarray,
    adjustments: Mapping[str, Any] | None = None,
) -> PipelineRunResult:
    adjustments = adjustments or {}
    pipeline_id = adjustments.get("pipeline_id")
    pipeline = _resolve_pipeline(pipeline_id)
    stage_overrides: Mapping[str, str] = adjustments.get("pipeline_stage_overrides") or {}
    fallback_model = adjustments.get("model_name")
    context = {
        "target_scale": adjustments.get("target_scale"),
        "prompt": adjustments.get("prompt"),
        "negative_prompt": adjustments.get("negative_prompt"),
        "mask_data": adjustments.get("mask_data"),
    }
    executed_stages: list[Dict[str, Any]] = []
    current_image = image_rgb

    for stage in pipeline.stages:
        stage_spec_model = get_model_spec(stage.model_id)
        model_id = stage_overrides.get(stage.id)
        if not model_id and fallback_model and stage_spec_model and stage_spec_model.kind == "superres":
            fallback_spec = get_model_spec(fallback_model)
            if fallback_spec and fallback_spec.kind == "superres":
                model_id = fallback_model
        if not model_id:
            model_id = stage.model_id
        stage_params: Dict[str, Any] = dict(stage.defaults or {})
        start_time = time.perf_counter()
        try:
            current_image = run_model_stage(model_id, current_image, stage_params, context)
            duration = (time.perf_counter() - start_time) * 1000
            executed_stages.append(_build_stage_summary(stage, model_id, "executed", duration))
        except StageNotConfiguredError as exc:
            duration = (time.perf_counter() - start_time) * 1000
            executed_stages.append(_build_stage_summary(stage, model_id, "skipped", duration, str(exc)))
            logger.warning("Stage %s 跳过：%s", stage.id, exc)
            if not stage.optional:
                raise
        except Exception as exc:
            duration = (time.perf_counter() - start_time) * 1000
            executed_stages.append(_build_stage_summary(stage, model_id, "error", duration, str(exc)))
            logger.exception("Stage %s 执行失败", stage.id)
            raise

    summary = {
        "pipeline_id": pipeline.id,
        "pipeline_name": pipeline.name,
        "stages": executed_stages,
    }
    return PipelineRunResult(image_rgb=current_image, summary=summary)
