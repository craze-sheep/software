import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { QuickActionCard } from "../components/cards/QuickActionCard";
import { Section } from "../components/common/Section";
import { StatCard } from "../components/ui/StatCard";
import { TaskDetailPanel } from "../components/tasks/TaskDetailPanel";
import { StatusBadge } from "../components/ui/StatusBadge";
import { fetchTasks } from "../lib/api";
import type { TaskSummary } from "../types/tasks";

const quickActions = [
  { icon: "📤", title: "上传图像", description: "拖拽或点击上传水下图像", path: "/upload", actionLabel: "开始上传" },
  { icon: "⚡", title: "自动修复", description: "一键应用智能算法", path: "/auto", actionLabel: "自动修复" },
  { icon: "🎛️", title: "手动调整", description: "细致控制每个参数", path: "/adjustment", actionLabel: "前往调整" },
  { icon: "📦", title: "批量处理", description: "批量导入与导出", path: "/upload", actionLabel: "批量处理" },
];

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "short",
  timeStyle: "short",
});

export const DashboardPage = () => {
  const navigate = useNavigate();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const { data: tasks = [], isFetching } = useQuery<TaskSummary[]>({
    queryKey: ["tasks"],
    queryFn: () => fetchTasks(),
  });

  const sortedTasks = useMemo(
    () =>
      [...tasks].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      ),
    [tasks],
  );

  const recentTasks = useMemo(() => sortedTasks.slice(0, 3), [sortedTasks]);

  const stats = useMemo(
    () => {
      const totalTasks = tasks.length;
      const completed = tasks.filter((task) => task.status === "completed").length;
      const inProgress = tasks.filter((task) => task.status === "processing").length;
      const pending = totalTasks - completed - inProgress;

      return [
        {
          label: "已上传任务",
          value: totalTasks.toString(),
          hint: `${pending > 0 ? `${pending} 待处理` : "队列空闲"}`,
          variant: "primary" as const,
        },
        {
          label: "完成任务",
          value: completed.toString(),
          hint: inProgress > 0 ? `${inProgress} 正在处理` : "全部完成",
          variant: "success" as const,
        },
        {
          label: "处理中任务",
          value: inProgress.toString(),
          hint: "包含去噪、对比度等流程",
          variant: "warning" as const,
        },
      ];
    },
    [tasks],
  );

  return (
    <div className="space-y-10">
      <div className="rounded-3xl bg-white/90 p-8 shadow-card">
        <p className="text-sm text-slate-500">欢迎回来，李浩</p>
        <h2 className="mt-2 text-3xl font-bold text-slate-800">准备好修复您的水下图像了吗？</h2>
        <p className="text-sm text-slate-500">今天是 2024 年 11 月 12 日 · 系统已准备就绪</p>
      </div>

      <Section title="快捷操作" subtitle="覆盖上传、自动修复、手动模式与批量处理">
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {quickActions.map((action) => (
            <QuickActionCard
              key={action.title}
              {...action}
              onClick={() => navigate(action.path)}
            />
          ))}
        </div>
      </Section>

      <div className="grid gap-6 md:grid-cols-3">
        {stats.map((stat) => (
          <StatCard key={stat.label} {...stat} />
        ))}
      </div>

      <Section
        title="最近处理"
        subtitle={isFetching ? "同步中…" : "追踪最新的处理任务"}
      >
        {recentTasks.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-slate-400">
            暂无处理记录，赶快上传一张图像吧
          </div>
        ) : (
          <div className="space-y-4">
            {recentTasks.map((task) => (
              <div
                key={task.id}
                className="grid gap-3 rounded-2xl border border-slate-100 bg-white/80 p-4 shadow-sm md:grid-cols-[1fr,120px,auto] md:items-center"
              >
                <div>
                  <p className="font-semibold text-slate-800">{task.filename}</p>
                  <p className="text-sm text-slate-500">
                    {dateFormatter.format(new Date(task.created_at))} ·{" "}
                    {task.size ? `${(task.size / 1024 / 1024).toFixed(2)} MB` : "未知大小"}
                  </p>
                </div>
                <div className="justify-self-center md:justify-self-start">
                  <StatusBadge status={task.status} />
                </div>
                <button
                  className="justify-self-start rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 md:justify-self-end"
                  onClick={() => setSelectedTaskId(task.id)}
                >
                  查看详情
                </button>
              </div>
            ))}
          </div>
        )}
      </Section>

      {selectedTaskId ? (
        <TaskDetailPanel taskId={selectedTaskId} onClose={() => setSelectedTaskId(null)} />
      ) : null}
    </div>
  );
};
