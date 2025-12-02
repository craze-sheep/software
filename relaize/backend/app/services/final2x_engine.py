from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from typing import Any

import cv2
import numpy as np
import torch
from cccv import AutoModel, ConfigType
from Final2x_core.util.device import get_device
from loguru import logger

from app.core.config import get_settings


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

    def __init__(self, config: Final2xEngineConfig):
        self.config = config
        tile: tuple[int, int] | None = (
            (config.tile_size, config.tile_size) if config.use_tile and config.tile_size > 0 else None
        )

        pretrained_name = self._resolve_model_name(config.model_name)
        effective_device = self._select_device(config.device)
        logger.info("Loading Final2x model: %s (tile=%s) on %s", pretrained_name, tile, effective_device)
        self._model = AutoModel.from_pretrained(
            pretrained_name,
            device=get_device(effective_device),
            fp16=False,
            tile=tile,
            gh_proxy=config.gh_proxy,
        )
        logger.info("Final2x engine ready on %s", self._model.device)

    @staticmethod
    def _select_device(requested: str) -> str:
        if requested and requested.lower().startswith("cuda"):
            if not torch.cuda.is_available():
                logger.warning(
                    "CUDA device '%s' requested but torch.cuda.is_available() is False, falling back to CPU",
                    requested,
                )
                return "cpu"
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

        result = self._model.inference_image(padded)
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


def get_final2x_engine(model_name: str | None = None) -> Final2xEngine:
    """Return a cached Final2x engine for the requested model."""
    settings = get_settings()
    effective_name = (model_name or settings.final2x_model_name).replace(".pth", "")
    return _build_engine(
        effective_name,
        settings.final2x_device,
        settings.final2x_target_scale,
        settings.final2x_use_tile,
        settings.final2x_tile_size,
        settings.final2x_gh_proxy,
    )


PRESET_MODEL_OVERRIDES: dict[str, str] = {
    "night": "HAT_Real_GAN_4x",
    "haze": "SwinIR_realSR_BSRGAN_DFOWMFC_s64w8_SwinIR_L_GAN_4x",
    "vintage": "RealESRGAN_RealESRGAN_x4plus_4x",
    "daily": "DAT_light_2x",
}


def resolve_model_for_adjustments(adjustments: dict[str, Any] | None) -> str | None:
    if not adjustments:
        return None
    explicit = adjustments.get("model_name")
    if explicit:
        return explicit
    preset_id = adjustments.get("preset_id")
    if preset_id:
        return PRESET_MODEL_OVERRIDES.get(preset_id)
    return None
