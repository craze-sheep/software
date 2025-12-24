import type { AdjustmentKey } from "../store/adjustmentStore";

export type TaskStatus = "pending" | "processing" | "completed" | "failed" | "cancelled";

export type AdjustmentParameters = Partial<Record<AdjustmentKey, number>>;

export type AdjustmentPayload = {
  preset_id?: string | null;
  model_name?: string | null;
  target_scale?: number | null;
  parameters: AdjustmentParameters;
  note?: string | null;
  saved_at?: string | null;
  face_restore_enabled?: boolean | null;
  face_restore_provider?: string | null;
  face_restore_fidelity?: number | null;
};

export interface TaskSummary {
  id: string;
  filename: string;
  size?: number;
  content_type?: string;
  status: TaskStatus;
  source_url?: string | null;
  metrics?: Record<string, { before: number; after: number; delta: number }>;
  processed_at?: string | null;
  adjustments?: AdjustmentPayload | null;
  created_at: string;
  updated_at: string;
}

export interface TaskDetail extends TaskSummary {
  message?: string | null;
}
