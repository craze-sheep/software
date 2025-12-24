from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Mapping, MutableMapping, Optional

import cv2
import numpy as np
import torch
from loguru import logger

from app.core.config import get_settings
from app.services.face_restoration import FaceRestorationUnavailable, restore_faces
from app.services.final2x_engine import get_final2x_engine, resolve_model_for_adjustments


def _compute_metrics(image: np.ndarray) -> Dict[str, float]:
    gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
    brightness = gray.mean() / 255.0
    contrast = gray.std() / 64.0
    saturation = np.mean(cv2.cvtColor(image, cv2.COLOR_RGB2HSV)[..., 1]) / 255.0
    lap_var = cv2.Laplacian(gray, cv2.CV_64F).var()

    hist = cv2.calcHist([gray], [0], None, [256], [0, 256]).ravel()
    hist = hist / (hist.sum() + 1e-9)
    non_zero = hist[hist > 0]
    entropy = float(-np.sum(non_zero * np.log2(non_zero)))

    uiqm = 2.0 + brightness * 2.5 + saturation * 1.5
    uciqe = 0.4 + contrast * 0.4 + saturation * 0.2
    clarity = min(100.0, lap_var / 5.0)

    return {
        "uiqm": round(uiqm, 2),
        "uciqe": round(uciqe, 2),
        "entropy": round(entropy, 2),
        "clarity": round(clarity, 2),
    }


def _format_metrics(before: Dict[str, float], after: Dict[str, float]) -> Dict[str, Dict[str, float]]:
    combined: Dict[str, Dict[str, float]] = {}
    for key in after.keys():
        b = before[key]
        a = after[key]
        combined[key] = {
            "before": round(b, 2),
            "after": round(a, 2),
            "delta": round(a - b, 2),
        }
    return combined


def _extract_target_scale(params: Mapping[str, Any]) -> float | None:
    for key in ("targetScale", "scale", "upscale"):
        value = params.get(key)
        if value is not None:
            try:
                parsed = float(value)
                if parsed > 0:
                    return parsed
            except (TypeError, ValueError):
                continue
    return None


def enhance_image(
    source: Path,
    destination: Path,
    adjustments: Optional[Mapping[str, MutableMapping]] = None,
) -> Dict[str, Dict[str, float]]:
    original_bgr = cv2.imread(str(source))
    if original_bgr is None:
        raise ValueError(f"Unable to read image {source}")

    original_rgb = cv2.cvtColor(original_bgr, cv2.COLOR_BGR2RGB)
    params: Mapping[str, Any] = (adjustments or {}).get("parameters", {}) if adjustments else {}

    settings = get_settings()
    face_restore_enabled = None
    face_restore_provider = None
    face_restore_fidelity = None
    if isinstance(adjustments, Mapping):
        face_restore_enabled = adjustments.get("face_restore_enabled")
        face_restore_provider = adjustments.get("face_restore_provider")
        face_restore_fidelity = adjustments.get("face_restore_fidelity")
    base_bgr = original_bgr
    if settings.final2x_enabled:
        model_override = resolve_model_for_adjustments(adjustments or {})
        scale_override = _extract_target_scale(params)
        sr_engine = get_final2x_engine(model_override)
        try:
            base_bgr = sr_engine.process(original_bgr, target_scale=scale_override)
        except (torch.cuda.OutOfMemoryError, RuntimeError) as exc:  # pragma: no cover - hardware dependent
            message = str(exc).lower()
            if "out of memory" in message:
                logger.warning(
                    "Final2x OOM on %s, skipping super-resolution: %s",
                    source,
                    exc,
                )
                base_bgr = original_bgr
                torch.cuda.empty_cache()
            else:
                raise

    super_res_rgb = cv2.cvtColor(base_bgr, cv2.COLOR_BGR2RGB)
    result_rgb = super_res_rgb

    do_face_restore = (
        face_restore_enabled if face_restore_enabled is not None else settings.face_restore_enabled
    )
    if do_face_restore:
        try:
            result_rgb = restore_faces(
                super_res_rgb,
                provider=face_restore_provider or settings.face_restore_provider,
                model_path=settings.face_restore_model_path,
                device=settings.face_restore_device,
                fidelity=face_restore_fidelity
                if face_restore_fidelity is not None
                else settings.face_restore_codeformer_fidelity,
            )
        except FaceRestorationUnavailable as exc:
            logger.warning("人脸修复未启用（依赖缺失）：{}", exc)
        except Exception as exc:  # pragma: no cover - best effort
            logger.exception("人脸修复阶段失败，回退超分结果: %s", exc)

    destination.parent.mkdir(parents=True, exist_ok=True)
    # Save as PNG to avoid any lossy compression on output.
    cv2.imwrite(str(destination), cv2.cvtColor(result_rgb, cv2.COLOR_RGB2BGR), [int(cv2.IMWRITE_PNG_COMPRESSION), 3])

    before_metrics = _compute_metrics(original_rgb)
    after_metrics = _compute_metrics(result_rgb)
    return _format_metrics(before_metrics, after_metrics)
