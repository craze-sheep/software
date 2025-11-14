import { useQuery } from "@tanstack/react-query";

import { fetchTaskDetail, resolveFileUrl } from "../../lib/api";
import type { TaskDetail } from "../../types/tasks";

type TaskDetailPanelProps = {
  taskId: string;
  onClose: () => void;
};

export const TaskDetailPanel = ({ taskId, onClose }: TaskDetailPanelProps) => {
  const { data, isFetching, isError } = useQuery({
    queryKey: ["task-detail", taskId],
    queryFn: () => fetchTaskDetail(taskId),
  });

  const task: TaskDetail | undefined = data;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="w-full max-w-xl rounded-3xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.3em] text-slate-400">任务详情</p>
            <h2 className="text-2xl font-semibold text-slate-800">{task?.filename ?? "加载中…"}</h2>
          </div>
          <button className="text-slate-500 hover:text-slate-800" onClick={onClose}>
            ✕
          </button>
        </div>

        {isFetching && (
          <p className="mt-4 text-sm text-slate-500">
            正在加载任务信息…
          </p>
        )}

        {isError && (
          <p className="mt-4 text-sm text-rose-500">
            获取任务信息失败，请稍后再试。
          </p>
        )}

        {task && (
          <div className="mt-6 space-y-4 text-sm text-slate-600">
            <div className="grid grid-cols-2 gap-4 rounded-2xl bg-slate-50 p-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">任务 ID</p>
                <p className="font-semibold text-slate-800">{task.id}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">状态</p>
                <p className="font-semibold text-slate-800">{task.status}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">创建时间</p>
                <p>{new Date(task.created_at).toLocaleString("zh-CN")}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">更新时间</p>
                <p>{new Date(task.updated_at).toLocaleString("zh-CN")}</p>
              </div>
            </div>

            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-400">文件信息</p>
              <p>文件名：{task.filename}</p>
              <p>类型：{task.content_type ?? "未知"}</p>
              <p>大小：{task.size ? `${(task.size / 1024 / 1024).toFixed(2)} MB` : "未知"}</p>
            </div>

            <div className="flex flex-wrap gap-3">
              {resolveFileUrl(task.source_url) ? (
                <a
                  href={resolveFileUrl(task.source_url) ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600"
                >
                  下载原始图像
                </a>
              ) : null}
              {resolveFileUrl(task.preview_url) ? (
                <a
                  href={resolveFileUrl(task.preview_url) ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600"
                >
                  查看修复结果
                </a>
              ) : null}
            </div>

            {task.metrics ? (
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-400">质量指标</p>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {Object.entries(task.metrics).map(([name, metric]) => (
                    <div key={name} className="rounded-xl border border-slate-100 p-3">
                      <p className="text-sm font-semibold text-slate-700">{name.toUpperCase()}</p>
                      <p className="text-xs text-slate-500">
                        {metric.before} → {metric.after} (Δ {metric.delta})
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">
                暂无指标结果，任务正在排队或处理中。
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
