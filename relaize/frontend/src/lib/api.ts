import axios from "axios";

import type { AdjustmentPayload, TaskDetail, TaskSummary } from "../types/tasks";
import type { UploadResponse } from "../types/upload";
import type { ReportResponse } from "../types/report";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000/api";
const API_HOST = API_BASE_URL.replace(/\/api\/?$/, "");

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 1000 * 20,
});

export const resolveFileUrl = (path?: string | null): string | null => {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) {
    return path;
  }
  return `${API_HOST}${path}`;
};

type TaskQuery = {
  status?: string;
  offset?: number;
  limit?: number;
};

export const fetchTasks = async (query?: TaskQuery): Promise<TaskSummary[]> => {
  const { data } = await apiClient.get<TaskSummary[]>("/tasks", {
    params: {
      status: query?.status,
      offset: query?.offset,
      limit: query?.limit,
    },
  });
  return data;
};

export const fetchTaskDetail = async (taskId: string): Promise<TaskDetail> => {
  const { data } = await apiClient.get<TaskDetail>(`/tasks/${taskId}`);
  return data;
};

export const uploadImage = async (file: File): Promise<UploadResponse> => {
  const formData = new FormData();
  formData.append("file", file);
  const { data } = await apiClient.post<UploadResponse>("/uploads", formData);
  return data;
};

export const fetchReport = async (taskId: string): Promise<ReportResponse> => {
  const { data } = await apiClient.get<ReportResponse>(`/reports/${taskId}`);
  return data;
};

export const applyAdjustments = async (
  taskId: string,
  payload: AdjustmentPayload,
): Promise<TaskDetail> => {
  const { data } = await apiClient.post<TaskDetail>(`/tasks/${taskId}/adjust`, payload);
  return data;
};

export const processTask = async (taskId: string): Promise<TaskDetail> => {
  const { data } = await apiClient.post<TaskDetail>(`/tasks/${taskId}/process`);
  return data;
};

export const cancelTask = async (taskId: string): Promise<TaskDetail> => {
  const { data } = await apiClient.post<TaskDetail>(`/tasks/${taskId}/cancel`);
  return data;
};

export const clearTasks = async (): Promise<{ cleared: number }> => {
  const { data } = await apiClient.delete<{ cleared: number }>("/tasks");
  return data;
};

export const resolveResultUrl = (taskId?: string | null): string | null =>
  taskId ? resolveFileUrl(`/api/tasks/${taskId}/result`) : null;
