from __future__ import annotations

import sys
import types
from functools import lru_cache
from typing import Literal

import cv2
import numpy as np
import torch
from loguru import logger


class FaceRestorationUnavailable(RuntimeError):
    """Raised when face restoration backend is not available."""


def _ensure_torchvision_compat() -> None:
    """
    basicsr/facexlib on newer torchvision may import deprecated module paths.
    We inject a tiny shim so imports like torchvision.transforms.functional_tensor still resolve.
    """
    try:
        import torchvision.transforms.functional_tensor as _  # type: ignore[import]
        return
    except ModuleNotFoundError:
        try:
            from torchvision.transforms import functional as F  # type: ignore[import]
        except Exception:
            return
        shim = types.ModuleType("torchvision.transforms.functional_tensor")
        if hasattr(F, "rgb_to_grayscale"):
            shim.rgb_to_grayscale = F.rgb_to_grayscale  # type: ignore[attr-defined]
            sys.modules["torchvision.transforms.functional_tensor"] = shim


def _select_device(preferred: str | None = None) -> str:
    if preferred and preferred.lower() not in ("auto", ""):
        return preferred
    return "cuda" if torch.cuda.is_available() else "cpu"


@lru_cache(maxsize=1)
def _get_gfpgan_restorer(model_path: str | None, device: str):
    _ensure_torchvision_compat()
    try:
        from gfpgan import GFPGANer
    except ImportError as exc:  # pragma: no cover - optional dependency
        detail = f"{exc.__class__.__name__}: {exc}"
        raise FaceRestorationUnavailable(f"GFPGAN 依赖缺失（{detail}），请先 pip install gfpgan") from exc

    logger.info("Loading GFPGAN model on %s (path=%s)", device, model_path or "GFPGANv1.4 auto")
    return GFPGANer(
        model_path=model_path,  # GFPGANer 会自动下载缺省权重
        upscale=1,
        arch="clean",
        channel_multiplier=2,
        bg_upsampler=None,
        device=device,
    )


def _run_gfpgan(image_rgb: np.ndarray, model_path: str | None, device: str) -> np.ndarray:
    restorer = _get_gfpgan_restorer(model_path, device)
    image_bgr = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2BGR)
    _, _, restored_bgr = restorer.enhance(
        image_bgr,
        has_aligned=False,
        only_center_face=False,
        paste_back=True,
    )
    return cv2.cvtColor(restored_bgr, cv2.COLOR_BGR2RGB)


@lru_cache(maxsize=1)
def _get_codeformer(model_path: str | None, device: str):
    _ensure_torchvision_compat()
    try:
        from basicsr.utils.download_util import load_file_from_url
        from basicsr.archs.codeformer_arch import CodeFormer
        from facexlib.utils.face_restoration_helper import FaceRestoreHelper
    except ImportError as exc:  # pragma: no cover - optional dependency
        detail = f"{exc.__class__.__name__}: {exc}"
        raise FaceRestorationUnavailable(
            f"CodeFormer 依赖缺失（{detail}），请先 pip install basicsr facexlib timm lpips"
        ) from exc

    weight_path = model_path or load_file_from_url(
        url="https://github.com/sczhou/CodeFormer/releases/download/v0.1.0/codeformer.pth",
        model_dir="weights/CodeFormer",
    )
    logger.info("Loading CodeFormer weight from %s on %s", weight_path, device)
    net = CodeFormer(dim_embd=512, codebook_size=1024, n_head=8, n_layers=9, connect_list=["32", "64", "128", "256"]).to(device)
    checkpoint = torch.load(weight_path, map_location=device)
    net.load_state_dict(checkpoint["params_ema"])
    net.eval()

    helper = FaceRestoreHelper(
        upscale_factor=1,
        face_size=512,
        crop_ratio=(1, 1),
        det_model="retinaface_resnet50",
        save_ext="png",
        device=device,
    )
    return net, helper


def _run_codeformer(image_rgb: np.ndarray, model_path: str | None, device: str, fidelity: float) -> np.ndarray:
    from torchvision.transforms.functional import normalize, to_tensor

    net, helper = _get_codeformer(model_path, device)
    image_bgr = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2BGR)
    helper.clean_all()
    helper.read_image(image_bgr)
    helper.get_face_landmarks_5()
    helper.align_warp_face()

    if len(helper.cropped_faces) == 0:
        logger.warning("CodeFormer 未检测到人脸，跳过人脸修复")
        return image_rgb

    restored_faces = []
    for cropped_face in helper.cropped_faces:
        face = cropped_face / 255.0
        face_t = to_tensor(face).unsqueeze(0).to(device)
        normalize(face_t, (0.5, 0.5, 0.5), (0.5, 0.5, 0.5), inplace=True)
        try:
            with torch.no_grad():
                output = net(face_t, w=fidelity, adain=True)[0]
            output = output.cpu().float().clamp_(-1, 1)
            output = (output + 1) / 2
            output = output.numpy().transpose(1, 2, 0)
            restored_faces.append(output)
        except Exception as exc:  # pragma: no cover - best-effort fallback
            logger.warning("CodeFormer 处理单张人脸失败: %s", exc)
            restored_faces.append(cropped_face / 255.0)

    helper.add_restored_face(restored_faces, method="average")
    restored_bgr = helper.get_final_image()
    return cv2.cvtColor(restored_bgr, cv2.COLOR_BGR2RGB)


def restore_faces(
    image_rgb: np.ndarray,
    provider: Literal["gfpgan", "codeformer"] = "gfpgan",
    *,
    model_path: str | None = None,
    device: str | None = None,
    fidelity: float = 0.5,
) -> np.ndarray:
    """
    Apply face restoration to an RGB image. Falls back gracefully when dependencies are missing.
    """
    resolved_device = _select_device(device)
    # ensure only the selected provider stays cached
    if provider == "gfpgan":
        _get_codeformer.cache_clear()  # type: ignore[attr-defined]
    elif provider == "codeformer":
        _get_gfpgan_restorer.cache_clear()  # type: ignore[attr-defined]

    provider_normalized = provider.lower()
    if provider_normalized == "gfpgan":
        return _run_gfpgan(image_rgb, model_path, resolved_device)
    if provider_normalized == "codeformer":
        return _run_codeformer(image_rgb, model_path, resolved_device, fidelity)
    raise FaceRestorationUnavailable(f"不支持的人脸修复 provider：{provider}")
