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


def _compute_psnr(before: np.ndarray, after: np.ndarray) -> float:
    mse = np.mean((before.astype(np.float64) - after.astype(np.float64)) ** 2)
    if mse == 0:
        # Identical images; cap to a large finite value to keep JSON serialization valid.
        return 100.0
    PIXEL_MAX = 255.0
    return 20 * np.log10(PIXEL_MAX / np.sqrt(mse))


def _compute_ssim(before: np.ndarray, after: np.ndarray) -> float:
    """Simple SSIM over the luminance channel (single-window approximation)."""
    gray1 = cv2.cvtColor(before, cv2.COLOR_RGB2GRAY).astype(np.float64)
    gray2 = cv2.cvtColor(after, cv2.COLOR_RGB2GRAY).astype(np.float64)
    C1 = (0.01 * 255) ** 2
    C2 = (0.03 * 255) ** 2

    mu1 = gray1.mean()
    mu2 = gray2.mean()
    sigma1_sq = ((gray1 - mu1) ** 2).mean()
    sigma2_sq = ((gray2 - mu2) ** 2).mean()
    sigma12 = ((gray1 - mu1) * (gray2 - mu2)).mean()

    numerator = (2 * mu1 * mu2 + C1) * (2 * sigma12 + C2)
    denominator = (mu1 ** 2 + mu2 ** 2 + C1) * (sigma1_sq + sigma2_sq + C2)
    return float(numerator / (denominator + 1e-12))


def _compute_mse(before: np.ndarray, after: np.ndarray) -> float:
    return float(np.mean((before.astype(np.float64) - after.astype(np.float64)) ** 2))


def _compute_entropy(image: np.ndarray) -> float:
    gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
    hist = cv2.calcHist([gray], [0], None, [256], [0, 256]).ravel()
    hist = hist / (hist.sum() + 1e-9)
    non_zero = hist[hist > 0]
    return float(-np.sum(non_zero * np.log2(non_zero)))


def _ensure_same_size(reference: np.ndarray, target: np.ndarray) -> np.ndarray:
    """Resize target to match reference HxW if不同尺寸."""
    if reference.shape[:2] == target.shape[:2]:
        return target
    h, w = reference.shape[:2]
    resized = cv2.resize(target, (w, h), interpolation=cv2.INTER_LINEAR)
    return resized


def _degrade_baseline(image: np.ndarray) -> np.ndarray:
    """生成一张降质版作为基线，用于衡量提升幅度。"""
    blurred = cv2.GaussianBlur(image, (9, 9), 2.5)
    h, w = image.shape[:2]
    down_h = max(1, h // 2)
    down_w = max(1, w // 2)
    lowres = cv2.resize(blurred, (down_w, down_h), interpolation=cv2.INTER_AREA)
    restored = cv2.resize(lowres, (w, h), interpolation=cv2.INTER_LINEAR)
    return restored

def _compute_metrics(before: np.ndarray, after: np.ndarray) -> Dict[str, float]:
    after = _ensure_same_size(before, after)
    psnr = _compute_psnr(before, after)
    ssim = _compute_ssim(before, after)
    mse = _compute_mse(before, after)
    entropy = _compute_entropy(after)
    return {
        "psnr": psnr,
        "ssim": ssim,
        "mse": mse,
        "entropy": entropy,
    }


def _format_metrics(before: Dict[str, float], after: Dict[str, float]) -> Dict[str, Dict[str, float | None]]:
    combined: Dict[str, Dict[str, float]] = {}
    for key in after.keys():
        b = before[key]
        a = after[key]
        if np.isfinite(a) and np.isfinite(b):
            delta: float | None = a - b
        else:
            delta = None
        combined[key] = {
            "before": round(b, 4) if np.isfinite(b) else b,
            "after": round(a, 4) if np.isfinite(a) else a,
            "delta": round(delta, 4) if delta is not None else None,
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

    # 基线：使用降质版原图衡量修复提升
    degraded_rgb = _degrade_baseline(original_rgb)
    before_metrics = _compute_metrics(original_rgb, degraded_rgb)
    after_metrics = _compute_metrics(original_rgb, result_rgb)
    return _format_metrics(before_metrics, after_metrics)
