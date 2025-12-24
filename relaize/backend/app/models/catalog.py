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
        id="RealESRGAN_RealESRGAN_x4plus_anime_6B_4x",
        name="RealESRGAN 4x Anime",
        kind="superres",
        description="针对动漫/插画优化的 4x 超分模型，线条与色彩更锐利。",
        repo="https://github.com/xinntao/Real-ESRGAN",
        tags=("superres", "final2x", "anime"),
        weight_hint="final2x/RealESRGAN_x4plus_anime_6B.pth",
    ),
    ModelSpec(
        id="GFPGAN",
        name="GFPGAN 人脸修复",
        kind="face_restore",
        description="人脸修复增强，适合模糊/低清晰度人像补全五官。",
        repo="https://github.com/TencentARC/GFPGAN",
        tags=("face", "restore"),
        weight_hint="gfpgan/GFPGANv1.4.pth",
    ),
    ModelSpec(
        id="CodeFormer",
        name="CodeFormer 人脸修复",
        kind="face_restore",
        description="保结构的人脸修复模型，可调节保真度/清晰度权衡。",
        repo="https://github.com/sczhou/CodeFormer",
        tags=("face", "restore"),
        weight_hint="codeformer/codeformer.pth",
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
        id="superres_face",
        name="超分 + 人脸修复",
        description="先超分，再对整张图做人脸修复（GFPGAN/CodeFormer）。",
        tags=("superres", "face"),
        stages=(
            PipelineStageSpec(
                id="superres",
                name="Final2x",
                model_id="RealESRGAN_RealESRGAN_x4plus_4x",
                description="默认使用 Real-ESRGAN，可被任务重写。",
                defaults={"scale": 4},
            ),
            PipelineStageSpec(
                id="face_restore",
                name="人脸修复",
                model_id="GFPGAN",
                description="GFPGAN/CodeFormer 可选，未安装依赖则跳过。",
                optional=True,
                defaults={"provider": "gfpgan", "fidelity": 0.5},
            ),
        ),
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
