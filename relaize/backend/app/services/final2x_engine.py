from __future__ import annotations

import os
import platform
import threading
from dataclasses import dataclass
from functools import lru_cache
from typing import Any
import warnings
import logging

import cv2
import numpy as np

# Avoid unsupported allocator hint on Windows to silence torch warning.
if platform.system() != "Windows":
    os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

import torch
from cccv import AutoModel, ConfigType
from Final2x_core.util.device import get_device
from loguru import logger

from app.core.config import get_settings


ALLOWED_MODEL_IDS = {"RealESRGAN_RealESRGAN_x4plus_4x"}

# Silence noisy warnings/logs from CCCV and allocator hint on Windows
warnings.filterwarnings("ignore", message="expandable_segments not supported on this platform")
logging.getLogger("cccv").setLevel(logging.ERROR)


@dataclass(frozen=True)
class Final2xEngineConfig:
    model_name: str
    device: str
    target_scale: float
    use_tile: bool
    tile_size: int
    gh_proxy: str | None = None


class Final2xEngine:
    """Thin wrapper around Final2x-core AutoModel with simple caching."""

    FALLBACK_TILE_SIZES: tuple[int, ...] = (512, 384, 320, 288, 256, 224, 192, 160, 144, 128, 112, 96, 80, 72, 64)

    def __init__(self, config: Final2xEngineConfig):
        self.config = config
        self._lock = threading.Lock()
        self._requested_device = self._select_device(config.device)
        self._pretrained_name = self._resolve_model_name(config.model_name)
        initial_tile = config.tile_size if config.use_tile and config.tile_size > 0 else None
        self._current_tile_size: int | None = initial_tile
        self._effective_device = self._requested_device
        self._model = None
        self._load_model(initial_tile, device_label=self._requested_device)

    @staticmethod
    def _select_device(requested: str) -> str:
        if requested and requested.lower().startswith("cuda"):
            if not torch.cuda.is_available():
                raise RuntimeError(
                    f"CUDA device '{requested}' requested but torch.cuda.is_available() is False. "
                    "GPU is required for Final2x; please install CUDA or choose a different device."
                )
        return requested or "cpu"

    @staticmethod
    def _resolve_model_name(name: str) -> ConfigType | str:
        """Support ConfigType name, enum value, or direct path/URL strings."""
        normalized = name.replace(".pth", "")
        for cfg in ConfigType:
            if cfg.name == normalized or cfg.value.replace(".pth", "") == normalized:
                return cfg
        return name

    def process(self, image_bgr: np.ndarray, *, target_scale: float | None = None) -> np.ndarray:
        """
        Run super-resolution and optional resize to the requested scale.

        :param image_bgr: input image in BGR color space.
        :param target_scale: override default scale factor.
        """
        pad_unit = 16
        height, width = image_bgr.shape[:2]
        pad_h = (pad_unit - height % pad_unit) % pad_unit
        pad_w = (pad_unit - width % pad_unit) % pad_unit
        if pad_h or pad_w:
            padded = cv2.copyMakeBorder(
                image_bgr,
                0,
                pad_h,
                0,
                pad_w,
                borderType=cv2.BORDER_REFLECT_101,
            )
        else:
            padded = image_bgr

        with self._lock:
            result = self._run_inference_with_retry(padded)
        if result is None:
            raise RuntimeError("Final2x inference returned empty output")

        if pad_h or pad_w:
            scale_h = result.shape[0] / padded.shape[0]
            scale_w = result.shape[1] / padded.shape[1]
            crop_h = result.shape[0] - int(round(pad_h * scale_h))
            crop_w = result.shape[1] - int(round(pad_w * scale_w))
            result = result[:crop_h, :crop_w]

        scale = target_scale or self.config.target_scale
        if scale and scale > 0:
            current_size = (result.shape[1], result.shape[0])
            target_size = (int(round(image_bgr.shape[1] * scale)), int(round(image_bgr.shape[0] * scale)))
            if current_size != target_size:
                result = cv2.resize(result, target_size, interpolation=cv2.INTER_LINEAR)
        return result

    def _load_model(self, tile_size: int | None, *, device_label: str | None = None) -> None:
        """Instantiate AutoModel with the requested tiling/device settings."""
        device_label = device_label or self._requested_device
        tile = (tile_size, tile_size) if tile_size else None
        logger.info(
            "Loading Final2x model: {} (tile={}) on {}",
            self._pretrained_name,
            f"{tile_size}px" if tile_size else "disabled",
            device_label,
        )
        self._model = None
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        model = AutoModel.from_pretrained(
            self._pretrained_name,
            device=get_device(device_label),
            fp16=False,
            tile=tile,
            gh_proxy=self.config.gh_proxy,
        )
        self._model = model
        self._effective_device = str(model.device)
        self._current_tile_size = tile_size
        logger.info("Final2x engine ready on {} (tile={})", self._model.device, tile)

    def _run_inference_with_retry(self, image: np.ndarray) -> np.ndarray:
        """Run inference and automatically retry on CUDA OOM with smaller tiles or CPU."""
        try:
            return self._model.inference_image(image)
        except torch.cuda.OutOfMemoryError as exc:  # pragma: no cover - depends on GPU memory
            logger.warning("Final2x CUDA OOM detected: {}", exc)
            return self._recover_from_oom(image, exc)
        except RuntimeError as exc:  # pragma: no cover - defensive handling
            if "CUDA out of memory" not in str(exc):
                raise
            logger.warning("Final2x runtime OOM detected: {}", exc)
            return self._recover_from_oom(image, exc)

    def _recover_from_oom(self, image: np.ndarray, original_exc: Exception) -> np.ndarray:
        """Fallback to progressively smaller tiles, then CPU if needed."""
        for tile_size in self._fallback_tile_sizes():
            try:
                self._load_model(tile_size, device_label=self._requested_device)
                logger.info("Retrying Final2x inference with {}px tiles", tile_size)
                return self._model.inference_image(image)
            except torch.cuda.OutOfMemoryError as exc:  # pragma: no cover - depends on GPU memory
                logger.warning("Tile {}px still OOM ({}), trying smaller tile", tile_size, exc)
                continue
            except RuntimeError as exc:
                if "CUDA out of memory" in str(exc):
                    logger.warning("Tile {}px runtime OOM ({}), trying smaller tile", tile_size, exc)
                    continue
                raise

        # All GPU attempts failed; propagate the original error instead of silently falling back to CPU.
        raise original_exc

    def _fallback_tile_sizes(self) -> list[int]:
        """Return descending tile sizes smaller than the current tile."""
        if self._current_tile_size:
            max_tile = self._current_tile_size
        else:
            max_tile = max(self.FALLBACK_TILE_SIZES) + 1

        candidates: list[int] = []
        if not self._current_tile_size and self.config.tile_size > 0:
            candidates.append(self.config.tile_size)

        for size in self.FALLBACK_TILE_SIZES:
            if size >= max_tile:
                continue
            if size not in candidates:
                candidates.append(size)
        return candidates


@lru_cache(maxsize=8)
def _build_engine(
    model_name: str,
    device: str,
    target_scale: float,
    use_tile: bool,
    tile_size: int,
    gh_proxy: str | None,
) -> Final2xEngine:
    config = Final2xEngineConfig(
        model_name=model_name,
        device=device,
        target_scale=max(target_scale, 0.1),
        use_tile=use_tile,
        tile_size=tile_size,
        gh_proxy=gh_proxy,
    )
    return Final2xEngine(config)


def _normalize_model_id(model_name: str, fallback: str) -> str:
    """Only allow configured Final2x model ids; otherwise fall back to default."""
    normalized = model_name.replace(".pth", "")
    if normalized not in ALLOWED_MODEL_IDS:
        logger.warning(
            "Model %s is not in allowed list %s, falling back to %s",
            normalized,
            sorted(ALLOWED_MODEL_IDS),
            fallback,
        )
        return fallback
    return normalized


def get_final2x_engine(model_name: str | None = None) -> Final2xEngine:
    """Return a cached Final2x engine for the requested model."""
    settings = get_settings()
    fallback = settings.final2x_model_name.replace(".pth", "")
    effective_name = _normalize_model_id(model_name or fallback, fallback)
    return _build_engine(
        effective_name,
        settings.final2x_device,
        settings.final2x_target_scale,
        settings.final2x_use_tile,
        settings.final2x_tile_size,
        settings.final2x_gh_proxy,
    )


PRESET_MODEL_OVERRIDES: dict[str, str] = {
    "night": "RealESRGAN_RealESRGAN_x4plus_4x",
    "haze": "RealESRGAN_RealESRGAN_x4plus_4x",
    "vintage": "RealESRGAN_RealESRGAN_x4plus_4x",
    "daily": "RealESRGAN_RealESRGAN_x4plus_4x",
}


def resolve_model_for_adjustments(adjustments: dict[str, Any] | None) -> str | None:
    if not adjustments:
        return None
    explicit = adjustments.get("model_name")
    if explicit:
        return _normalize_model_id(explicit, get_settings().final2x_model_name.replace(".pth", ""))
    preset_id = adjustments.get("preset_id")
    if preset_id:
        override = PRESET_MODEL_OVERRIDES.get(preset_id)
        if override:
            return _normalize_model_id(override, get_settings().final2x_model_name.replace(".pth", ""))
    return None
