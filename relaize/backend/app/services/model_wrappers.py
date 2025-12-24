from __future__ import annotations

import base64
from functools import lru_cache
from pathlib import Path
from typing import Any, Mapping

import cv2
import numpy as np

from app.core.config import get_settings
from app.models.catalog import ModelSpec, get_model_spec
from app.services.final2x_engine import get_final2x_engine


class StageNotConfiguredError(RuntimeError):
    """Raised when a pipeline stage cannot locate its模型或依赖."""


def _ensure_data_url_image(data_url: str, *, grayscale: bool = False) -> np.ndarray:
    if not data_url or not data_url.startswith("data:"):
        raise StageNotConfiguredError("掩膜数据必须是 data URL（data:image/png;base64,...）格式")
    try:
        _, payload = data_url.split(",", 1)
    except ValueError as exc:
        raise StageNotConfiguredError("掩膜 data URL 格式无效") from exc
    binary = base64.b64decode(payload)
    flag = cv2.IMREAD_GRAYSCALE if grayscale else cv2.IMREAD_UNCHANGED
    decoded = cv2.imdecode(np.frombuffer(binary, np.uint8), flag)
    if decoded is None:
        raise StageNotConfiguredError("无法解析掩膜图像，请确认为 PNG/JPEG")
    if grayscale and decoded.ndim == 3:
        decoded = cv2.cvtColor(decoded, cv2.COLOR_BGR2GRAY)
    return decoded


def _resolve_device(preferred: str | None = None) -> str:
    import torch

    if preferred and preferred.lower() != "auto":
        return preferred
    return "cuda" if torch.cuda.is_available() else "cpu"


def _run_final2x_superres(image_rgb: np.ndarray, model_id: str, stage_params: Mapping[str, Any], context: Mapping[str, Any]) -> np.ndarray:
    settings = get_settings()
    if not settings.final2x_enabled:
        raise StageNotConfiguredError("Final2x 已被禁用，无法执行超分阶段")
    target_scale = context.get("target_scale") or stage_params.get("scale")
    engine = get_final2x_engine(model_id)
    image_bgr = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2BGR)
    result_bgr = engine.process(image_bgr, target_scale=target_scale)
    return cv2.cvtColor(result_bgr, cv2.COLOR_BGR2RGB)


def run_model_stage(
    model_id: str,
    image_rgb: np.ndarray,
    stage_params: Mapping[str, Any],
    context: Mapping[str, Any],
) -> np.ndarray:
    spec: ModelSpec | None = get_model_spec(model_id)
    if spec and spec.kind == "superres":
        return _run_final2x_superres(image_rgb, model_id, stage_params, context)

    raise StageNotConfiguredError(f"模型 {model_id} 未接入执行器（当前仅支持 Final2x 超分模型）")
