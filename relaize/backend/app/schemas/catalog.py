from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class ModelInfo(BaseModel):
    id: str
    name: str
    kind: str
    description: str
    repo: Optional[str] = None
    homepage: Optional[str] = None
    tags: list[str] = Field(default_factory=list)
    default_device: str = "cuda"
    weight_hint: Optional[str] = None
    supports_prompt: bool = False
    supports_mask: bool = False


class PipelineStageInfo(BaseModel):
    id: str
    name: str
    model_id: str
    description: str
    optional: bool = False
    defaults: dict = Field(default_factory=dict)


class PipelineInfo(BaseModel):
    id: str
    name: str
    description: str
    tags: list[str] = Field(default_factory=list)
    stages: list[PipelineStageInfo] = Field(default_factory=list)
    recommended_presets: list[str] = Field(default_factory=list)
    supports_prompt: bool = False
    supports_mask: bool = False


class CatalogResponse(BaseModel):
    models: list[ModelInfo]
    pipelines: list[PipelineInfo]
