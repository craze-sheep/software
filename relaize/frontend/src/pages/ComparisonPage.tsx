import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { fetchTasks, resolveFileUrl } from "../lib/api";
import type { TaskSummary } from "../types/tasks";

type ComparisonMode = "split" | "slider" | "zoom";

const modes: { key: ComparisonMode; label: string }[] = [
  { key: "split", label: "分屏对比" },
  { key: "slider", label: "滑动对比" },
  { key: "zoom", label: "局部放大" },
];

export const ComparisonPage = () => {
  const [mode, setMode] = useState<ComparisonMode>("split");
  const [sliderPosition, setSliderPosition] = useState(50);
  const navigate = useNavigate();
  const location = useLocation();
  const initialTaskId =
    (location.state as { taskId?: string } | null)?.taskId ?? null;
  const [activeTool, setActiveTool] = useState("🔍 放大镜");
  const [downloadInfo, setDownloadInfo] = useState<string | null>(null);
  const { data: tasks = [], isFetching } = useQuery<TaskSummary[]>({
    queryKey: ["tasks"],
    queryFn: () => fetchTasks(),
  });
  const completedTasks = tasks.filter((task) => task.preview_url && task.source_url);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(initialTaskId);

  const selectedTask: TaskSummary | undefined = useMemo(() => {
    if (!selectedTaskId) {
      return completedTasks[0];
    }
    return completedTasks.find((task) => task.id === selectedTaskId) ?? completedTasks[0];
  }, [completedTasks, selectedTaskId]);

  const resolvedSourceUrl = resolveFileUrl(selectedTask?.source_url);
  const resolvedPreviewUrl = resolveFileUrl(selectedTask?.preview_url);
  const beforeImage = resolvedSourceUrl ?? "/placeholder.svg?height=600&width=800";
  const afterImage = resolvedPreviewUrl ?? "/placeholder.svg?height=600&width=800";
  const stats = useMemo(
    () => [
      {
        label: "UIQM",
        value: selectedTask?.metrics?.uiqm?.after
          ? selectedTask.metrics.uiqm.after.toString()
          : "--",
        hint: selectedTask?.metrics?.uiqm
          ? `${selectedTask.metrics.uiqm.before} → ${selectedTask.metrics.uiqm.after}`
          : "待处理",
      },
      {
        label: "UCIQE",
        value: selectedTask?.metrics?.uciqe?.after
          ? selectedTask.metrics.uciqe.after.toString()
          : "--",
        hint: selectedTask?.metrics?.uciqe
          ? `${selectedTask.metrics.uciqe.before} → ${selectedTask.metrics.uciqe.after}`
          : "待处理",
      },
      {
        label: "Entropy",
        value: selectedTask?.metrics?.entropy?.after
          ? selectedTask.metrics.entropy.after.toString()
          : "--",
        hint: selectedTask?.metrics?.entropy
          ? `${selectedTask.metrics.entropy.before} → ${selectedTask.metrics.entropy.after}`
          : "待处理",
      },
      {
        label: "状态",
        value: selectedTask?.status ?? "--",
        hint: selectedTask?.processed_at ?? "",
      },
    ],
    [selectedTask],
  );

  const toolOptions = [
    {
      label: "🔍 放大镜",
      description: "开启虚拟放大镜，观察局部纹理变化。",
    },
    {
      label: "📍 标注工具",
      description: "为可疑区域添加标注，便于质检沟通。",
    },
    {
      label: "🔄 同步浏览",
      description: "左右图保持同步缩放，方便逐像素比对。",
    },
    {
      label: "📊 显示指标",
      description: "叠加 UIQM / UCIQE 曲线，快速识别异常。",
    },
    {
      label: "⬇️ 导出对比图",
      description: "导出当前模式视图，生成 PPT 报告素材。",
    },
  ];

  const handleDownload = async () => {
    if (!resolvedPreviewUrl || !selectedTask) return;
    setDownloadInfo("正在准备下载…");
    try {
      const response = await fetch(resolvedPreviewUrl);
      if (!response.ok) {
        throw new Error("无法获取修复结果");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `enhanced-${selectedTask.filename}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setDownloadInfo("修复图像已保存到本地。");
    } catch (error) {
      console.error(error);
      setDownloadInfo("下载失败，请稍后重试。");
    }
  };

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-4 rounded-3xl bg-slate-900 p-6 text-white shadow-card md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">🔍 效果对比</h2>
          <p className="text-sm text-slate-300">切换不同模式查看修复前后的差异</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            className="rounded-full border border-white/30 bg-white/10 px-4 py-2 text-sm text-white"
            value={selectedTask?.id ?? ""}
            onChange={(event) => setSelectedTaskId(event.target.value)}
            disabled={!completedTasks.length}
          >
            {!completedTasks.length ? (
              <option value="">暂无完成任务</option>
            ) : (
              completedTasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.filename} · {task.status}
                </option>
              ))
            )}
          </select>
          {modes.map((item) => (
            <button
              key={item.key}
              className={`rounded-full px-4 py-2 text-sm font-semibold ${
                mode === item.key ? "bg-white/20" : "bg-white/10 hover:bg-white/20"
              }`}
              onClick={() => setMode(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>

      {!completedTasks.length ? (
        <div className="rounded-3xl bg-white/90 p-8 text-center text-slate-500 shadow-card">
          {isFetching ? "正在同步任务，请稍候…" : "暂无完成任务，请在上传页提交图像并等待处理完成。"}
        </div>
      ) : null}

      {completedTasks.length && mode === "split" ? (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="relative overflow-hidden rounded-3xl bg-slate-900">
            <div className="absolute left-4 top-4 rounded-full bg-brand-primary/80 px-3 py-1 text-sm font-semibold text-white">
              原始图像
            </div>
            <img src={beforeImage} alt="原始图像" className="h-full w-full object-contain bg-black" />
          </div>
          <div className="relative overflow-hidden rounded-3xl bg-slate-900">
            <div className="absolute left-4 top-4 rounded-full bg-emerald-500/80 px-3 py-1 text-sm font-semibold text-white">
              修复后图像
            </div>
            <img src={afterImage} alt="修复后图像" className="h-full w-full object-contain bg-black" />
          </div>
        </div>
      ) : null}

      {completedTasks.length && mode === "slider" ? (
        <div className="relative h-[420px] overflow-hidden rounded-3xl bg-slate-900 shadow-card">
          <img
            src={beforeImage}
            alt="原始图像"
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div
            className="absolute inset-0 overflow-hidden"
            style={{ clipPath: `inset(0 ${100 - sliderPosition}% 0 0)` }}
          >
            <img
              src={afterImage}
              alt="修复后图像"
              className="h-full w-full object-cover"
            />
          </div>
          <div
            className="absolute inset-y-0"
            style={{ left: `${sliderPosition}%` }}
          >
            <div className="h-full w-1 bg-white/70" />
            <div className="absolute top-1/2 -translate-y-1/2 whitespace-nowrap rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-slate-700">
              ⟨ 拖动比较 ⟩
            </div>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={sliderPosition}
            onChange={(event) => setSliderPosition(parseInt(event.target.value, 10))}
            className="absolute bottom-4 left-1/2 w-1/2 -translate-x-1/2"
          />
        </div>
      ) : null}

      {completedTasks.length && mode === "zoom" ? (
        <div className="grid gap-4 md:grid-cols-[1.2fr,0.8fr]">
          <div className="rounded-3xl bg-white/90 p-6 shadow-card">
            <h3 className="text-lg font-semibold text-slate-800">同步浏览</h3>
            <p className="text-sm text-slate-500">
              选择 ROI（感兴趣区域）并查看像素级变化。后续将接入 Konva 实现真实标注与放大镜。
            </p>
            <div className="mt-4 grid gap-4 rounded-2xl bg-slate-900 p-4 md:grid-cols-2">
              <img src={beforeImage} alt="原始" className="h-72 w-full rounded-xl object-cover" />
              <img src={afterImage} alt="修复" className="h-72 w-full rounded-xl object-cover" />
            </div>
          </div>
          <div className="space-y-4 rounded-3xl bg-white/90 p-6 shadow-card">
            <h3 className="text-lg font-semibold text-slate-800">工具栏</h3>
            {toolOptions.map((tool) => (
              <button
                key={tool.label}
                className={`w-full rounded-xl border px-4 py-2 text-left text-sm font-semibold transition ${
                  activeTool === tool.label
                    ? "border-brand-primary bg-indigo-50 text-brand-primary"
                    : "border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
                onClick={() => setActiveTool(tool.label)}
              >
                {tool.label}
              </button>
            ))}
            <p className="rounded-2xl bg-slate-50 p-3 text-xs text-slate-500">
              {toolOptions.find((tool) => tool.label === activeTool)?.description}
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-3xl bg-white/90 p-4 text-center shadow-card">
            <p className="text-sm text-slate-500">{stat.label}</p>
            <p className="text-3xl font-bold text-slate-800">{stat.value}</p>
            <p className="text-xs text-slate-500">{stat.hint}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className="flex-1 rounded-full bg-gradient-to-r from-brand-primary to-brand-secondary px-6 py-3 font-semibold text-white shadow disabled:cursor-not-allowed disabled:opacity-60"
          onClick={handleDownload}
          disabled={!resolvedPreviewUrl}
        >
          ✓ 保存修复图像
        </button>
        <button
          type="button"
          className="flex-1 rounded-full bg-slate-900 px-6 py-3 font-semibold text-white"
          onClick={() => navigate("/report")}
        >
          📊 查看详细报告
        </button>
        <button
          type="button"
          className="flex-1 rounded-full border border-slate-300 px-6 py-3 font-semibold text-slate-600"
          onClick={() => navigate("/")}
        >
          ↩️ 返回首页
        </button>
      </div>
      {downloadInfo ? (
        <p className="text-center text-xs text-slate-500">{downloadInfo}</p>
      ) : null}
    </div>
  );
};
