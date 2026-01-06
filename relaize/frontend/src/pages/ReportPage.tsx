import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";

import { fetchReport, fetchTasks, resolveFileUrl, resolveResultUrl } from "../lib/api";
import { downloadBinaryFile } from "../lib/download";
import type { TaskSummary } from "../types/tasks";

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "short",
  timeStyle: "short",
});

const statusLabelMap: Record<string, string> = {
  pending: "待处理",
  processing: "处理中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

type MetricRecord = { before: number; after: number; delta?: number };

const pickMetricMap = (report: any, task: TaskSummary | undefined): Record<string, MetricRecord | undefined> => {
  // Prefer report primary section metrics if present
  const sectionMetrics: Record<string, MetricRecord> = {};
  const primarySection = report?.sections?.[0];
  if (primarySection?.metrics?.length) {
    primarySection.metrics.forEach((m: any) => {
      if (!m?.name) return;
      sectionMetrics[String(m.name).toLowerCase()] = {
        before: Number(m.before),
        after: Number(m.after),
        delta: m.delta !== undefined ? Number(m.delta) : Number(m.after) - Number(m.before),
      };
    });
  }
  // Fallback to task.metrics object if available
  const taskMetrics: Record<string, MetricRecord> = {};
  if (task?.metrics && typeof task.metrics === "object") {
    Object.entries(task.metrics).forEach(([key, value]: [string, any]) => {
      if (!value) return;
      taskMetrics[key.toLowerCase()] = {
        before: Number(value.before),
        after: Number(value.after),
        delta: value.delta !== undefined ? Number(value.delta) : Number(value.after) - Number(value.before),
      };
    });
  }

  const merged = { ...taskMetrics, ...sectionMetrics };
  return {
    psnr: merged["psnr"],
    ssim: merged["ssim"],
    mse: merged["mse"],
    entropy: merged["entropy"],
  };
};

export const ReportPage = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: tasks = [] } = useQuery<TaskSummary[]>({
    queryKey: ["tasks"],
    queryFn: () => fetchTasks(),
  });
  const queryTaskId = searchParams.get("taskId") || undefined;
  const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>(queryTaskId);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const reportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (queryTaskId && tasks.some((t) => t.id === queryTaskId)) {
      setSelectedTaskId(queryTaskId);
      return;
    }
    if (!selectedTaskId && tasks.length > 0) {
      const preferred = tasks.find((task) => task.status === "completed") ?? tasks[0];
      setSelectedTaskId(preferred.id);
      setSearchParams({ taskId: preferred.id });
    }
  }, [tasks, selectedTaskId, queryTaskId, setSearchParams]);

  const {
    data: report,
    isFetching,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["report", selectedTaskId],
    queryFn: () => fetchReport(selectedTaskId as string),
    enabled: Boolean(selectedTaskId),
  });

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId),
    [tasks, selectedTaskId],
  );
  const metricMap = useMemo(() => pickMetricMap(report, selectedTask), [report, selectedTask]);
  const primarySection = useMemo(() => report?.sections?.[0], [report]);
  const sourceImageUrl = useMemo(() => resolveFileUrl(selectedTask?.source_url), [selectedTask?.source_url]);
  const processedImageUrl = useMemo(
    () => (selectedTask?.status === "completed" && selectedTask?.id ? resolveResultUrl(selectedTask.id) : null),
    [selectedTask?.id, selectedTask?.status],
  );
  const statusLabel = selectedTask?.status ? statusLabelMap[selectedTask.status] ?? selectedTask.status : "—";
  const displayFilename = selectedTask?.filename || "未提供文件名";
  const metricsList = useMemo(
    () => [
      { id: "psnr", label: "PSNR (dB)", metric: metricMap.psnr },
      { id: "ssim", label: "SSIM", metric: metricMap.ssim },
      { id: "mse", label: "MSE（越低越好）", metric: metricMap.mse },
      { id: "entropy", label: "信息熵", metric: metricMap.entropy },
    ],
    [metricMap],
  );

  const metricHighlight = useMemo(() => {
    const deltas = metricsList
      .map((item) => ({ id: item.id, label: item.label, delta: item.metric?.delta }))
      .filter((item) => typeof item.delta === "number" && !Number.isNaN(item.delta)) as {
      id: string;
      label: string;
      delta: number;
    }[];
    const best = deltas.reduce<{ label: string; delta: number } | null>(
      (acc, curr) => (!acc || curr.delta > acc.delta ? { label: curr.label, delta: curr.delta } : acc),
      null,
    );
    const regressions = deltas.filter((item) => item.delta < 0).length;
    return { best, regressions, total: deltas.length };
  }, [metricsList]);

  useEffect(() => {
    setPreviewError(null);
    if (processedImageUrl) {
      setPreviewUrl(processedImageUrl);
    } else if (sourceImageUrl) {
      setPreviewUrl(sourceImageUrl);
    } else {
      setPreviewUrl(null);
    }
  }, [processedImageUrl, sourceImageUrl]);

  const handleExportPdf = async () => {
    if (!report || !reportRef.current) {
      setActionError("暂无可导出的报告，请等待任务完成后再试。");
      return;
    }
    setActionError(null);
    setActionMessage(null);
    setIsExportingPdf(true);
    try {
      // 确保图片已加载，避免 html2canvas 丢失图像
      const images: NodeListOf<HTMLImageElement> = reportRef.current.querySelectorAll("img");
      await Promise.all(
        Array.from(images).map(
          (img) =>
            new Promise<void>((resolve) => {
              if (img.complete) return resolve();
              img.onload = () => resolve();
              img.onerror = () => resolve();
            }),
        ),
      );
      const canvas = await html2canvas(reportRef.current, {
        backgroundColor: "#ffffff",
        scale: window.devicePixelRatio > 1 ? 2 : 1.5,
        useCORS: true,
        imageTimeout: 15000,
        scrollX: 0,
        scrollY: -window.scrollY,
        ignoreElements: (element) => element.dataset?.exportIgnore === "true",
      });
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF("p", "pt", "a4");
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const ratio = Math.min(pageWidth / canvas.width, (pageHeight - 40) / canvas.height);
      const imgWidth = canvas.width * ratio;
      const imgHeight = canvas.height * ratio;
      const offsetX = (pageWidth - imgWidth) / 2;
      pdf.addImage(imgData, "PNG", offsetX, 20, imgWidth, imgHeight);
      const filenameSafe = (selectedTask?.filename ?? selectedTaskId ?? "report").replace(/\s+/g, "-");
      pdf.save(`report-${filenameSafe}.pdf`);
      setActionMessage("报告 PDF 导出完成。");
    } catch (error) {
      console.error(error);
      setActionError("导出 PDF 失败，请稍后重试。");
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handleDownloadProcessed = async () => {
    if (!processedImageUrl || !selectedTask) {
      setActionError("暂无可下载的修复图像，请先等待任务完成。");
      return;
    }
    setIsDownloading(true);
    setActionError(null);
    setActionMessage(null);
    try {
      await downloadBinaryFile(processedImageUrl, `enhanced-${selectedTask.filename}`);
      setActionMessage("修复图像下载已开始。");
    } catch (error) {
      console.error(error);
      setActionError("下载失败，请稍后重试或检查后端日志。");
    } finally {
      setIsDownloading(false);
    }
  };

  const handleBackHome = () => {
    navigate("/upload");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#f5f7fa] via-[#e9eef6] to-[#c3cfe2] px-4 py-6 sm:px-8">
      <div ref={reportRef} className="mx-auto flex max-w-6xl flex-col gap-8">
        <section className="overflow-hidden rounded-3xl bg-gradient-to-r from-[#1f1f4f] via-[#2f3a8a] to-[#4f46e5] p-[1px] shadow-[0_16px_60px_rgba(0,0,0,0.12)]">
          <div className="flex h-full flex-col gap-6 bg-white/95 p-6 md:flex-row md:items-center md:justify-between md:p-8">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">
                评估报告
                <span className="text-indigo-400">•</span>
                {report ? dateFormatter.format(new Date(report.generated_at)) : "等待生成"}
              </div>
              <h2 className="text-3xl font-bold text-slate-900">图像修复评估</h2>
              <p className="max-w-2xl text-sm text-slate-600">
                {report?.overview ?? "请选择任务查看详细的质量指标、处理状态与建议。"}
              </p>
              <div className="flex flex-wrap gap-3 text-xs">
                <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-700">
                  状态：{statusLabel}
                </span>
                <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-700">
                  任务 ID：{selectedTask?.id ?? "未选择"}
                </span>
                {metricHighlight.best ? (
                  <span className="rounded-full bg-emerald-50 px-3 py-1 font-semibold text-emerald-700">
                    亮点：{metricHighlight.best.label} 提升 {metricHighlight.best.delta.toFixed(4)}
                  </span>
                ) : null}
                {metricHighlight.regressions > 0 ? (
                  <span className="rounded-full bg-amber-50 px-3 py-1 font-semibold text-amber-700">
                    有 {metricHighlight.regressions} 项下降，建议复查
                  </span>
                ) : null}
              </div>
            </div>
            <div className="flex w-full flex-col gap-3 rounded-2xl bg-slate-50 p-4 text-sm text-slate-700 md:w-72">
              <div className="flex items-center justify-between">
                <span className="font-semibold">选择任务</span>
                <button
                  className="text-xs font-semibold text-indigo-600 underline-offset-4 hover:underline disabled:opacity-60"
                  onClick={() => refetch()}
                  disabled={!selectedTaskId || isFetching}
                >
                  ⟳ {isFetching ? "刷新中…" : "刷新"}
                </button>
              </div>
              <select
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm focus:border-indigo-400 focus:outline-none"
                value={selectedTaskId ?? ""}
                onChange={(event) => {
                  const nextId = event.target.value;
                  setSelectedTaskId(nextId);
                  setSearchParams(nextId ? { taskId: nextId } : {});
                }}
              >
                <option value="" disabled>
                  选择任务
                </option>
                {tasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.filename} · {statusLabelMap[task.status] ?? task.status}
                  </option>
                ))}
              </select>
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>生成时间</span>
                <span>{report ? dateFormatter.format(new Date(report.generated_at)) : "—"}</span>
              </div>
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>文件名</span>
                <span className="max-w-[180px] truncate text-right font-semibold text-slate-700" title={displayFilename}>
                  {displayFilename}
                </span>
              </div>
            </div>
          </div>
        </section>

        {isError ? (
          <section className="rounded-3xl border border-rose-200 bg-rose-50 p-6 text-rose-700 shadow-sm">
            获取报告失败，请稍后重试。
          </section>
        ) : !report ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-6 text-slate-600 shadow-sm">
            当前暂无任务或尚未生成报告，请先提交图像。
          </section>
        ) : null}

        {report ? (
          <section className="grid gap-5 md:grid-cols-[1.6fr_1fr]">
            <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-[0_10px_40px_rgba(0,0,0,0.08)]">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-semibold text-slate-900">定量指标</h3>
                  <p className="text-sm text-slate-500">{primarySection?.summary ?? "核心质量指标一览。"}</p>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                  样本：
                  <span className="ml-1 max-w-[220px] truncate align-middle" title={displayFilename}>
                    {displayFilename}
                  </span>
                </span>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {metricsList.map((meta) => {
                  const metric = meta.metric;
                  const after = metric?.after;
                  const before = metric?.before;
                  const delta = metric?.delta;
                  const deltaValid = delta !== undefined && !isNaN(delta);
                  const deltaText = !deltaValid ? "—" : delta > 0 ? `+${delta.toFixed(4)}` : `${delta.toFixed(4)}`;
                  const deltaColor = !deltaValid
                    ? "text-slate-500"
                    : delta > 0
                    ? "text-emerald-600"
                    : delta < 0
                    ? "text-rose-500"
                    : "text-slate-500";
                  return (
                    <div
                      key={meta.id}
                      className="rounded-2xl border border-slate-100 bg-gradient-to-br from-white to-[#f7f8fb] p-5 shadow-sm"
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{meta.label}</p>
                        <span className={`text-xs font-semibold ${deltaColor}`}>{deltaValid ? `提升 ${deltaText}` : "—"}</span>
                      </div>
                      <div className="mt-3 flex items-baseline gap-3">
                        <p className="text-3xl font-bold text-slate-900">
                          {after === undefined || isNaN(after) ? "—" : after.toFixed(after < 10 ? 4 : 2)}
                        </p>
                        <p className="text-sm text-slate-500">
                          修复前 {before === undefined || isNaN(before) ? "—" : before.toFixed(before < 10 ? 4 : 2)}
                        </p>
                      </div>
                      <div className="mt-3 h-2 rounded-full bg-slate-100">
                        <div
                          className={`h-2 rounded-full ${delta && delta < 0 ? "bg-rose-300" : "bg-indigo-400"}`}
                          style={{
                            width: delta === undefined || isNaN(delta) ? "12%" : `${Math.min(Math.abs(delta) * 8 + 20, 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <div className="rounded-3xl border border-slate-100 bg-white p-5 shadow-[0_10px_40px_rgba(0,0,0,0.08)]">
                <div className="mb-3 flex items-center justify-between">
                  <h4 className="text-lg font-semibold text-slate-900">处理信息</h4>
                  <span className="text-xs font-semibold text-indigo-600">{statusLabel}</span>
                </div>
                <dl className="space-y-2 text-sm text-slate-600">
                  <div className="flex justify-between">
                    <dt className="text-slate-500">生成时间</dt>
                    <dd className="font-semibold text-slate-800">
                      {report ? dateFormatter.format(new Date(report.generated_at)) : "—"}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">任务 ID</dt>
                    <dd className="truncate text-right font-semibold text-slate-800" title={selectedTask?.id}>
                      {selectedTask?.id ?? "—"}
                    </dd>
                  </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">文件名</dt>
                  <dd className="max-w-[180px] truncate text-right font-semibold text-slate-800" title={displayFilename}>
                    {displayFilename}
                  </dd>
                </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">文件大小</dt>
                    <dd className="font-semibold text-slate-800">
                      {selectedTask?.size ? `${(selectedTask.size / 1024 / 1024).toFixed(2)} MB` : "—"}
                    </dd>
                  </div>
                </dl>
              </div>

              {previewUrl ? (
                <div className="overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-[0_12px_40px_rgba(0,0,0,0.08)]">
                  <div className="flex items-center justify-between px-5 pb-3 pt-4">
                    <h4 className="text-lg font-semibold text-slate-900">修复结果预览</h4>
                    <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">完成</span>
                  </div>
                  <div className="bg-slate-50 p-4">
                    <img
                      src={previewUrl}
                      alt="修复结果"
                      className="max-h-72 w-full rounded-2xl object-contain bg-white"
                      loading="lazy"
                      crossOrigin="anonymous"
                      onError={() => {
                        if (previewUrl !== sourceImageUrl && sourceImageUrl) {
                          setPreviewUrl(sourceImageUrl);
                          setPreviewError("修复图加载失败，已回退到原图预览");
                          return;
                        }
                        setPreviewError("图像预览加载失败，请下载后查看");
                      }}
                    />
                    {previewError ? <p className="mt-2 text-xs text-amber-600">{previewError}</p> : null}
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {report?.sections.slice(1).length ? (
          <section className="rounded-3xl bg-white p-6 shadow-[0_10px_40px_rgba(0,0,0,0.08)]">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-xl font-semibold text-slate-900">其他指标</h3>
                <p className="text-sm text-slate-500">详细指标与变化说明。</p>
              </div>
              <span className="text-xs font-semibold text-indigo-600">补充维度</span>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {report.sections.slice(1).map((section) => (
                <div key={section.title} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                  <p className="text-sm font-semibold text-slate-800">{section.title}</p>
                  <p className="text-xs text-slate-500">{section.summary}</p>
                  <div className="mt-3 grid gap-3">
                    {section.metrics.map((metric) => {
                      const delta = Number(metric.delta);
                      const deltaText = delta > 0 ? `+${delta}` : `${delta}`;
                      const deltaColor =
                        delta > 0 ? "text-emerald-600" : delta < 0 ? "text-rose-500" : "text-slate-500";
                      return (
                        <div key={metric.name} className="rounded-xl bg-slate-50 px-3 py-2">
                          <div className="flex items-center justify-between text-sm text-slate-600">
                            <span className="font-semibold text-slate-700">{metric.name}</span>
                            <span className={`font-semibold ${deltaColor}`}>{deltaText}</span>
                          </div>
                          <p className="text-sm text-slate-500">前值 {metric.before} · 现值 {metric.after}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {report?.recommendations?.length ? (
          <section className="rounded-3xl bg-white p-6 shadow-[0_10px_40px_rgba(0,0,0,0.08)]">
            <h3 className="text-xl font-semibold text-slate-900">建议</h3>
            <ul className="mt-4 space-y-2 text-sm text-slate-600">
              {report.recommendations.map((recommendation) => (
                <li key={recommendation} className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-indigo-400" />
                  <span>{recommendation}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section
          className="sticky bottom-6 z-10 mx-auto flex w-full flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 shadow-[0_12px_50px_rgba(0,0,0,0.08)] backdrop-blur md:px-6"
          data-export-ignore="true"
        >
          <button
            className="flex-1 rounded-full bg-gradient-to-r from-indigo-500 via-indigo-500 to-fuchsia-500 px-6 py-3 text-center text-sm font-semibold text-white shadow-lg transition hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-70"
            onClick={handleExportPdf}
            disabled={!report || isExportingPdf}
          >
            {isExportingPdf ? "导出中…" : "💾 导出 PDF"}
          </button>
          <button
            className="flex-1 rounded-full border border-slate-200 bg-white px-6 py-3 text-center text-sm font-semibold text-slate-700 shadow-sm transition hover:border-indigo-200 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-70"
            onClick={handleDownloadProcessed}
            disabled={!processedImageUrl || isDownloading}
          >
            📥 下载修复图像
          </button>
          <button
            className="flex-1 rounded-full border border-slate-200 bg-white px-6 py-3 text-center text-sm font-semibold text-slate-700 shadow-sm transition hover:border-indigo-200 hover:text-indigo-600"
            onClick={handleBackHome}
          >
            🏠 返回首页
          </button>
          {actionMessage ? <p className="text-sm font-semibold text-emerald-600">{actionMessage}</p> : null}
          {actionError ? <p className="text-sm font-semibold text-rose-500">{actionError}</p> : null}
        </section>
      </div>
    </div>
  );
};
