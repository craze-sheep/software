import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { fetchReport, fetchTasks } from "../lib/api";
import type { TaskSummary } from "../types/tasks";

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "short",
  timeStyle: "short",
});

export const ReportPage = () => {
  const { data: tasks = [] } = useQuery<TaskSummary[]>({
    queryKey: ["tasks"],
    queryFn: () => fetchTasks(),
  });
  const [selectedTaskId, setSelectedTaskId] = useState<string>();

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

  const primarySection = useMemo(() => report?.sections?.[0], [report]);

  return (
    <div className="space-y-8">
      <section className="rounded-3xl bg-white/90 p-8 shadow-card">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-slate-800">评估报告</h2>
            <p className="text-sm text-slate-500">
              {report
                ? `生成时间：${dateFormatter.format(new Date(report.generated_at))}`
                : "请选择任务查看评估结果"}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <select
              className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700"
              value={selectedTaskId ?? ""}
              onChange={(event) => setSelectedTaskId(event.target.value)}
            >
              <option value="" disabled>
                选择任务
              </option>
              {tasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.filename} · {task.status}
                </option>
              ))}
            </select>
            <button
              className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => refetch()}
              disabled={!selectedTaskId || isFetching}
            >
              {isFetching ? "刷新中…" : "↻ 刷新"}
            </button>
          </div>
        </div>

        {isError ? (
          <p className="mt-4 text-sm text-rose-500">获取报告失败，请稍后重试。</p>
        ) : report ? (
          <p className="mt-4 text-slate-600">{report.overview}</p>
        ) : (
          <p className="mt-4 text-sm text-slate-500">
            当前暂无任务或尚未生成报告，请先在上传页提交图像。
          </p>
        )}
      </section>

      {primarySection ? (
        <section className="rounded-3xl bg-white/90 p-8 shadow-card">
          <h3 className="text-xl font-semibold text-slate-800">{primarySection.title}</h3>
          <p className="text-sm text-slate-500">{primarySection.summary}</p>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {primarySection.metrics.map((metric) => (
              <div key={metric.name} className="rounded-2xl border border-slate-100 p-4 shadow-sm">
                <p className="text-sm text-slate-500">{metric.name}</p>
                <p className="text-3xl font-bold text-slate-800">{metric.after}</p>
                <p className="text-xs text-slate-500">
                  修复前 {metric.before} · 提升 {metric.delta}
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {report?.sections.slice(1).map((section) => (
        <section key={section.title} className="rounded-3xl bg-white/90 p-8 shadow-card">
          <h3 className="text-xl font-semibold text-slate-800">{section.title}</h3>
          <p className="text-sm text-slate-500">{section.summary}</p>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {section.metrics.map((metric) => (
              <div key={metric.name} className="rounded-2xl border border-slate-100 p-4 shadow-sm">
                <div className="flex items-center justify-between text-sm text-slate-500">
                  <span>{metric.name}</span>
                  <span className="font-semibold text-brand-primary">{metric.delta}</span>
                </div>
                <p className="text-2xl font-bold text-slate-800">{metric.after}</p>
                <p className="text-xs text-slate-500">前值 {metric.before}</p>
              </div>
            ))}
          </div>
        </section>
      ))}

      {report?.recommendations?.length ? (
        <section className="rounded-3xl bg-white/90 p-8 shadow-card">
          <h3 className="text-xl font-semibold text-slate-800">📋 建议</h3>
          <ul className="mt-4 list-disc space-y-2 pl-6 text-sm text-slate-600">
            {report.recommendations.map((recommendation) => (
              <li key={recommendation}>{recommendation}</li>
            ))}
          </ul>
          <div className="mt-6 flex flex-wrap gap-3">
            <button className="flex-1 rounded-full bg-gradient-to-r from-brand-primary to-brand-secondary px-6 py-3 font-semibold text-white shadow">
              💾 导出 PDF
            </button>
            <button className="flex-1 rounded-full border border-slate-200 px-6 py-3 font-semibold text-slate-600">
              📥 下载修复图像
            </button>
            <button className="flex-1 rounded-full border border-slate-200 px-6 py-3 font-semibold text-slate-600">
              🏠 返回首页
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
};
