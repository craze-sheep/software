export type ModelCatalogEntry = {
  id: string;
  name: string;
  kind: string;
  description: string;
  repo?: string | null;
  homepage?: string | null;
  tags?: string[];
  default_device?: string;
  weight_hint?: string | null;
  supports_prompt?: boolean;
  supports_mask?: boolean;
};

export type PipelineStageInfo = {
  id: string;
  name: string;
  model_id: string;
  description: string;
  optional?: boolean;
  defaults?: Record<string, unknown>;
};

export type PipelineCatalogEntry = {
  id: string;
  name: string;
  description: string;
  tags?: string[];
  stages: PipelineStageInfo[];
  recommended_presets?: string[];
  supports_prompt?: boolean;
  supports_mask?: boolean;
};
