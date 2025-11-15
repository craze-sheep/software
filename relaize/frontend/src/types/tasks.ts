import type { AdjustmentKey } from "../store/adjustmentStore";

export type TaskStatus = "pending" | "processing" | "completed" | "failed" | "cancelled";

export type AdjustmentParameters = Partial<Record<AdjustmentKey, number>>;

export type AdjustmentPayload = {
  preset_id?: string | null;
  parameters: AdjustmentParameters;
  note?: string | null;
  saved_at?: string | null;
};

export interface TaskSummary {
  id: string;
  filename: string;
  size?: number;
  content_type?: string;
  status: TaskStatus;
  preview_url?: string | null;
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
