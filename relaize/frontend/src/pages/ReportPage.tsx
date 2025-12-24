import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { fetchReport, fetchTasks, resolveResultUrl } from "../lib/api";
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

export const ReportPage = () => {
  const navigate = useNavigate();
  const { data: tasks = [] } = useQuery<TaskSummary[]>({
    queryKey: ["tasks"],
    queryFn: () => fetchTasks(),
  });
  const [selectedTaskId, setSelectedTaskId] = useState<string>();
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  useEffect(() => {
    if (!selectedTaskId && tasks.length > 0) {
      const preferred = tasks.find((task) => task.status === "completed") ?? tasks[0];
      setSelectedTaskId(preferred.id);
    }
  }, [tasks, selectedTaskId]);

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
  const primarySection = useMemo(() => report?.sections?.[0], [report]);
  const processedImageUrl = useMemo(
    () => (selectedTask?.status === "completed" && selectedTask?.id ? resolveResultUrl(selectedTask.id) : null),
    [selectedTask?.id, selectedTask?.status],
  );
  const statusLabel = selectedTask?.status ? statusLabelMap[selectedTask.status] ?? selectedTask.status : "—";

  const handleExportPdf = () => {
    setActionError(null);
    setActionMessage(null);
    window.print();
    setActionMessage("已打开系统打印窗口，可选择“保存为 PDF”。");
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
      const response = await fetch(processedImageUrl);
      if (!response.ok) {
        throw new Error(`failed to fetch image: ${response.status}`);
      }
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = blobUrl;
      anchor.download = `enhanced-${selectedTask.filename}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(blobUrl);
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
      <div className="mx-auto flex max-w-5xl flex-col gap-8">
        <section className="rounded-3xl bg-white p-6 shadow-[0_10px_40px_rgba(0,0,0,0.08)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-slate-900">评估报告</h2>
              <p className="text-sm text-slate-500">
                {report
                  ? `生成时间：${dateFormatter.format(new Date(report.generated_at))}`
                  : "请选择任务查看评估结果"}
              </p>
              {report ? <p className="text-sm text-slate-500">{report.overview}</p> : null}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <select
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm focus:border-indigo-400 focus:outline-none"
                value={selectedTaskId ?? ""}
                onChange={(event) => setSelectedTaskId(event.target.value)}
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
              <button
                className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => refetch()}
                disabled={!selectedTaskId || isFetching}
              >
                ⟳ {isFetching ? "刷新中…" : "刷新"}
              </button>
            </div>
          </div>

          <div className="mt-6 grid gap-3 text-sm text-slate-600 md:grid-cols-3">
            <div className="rounded-2xl bg-slate-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">任务 ID</p>
              <p className="mt-1 truncate font-semibold text-slate-800" title={selectedTask?.id ?? ""}>
                {selectedTask?.id ?? "未选择"}
              </p>
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">状态</p>
              <p className="mt-1 font-semibold text-indigo-600">{statusLabel}</p>
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">生成时间</p>
              <p className="mt-1 font-semibold text-slate-800">
                {report ? dateFormatter.format(new Date(report.generated_at)) : "—"}
              </p>
            </div>
          </div>

          {isError ? (
            <p className="mt-4 text-sm text-rose-500">获取报告失败，请稍后重试。</p>
          ) : !report ? (
            <p className="mt-4 text-sm text-slate-500">当前暂无任务或尚未生成报告，请先提交图像。</p>
          ) : null}
        </section>

        {primarySection ? (
          <section className="rounded-3xl bg-white p-6 shadow-[0_10px_40px_rgba(0,0,0,0.08)]">
            <div className="mb-4">
              <h3 className="text-xl font-semibold text-slate-900">{primarySection.title}</h3>
              <p className="text-sm text-slate-500">{primarySection.summary}</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {primarySection.metrics.map((metric) => {
                const delta = Number(metric.delta);
                const deltaText = delta > 0 ? `+${delta}` : `${delta}`;
                const deltaColor = delta > 0 ? "text-emerald-600" : delta < 0 ? "text-rose-500" : "text-slate-500";
                return (
                  <div
                    key={metric.name}
                    className="rounded-2xl border border-slate-100 bg-gradient-to-br from-white to-[#f7f8fb] p-5 shadow-sm"
                  >
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{metric.name}</p>
                    <div className="mt-2 flex items-baseline gap-3">
                      <p className="text-3xl font-bold text-slate-900">{metric.after}</p>
                      <p className="text-sm text-slate-500">修复前 {metric.before}</p>
                    </div>
                    <p className={`mt-1 text-xs font-semibold ${deltaColor}`}>提升 {deltaText}</p>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        {report?.sections.slice(1).length ? (
          <section className="rounded-3xl bg-white p-6 shadow-[0_10px_40px_rgba(0,0,0,0.08)]">
            <div className="mb-4">
              <h3 className="text-xl font-semibold text-slate-900">其他指标</h3>
              <p className="text-sm text-slate-500">详细指标与变化说明。</p>
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
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                className="flex-1 rounded-full bg-gradient-to-r from-indigo-500 via-indigo-500 to-fuchsia-500 px-6 py-3 text-center text-sm font-semibold text-white shadow-lg transition hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-70"
                onClick={handleExportPdf}
                disabled={!report}
              >
                💾 导出 PDF
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
            </div>
            {actionMessage ? <p className="mt-3 text-sm text-emerald-600">{actionMessage}</p> : null}
            {actionError ? <p className="mt-3 text-sm text-rose-500">{actionError}</p> : null}
          </section>
        ) : null}
      </div>
    </div>
  );
};
