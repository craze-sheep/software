import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { fetchTasks, processTask } from "../lib/api";
import type { TaskSummary } from "../types/tasks";
import { TaskDetailPanel } from "../components/tasks/TaskDetailPanel";

type Preset = {
  id: string;
  title: string;
  description: string;
  runtime: string;
  steps: string[];
  recommended?: string;
};

const presets: Preset[] = [
  {
    id: "balanced",
    title: "平衡增强",
    description: "多段颜色补偿 + 自适应对比度，适合大多数蓝绿色水体。",
    runtime: "≈1.2×",
    recommended: "观光/娱乐拍摄",
    steps: ["自动白平衡", "多尺度去雾", "保边锐化"],
  },
  {
    id: "deep",
    title: "深水强化",
    description: "强化红光回补与局部对比度，提升极暗深水区域的细节。",
    runtime: "≈1.5×",
    recommended: "深潜、低照度",
    steps: ["暗通道抑制", "红光回补", "纹理增强"],
  },
  {
    id: "turbid",
    title: "浑浊净化",
    description: "侧重去雾和去噪，控制锐化幅度，避免伪影。",
    runtime: "≈1.0×",
    recommended: "泥沙/浮游物较多",
    steps: ["谱域去雾", "可变去噪", "边缘保护"],
  },
];

const guardOptions = [
  { key: "color", label: "颜色护栏", description: "限制色偏，防止过饱和" },
  { key: "noise", label: "降噪护栏", description: "自动检测高噪区域并额外平滑" },
  { key: "contrast", label: "对比度护栏", description: "防止亮度拉伸过度" },
];

export const AutoEnhancePage = () => {
  const [selectedPresetId, setSelectedPresetId] = useState(presets[0]?.id ?? "balanced");
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const [intensity, setIntensity] = useState(60);
  const [activeGuards, setActiveGuards] = useState<Record<string, boolean>>({
    color: true,
    noise: true,
    contrast: true,
  });
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const { data: tasks = [], isFetching, refetch } = useQuery<TaskSummary[]>({
    queryKey: ["tasks", "auto"],
    queryFn: () => fetchTasks({ limit: 80 }),
  });

  const actionableTasks = useMemo(
    () => tasks.filter((task) => task.status !== "completed"),
    [tasks],
  );

  const stats = useMemo(() => {
    const pending = tasks.filter((task) => task.status === "pending").length;
    const processing = tasks.filter((task) => task.status === "processing").length;
    const failed = tasks.filter((task) => task.status === "failed").length;
    return { pending, processing, failed };
  }, [tasks]);

  const selectedPreset =
    presets.find((preset) => preset.id === selectedPresetId) ?? presets[0];

  const toggleTask = (taskId: string) => {
    setSelectedTaskIds((prev) =>
      prev.includes(taskId)
        ? prev.filter((id) => id !== taskId)
        : [...prev, taskId],
    );
  };

  const handleSelectAll = () => {
    setSelectedTaskIds(actionableTasks.map((task) => task.id));
  };

  const handleClearSelection = () => {
    setSelectedTaskIds([]);
  };

  const handleRunPreset = async () => {
    if (!selectedTaskIds.length) {
      setErrorMessage("请至少勾选一个待处理任务");
      setStatusMessage(null);
      return;
    }

    setIsRunning(true);
    setStatusMessage(`正在执行「${selectedPreset.title}」策略…`);
    setErrorMessage(null);

    const failed: string[] = [];
    for (const id of selectedTaskIds) {
      try {
        await processTask(id);
      } catch (error) {
        console.error(error);
        failed.push(id);
      }
    }

    if (failed.length) {
      setErrorMessage(`有 ${failed.length} 个任务提交失败，请稍后重试。`);
      setStatusMessage(
        failed.length === selectedTaskIds.length
          ? null
          : `${selectedTaskIds.length - failed.length} 个任务已成功加入自动修复队列。`,
      );
      setSelectedTaskIds(failed);
    } else {
      setStatusMessage(
        `${selectedTaskIds.length} 个任务已使用 ${selectedPreset.title}（强度 ${intensity}%）执行自动修复。`,
      );
      setSelectedTaskIds([]);
    }

    await refetch();
    setIsRunning(false);
  };

  return (
    <div className="space-y-8">
      <header className="rounded-3xl bg-gradient-to-r from-brand-primary to-brand-secondary p-8 text-white shadow-card">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.3em] opacity-80">自动修复编排中心</p>
            <h2 className="text-3xl font-bold">⚡ 一键调度智能修复流水线</h2>
            <p className="text-sm opacity-80">
              选择策略 → 勾选任务 → 执行，即可让后端排产所有自动修复步骤。
            </p>
          </div>
          <div className="flex gap-6 text-right text-sm">
            <div>
              <p className="opacity-70">待处理</p>
              <p className="text-2xl font-semibold">{stats.pending}</p>
            </div>
            <div>
              <p className="opacity-70">处理中</p>
              <p className="text-2xl font-semibold">{stats.processing}</p>
            </div>
            <div>
              <p className="opacity-70">失败重试</p>
              <p className="text-2xl font-semibold">{stats.failed}</p>
            </div>
          </div>
        </div>
      </header>

      <section className="grid gap-6 rounded-3xl bg-white/90 p-8 shadow-card md:grid-cols-[1.3fr,0.7fr]">
        <div>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-slate-800">🧠 策略模版</h3>
              <p className="text-sm text-slate-500">针对不同水体准备了预设管线，可随时切换。</p>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
              {selectedPreset.runtime} · {selectedPreset.recommended}
            </span>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {presets.map((preset) => (
              <button
                key={preset.id}
                className={`rounded-2xl border px-4 py-4 text-left transition ${
                  preset.id === selectedPresetId
                    ? "border-brand-primary bg-indigo-50"
                    : "border-slate-200 hover:border-brand-primary/50"
                }`}
                onClick={() => setSelectedPresetId(preset.id)}
              >
                <p className="text-sm font-semibold text-slate-800">{preset.title}</p>
                <p className="mt-2 text-xs text-slate-500">{preset.description}</p>
                <ul className="mt-3 list-disc pl-5 text-xs text-slate-500">
                  {preset.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ul>
              </button>
            ))}
          </div>
          <div className="mt-6 rounded-2xl bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-700">
              自动修复强度：<span className="text-brand-secondary">{intensity}%</span>
            </p>
            <input
              type="range"
              min={20}
              max={100}
              value={intensity}
              onChange={(event) => setIntensity(parseInt(event.target.value, 10))}
              className="mt-3 w-full"
            />
            <p className="text-xs text-slate-500">
              强度越高意味着更激进的颜色补偿和锐化，可能增加噪点。
            </p>
          </div>
        </div>
        <div className="space-y-4 rounded-2xl border border-slate-100 bg-slate-50 p-4">
          <h3 className="text-sm font-semibold text-slate-700">安全护栏</h3>
          {guardOptions.map((item) => (
            <label key={item.key} className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4"
                checked={activeGuards[item.key]}
                onChange={(event) =>
                  setActiveGuards((prev) => ({ ...prev, [item.key]: event.target.checked }))
                }
              />
              <div>
                <p className="text-sm font-semibold text-slate-800">{item.label}</p>
                <p className="text-xs text-slate-500">{item.description}</p>
              </div>
            </label>
          ))}
          <div className="rounded-xl border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-500">
            当前策略将：{selectedPreset.steps.join(" → ")}，强度 {intensity}% ·{" "}
            {Object.entries(activeGuards)
              .filter(([, enabled]) => enabled)
              .map(([key]) => guardOptions.find((guard) => guard.key === key)?.label)
              .join(" / ") || "未启用护栏"}
          </div>
        </div>
      </section>

      <section className="rounded-3xl bg-white/90 p-8 shadow-card">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-800">📋 待处理任务</h3>
            <p className="text-sm text-slate-500">
              {isFetching
                ? "正在同步…"
                : actionableTasks.length
                  ? `共 ${actionableTasks.length} 条可提交的任务`
                  : "暂无需要自动修复的任务"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600"
              onClick={handleSelectAll}
              disabled={!actionableTasks.length}
            >
              全选
            </button>
            <button
              className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600"
              onClick={handleClearSelection}
              disabled={!selectedTaskIds.length}
            >
              清空
            </button>
            <button
              className="rounded-full bg-gradient-to-r from-brand-primary to-brand-secondary px-5 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70"
              onClick={handleRunPreset}
              disabled={isRunning || !selectedTaskIds.length}
            >
              {isRunning ? "提交中…" : `⚡ 执行 ${selectedPreset.title}`}
            </button>
          </div>
        </div>

        {actionableTasks.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed border-slate-200 p-8 text-center text-slate-400">
            所有任务都已完成，前往上传页添加新的图像即可触发自动修复。
          </div>
        ) : (
          <div className="mt-6 space-y-3">
            {actionableTasks.map((task) => (
              <label
                key={task.id}
                className="flex flex-col gap-3 rounded-2xl border border-slate-100 bg-white/80 p-4 shadow-sm md:flex-row md:items-center md:justify-between"
              >
                <div className="flex flex-1 items-center gap-3">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={selectedTaskIds.includes(task.id)}
                    onChange={() => toggleTask(task.id)}
                  />
                  <div>
                    <p className="font-semibold text-slate-800">{task.filename}</p>
                    <p className="text-xs text-slate-500">
                      {new Date(task.created_at).toLocaleString("zh-CN")} ·{" "}
                      {task.size ? `${(task.size / 1024 / 1024).toFixed(2)} MB` : "未知大小"}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      task.status === "failed"
                        ? "bg-rose-100 text-rose-600"
                        : task.status === "processing"
                          ? "bg-blue-100 text-blue-600"
                          : "bg-amber-100 text-amber-600"
                    }`}
                  >
                    {task.status}
                  </span>
                  <button
                    type="button"
                    className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600"
                    onClick={() => setDetailTaskId(task.id)}
                  >
                    查看详情
                  </button>
                </div>
              </label>
            ))}
          </div>
        )}

        {(statusMessage || errorMessage) && (
          <div className="mt-6 rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm">
            {statusMessage ? <p className="text-slate-700">{statusMessage}</p> : null}
            {errorMessage ? <p className="text-rose-500">{errorMessage}</p> : null}
          </div>
        )}
      </section>

      {detailTaskId ? (
        <TaskDetailPanel taskId={detailTaskId} onClose={() => setDetailTaskId(null)} />
      ) : null}
    </div>
  );
};

