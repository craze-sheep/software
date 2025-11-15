import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { SliderControl } from "../components/ui/SliderControl";
import { useAdjustmentStore } from "../store/adjustmentStore";
import type { AdjustmentKey } from "../store/adjustmentStore";
import { applyAdjustments, fetchTasks, resolveFileUrl } from "../lib/api";
import type { AdjustmentPayload, TaskSummary } from "../types/tasks";
import { StatusBadge } from "../components/ui/StatusBadge";

type PresetOption = {
  id: "shallow" | "deep" | "turbid";
  label: string;
  icon: string;
  description: string;
  values: Partial<Record<AdjustmentKey, number>>;
};

const PRESET_OPTIONS: PresetOption[] = [
  {
    id: "shallow",
    label: "浅水场景",
    icon: "📌",
    description: "清澈浅水，侧重色温与适度对比。",
    values: {
      compensation: 55,
      colorTemp: 8,
      saturation: 115,
      contrast: 1.4,
      dehaze: 25,
      denoise: 35,
      edgePreserve: 70,
    },
  },
  {
    id: "deep",
    label: "深水场景",
    icon: "🌊",
    description: "红光缺失明显，加强补偿与锐化。",
    values: {
      compensation: 85,
      colorTemp: 28,
      saturation: 130,
      contrast: 2.2,
      sharpness: 70,
      dehaze: 60,
      denoise: 45,
    },
  },
  {
    id: "turbid",
    label: "浑浊水体",
    icon: "💨",
    description: "控制锐化，优先降噪与去雾。",
    values: {
      compensation: 65,
      saturation: 105,
      contrast: 1.3,
      sharpness: 40,
      dehaze: 80,
      denoise: 70,
      edgePreserve: 80,
    },
  },
];

const PRESET_STORAGE_KEY = "adjustment:lastPreset";

const isPresetOptionId = (value: string | null | undefined): value is PresetOption["id"] =>
  Boolean(value && PRESET_OPTIONS.some((option) => option.id === value));

type StoredPreset = {
  parameters: Record<AdjustmentKey, number>;
  presetId: PresetOption["id"] | "custom";
  savedAt: string;
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
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { parameters, setParameter, setParameters, reset } = useAdjustmentStore();
  const { data: tasks = [] } = useQuery<TaskSummary[]>({
    queryKey: ["tasks"],
    queryFn: () => fetchTasks(),
  });
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activePresetId, setActivePresetId] = useState<PresetOption["id"] | "custom">("custom");
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const selectedTask: TaskSummary | undefined =
    tasks.find((task) => task.id === selectedTaskId) ?? tasks[0];
  const beforeImage = resolveFileUrl(selectedTask?.source_url);
  const afterImage = resolveFileUrl(selectedTask?.preview_url);
  const isCustomMode = activePresetId === "custom";
  const currentModeLabel =
    activePresetId === "custom"
      ? "自定义"
      : PRESET_OPTIONS.find((option) => option.id === activePresetId)?.label ?? "预设";

  useEffect(() => {
    const presetFromStorage = loadStoredPreset();
    const applySnapshot = (snapshot: StoredPreset | null) => {
      reset();
      if (snapshot) {
        setParameters(snapshot.parameters);
        setActivePresetId(snapshot.presetId);
      } else {
        setActivePresetId("custom");
      }
    };

    if (!selectedTask) {
      applySnapshot(presetFromStorage);
      return;
    }

    if (selectedTask.adjustments?.parameters) {
      applySnapshot({
        parameters: selectedTask.adjustments.parameters as Record<AdjustmentKey, number>,
        presetId: isPresetOptionId(selectedTask.adjustments.preset_id)
          ? (selectedTask.adjustments.preset_id as PresetOption["id"])
          : "custom",
        savedAt: selectedTask.adjustments.saved_at ?? new Date().toISOString(),
      });
      return;
    }

    applySnapshot(presetFromStorage);
  }, [selectedTask?.id, selectedTask?.adjustments?.saved_at, reset, setParameters]);

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
    setStatusMessage(`已应用「${preset.label}」预设，可继续微调后点击应用修复。`);
    setErrorMessage(null);
  };

  const handleSavePreset = () => {
    const snapshot: StoredPreset = {
      parameters: { ...parameters },
      presetId: activePresetId,
      savedAt: new Date().toISOString(),
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
      note: isCustomMode ? "自定义调参参数" : `使用预设「${currentModeLabel}」提交`,
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
      });
      setStatusMessage(`「${taskName}」已提交新参数，任务已重新排队处理。`);
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

  const handleComparison = () => {
    if (!selectedTask) return;
    navigate("/comparison", { state: { taskId: selectedTask.id } });
  };

  const handleCustomMode = () => {
    setActivePresetId("custom");
    setStatusMessage("已切换至自定义模式，可自由拖动滑块。");
    setErrorMessage(null);
  };

  return (
    <div className="grid gap-6 items-stretch xl:grid-cols-[minmax(0,1.35fr)_280px] 2xl:grid-cols-[minmax(0,1.55fr)_320px]">
      <div className="space-y-6">
        <div className="flex flex-col gap-3 rounded-3xl bg-white/90 p-5 shadow-card md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm text-slate-500">选择需要调参的任务</p>
            <h2 className="text-2xl font-semibold text-slate-800">{selectedTask?.filename ?? "暂无任务"}</h2>
          </div>
          <div className="w-full max-w-md md:w-96">
            <select
              className="w-full truncate rounded-full border border-slate-200 px-5 py-2.5 text-base text-slate-700"
              value={selectedTask?.id ?? ""}
              onChange={(event) => setSelectedTaskId(event.target.value)}
              disabled={!tasks.length}
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
              修复后图像
            </div>
            {afterImage ? (
              <img src={afterImage} alt="修复后图像" className="h-full w-full object-contain bg-black" />
            ) : (
              <div className="flex h-64 items-center justify-center text-slate-400">
                处理未完成，等待 worker 输出
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
                onValueChange={(value) => setParameter(config.key, value)}
                disabled={!isCustomMode}
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
            <button className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 whitespace-nowrap" onClick={reset}>
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

      <aside className="flex h-full flex-col gap-5 rounded-3xl bg-white/90 p-5 shadow-card">
        <div>
          <h3 className="text-lg font-semibold text-slate-800">📊 图像信息</h3>
          <dl className="mt-4 space-y-3 text-sm text-slate-500">
            <div className="flex justify-between">
              <dt>文件名</dt>
              <dd className="font-semibold text-slate-700">{selectedTask?.filename ?? "--"}</dd>
            </div>
            <div className="flex justify-between">
              <dt>大小</dt>
              <dd className="font-semibold text-slate-700">
                {selectedTask?.size ? `${(selectedTask.size / 1024 / 1024).toFixed(2)} MB` : "--"}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt>状态</dt>
              <dd className="font-semibold text-slate-700">
                {selectedTask?.status ? <StatusBadge status={selectedTask.status} size="sm" /> : "--"}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt>更新时间</dt>
              <dd className="font-semibold text-slate-700">
                {selectedTask?.updated_at ? new Date(selectedTask.updated_at).toLocaleString("zh-CN") : "--"}
              </dd>
            </div>
          </dl>
        </div>
        <div className="space-y-3">
          <button
            className="w-full rounded-full bg-gradient-to-r from-brand-primary to-brand-secondary px-4 py-3 font-semibold text-white shadow disabled:cursor-not-allowed disabled:opacity-70"
            onClick={handleApply}
            disabled={isApplying}
          >
            {isApplying ? "提交中…" : "✓ 应用修复"}
          </button>
          <button
            className="w-full rounded-full border border-slate-200 px-4 py-3 font-semibold text-slate-600"
            onClick={handlePreview}
            disabled={!beforeImage && !afterImage}
          >
            👁️ 全屏预览
          </button>
          <button
            className="w-full rounded-full border border-slate-200 px-4 py-3 font-semibold text-slate-600"
            onClick={handleComparison}
            disabled={!selectedTask}
          >
            📋 对比详情
          </button>
        </div>
        <div className="space-y-3 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
          <p>• 对于浑浊水体，适当增加去雾强度。</p>
          <p>• 避免过度锐化导致伪影，可结合局部预览观察。</p>
          <p>• 保存参数组合，便于批量任务快速调用。</p>
          {statusMessage ? <p className="text-brand-secondary">{statusMessage}</p> : null}
          {errorMessage ? <p className="text-rose-500">{errorMessage}</p> : null}
        </div>
      </aside>

      <PreviewModal
        open={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        beforeImage={beforeImage}
        afterImage={afterImage}
      />
    </div>
  );
};

type PreviewModalProps = {
  open: boolean;
  onClose: () => void;
  beforeImage?: string | null;
  afterImage?: string | null;
};

const PreviewModal = ({ open, onClose, beforeImage, afterImage }: PreviewModalProps) => {
  if (!open) return null;
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
            <p className="mb-2 text-sm font-semibold text-slate-600">修复后图像</p>
            {afterImage ? (
              <img src={afterImage} alt="修复后图像" className="h-96 w-full rounded-2xl object-contain bg-black" />
            ) : (
              <div className="flex h-96 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                处理结果稍后生成
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
