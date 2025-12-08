from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Iterable


@dataclass(frozen=True)
class ModelSpec:
    id: str
    name: str
    kind: str
    description: str
    repo: str | None = None
    homepage: str | None = None
    tags: tuple[str, ...] = ()
    default_device: str = "cuda"
    weight_hint: str | None = None
    supports_prompt: bool = False
    supports_mask: bool = False


@dataclass(frozen=True)
class PipelineStageSpec:
    id: str
    name: str
    model_id: str
    description: str
    optional: bool = False
    defaults: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class PipelineSpec:
    id: str
    name: str
    description: str
    tags: tuple[str, ...] = ()
    stages: tuple[PipelineStageSpec, ...] = ()
    recommended_presets: tuple[str, ...] = ()
    supports_prompt: bool = False
    supports_mask: bool = False


MODEL_CATALOG: tuple[ModelSpec, ...] = (
    ModelSpec(
        id="RealESRGAN_RealESRGAN_x4plus_4x",
        name="RealESRGAN 4x",
        kind="superres",
        description="通用写实场景的 4x 超分模型，适合作为底层修复基座。",
        repo="https://github.com/xinntao/Real-ESRGAN",
        tags=("superres", "final2x", "写实"),
        weight_hint="final2x/RealESRGAN_x4plus.pth",
    ),
    ModelSpec(
        id="HAT_Real_GAN_4x",
        name="HAT Real 4x",
        kind="superres",
        description="HAT 实景模型，夜景/低光噪声表现更好。",
        repo="https://github.com/XPixelGroup/HAT",
        tags=("superres", "lowlight", "final2x"),
    ),
    ModelSpec(
        id="SwinIR_realSR_BSRGAN_DFOWMFC_s64w8_SwinIR_L_GAN_4x",
        name="SwinIR 实景 4x",
        kind="superres",
        description="SwinIR BSRGAN 版本，适合雾霾/去雾与风景。",
        repo="https://github.com/JingyunLiang/SwinIR",
        tags=("superres", "dehaze"),
    ),
    ModelSpec(
        id="DAT_light_2x",
        name="DAT Light 2x",
        kind="superres",
        description="轻量超分模型，适合快速预览或移动端推理。",
        repo="https://github.com/baidu-research/NJUDat",
        tags=("superres", "lightweight"),
        default_device="cpu",
    ),
    ModelSpec(
        id="RealCUGAN_Conservative_2x",
        name="RealCUGAN 2x",
        kind="superres",
        description="针对动漫/插画的 RealCUGAN 模型。",
        repo="https://github.com/bilibili/ailab",
        tags=("anime", "superres"),
    ),
    ModelSpec(
        id="GFPGAN_v1.4",
        name="GFPGAN v1.4",
        kind="face",
        description="腾讯 ARC 的人脸修复模型，可与 Real-ESRGAN 级联。",
        repo="https://github.com/TencentARC/GFPGAN",
        weight_hint="weights/GFPGANv1.4.pth",
        tags=("face", "restore"),
    ),
    ModelSpec(
        id="PromptFix_diffusion",
        name="PromptFix",
        kind="prompt",
        description="基于扩散模型的指令式修复，支持自然语言提示与掩膜。",
        repo="https://github.com/yeates/PromptFix",
        tags=("diffusion", "prompt", "inpaint"),
        supports_prompt=True,
        supports_mask=True,
    ),
    ModelSpec(
        id="IOPaint_lama",
        name="IOPaint (LaMa)",
        kind="mask-inpaint",
        description="IOPaint/LaMa Cleaner 掩膜修复，适合去除物体/水印。",
        repo="https://github.com/Sanster/IOPaint",
        tags=("inpaint", "lama"),
        supports_mask=True,
    ),
    ModelSpec(
        id="CTSDG_iccv2021",
        name="CTSDG",
        kind="structure",
        description="CTSDG 结构+纹理双生成模型，恢复大面积缺失内容。",
        repo="https://github.com/Xiefan-Guo/CTSDG",
        tags=("structure", "inpaint"),
    ),
    ModelSpec(
        id="ShiftNet_pytorch",
        name="Shift-Net",
        kind="structure",
        description="Shift-Net 深度特征重排修复，适合全景纹理补全。",
        repo="https://github.com/Zhaoyi-Yan/Shift-Net_pytorch",
        tags=("texture", "inpaint"),
    ),
    ModelSpec(
        id="CRFill_iccv2021",
        name="CR-Fill",
        kind="structure",
        description="CR-Fill 上下文重建模型，可用于大面积场景修复。",
        repo="https://github.com/zengxianyu/crfill",
        tags=("inpaint", "context"),
    ),
)


PIPELINE_CATALOG: tuple[PipelineSpec, ...] = (
    PipelineSpec(
        id="superres_basic",
        name="基础超分",
        description="Final2x 内置超分流程，执行一次指定的超分模型。",
        tags=("default", "superres"),
        stages=(
            PipelineStageSpec(
                id="superres",
                name="Final2x",
                model_id="RealESRGAN_RealESRGAN_x4plus_4x",
                description="默认使用 Real-ESRGAN，可被任务重写。",
                defaults={"scale": 4},
            ),
        ),
        recommended_presets=("night", "haze", "daily"),
    ),
    PipelineSpec(
        id="old_photo_restore",
        name="老照片修复",
        description="GFPGAN + 超分的串联，适合老旧人像。",
        tags=("face", "old-photo"),
        stages=(
            PipelineStageSpec(
                id="face",
                name="GFPGAN",
                model_id="GFPGAN_v1.4",
                description="先对人脸结构进行修复。",
            ),
            PipelineStageSpec(
                id="superres",
                name="RealESRGAN",
                model_id="RealESRGAN_RealESRGAN_x4plus_4x",
                description="最终放大并加强细节。",
                defaults={"scale": 4},
            ),
        ),
        recommended_presets=("vintage",),
    ),
    PipelineSpec(
        id="prompt_inpaint",
        name="指令式修复",
        description="PromptFix 扩散模型，支持文字描述+掩膜。",
        tags=("prompt", "diffusion", "inpaint"),
        stages=(
            PipelineStageSpec(
                id="prompt",
                name="PromptFix",
                model_id="PromptFix_diffusion",
                description="根据自然语言和掩膜生成修复区域。",
                defaults={"guidance_scale": 7.5},
            ),
        ),
        supports_prompt=True,
        supports_mask=True,
    ),
    PipelineSpec(
        id="mask_inpaint",
        name="掩膜修复",
        description="IOPaint (LaMa Cleaner) 掩膜编辑，适合去除物体。",
        tags=("lama", "mask"),
        stages=(
            PipelineStageSpec(
                id="mask",
                name="IOPaint",
                model_id="IOPaint_lama",
                description="根据掩膜删除/填补内容。",
            ),
        ),
        supports_mask=True,
    ),
    PipelineSpec(
        id="structure_fill",
        name="结构补全",
        description="CTSDG -> Shift-Net -> CR-Fill 结构纹理协同。",
        tags=("structure", "inpaint"),
        stages=(
            PipelineStageSpec(
                id="structure",
                name="CTSDG",
                model_id="CTSDG_iccv2021",
                description="恢复缺失区域的结构轮廓。",
            ),
            PipelineStageSpec(
                id="texture",
                name="Shift-Net",
                model_id="ShiftNet_pytorch",
                description="补齐高频纹理信息。",
                optional=True,
            ),
            PipelineStageSpec(
                id="context",
                name="CR-Fill",
                model_id="CRFill_iccv2021",
                description="利用上下文做细节融合。",
                optional=True,
            ),
        ),
        supports_mask=True,
    ),
)


def _serialize_specs(specs: Iterable[Any]) -> list[dict[str, Any]]:
    return [asdict(spec) for spec in specs]


def list_models() -> list[dict[str, Any]]:
    return _serialize_specs(MODEL_CATALOG)


def list_pipelines() -> list[dict[str, Any]]:
    return _serialize_specs(PIPELINE_CATALOG)


def get_model_ids() -> set[str]:
    return {spec.id for spec in MODEL_CATALOG}


def get_pipeline_ids() -> set[str]:
    return {spec.id for spec in PIPELINE_CATALOG}


_MODEL_INDEX = {spec.id: spec for spec in MODEL_CATALOG}
_PIPELINE_INDEX = {spec.id: spec for spec in PIPELINE_CATALOG}


def get_model_spec(model_id: str) -> ModelSpec | None:
    return _MODEL_INDEX.get(model_id)


def get_pipeline_spec(pipeline_id: str) -> PipelineSpec | None:
    return _PIPELINE_INDEX.get(pipeline_id)
