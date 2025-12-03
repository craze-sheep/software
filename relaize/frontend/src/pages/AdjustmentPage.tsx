import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { SliderControl } from "../components/ui/SliderControl";
import { useAdjustmentStore } from "../store/adjustmentStore";
import type { AdjustmentKey } from "../store/adjustmentStore";
import { applyAdjustments, fetchTaskDetail, fetchTaskPreview, fetchTasks, resolveFileUrl } from "../lib/api";
import type { AdjustmentPayload, TaskDetail, TaskSummary } from "../types/tasks";
import { StatusBadge } from "../components/ui/StatusBadge";

type PresetOption = {
  id: "night" | "haze" | "vintage" | "daily";
  label: string;
  icon: string;
  description: string;
  values: Partial<Record<AdjustmentKey, number>>;
};

const PRESET_OPTIONS: PresetOption[] = [
  {
    id: "night",
    label: "夜景增强",
    icon: "🌙",
    description: "提升亮度动态范围，压制噪声并保留细节。",
    values: {
      compensation: 75,
      colorTemp: 12,
      saturation: 130,
      contrast: 1.7,
      sharpness: 55,
      dehaze: 35,
      denoise: 45,
      edgePreserve: 70,
    },
  },
  {
    id: "haze",
    label: "雾霾去除",
    icon: "🌫️",
    description: "强化对比度和去雾能力，恢复远景层次。",
    values: {
      compensation: 65,
      colorTemp: 6,
      saturation: 115,
      contrast: 1.8,
      sharpness: 50,
      dehaze: 80,
      denoise: 40,
      edgePreserve: 72,
    },
  },
  {
    id: "vintage",
    label: "老照片修复",
    icon: "🧾",
    description: "校正褪色并适度锐化，兼顾历史质感。",
    values: {
      compensation: 80,
      colorTemp: -8,
      saturation: 125,
      contrast: 1.6,
      sharpness: 60,
      dehaze: 40,
      denoise: 60,
      edgePreserve: 65,
    },
  },
  {
    id: "daily",
    label: "日常美化",
    icon: "✨",
    description: "快速提亮与色彩增强，适合社交分享。",
    values: {
      compensation: 60,
      colorTemp: 15,
      saturation: 118,
      contrast: 1.3,
      sharpness: 40,
      dehaze: 30,
      denoise: 25,
      edgePreserve: 68,
    },
  },
];

const PRESET_STORAGE_KEY = "adjustment:lastPreset";
type ModelOption = {
  id: string;
  label: string;
  description: string;
};

const MODEL_OPTIONS: ModelOption[] = [
  { id: "RealESRGAN_RealESRGAN_x4plus_4x", label: "RealESRGAN 4x", description: "通用写实增强" },
  { id: "HAT_Real_GAN_4x", label: "HAT Real 4x", description: "夜景/低光更佳" },
  { id: "SwinIR_realSR_BSRGAN_DFOWMFC_s64w8_SwinIR_L_GAN_4x", label: "SwinIR 实景 4x", description: "雾霾与去雾场景" },
  { id: "DAT_light_2x", label: "DAT 2x", description: "日常/轻量增强" },
  { id: "RealCUGAN_Conservative_2x", label: "RealCUGAN 2x", description: "动画/插画" },
];

const PRESET_DEFAULT_MODELS: Record<PresetOption["id"], string> = {
  night: "HAT_Real_GAN_4x",
  haze: "SwinIR_realSR_BSRGAN_DFOWMFC_s64w8_SwinIR_L_GAN_4x",
  vintage: "RealESRGAN_RealESRGAN_x4plus_4x",
  daily: "DAT_light_2x",
};

const isPresetOptionId = (value: string | null | undefined): value is PresetOption["id"] =>
  Boolean(value && PRESET_OPTIONS.some((option) => option.id === value));

type StoredPreset = {
  parameters: Record<AdjustmentKey, number>;
  presetId: PresetOption["id"] | "custom";
  savedAt: string;
  modelId?: string;
};

const loadStoredPreset = (): StoredPreset | null => {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(PRESET_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredPreset;
    if (!parsed?.parameters) return null;
    return parsed;
  } catch (error) {
    console.warn("Failed to parse stored preset", error);
    return null;
  }
};

const persistStoredPreset = (snapshot: StoredPreset) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(snapshot));
  } catch (error) {
    console.warn("Failed to persist preset", error);
  }
};

export const AdjustmentPage = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { parameters, setParameter: setParameterBase, setParameters, reset } = useAdjustmentStore();
  const { data: tasks = [], isFetching: isFetchingTasks } = useQuery<TaskSummary[]>({
    queryKey: ["tasks"],
    queryFn: () => fetchTasks(),
    refetchInterval: 8000,
  });
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activePresetId, setActivePresetId] = useState<PresetOption["id"] | "custom">("custom");
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [activeModelId, setActiveModelId] = useState<string>(MODEL_OPTIONS[0].id);
  const [hasLocalChanges, setHasLocalChanges] = useState(false);
  const [lastSubmittedTaskId, setLastSubmittedTaskId] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewRequestRef = useRef(0);

  useEffect(() => {
    if (!tasks.length) return;
    setSelectedTaskId((current) => {
      if (current && tasks.some((task) => task.id === current)) {
        return current;
      }
      return tasks[0].id;
    });
  }, [tasks]);

  const { data: selectedTask, isFetching: isFetchingTaskDetail } = useQuery<TaskDetail>({
    queryKey: ["task-detail", selectedTaskId],
    queryFn: () => fetchTaskDetail(selectedTaskId as string),
    enabled: Boolean(selectedTaskId),
    refetchInterval: 5000,
  });

  const beforeImage = resolveFileUrl(selectedTask?.source_url);
  const afterImage = resolveFileUrl(selectedTask?.preview_url);
  const detailTitle = selectedTask?.filename ?? (isFetchingTaskDetail ? "加载中…" : "暂无任务");
  const updatedAtText = selectedTask?.updated_at
    ? new Date(selectedTask.updated_at).toLocaleString("zh-CN")
    : "--";
  const fileSizeText = selectedTask?.size ? `${(selectedTask.size / 1024 / 1024).toFixed(2)} MB` : "--";

  const isCustomMode = activePresetId === "custom";
  const currentModeLabel =
    activePresetId === "custom"
      ? "自定义"
      : PRESET_OPTIONS.find((option) => option.id === activePresetId)?.label ?? "预设";
  const parameterSignature = useMemo(() => JSON.stringify(parameters), [parameters]);
  const previewOrResultImage = previewImage ?? afterImage ?? null;
  const isPreviewActive = Boolean(previewImage);
  const previewBadgeText = previewImage
    ? isPreviewLoading
      ? "预览生成中…"
      : hasLocalChanges
        ? "草稿预览"
        : "预览最新"
    : hasLocalChanges
      ? isPreviewLoading
        ? "预览生成中…"
        : "等待预览"
      : "预览最新";

  const lastSnapshotKeyRef = useRef<string | null>(null);
  const ensureCustomMode = () => {
    if (activePresetId !== "custom") {
      setActivePresetId("custom");
      setStatusMessage("已切换至自定义模式，可自由拖动滑块。");
      setErrorMessage(null);
    }
  };

  const setParameterWithDirty = (key: AdjustmentKey, value: number) => {
    ensureCustomMode();
    setHasLocalChanges(true);
    setParameterBase(key, value);
  };

  const handleModelChange = (modelId: string) => {
    setActiveModelId(modelId);
    setHasLocalChanges(true);
  };

  const handleResetParameters = () => {
    reset();
    setHasLocalChanges(false);
    setActivePresetId("custom");
    setActiveModelId(MODEL_OPTIONS[0].id);
  };

  useEffect(() => {
    const presetFromStorage = loadStoredPreset();
    const applySnapshot = (snapshot: StoredPreset | null) => {
      reset();
      if (snapshot) {
        setParameters(snapshot.parameters);
        setActivePresetId(snapshot.presetId);
        if (snapshot.modelId) {
          setActiveModelId(snapshot.modelId);
        } else if (snapshot.presetId !== "custom" && PRESET_DEFAULT_MODELS[snapshot.presetId]) {
          setActiveModelId(PRESET_DEFAULT_MODELS[snapshot.presetId]);
        } else {
          setActiveModelId(MODEL_OPTIONS[0].id);
        }
      } else {
        setActivePresetId("custom");
        setActiveModelId(MODEL_OPTIONS[0].id);
      }
      setHasLocalChanges(false);
    };

    if (!selectedTask) {
      if (lastSnapshotKeyRef.current !== "local") {
        lastSnapshotKeyRef.current = "local";
        applySnapshot(presetFromStorage);
      }
      return;
    }

    const snapshotKey = `${selectedTask.id}:${selectedTask.adjustments?.saved_at ?? "none"}`;
    if (hasLocalChanges && lastSnapshotKeyRef.current === snapshotKey) {
      return;
    }
    lastSnapshotKeyRef.current = snapshotKey;

    if (selectedTask.adjustments?.parameters) {
      applySnapshot({
        parameters: selectedTask.adjustments.parameters as Record<AdjustmentKey, number>,
        presetId: isPresetOptionId(selectedTask.adjustments.preset_id)
          ? (selectedTask.adjustments.preset_id as PresetOption["id"])
          : "custom",
        savedAt: selectedTask.adjustments.saved_at ?? new Date().toISOString(),
        modelId:
          "model_name" in selectedTask.adjustments && selectedTask.adjustments.model_name
            ? (selectedTask.adjustments.model_name as string)
            : undefined,
      });
      return;
    }

    applySnapshot(presetFromStorage);
  }, [
    selectedTask?.id,
    selectedTask?.adjustments?.saved_at,
    reset,
    setParameters,
    hasLocalChanges,
  ]);

  useEffect(() => {
    if (!selectedTask?.id) {
      setPreviewImage(null);
      return;
    }

    if (!hasLocalChanges) {
      if (previewTimerRef.current) {
        clearTimeout(previewTimerRef.current);
        previewTimerRef.current = null;
      }
      previewRequestRef.current += 1;
      setIsPreviewLoading(false);
      setPreviewImage(null);
      return;
    }

    if (previewTimerRef.current) {
      clearTimeout(previewTimerRef.current);
    }

    setIsPreviewLoading(true);
    const requestId = previewRequestRef.current + 1;
    previewRequestRef.current = requestId;
    previewTimerRef.current = setTimeout(async () => {
      try {
        const payload: AdjustmentPayload = {
          parameters: { ...parameters },
          preset_id: isCustomMode ? null : activePresetId,
          model_name: activeModelId,
        };
        const response = await fetchTaskPreview(selectedTask.id, payload);
        if (previewRequestRef.current !== requestId) return;
        setPreviewImage(`data:image/png;base64,${response.preview_base64}`);
      } catch (error) {
        if (previewRequestRef.current !== requestId) return;
        setPreviewImage(null);
      } finally {
        if (previewRequestRef.current === requestId) {
          setIsPreviewLoading(false);
        }
      }
    }, 600);

    return () => {
      if (previewTimerRef.current) {
        clearTimeout(previewTimerRef.current);
      }
    };
  }, [selectedTask?.id, parameterSignature, activePresetId, isCustomMode, activeModelId, hasLocalChanges]);

  const sliderConfigs = useMemo<
    {
      key: AdjustmentKey;
      label: string;
      min: number;
      max: number;
      step?: number;
      description?: string;
      formatValue?: (value: number) => string;
    }[]
  >(
    () => [
      {
        key: "compensation",
        label: "颜色补偿",
        min: 0,
        max: 100,
        formatValue: (v: number) => `${v}%`,
        description: "补偿红光衰减，恢复自然色彩",
      },
      {
        key: "colorTemp",
        label: "色温调整",
        min: -50,
        max: 50,
        step: 1,
        formatValue: (v: number) => `${v > 0 ? "+" : ""}${v}`,
        description: "负值偏冷，正值偏暖",
      },
      {
        key: "saturation",
        label: "饱和度增强",
        min: 0,
        max: 200,
        formatValue: (v: number) => `${v}%`,
      },
      {
        key: "contrast",
        label: "对比度强度",
        min: 1,
        max: 3,
        step: 0.1,
        formatValue: (v: number) => v.toFixed(1),
        description: "1.0 表示无增强，3.0 为最强",
      },
      {
        key: "sharpness",
        label: "锐化程度",
        min: 0,
        max: 100,
      },
      {
        key: "dehaze",
        label: "去雾强度",
        min: 0,
        max: 100,
      },
      {
        key: "denoise",
        label: "去噪强度",
        min: 0,
        max: 100,
      },
      {
        key: "edgePreserve",
        label: "保边程度",
        min: 0,
        max: 100,
      },
    ],
    [],
  );

const applyPreset = (presetId: PresetOption["id"]) => {
  const preset = PRESET_OPTIONS.find((item) => item.id === presetId);
  if (!preset) return;
  setParameters(preset.values);
  setActivePresetId(presetId);
  setActiveModelId(PRESET_DEFAULT_MODELS[presetId] ?? MODEL_OPTIONS[0].id);
  setHasLocalChanges(true);
  setStatusMessage(`已应用「${preset.label}」预设，可继续微调后点击应用修复。`);
  setErrorMessage(null);
};

  const handleSavePreset = () => {
    const snapshot: StoredPreset = {
      parameters: { ...parameters },
      presetId: activePresetId,
      savedAt: new Date().toISOString(),
      modelId: activeModelId,
    };
    persistStoredPreset(snapshot);
    setStatusMessage("已保存当前参数组合，下次将默认加载。");
    setErrorMessage(null);
  };

  const handleApply = async () => {
    if (!selectedTask?.id) {
      setErrorMessage("请先选择要处理的任务");
      return;
    }
    const taskId = selectedTask.id;
    const taskName = selectedTask.filename;
    const payload: AdjustmentPayload = {
      parameters: { ...parameters },
      preset_id: isCustomMode ? null : activePresetId,
      model_name: activeModelId,
      note: isCustomMode
        ? `自定义参数（模型：${activeModelId}）`
        : `使用预设「${currentModeLabel}」与模型 ${activeModelId} 提交`,
    };
    setIsApplying(true);
    setStatusMessage("正在提交参数并重新调度修复…");
    setErrorMessage(null);
    try {
      await applyAdjustments(taskId, payload);
      persistStoredPreset({
        parameters: { ...parameters },
        presetId: activePresetId,
        savedAt: new Date().toISOString(),
        modelId: activeModelId,
      });
      setStatusMessage(`「${taskName}」已提交新参数，系统正在重新处理，稍后可在效果对比页查看结果。`);
      setLastSubmittedTaskId(taskId);
      setHasLocalChanges(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["task-detail", taskId] }),
      ]);
    } catch (error) {
      console.error(error);
      setErrorMessage("提交失败，请稍后重试或检查后端日志。");
    } finally {
      setIsApplying(false);
    }
  };

  const handlePreview = () => setIsPreviewOpen(true);

  const handleCustomMode = () => {
    setActivePresetId("custom");
    setStatusMessage("已切换至自定义模式，可自由拖动滑块。");
    setErrorMessage(null);
    setHasLocalChanges(true);
  };

  return (
    <div className="grid gap-6 items-stretch xl:grid-cols-[minmax(0,1.35fr)_280px] 2xl:grid-cols-[minmax(0,1.55fr)_320px]">
      <div className="space-y-6">
        <div className="flex flex-col gap-3 rounded-3xl bg-white/90 p-5 shadow-card md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm text-slate-500">选择需要调参的任务</p>
            <h2 className="text-2xl font-semibold text-slate-800">{detailTitle}</h2>
          </div>
          <div className="w-full max-w-md md:w-96">
            <select
              className="w-full truncate rounded-full border border-slate-200 px-5 py-2.5 text-base text-slate-700"
              value={selectedTaskId ?? ""}
              onChange={(event) => setSelectedTaskId(event.target.value)}
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
              {isPreviewActive ? "调参预览" : "修复后图像"}
            </div>
            {isPreviewActive ? (
              <div className="absolute right-4 top-4 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-slate-600">
                {previewBadgeText}
              </div>
            ) : null}
            {previewOrResultImage ? (
              <img
                src={previewOrResultImage}
                alt={isPreviewActive ? "调参预览" : "修复后图像"}
                className="h-full w-full object-contain bg-black"
              />
            ) : (
              <div className="flex h-64 items-center justify-center text-slate-400">
                {isPreviewActive
                  ? isPreviewLoading
                    ? "生成预览中…"
                    : "暂无预览，可调节参数试试"
                  : "处理未完成，等待 worker 输出"}
              </div>
            )}
          </div>
        </section>

        <section className="space-y-5 rounded-3xl bg-white/90 p-5 shadow-card">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-slate-800">参数调整</h2>
              <p className="text-sm text-slate-500">使用滑块控制颜色、对比度与去噪强度</p>
            </div>
            <span
              className={`rounded-full px-4 py-1 text-sm font-semibold ${
                isCustomMode ? "bg-emerald-50 text-emerald-600" : "bg-indigo-50 text-brand-primary"
              }`}
            >
              当前模式：{currentModeLabel}
            </span>
          </header>
          <div className="grid gap-4 md:grid-cols-4">
            {sliderConfigs.map((config) => (
              <SliderControl
                key={config.key}
                label={config.label}
                value={parameters[config.key]}
                min={config.min}
                max={config.max}
                step={config.step}
                description={config.description}
                formatValue={config.formatValue}
                onValueChange={(value) => setParameterWithDirty(config.key, value)}
              />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3 xl:flex-nowrap xl:gap-4">
            {PRESET_OPTIONS.map((preset) => (
              <button
                key={preset.id}
                className={`rounded-full border px-4 py-2 text-sm font-semibold whitespace-nowrap transition ${
                  activePresetId === preset.id
                    ? "border-brand-primary bg-indigo-50 text-brand-primary"
                    : "border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
                onClick={() => applyPreset(preset.id)}
              >
                <span className="mr-1">{preset.icon}</span>
                {preset.label}
              </button>
            ))}
            <button
              className={`rounded-full border px-4 py-2 text-sm font-semibold whitespace-nowrap ${
                activePresetId === "custom"
                  ? "border-brand-primary bg-indigo-50 text-brand-primary"
                  : "border-slate-200 text-slate-600"
              }`}
              onClick={handleCustomMode}
            >
              🎨 自定义
            </button>
            <button
              className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 whitespace-nowrap"
              onClick={handleResetParameters}
            >
              ↻ 重置参数
            </button>
            <button
              className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 whitespace-nowrap md:ml-auto"
              onClick={handleSavePreset}
            >
              💾 保存预设
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
              <dt className="text-xs uppercase tracking-wide text-slate-400">修复结果</dt>
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
            <p className="text-xs text-slate-500">选择用于 Final2x 超分的模型</p>
            <select
              className="mt-3 w-full rounded-full border border-slate-200 px-4 py-2 text-base text-slate-700"
              value={activeModelId}
              onChange={(event) => handleModelChange(event.target.value)}
            >
              {MODEL_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label} · {option.description}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-4">
            <button
              className="w-full rounded-3xl bg-gradient-to-b from-brand-primary to-brand-secondary px-4 py-4 text-xl font-semibold text-white shadow disabled:cursor-not-allowed disabled:opacity-70"
              onClick={handleApply}
              disabled={isApplying}
            >
              应用修复
            </button>
            <button
              className="w-full rounded-3xl border border-slate-100 bg-white px-4 py-4 text-xl font-semibold text-slate-700 shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
              onClick={handlePreview}
              disabled={!beforeImage && !afterImage}
            >
              全屏预览
            </button>
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-800">调参建议</p>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-600 leading-relaxed">
              <li>夜景/低光场景建议提升补偿和亮度，同时保持 40~50% 去噪。</li>
              <li>雾霾/去雾场景可将“去雾强度”提升到 70 以上，并适度调高饱和度。</li>
              <li>保存参数组合，便于多任务或批量调度时快速复用。</li>
            </ul>
            {statusMessage ? <p className="mt-3 text-sm text-brand-secondary">{statusMessage}</p> : null}
            {errorMessage ? <p className="mt-1 text-sm text-rose-500">{errorMessage}</p> : null}
            {lastSubmittedTaskId ? (
              <button
                className="mt-4 w-full rounded-full border border-brand-primary/30 px-4 py-2 text-sm font-semibold text-brand-primary hover:bg-brand-primary/10"
                onClick={() => navigate(`/comparison?taskId=${lastSubmittedTaskId}`)}
              >
                前往效果对比
              </button>
            ) : null}
          </div>
        </div>
      </aside>

      <PreviewModal
        open={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        beforeImage={beforeImage}
        afterImage={previewOrResultImage}
        isPreviewActive={isPreviewActive}
      />
    </div>
  );
};

type PreviewModalProps = {
  open: boolean;
  onClose: () => void;
  beforeImage?: string | null;
  afterImage?: string | null;
  isPreviewActive?: boolean;
};

const PreviewModal = ({ open, onClose, beforeImage, afterImage, isPreviewActive }: PreviewModalProps) => {
  if (!open) return null;
  const afterLabel = isPreviewActive ? "调参预览" : "修复后图像";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 p-4">
      <div className="w-full max-w-5xl rounded-3xl bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-800">全屏预览</h3>
          <button className="text-slate-500 hover:text-slate-800" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <p className="mb-2 text-sm font-semibold text-slate-600">原始图像</p>
            {beforeImage ? (
              <img src={beforeImage} alt="原始图像" className="h-96 w-full rounded-2xl object-contain bg-black" />
            ) : (
              <div className="flex h-96 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                暂无原始图像
              </div>
            )}
          </div>
          <div>
            <p className="mb-2 text-sm font-semibold text-slate-600">{afterLabel}</p>
            {afterImage ? (
              <img src={afterImage} alt={afterLabel} className="h-96 w-full rounded-2xl object-contain bg-black" />
            ) : (
              <div className="flex h-96 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                {isPreviewActive ? "生成预览中…" : "处理结果稍后生成"}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
