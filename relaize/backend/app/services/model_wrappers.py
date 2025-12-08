from __future__ import annotations

import base64
from functools import lru_cache
from pathlib import Path
from typing import Any, Mapping

import cv2
import numpy as np
from loguru import logger
from PIL import Image

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


@lru_cache(maxsize=1)
def _get_gfpgan(model_path: str, device: str):
    try:
        from gfpgan import GFPGANer
    except ImportError as exc:  # pragma: no cover - optional dependency
        raise StageNotConfiguredError("GFPGAN 未安装，请执行 pip install gfpgan facexlib basicsr") from exc
    if not Path(model_path).exists():
        raise StageNotConfiguredError(f"GFPGAN 权重文件不存在：{model_path}")
    logger.info("Loading GFPGAN weights from %s", model_path)
    return GFPGANer(
        model_path=model_path,
        upscale=1,
        arch="clean",
        channel_multiplier=2,
        bg_upsampler=None,
        device=device,
    )


def _run_gfpgan(image_rgb: np.ndarray, stage_params: Mapping[str, Any], context: Mapping[str, Any]) -> np.ndarray:
    settings = get_settings()
    if not settings.gfpgan_model_path:
        raise StageNotConfiguredError("请在配置中设置 gfpgan_model_path 以启用人脸修复阶段")
    device = settings.gfpgan_device if settings.gfpgan_device.lower() != "auto" else settings.final2x_device
    restorer = _get_gfpgan(str(settings.gfpgan_model_path), device)
    image_bgr = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2BGR)
    _, _, restored_bgr = restorer.enhance(
        image_bgr,
        has_aligned=False,
        only_center_face=bool(stage_params.get("only_center_face", False)),
        paste_back=True,
    )
    return cv2.cvtColor(restored_bgr, cv2.COLOR_BGR2RGB)


@lru_cache(maxsize=1)
def _get_promptfix_pipeline(model_path: str, device: str):
    try:
        from diffusers import StableDiffusionInpaintPipeline
        import torch
    except ImportError as exc:
        raise StageNotConfiguredError("PromptFix 所需 diffusers/torch 未安装") from exc

    dtype = torch.float16 if device.startswith("cuda") else torch.float32
    pipeline = StableDiffusionInpaintPipeline.from_pretrained(
        model_path,
        torch_dtype=dtype,
        safety_checker=None,
    )
    pipeline = pipeline.to(device)
    try:
        pipeline.enable_xformers_memory_efficient_attention()
    except Exception:  # pragma: no cover - 可选优化
        logger.debug("PromptFix 未启用 xformers 记忆优化")
    return pipeline


def _run_promptfix(image_rgb: np.ndarray, stage_params: Mapping[str, Any], context: Mapping[str, Any]) -> np.ndarray:
    settings = get_settings()
    if not settings.promptfix_model_path:
        raise StageNotConfiguredError("未配置 PROMPTFIX_MODEL_PATH，无法运行 PromptFix")
    prompt = context.get("prompt")
    mask_data = context.get("mask_data")
    if not prompt:
        raise StageNotConfiguredError("PromptFix 需要提供 prompt")
    if not mask_data:
        raise StageNotConfiguredError("PromptFix 需要提供掩膜 data URL")

    device = _resolve_device(settings.final2x_device)
    pipeline = _get_promptfix_pipeline(str(settings.promptfix_model_path), device)
    mask_gray = _ensure_data_url_image(mask_data, grayscale=True)
    mask_pil = Image.fromarray(mask_gray).resize((image_rgb.shape[1], image_rgb.shape[0]), Image.NEAREST)
    init_image = Image.fromarray(image_rgb)

    guidance = float(stage_params.get("guidance_scale", 7.5))
    strength = float(stage_params.get("strength", 0.75))
    result = pipeline(
        prompt=prompt,
        negative_prompt=context.get("negative_prompt") or None,
        image=init_image,
        mask_image=mask_pil,
        guidance_scale=guidance,
        strength=strength,
    ).images[0]
    return np.array(result)


@lru_cache(maxsize=1)
def _get_iopaint_pipeline(model_path: str):
    try:
        from iopaint import InpaintPipeline
    except ImportError as exc:
        raise StageNotConfiguredError("IOPaint 依赖未安装，请执行 pip install iopaint") from exc

    return InpaintPipeline(model=model_path)


def _run_iopaint(image_rgb: np.ndarray, stage_params: Mapping[str, Any], context: Mapping[str, Any]) -> np.ndarray:
    settings = get_settings()
    if not settings.iopaint_model_path:
        raise StageNotConfiguredError("未配置 IOPAINT_MODEL_PATH，无法运行 IOPaint")
    mask_data = context.get("mask_data")
    if not mask_data:
        raise StageNotConfiguredError("IOPaint 阶段需要提供掩膜")

    mask = _ensure_data_url_image(mask_data, grayscale=True)
    mask = cv2.resize(mask, (image_rgb.shape[1], image_rgb.shape[0]), interpolation=cv2.INTER_NEAREST)
    pipeline = _get_iopaint_pipeline(str(settings.iopaint_model_path))
    result = pipeline(image_rgb, mask)
    return result


def run_model_stage(
    model_id: str,
    image_rgb: np.ndarray,
    stage_params: Mapping[str, Any],
    context: Mapping[str, Any],
) -> np.ndarray:
    spec: ModelSpec | None = get_model_spec(model_id)
    if spec and spec.kind == "superres":
        return _run_final2x_superres(image_rgb, model_id, stage_params, context)
    if model_id == "GFPGAN_v1.4":
        return _run_gfpgan(image_rgb, stage_params, context)
    if model_id == "PromptFix_diffusion":
        return _run_promptfix(image_rgb, stage_params, context)
    if model_id == "IOPaint_lama":
        return _run_iopaint(image_rgb, stage_params, context)

    raise StageNotConfiguredError(f"模型 {model_id} 暂未接入执行器，可在 model_wrappers.py 中补充 handler")
