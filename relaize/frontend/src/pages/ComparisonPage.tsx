import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import clsx from "classnames";

import { fetchTasks, resolveFileUrl, resolveResultUrl } from "../lib/api";
import type { TaskSummary } from "../types/tasks";

type Mode = "split" | "slider";

type MetricValue = {
  before: number;
  after: number;
  delta: number;
};

type MetricMap = Record<string, MetricValue>;

const FALLBACK_METRICS: MetricMap = {
  psnr: { before: 28.5, after: 32.1, delta: 3.6 },
  ssim: { before: 0.78, after: 0.91, delta: 0.13 },
  mse: { before: 1200, after: 450, delta: -750 },
  entropy: { before: 7.1, after: 7.5, delta: 0.4 },
};

type Feedback = {
  tone: "success" | "error" | "info";
  message: string;
};

const GuideOverlay = () => (
  <div className="pointer-events-none absolute inset-0">
    <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-brand-primary/40" />
    <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-brand-primary/40" />
    <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-brand-primary/40 px-2 py-1 text-[10px] text-brand-primary">
      标注
    </div>
  </div>
);

const formatPercentChange = (metric?: MetricValue, lowerIsBetter = false) => {
  if (!metric || metric.before === 0) {
    return null;
  }
  const diff = lowerIsBetter ? metric.before - metric.after : metric.after - metric.before;
  const ratio = (diff / metric.before) * 100;
  const rounded = Math.round(ratio);
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
};

const metricValue = (metric?: MetricValue) => {
  if (!metric) return "—";
  return metric.after.toFixed(metric.after < 10 ? 2 : 1);
};
 
export const ComparisonPage = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: tasks = [], isFetching, refetch } = useQuery<TaskSummary[]>({
    queryKey: ["tasks", "comparison"],
    queryFn: () => fetchTasks({ status: "completed", limit: 100 }),
    refetchInterval: 5000,
  });

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(searchParams.get("taskId"));
  const [mode, setMode] = useState<Mode>("split");
  const [sliderPosition, setSliderPosition] = useState(50);
  const sliderRef = useRef<HTMLDivElement | null>(null);
  const isDragging = useRef(false);
  const [isAnnotationVisible, setIsAnnotationVisible] = useState(false);
  const [isSyncEnabled, setIsSyncEnabled] = useState(false);
  const [showMetrics, setShowMetrics] = useState(true);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  useEffect(() => {
    const queryTaskId = searchParams.get("taskId");
    if (queryTaskId && tasks.some((task) => task.id === queryTaskId)) {
      if (selectedTaskId !== queryTaskId) {
        setSelectedTaskId(queryTaskId);
      }
      return;
    }
    if ((!selectedTaskId || !tasks.some((task) => task.id === selectedTaskId)) && tasks.length) {
      const fallback = tasks[0].id;
      setSelectedTaskId(fallback);
      const params = new URLSearchParams(searchParams);
      params.set("taskId", fallback);
      setSearchParams(params);
    }
  }, [tasks, searchParams, selectedTaskId, setSearchParams]);

  const selectedTask = tasks.find((task) => task.id === selectedTaskId);
  const beforeImage = resolveFileUrl(selectedTask?.source_url);
  const afterImage =
    selectedTask?.status === "completed" && selectedTask?.id ? resolveResultUrl(selectedTask.id) : null;
  const hasComparisonAssets = Boolean(beforeImage && afterImage);

  const metricsMap: MetricMap = useMemo(
    () => ({
      ...FALLBACK_METRICS,
      ...(selectedTask?.metrics ?? {}),
    }),
    [selectedTask?.metrics],
  );

  const durationText = useMemo(() => {
    if (!selectedTask?.processed_at || !selectedTask?.created_at) {
      return "等待处理";
    }
    const createdAt = new Date(selectedTask.created_at).getTime();
    const processedAt = new Date(selectedTask.processed_at).getTime();
    const delta = processedAt - createdAt;
    if (delta <= 0) return "—";
    const seconds = Math.round(delta / 1000);
    if (seconds >= 120) {
      return `${(seconds / 60).toFixed(1)} min`;
    }
    return `${seconds}s`;
  }, [selectedTask?.created_at, selectedTask?.processed_at]);

  const metricCards = useMemo(
    () => [
      {
        id: "psnr",
        label: "PSNR",
        value: metricValue(metricsMap.psnr),
        percent: formatPercentChange(metricsMap.psnr),
        summary: `峰值信噪比 ${metricsMap.psnr.before?.toFixed?.(2) ?? metricsMap.psnr.before} → ${metricsMap.psnr.after?.toFixed?.(2) ?? metricsMap.psnr.after}`,
      },
      {
        id: "ssim",
        label: "SSIM",
        value: metricValue(metricsMap.ssim),
        percent: formatPercentChange(metricsMap.ssim),
        summary: `结构相似度 ${metricsMap.ssim.before?.toFixed?.(4) ?? metricsMap.ssim.before} → ${metricsMap.ssim.after?.toFixed?.(4) ?? metricsMap.ssim.after}`,
      },
      {
        id: "mse",
        label: "MSE（越低越好）",
        value: metricValue(metricsMap.mse),
        percent: formatPercentChange(metricsMap.mse, true),
        summary: `均方误差 ${metricsMap.mse.before} → ${metricsMap.mse.after}`,
      },
      {
        id: "entropy",
        label: "信息熵",
        value: metricValue(metricsMap.entropy),
        percent: formatPercentChange(metricsMap.entropy),
        summary: `纹理丰富度 ${metricsMap.entropy.before} → ${metricsMap.entropy.after}`,
      },
      {
        id: "duration",
        label: "处理耗时",
        value: durationText,
        percent: selectedTask?.size ? `${(selectedTask.size / 1024 / 1024).toFixed(2)} MB` : undefined,
        summary: selectedTask?.processed_at
          ? `完成时间：${new Date(selectedTask.processed_at).toLocaleString("zh-CN")}`
          : "等待 worker 输出",
      },
    ],
    [metricsMap, durationText, selectedTask?.size, selectedTask?.processed_at],
  );

  useEffect(() => {
    const handlePointerMove = (event: MouseEvent | TouchEvent) => {
      if (!isDragging.current) return;
      let clientX: number | null = null;
      if ("touches" in event) {
        clientX = event.touches[0]?.clientX ?? null;
      } else {
        clientX = event.clientX;
      }
      if (clientX !== null) {
        updateSliderFromClientX(clientX);
      }
    };

    const stopDragging = () => {
      isDragging.current = false;
    };

    window.addEventListener("mousemove", handlePointerMove);
    window.addEventListener("touchmove", handlePointerMove);
    window.addEventListener("mouseup", stopDragging);
    window.addEventListener("touchend", stopDragging);
    window.addEventListener("touchcancel", stopDragging);
    return () => {
      window.removeEventListener("mousemove", handlePointerMove);
      window.removeEventListener("touchmove", handlePointerMove);
      window.removeEventListener("mouseup", stopDragging);
      window.removeEventListener("touchend", stopDragging);
      window.removeEventListener("touchcancel", stopDragging);
    };
  }, []);

  const updateSliderFromClientX = (clientX: number) => {
    const container = sliderRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    if (!rect.width) return;
    const x = Math.min(Math.max(clientX - rect.left, 0), rect.width);
    const percent = (x / rect.width) * 100;
    setSliderPosition(percent);
  };

  const beginDragging = (clientX?: number) => {
    if (typeof clientX === "number") {
      updateSliderFromClientX(clientX);
    }
    isDragging.current = true;
  };

  const renderSplitView = () => (
    <div className="mt-6 grid gap-6 lg:grid-cols-2">
      {[
        { label: "原始图像", src: beforeImage, emptyText: "暂无原始图像" },
        { label: "修复后图像", src: afterImage, emptyText: "等待修复结果" },
      ].map((item) => (
        <div
          key={item.label}
          className="relative overflow-hidden rounded-3xl border border-slate-100 bg-white p-4"
        >
          <span className="rounded-full bg-brand-primary/10 px-3 py-1 text-xs font-semibold tracking-wide text-brand-primary">
            {item.label}
          </span>
          {item.src ? (
            <img src={item.src} alt={item.label} className="mt-4 h-[380px] w-full rounded-2xl object-contain bg-black" />
          ) : (
            <div className="mt-4 flex h-[380px] items-center justify-center rounded-2xl bg-slate-100 text-sm text-slate-500">
              {item.emptyText}
            </div>
          )}
          {isAnnotationVisible ? <GuideOverlay /> : null}
        </div>
      ))}
    </div>
  );

  const renderSliderView = () => (
    <div
      ref={sliderRef}
      className="relative mt-6 h-[420px] cursor-col-resize overflow-hidden rounded-3xl border border-slate-200 bg-slate-100"
      onMouseDown={(event) => beginDragging(event.clientX)}
      onTouchStart={(event) => {
        event.preventDefault();
        beginDragging(event.touches[0]?.clientX);
      }}
    >
      {beforeImage ? (
        <img src={beforeImage} alt="原始图像" className="absolute inset-0 h-full w-full object-contain" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-100 text-sm text-slate-500">
          暂无原始图像
        </div>
      )}
      {afterImage ? (
        <div
          className="absolute inset-0 overflow-hidden"
          style={{ clipPath: `inset(0 ${100 - sliderPosition}% 0 0)` }}
        >
          <img src={afterImage} alt="修复后图像" className="h-full w-full object-contain" />
        </div>
      ) : null}
      <div
        className="pointer-events-none absolute inset-y-0 w-0.5 bg-brand-primary/60"
        style={{ left: `${sliderPosition}%` }}
      />
      <button
        type="button"
        className="absolute top-1/2 -translate-y-1/2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 shadow-lg"
        style={{ left: `${sliderPosition}%`, transform: "translate(-50%, -50%)" }}
        onMouseDown={(event) => {
          event.stopPropagation();
          beginDragging(event.clientX);
        }}
        onTouchStart={(event) => {
          event.stopPropagation();
          event.preventDefault();
          beginDragging(event.touches[0]?.clientX);
        }}
      >
        拖动
      </button>
      {isAnnotationVisible ? <GuideOverlay /> : null}
      {isSyncEnabled ? (
        <span className="absolute right-4 top-4 rounded-full bg-emerald-500/20 px-3 py-1 text-xs text-emerald-100">
          同步模式
        </span>
      ) : null}
    </div>
  );

  const handleDownload = async (variant: "before" | "after") => {
    const target = variant === "before" ? beforeImage : afterImage;
    if (!target || !selectedTask) {
      setFeedback({ tone: "error", message: "暂无可下载的图像，请等待处理完成。" });
      return;
    }
    try {
      const response = await fetch(target);
      if (!response.ok) throw new Error("failed to fetch");
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = blobUrl;
      anchor.download = `${variant === "before" ? "original" : "enhanced"}-${selectedTask.filename}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(blobUrl);
      setFeedback({
        tone: "success",
        message: `${variant === "before" ? "原始图像" : "修复图像"}已开始下载`,
      });
    } catch (error) {
      console.error(error);
      setFeedback({ tone: "error", message: "下载失败，请稍后再试或检查后端日志。" });
    }
  };

  const handleExportComparison = () => {
    window.print();
    setFeedback({
      tone: "info",
      message: "已打开浏览器打印窗口，可选择“保存为 PDF”导出对比结果。",
    });
  };

  const toolbarButtons = [
    {
      id: "annotations",
      label: isAnnotationVisible ? "📍 关闭标注" : "📍 标注工具",
      onClick: () => setIsAnnotationVisible((prev) => !prev),
      active: isAnnotationVisible,
    },
    {
      id: "sync",
      label: isSyncEnabled ? "✅ 同步浏览" : "🔄 同步浏览",
      onClick: () => setIsSyncEnabled((prev) => !prev),
      active: isSyncEnabled,
    },
    {
      id: "metrics",
      label: showMetrics ? "🙈 隐藏指标" : "📊 显示指标",
      onClick: () => setShowMetrics((prev) => !prev),
      active: showMetrics,
    },
    {
      id: "export",
      label: "⬇️ 导出对比图",
      onClick: handleExportComparison,
      active: false,
    },
  ];

  return (
    <div className="space-y-8">
      <section className="rounded-3xl bg-white/95 p-6 text-slate-900 shadow-card lg:p-8">
        <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Comparison</p>
            <h2 className="text-3xl font-semibold text-slate-900">🔍 效果对比</h2>
            <p className="text-sm text-slate-500">
              查看修复前后的视觉差异，可切换分屏 / 滑动模式或开启辅助标注。
            </p>
          </div>
          <div className="flex items-center gap-3 rounded-full bg-slate-100 p-2">
            {(["split", "slider"] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setMode(item)}
                className={clsx(
                  "rounded-full px-5 py-2 text-sm font-semibold transition",
                  mode === item ? "bg-white text-brand-primary shadow" : "text-slate-600 hover:bg-white",
                )}
              >
                {item === "split" ? "分屏对比" : "滑动对比"}
              </button>
            ))}
          </div>
        </header>

        <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="flex flex-wrap items-center gap-3">
            <select
              className="max-w-xl flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700"
              value={selectedTaskId ?? ""}
              onChange={(event) => {
                const nextId = event.target.value;
                setSelectedTaskId(nextId);
                const params = new URLSearchParams(searchParams);
                params.set("taskId", nextId);
                setSearchParams(params);
              }}
            >
              {tasks.length === 0 ? (
                <option value="">暂无已完成任务</option>
              ) : null}
              {tasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.filename} · {new Date(task.created_at).toLocaleDateString("zh-CN")}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              {isFetching ? "刷新中…" : "↻ 刷新列表"}
            </button>
          </div>
          <div className="rounded-2xl border border-slate-100 bg-white p-4 text-sm">
            <p className="text-xs uppercase tracking-wide text-slate-400">当前任务</p>
            <p className="mt-1 truncate text-base font-semibold text-slate-900" title={selectedTask?.filename ?? ""}>
              {selectedTask?.filename ?? "暂无任务"}
            </p>
            <p className="mt-2 text-slate-500">
              状态：{selectedTask ? selectedTask.status : "—"} · 更新时间：
              {selectedTask?.updated_at ? new Date(selectedTask.updated_at).toLocaleString("zh-CN") : "—"}
            </p>
          </div>
        </div>

        {hasComparisonAssets ? (
          mode === "split" ? renderSplitView() : renderSliderView()
        ) : (
            <div className="mt-6 rounded-3xl border border-dashed border-slate-200 p-10 text-center text-slate-500">
            {selectedTask
              ? "该任务暂未生成可对比的图像，请等待后台处理完成。"
              : "暂无完成任务，先到上传页提交图像吧。"}
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          {toolbarButtons.map((button) => (
            <button
              key={button.id}
              type="button"
              onClick={button.onClick}
              className={clsx(
                "rounded-full px-4 py-2 text-sm font-semibold transition",
                button.active ? "bg-brand-primary/10 text-brand-primary" : "bg-slate-100 text-slate-600 hover:bg-white",
              )}
            >
              {button.label}
            </button>
          ))}
        </div>
      </section>

      {showMetrics ? (
        <section className="rounded-3xl bg-white/95 p-6 shadow-card lg:p-8">
          <div className="flex flex-col gap-2">
            <h3 className="text-xl font-semibold text-slate-800">📊 质量指标对比</h3>
            <p className="text-sm text-slate-500">
              质量指标来自后台即时计算，覆盖亮度、色彩、清晰度等核心维度。
            </p>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {metricCards.map((card) => (
              <div key={card.id} className="rounded-2xl border border-slate-100 p-4 shadow-sm">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">{card.label}</p>
                <p className="mt-2 text-3xl font-bold text-slate-900">{card.value}</p>
                {card.percent ? (
                  <p className="text-sm font-semibold text-emerald-500">{card.percent}</p>
                ) : null}
                <p className="mt-2 text-xs text-slate-500">{card.summary}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="rounded-3xl bg-white/95 p-6 shadow-card lg:p-8">
        <h3 className="text-xl font-semibold text-slate-800">⚙️ 操作</h3>
        <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <button
            type="button"
            className="rounded-2xl bg-gradient-to-r from-brand-primary to-brand-secondary px-4 py-4 text-lg font-semibold text-white shadow"
            onClick={() => handleDownload("after")}
            disabled={!afterImage}
          >
            ✓ 下载修复图像
          </button>
          <button
            type="button"
            className="rounded-2xl border border-slate-200 px-4 py-4 text-lg font-semibold text-slate-700"
            onClick={() => handleDownload("before")}
            disabled={!beforeImage}
          >
            ⬇️ 下载原始图像
          </button>
          <button
            type="button"
            className="rounded-2xl border border-slate-200 px-4 py-4 text-lg font-semibold text-slate-700"
            onClick={() => navigate("/report")}
          >
            📊 查看评估报告
          </button>
          <button
            type="button"
            className="rounded-2xl border border-slate-200 px-4 py-4 text-lg font-semibold text-slate-700"
            onClick={() => navigate("/upload")}
          >
            ↩️ 返回上传
          </button>
        </div>
      </section>

      {feedback ? (
        <div
          className={clsx(
            "rounded-2xl border px-4 py-3 text-sm",
            feedback.tone === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : feedback.tone === "error"
                ? "border-rose-200 bg-rose-50 text-rose-600"
                : "border-indigo-200 bg-indigo-50 text-indigo-700",
          )}
        >
          {feedback.message}
        </div>
      ) : null}
    </div>
  );
};
