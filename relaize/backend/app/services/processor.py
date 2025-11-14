from __future__ import annotations

from pathlib import Path
from typing import Dict

import cv2
import numpy as np


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


def enhance_image(source: Path, destination: Path) -> Dict[str, Dict[str, float]]:
    original_bgr = cv2.imread(str(source))
    if original_bgr is None:
        raise ValueError(f"Unable to read image {source}")

    original_rgb = cv2.cvtColor(original_bgr, cv2.COLOR_BGR2RGB)
    balanced = _gray_world_balance(original_rgb.astype(np.float32))

    lab = cv2.cvtColor(balanced.astype(np.uint8), cv2.COLOR_RGB2LAB)
    clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
    lab[..., 0] = clahe.apply(lab[..., 0])
    enhanced = cv2.cvtColor(lab, cv2.COLOR_LAB2RGB)

    # gentle denoise + sharpen
    denoised = cv2.bilateralFilter(enhanced, d=5, sigmaColor=60, sigmaSpace=60)
    blurred = cv2.GaussianBlur(denoised, (0, 0), 1.2)
    sharpened = cv2.addWeighted(denoised, 1.5, blurred, -0.5, 0)

    destination.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(
        str(destination),
        cv2.cvtColor(sharpened, cv2.COLOR_RGB2BGR),
        [int(cv2.IMWRITE_JPEG_QUALITY), 94],
    )

    before_metrics = _compute_metrics(original_rgb)
    after_metrics = _compute_metrics(sharpened)
    return _format_metrics(before_metrics, after_metrics)
