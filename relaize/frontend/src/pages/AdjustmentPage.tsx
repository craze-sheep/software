import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { applyAdjustments, fetchTaskDetail, fetchTasks, resolveFileUrl, resolveResultUrl } from "../lib/api";
import type { TaskDetail, TaskSummary } from "../types/tasks";
import { StatusBadge } from "../components/ui/StatusBadge";

type ModelCombo = {
  id: string;
  label: string;
  modelName: string;
  faceProvider: "none" | "gfpgan" | "codeformer";
  faceFidelity?: number;
};

const MODEL_COMBOS: ModelCombo[] = [
  {
    id: "real_raw",
    label: "写实 · 无人脸修复",
    modelName: "RealESRGAN_RealESRGAN_x4plus_4x",
    faceProvider: "none",
  },
  {
    id: "anime_raw",
    label: "动漫 · 无人脸修复",
    modelName: "RealESRGAN_RealESRGAN_x4plus_anime_6B_4x",
    faceProvider: "none",
  },
  {
    id: "real_gfpgan",
    label: "写实 · GFPGAN",
    modelName: "RealESRGAN_RealESRGAN_x4plus_4x",
    faceProvider: "gfpgan",
  },
  {
    id: "real_codeformer",
    label: "写实 · CodeFormer",
    modelName: "RealESRGAN_RealESRGAN_x4plus_4x",
    faceProvider: "codeformer",
    faceFidelity: 0.5,
  },
];

export const AdjustmentPage = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { data: tasks = [], isFetching: isFetchingTasks } = useQuery<TaskSummary[]>({
    queryKey: ["tasks"],
    queryFn: () => fetchTasks(),
    refetchInterval: 8000,
  });
  const initialTaskId = searchParams.get("taskId");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(initialTaskId);
  const [selectedComboId, setSelectedComboId] = useState<string>(MODEL_COMBOS[0].id);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isApplying, setIsApplying] = useState(false);

  useEffect(() => {
    if (!tasks.length) return;
    if (!selectedTaskId) {
      const first = tasks[0].id;
      setSelectedTaskId(first);
      setSearchParams({ taskId: first });
      return;
    }
    // keep current selection even if not in current list, to allow direct loading by id
    setSearchParams({ taskId: selectedTaskId });
  }, [tasks, selectedTaskId, setSearchParams]);

  const { data: selectedTask, isFetching: isFetchingTaskDetail } = useQuery<TaskDetail>({
    queryKey: ["task-detail", selectedTaskId],
    queryFn: () => fetchTaskDetail(selectedTaskId as string),
    enabled: Boolean(selectedTaskId),
    refetchInterval: 5000,
  });

  const detailTitle = selectedTask?.filename ?? (isFetchingTaskDetail ? "加载中…" : "暂无任务");
  const beforeImage = resolveFileUrl(selectedTask?.source_url);
  const afterImage =
    selectedTask?.status === "completed" && selectedTask?.id ? resolveResultUrl(selectedTask.id) : null;
  const updatedAtText = selectedTask?.updated_at
    ? new Date(selectedTask.updated_at).toLocaleString("zh-CN")
    : "--";
  const fileSizeText = selectedTask?.size ? `${(selectedTask.size / 1024 / 1024).toFixed(2)} MB` : "--";
  const statusLabel = selectedTask?.status ?? (isFetchingTaskDetail ? "同步中…" : "--");
  const hasImages = Boolean(beforeImage || afterImage);
  const currentModelId = selectedTask?.adjustments?.model_name;
  const currentFaceProvider = selectedTask?.adjustments?.face_restore_provider;
  const currentFaceEnabled = selectedTask?.adjustments?.face_restore_enabled;

  const resolvedCombo = useMemo(() => {
    const fromTask = () => {
      if (!currentModelId) return null;
      const enabled = currentFaceEnabled !== false; // default true if undefined
      const provider = enabled ? currentFaceProvider ?? "none" : "none";
      if (currentModelId === "RealESRGAN_RealESRGAN_x4plus_anime_6B_4x" && provider === "none") {
        return "anime_raw";
      }
      if (currentModelId === "RealESRGAN_RealESRGAN_x4plus_4x" && provider === "gfpgan") {
        return "real_gfpgan";
      }
      if (currentModelId === "RealESRGAN_RealESRGAN_x4plus_4x" && provider === "codeformer") {
        return "real_codeformer";
      }
      if (currentModelId === "RealESRGAN_RealESRGAN_x4plus_4x" && provider === "none") {
        return "real_raw";
      }
      // fallback
      return null;
    };
    return fromTask() ?? selectedComboId;
  }, [currentModelId, currentFaceProvider, currentFaceEnabled, selectedComboId]);

  const currentCombo = MODEL_COMBOS.find((item) => item.id === resolvedCombo) ?? MODEL_COMBOS[0];

  useEffect(() => {
    if (!resolvedCombo) return;
    setSelectedComboId(resolvedCombo);
  }, [resolvedCombo]);

  const handleBackHome = () => navigate("/upload");

  const handleGoComparison = () => {
    if (selectedTask?.id) {
      navigate(`/comparison?taskId=${selectedTask.id}`);
      return;
    }
    navigate("/comparison");
  };

  const handleGoReport = () => {
    if (selectedTask?.id) {
      navigate(`/report?taskId=${selectedTask.id}`);
    } else {
      navigate("/report");
    }
  };

  const handleApplyModel = async () => {
    if (!selectedTask?.id) {
      setErrorMessage("请先选择任务再切换模型。");
      return;
    }
    setIsApplying(true);
    setStatusMessage(null);
    setErrorMessage(null);
    try {
      const payload = {
        parameters: {},
        model_name: currentCombo.modelName,
        preset_id: null,
        face_restore_enabled: currentCombo.faceProvider !== "none",
        face_restore_provider: currentCombo.faceProvider === "none" ? null : currentCombo.faceProvider,
        face_restore_fidelity:
          currentCombo.faceProvider === "codeformer" ? currentCombo.faceFidelity ?? null : null,
        note: `切换模型：${currentCombo.label}`,
      };
      const newTask = await applyAdjustments(selectedTask.id, payload);
      setSelectedTaskId(newTask.id);
      setSearchParams({ taskId: newTask.id });
      setStatusMessage("已创建新任务并提交模型切换，正在重新排队处理中…");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["task-detail", selectedTask.id] }),
        queryClient.invalidateQueries({ queryKey: ["task-detail", newTask.id] }),
      ]);
    } catch (error) {
      console.error(error);
      setErrorMessage("提交失败，请稍后重试或检查后端日志。");
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <div className="grid gap-6 items-stretch xl:grid-cols-[minmax(0,1.35fr)_280px] 2xl:grid-cols-[minmax(0,1.55fr)_320px]">
      <div className="space-y-6">
        <div className="flex flex-col gap-3 rounded-3xl bg-white/90 p-5 shadow-card md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm text-slate-500">选择需要查看的任务</p>
            <h2 className="text-2xl font-semibold text-slate-800">{detailTitle}</h2>
            <p className="text-sm text-emerald-600">参数调节已关闭，以下展示模型的原始输出。</p>
          </div>
          <div className="w-full max-w-md md:w-96">
            <select
              className="w-full truncate rounded-full border border-slate-200 px-5 py-2.5 text-base text-slate-700"
              value={selectedTaskId ?? ""}
              onChange={(event) => {
                const nextId = event.target.value;
                setSelectedTaskId(nextId);
                setSearchParams({ taskId: nextId });
              }}
              disabled={!tasks.length || isFetchingTasks}
            >
              {!tasks.length ? (
                <option value="">暂无任务</option>
              ) : (
                tasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.filename} · {task.status}
                  </option>
                ))
              )}
            </select>
          </div>
        </div>

        <section className="grid gap-3 rounded-3xl bg-white/90 p-5 shadow-card md:grid-cols-2">
          <div className="relative overflow-hidden rounded-2xl bg-slate-100">
            <div className="absolute left-4 top-4 rounded-full bg-black/60 px-3 py-1 text-sm font-semibold text-white">
              原始图像
            </div>
            {beforeImage ? (
              <img src={beforeImage} alt="原始图像" className="h-full w-full object-contain bg-black" />
            ) : (
              <div className="flex h-64 items-center justify-center text-slate-400">暂无可用图像</div>
            )}
          </div>
          <div className="relative overflow-hidden rounded-2xl bg-slate-100">
            <div className="absolute left-4 top-4 rounded-full bg-black/60 px-3 py-1 text-sm font-semibold text-white">
              模型输出
            </div>
            {afterImage ? (
              <img src={afterImage} alt="模型输出" className="h-full w-full object-contain bg-black" />
            ) : (
              <div className="flex h-64 items-center justify-center text-slate-400">
                {selectedTask?.status === "processing" || selectedTask?.status === "pending"
                  ? "正在等待模型输出…"
                  : "暂无输出，等待任务完成"}
              </div>
            )}
          </div>
        </section>

        <section className="space-y-5 rounded-3xl bg-white/90 p-5 shadow-card">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-slate-800">输出说明</h2>
              <p className="text-sm text-slate-500">
                已移除所有颜色、锐化、去雾等手动参数，直接呈现模型的默认结果。
              </p>
            </div>
            <span className="rounded-full bg-emerald-50 px-4 py-1 text-sm font-semibold text-emerald-600">
              原始输出
            </span>
          </header>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
              <p className="text-xs uppercase tracking-wide text-slate-400">状态</p>
              <p className="mt-2 text-base font-semibold text-slate-800">{statusLabel}</p>
            </div>
            <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
              <p className="text-xs uppercase tracking-wide text-slate-400">更新时间</p>
              <p className="mt-2 text-base font-semibold text-slate-800">{updatedAtText}</p>
            </div>
            <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
              <p className="text-xs uppercase tracking-wide text-slate-400">文件大小</p>
              <p className="mt-2 text-base font-semibold text-slate-800">{fileSizeText}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600"
              onClick={handleGoReport}
              disabled={!hasImages}
            >
              查看评估报告
            </button>
            <button
              className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600"
              onClick={handleGoComparison}
              disabled={!selectedTask}
            >
              查看效果对比
            </button>
            <button
              className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600"
              onClick={handleBackHome}
            >
              返回上传
            </button>
          </div>
        </section>
      </div>

      <aside className="rounded-3xl bg-white/95 p-6 shadow-card">
        <div className="space-y-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.35em] text-slate-400">图像信息</p>
              <h3 className="mt-2 truncate text-xl font-semibold text-slate-900" title={detailTitle}>
                {detailTitle}
              </h3>
              <p className="mt-1 truncate text-xs text-slate-500">ID：{selectedTask?.id ?? "--"}</p>
            </div>
            <div className="shrink-0 text-right text-xs text-slate-500">
              <p className="text-[11px] uppercase tracking-[0.3em] text-slate-400">状态</p>
              <div className="mt-2">
                {selectedTask?.status ? (
                  <StatusBadge status={selectedTask.status} size="sm" />
                ) : isFetchingTaskDetail ? (
                  <span className="text-[11px] text-slate-400">同步中…</span>
                ) : (
                  "--"
                )}
              </div>
            </div>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm text-slate-500">
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-400">文件大小</dt>
              <dd className="font-semibold text-slate-700">{fileSizeText}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-400">更新时间</dt>
              <dd className="font-semibold text-slate-700">{updatedAtText}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-400">原图链接</dt>
              <dd className="truncate text-indigo-500">
                {beforeImage ? (
                  <a href={beforeImage} target="_blank" rel="noreferrer">
                    查看
                  </a>
                ) : (
                  "--"
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-400">模型输出</dt>
              <dd className="truncate text-indigo-500">
                {afterImage ? (
                  <a href={afterImage} target="_blank" rel="noreferrer">
                    查看
                  </a>
                ) : (
                  "待生成"
                )}
              </dd>
            </div>
          </dl>
          <div className="rounded-2xl border border-slate-100 bg-white/80 p-4">
            <p className="text-sm font-semibold text-slate-700">AI 模型</p>
            <p className="text-xs text-slate-500">选择超分模型组合（仅一项），提交后重新排队处理。</p>
            <div className="mt-3 space-y-3">
              <div className="space-y-2">
                <label className="text-xs text-slate-500">模型组合</label>
                <select
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700"
                  value={selectedComboId}
                  onChange={(event) => setSelectedComboId(event.target.value)}
                  disabled={isApplying}
                >
                  {MODEL_COMBOS.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>
              <button
                className="w-full rounded-full bg-gradient-to-r from-brand-primary to-brand-secondary px-4 py-2 text-sm font-semibold text-white shadow disabled:cursor-not-allowed disabled:opacity-70"
                onClick={handleApplyModel}
                disabled={isApplying || !selectedTask}
              >
                {isApplying ? "提交中…" : "提交模型切换"}
              </button>
              <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
                <p>当前：{currentCombo.label}</p>
              </div>
              {statusMessage ? <p className="text-sm text-emerald-600">{statusMessage}</p> : null}
              {errorMessage ? <p className="text-sm text-rose-500">{errorMessage}</p> : null}
            </div>
          </div>
        </div>
      </aside>

    </div>
  );
};
