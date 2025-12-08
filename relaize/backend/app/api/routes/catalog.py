from __future__ import annotations

from fastapi import APIRouter

from app.models.catalog import list_models, list_pipelines
from app.schemas.catalog import CatalogResponse, ModelInfo, PipelineInfo

router = APIRouter(prefix="/catalog", tags=["Catalog"])


@router.get("/models", response_model=list[ModelInfo])
def get_models() -> list[ModelInfo]:
    """Return the list of configured AI 模型."""
    return [ModelInfo(**spec) for spec in list_models()]


@router.get("/pipelines", response_model=list[PipelineInfo])
def get_pipelines() -> list[PipelineInfo]:
    """Return the list of available修复管线."""
    return [PipelineInfo(**spec) for spec in list_pipelines()]


@router.get("", response_model=CatalogResponse)
def get_full_catalog() -> CatalogResponse:
    """Convenience endpoint that同时返回模型与管线."""
    return CatalogResponse(
        models=[ModelInfo(**spec) for spec in list_models()],
        pipelines=[PipelineInfo(**spec) for spec in list_pipelines()],
    )
