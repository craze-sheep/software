from __future__ import annotations

import base64
from pathlib import Path
from typing import Any, Dict, Mapping, MutableMapping, Optional

import cv2
import numpy as np
import torch
from loguru import logger

from app.core.config import get_settings
from app.services.final2x_engine import get_final2x_engine, resolve_model_for_adjustments


def _gray_world_balance(image: np.ndarray) -> np.ndarray:
    avg_bgr = image.mean(axis=(0, 1))
    avg_gray = avg_bgr.mean()
    scale = avg_gray / (avg_bgr + 1e-6)
    balanced = np.clip(image * scale, 0, 255).astype(np.uint8)
    return balanced


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


def _apply_color_temperature(image: np.ndarray, color_temp: float) -> np.ndarray:
    """Adjust color temperature: positive -> warm, negative -> cool."""
    if color_temp == 0:
        return image
    temp = image.astype(np.float32)
    shift = color_temp / 80.0  # clamp effect
    # Red channel boost; blue channel attenuation for warm tones
    temp[..., 0] *= 1 + shift * 0.6
    temp[..., 2] *= 1 - shift * 0.6
    return np.clip(temp, 0, 255).astype(np.uint8)


def _apply_saturation(image: np.ndarray, saturation: float) -> np.ndarray:
    hsv = cv2.cvtColor(image, cv2.COLOR_RGB2HSV).astype(np.float32)
    hsv[..., 1] = np.clip(hsv[..., 1] * saturation, 0, 255)
    return cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2RGB)


def _apply_adjustment_pipeline(image_rgb: np.ndarray, params: Mapping[str, Any]) -> np.ndarray:
    compensation = float(params.get("compensation", 70))
    saturation_gain = float(params.get("saturation", 120))
    color_temp = float(params.get("colorTemp", 0))
    contrast = float(params.get("contrast", 1.8))
    sharpness = float(params.get("sharpness", 60))
    dehaze = float(params.get("dehaze", 75))
    denoise = float(params.get("denoise", 50))
    edge_preserve = float(params.get("edgePreserve", 70))

    balanced = _gray_world_balance(image_rgb.astype(np.float32))
    comp_scale = 1 + (compensation - 70) / 160.0
    balanced = np.clip(balanced.astype(np.float32) * [comp_scale, 1.0, 1.0], 0, 255).astype(np.uint8)
    balanced = _apply_color_temperature(balanced, color_temp)
    balanced = _apply_saturation(balanced, max(0.3, min(2.2, saturation_gain / 120.0)))

    lab = cv2.cvtColor(balanced.astype(np.uint8), cv2.COLOR_RGB2LAB)
    clip_limit = max(1.2, min(4.0, 2.0 + (contrast - 1.0)))
    grid = int(max(4, min(16, 8 + (dehaze - 50) / 10)))
    clahe = cv2.createCLAHE(clipLimit=clip_limit, tileGridSize=(grid, grid))
    lab[..., 0] = clahe.apply(lab[..., 0])
    enhanced = cv2.cvtColor(lab, cv2.COLOR_LAB2RGB)

    sigma_color = max(10.0, min(120.0, 40.0 + denoise * 0.8))
    sigma_space = max(10.0, min(120.0, 40.0 + edge_preserve * 0.6))
    denoised = cv2.bilateralFilter(enhanced, d=5, sigmaColor=sigma_color, sigmaSpace=sigma_space)
    blur_sigma = 0.6 + (100 - sharpness) * 0.01
    blurred = cv2.GaussianBlur(denoised, (0, 0), blur_sigma)
    sharp_weight = 1.0 + sharpness / 80.0
    return cv2.addWeighted(denoised, sharp_weight, blurred, -(sharp_weight - 1.0), 0)


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

    tweaked_rgb = _apply_adjustment_pipeline(super_res_rgb, params)

    destination.parent.mkdir(parents=True, exist_ok=True)
    # Save as PNG to avoid any lossy compression on output.
    cv2.imwrite(str(destination), cv2.cvtColor(tweaked_rgb, cv2.COLOR_RGB2BGR), [int(cv2.IMWRITE_PNG_COMPRESSION), 3])

    before_metrics = _compute_metrics(original_rgb)
    after_metrics = _compute_metrics(tweaked_rgb)
    return _format_metrics(before_metrics, after_metrics)


def generate_preview_image(
    source: Path,
    adjustments: Optional[Mapping[str, MutableMapping]] = None,
) -> Dict[str, Any]:
    original_bgr = cv2.imread(str(source))
    if original_bgr is None:
        raise ValueError(f"Unable to read image {source}")

    original_rgb = cv2.cvtColor(original_bgr, cv2.COLOR_BGR2RGB)
    params: Mapping[str, Any] = (adjustments or {}).get("parameters", {}) if adjustments else {}
    settings = get_settings()
    base_bgr = original_bgr
    can_run_sr = settings.final2x_enabled and settings.preview_enable_final2x
    if can_run_sr:
        model_override = resolve_model_for_adjustments(adjustments or {})
        scale_override = _extract_target_scale(params)
        sr_engine = get_final2x_engine(model_override)
        try:
            base_bgr = sr_engine.process(original_bgr, target_scale=scale_override)
        except (torch.cuda.OutOfMemoryError, RuntimeError) as exc:  # pragma: no cover - hardware dependent
            message = str(exc).lower()
            if "out of memory" in message:
                logger.warning(
                    "Final2x preview OOM, falling back to original image: %s",
                    exc,
                )
                base_bgr = original_bgr
                torch.cuda.empty_cache()
            else:
                raise
    base_rgb = cv2.cvtColor(base_bgr, cv2.COLOR_BGR2RGB)

    tweaked_rgb = _apply_adjustment_pipeline(base_rgb, params)

    before_metrics = _compute_metrics(original_rgb)
    after_metrics = _compute_metrics(tweaked_rgb)
    metrics = _format_metrics(before_metrics, after_metrics)

    _, buffer = cv2.imencode(".png", cv2.cvtColor(tweaked_rgb, cv2.COLOR_RGB2BGR))
    preview_base64 = base64.b64encode(buffer).decode("utf-8")
    return {"preview_base64": preview_base64, "metrics": metrics}
