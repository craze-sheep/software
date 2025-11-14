import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { SliderControl } from "../components/ui/SliderControl";
import { useAdjustmentStore } from "../store/adjustmentStore";
import type { AdjustmentKey } from "../store/adjustmentStore";
import { fetchTasks, resolveFileUrl } from "../lib/api";
import type { TaskSummary } from "../types/tasks";

export const AdjustmentPage = () => {
  const { parameters, setParameter, reset } = useAdjustmentStore();
  const { data: tasks = [] } = useQuery<TaskSummary[]>({
    queryKey: ["tasks"],
    queryFn: () => fetchTasks(),
  });
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const selectedTask: TaskSummary | undefined =
    tasks.find((task) => task.id === selectedTaskId) ?? tasks[0];
  const beforeImage = resolveFileUrl(selectedTask?.source_url);
  const afterImage = resolveFileUrl(selectedTask?.preview_url);

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

  return (
    <div className="grid gap-8 lg:grid-cols-[2fr_1fr]">
      <div className="space-y-8">
        <div className="flex flex-col gap-3 rounded-3xl bg-white/90 p-6 shadow-card md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm text-slate-500">选择需要调参的任务</p>
            <h2 className="text-2xl font-semibold text-slate-800">{selectedTask?.filename ?? "暂无任务"}</h2>
          </div>
          <select
            className="rounded-full border border-slate-200 px-4 py-2 text-sm text-slate-700"
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

        <section className="grid gap-4 rounded-3xl bg-white/90 p-6 shadow-card md:grid-cols-2">
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

        <section className="space-y-6 rounded-3xl bg-white/90 p-6 shadow-card">
          <header>
            <h2 className="text-xl font-semibold text-slate-800">参数调整</h2>
            <p className="text-sm text-slate-500">使用滑块控制颜色、对比度与去噪强度</p>
          </header>
          <div className="grid gap-4 md:grid-cols-2">
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
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-3">
            {["📌 浅水场景", "🌊 深水场景", "💨 浑浊水体", "🎨 自定义"].map((preset) => (
              <button key={preset} className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600">
                {preset}
              </button>
            ))}
            <button className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600" onClick={reset}>
              ↻ 重置参数
            </button>
            <button className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600">
              💾 保存预设
            </button>
          </div>
        </section>
      </div>

      <aside className="space-y-6 rounded-3xl bg-white/90 p-6 shadow-card">
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
              <dd className="font-semibold text-slate-700">{selectedTask?.status ?? "--"}</dd>
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
          <button className="w-full rounded-full bg-gradient-to-r from-brand-primary to-brand-secondary px-4 py-3 font-semibold text-white shadow">
            ✓ 应用修复
          </button>
          <button className="w-full rounded-full border border-slate-200 px-4 py-3 font-semibold text-slate-600">
            👁️ 全屏预览
          </button>
          <button className="w-full rounded-full border border-slate-200 px-4 py-3 font-semibold text-slate-600">
            📋 对比详情
          </button>
        </div>
        <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
          <p>• 对于浑浊水体，适当增加去雾强度。</p>
          <p>• 避免过度锐化导致伪影，可结合局部预览观察。</p>
          <p>• 保存参数组合，便于批量任务快速调用。</p>
        </div>
      </aside>
    </div>
  );
};
