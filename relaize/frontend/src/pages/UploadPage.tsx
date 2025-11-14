import { useCallback, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { cancelTask, fetchTasks, processTask, uploadImage } from "../lib/api";
import type { TaskSummary } from "../types/tasks";
import { TaskDetailPanel } from "../components/tasks/TaskDetailPanel";

type PreviewFile = {
  id: string;
  file: File;
  previewUrl: string;
};

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "short",
  timeStyle: "short",
});

export const UploadPage = () => {
  const [files, setFiles] = useState<PreviewFile[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const {
    data: tasks = [],
    refetch,
    isFetching: isRefreshingTasks,
  } = useQuery({
    queryKey: ["tasks", statusFilter],
    queryFn: () =>
      fetchTasks({
        status: statusFilter === "all" ? undefined : statusFilter,
        limit: 100,
      }),
  });

  const addFiles = useCallback((list: FileList | null) => {
    if (!list) return;
    const next = Array.from(list).map((file) => ({
      id: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
    }));
    setFiles((prev) => [...prev, ...next]);
  }, []);

  const removeFile = (id: string) => {
    setFiles((prev) => {
      prev.find((item) => {
        if (item.id === id) URL.revokeObjectURL(item.previewUrl);
        return false;
      });
      return prev.filter((item) => item.id !== id);
    });
  };

  const handleUpload = async () => {
    if (!files.length) {
      setErrorMessage("请先选择至少一张图像");
      setStatusMessage(null);
      return;
    }

    setIsUploading(true);
    setStatusMessage("正在上传到服务器…");
    setErrorMessage(null);
    try {
      const results = await Promise.allSettled(files.map((item) => uploadImage(item.file)));
      const successCount = results.filter((result) => result.status === "fulfilled").length;
      const failureCount = results.length - successCount;

      if (failureCount === 0) {
        setStatusMessage(`已成功上传 ${successCount} 张图像，等待修复处理`);
        setFiles([]);
      } else {
        setStatusMessage(`成功 ${successCount} 张，失败 ${failureCount} 张`);
        setErrorMessage("部分文件上传失败，请检查网络或后端日志");
      }
      await refetch();
    } catch (error) {
      console.error(error);
      setErrorMessage("上传失败，请稍后重试");
      setStatusMessage(null);
    } finally {
      setIsUploading(false);
    }
  };

  const sortedTasks: TaskSummary[] = useMemo(
    () =>
      [...tasks].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      ),
    [tasks],
  );

  const handleReprocess = async (taskId: string) => {
    try {
      await processTask(taskId);
      setStatusMessage("任务已重新进入处理队列");
      setErrorMessage(null);
      await refetch();
    } catch (error) {
      console.error(error);
      setErrorMessage("无法重新处理任务，请检查服务日志");
    }
  };

  const handleCancel = async (taskId: string) => {
    try {
      await cancelTask(taskId);
      setStatusMessage("任务已取消");
      setErrorMessage(null);
      await refetch();
    } catch (error) {
      console.error(error);
      setErrorMessage("取消任务失败，请稍后再试");
    }
  };

  return (
    <div className="space-y-8">
      <header className="text-center text-white">
        <div className="mx-auto max-w-3xl rounded-3xl bg-gradient-to-r from-brand-primary to-brand-secondary p-10 text-white shadow-card">
          <h2 className="text-3xl font-bold">🌊 上传图像</h2>
          <p className="text-sm opacity-80">选择或拖拽水下图像，支持批量上传</p>
        </div>
      </header>

      <section className="rounded-3xl bg-white/90 p-8 shadow-card">
        <div
          className="flex flex-col items-center gap-4 rounded-2xl border-2 border-dashed border-brand-primary/60 bg-gradient-to-r from-indigo-50 to-purple-50 p-10 text-center"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            addFiles(event.dataTransfer.files);
          }}
        >
          <span className="text-6xl">⬆️</span>
          <h3 className="text-xl font-semibold text-slate-800">拖拽文件到此处或点击选择</h3>
          <p className="text-sm text-slate-500">支持格式：JPG、PNG、BMP、TIFF · 最大单文件 100MB</p>
          <div className="flex flex-wrap gap-4">
            <button
              type="button"
              className="rounded-full bg-gradient-to-r from-brand-primary to-brand-secondary px-5 py-2 text-sm font-semibold text-white shadow"
              onClick={() => inputRef.current?.click()}
            >
              📁 选择文件
            </button>
            <button type="button" className="rounded-full bg-slate-100 px-5 py-2 text-sm font-semibold text-slate-600">
              🗂️ 选择文件夹
            </button>
          </div>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            multiple
            accept="image/*"
            onChange={(event) => addFiles(event.target.files)}
          />
        </div>
        <div className="mt-6 rounded-2xl border-l-4 border-blue-500 bg-blue-50 p-4 text-sm text-blue-600">
          💡 提示：不同的修复效果取决于图像的清晰度和颜色偏差程度。建议优先上传低对比度的蓝绿色样本。
        </div>
      </section>

      <section className="rounded-3xl bg-white/90 p-8 shadow-card">
        <h3 className="text-lg font-semibold text-slate-800">📸 已选择的图像</h3>
        {files.length === 0 ? (
          <div className="mt-6 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-200 p-10 text-slate-400">
            <span className="text-4xl">📭</span>
            <p>暂无图像，请先上传</p>
          </div>
        ) : (
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {files.map((item) => (
              <div key={item.id} className="relative overflow-hidden rounded-2xl shadow-card">
                <img src={item.previewUrl} alt={item.file.name} className="h-48 w-full object-cover" />
                <button
                  type="button"
                  className="absolute right-3 top-3 rounded-full bg-white/90 px-3 py-1 text-sm font-semibold text-slate-600 shadow"
                  onClick={() => removeFile(item.id)}
                >
                  ✕
                </button>
                <div className="bg-white/90 p-3 text-sm">
                  <p className="font-semibold text-slate-800">{item.file.name}</p>
                  <p className="text-xs text-slate-500">{(item.file.size / 1024 / 1024).toFixed(2)} MB</p>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-6 flex flex-col gap-4 md:flex-row">
          <button
            className="flex-1 rounded-full bg-gradient-to-r from-brand-primary to-brand-secondary px-5 py-3 text-white shadow disabled:cursor-not-allowed disabled:opacity-60"
            onClick={handleUpload}
            disabled={isUploading}
          >
            {isUploading ? "上传中…" : "✓ 开始修复"}
          </button>
          <button
            className="flex-1 rounded-full bg-slate-100 px-5 py-3 text-slate-600 shadow-inner"
            onClick={() => setFiles([])}
          >
            ↻ 清空重置
          </button>
        </div>

        {(statusMessage || errorMessage) && (
          <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm">
            {statusMessage ? <p className="text-slate-700">{statusMessage}</p> : null}
            {errorMessage ? <p className="text-red-500">{errorMessage}</p> : null}
          </div>
        )}
      </section>

      <section className="rounded-3xl bg-white/90 p-8 shadow-card">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-800">📋 任务队列</h3>
            <p className="text-sm text-slate-500">查看上传后的处理进度</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <select
              className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="all">全部</option>
              <option value="pending">待处理</option>
              <option value="processing">处理中</option>
              <option value="completed">已完成</option>
              <option value="failed">失败</option>
              <option value="cancelled">已取消</option>
            </select>

            <button
              className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => refetch()}
              disabled={isRefreshingTasks}
            >
              {isRefreshingTasks ? "刷新中…" : "↻ 刷新列表"}
            </button>
          </div>

        </div>

        {sortedTasks.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed border-slate-200 p-8 text-center text-slate-400">
            暂无任务，上传后即可看到最新状态
          </div>
        ) : (
          <div className="mt-6 space-y-3">
            {sortedTasks.map((task) => (
              <div
                key={task.id}
                className="flex flex-col gap-2 rounded-2xl border border-slate-100 bg-white/80 p-4 shadow-sm md:flex-row md:items-center md:justify-between"
              >
                <div>
                  <p className="font-semibold text-slate-800">{task.filename}</p>
                  <p className="text-xs text-slate-500">
                    {dateFormatter.format(new Date(task.created_at))} · {task.size ? (task.size / 1024 / 1024).toFixed(2) : "?"} MB
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-3 py-1 text-sm font-semibold ${
                      task.status === "completed"
                        ? "bg-emerald-100 text-emerald-600"
                        : task.status === "processing"
                          ? "bg-blue-100 text-blue-600"
                          : task.status === "failed"
                            ? "bg-rose-100 text-rose-600"
                            : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {task.status}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600"
                      onClick={() => setSelectedTaskId(task.id)}
                    >
                      查看详情
                    </button>
                    {(task.status === "failed" || task.status === "cancelled") && (
                      <button
                        className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600"
                        onClick={() => handleReprocess(task.id)}
                      >
                        重新处理
                      </button>
                    )}
                    {(task.status === "pending" || task.status === "processing") && (
                      <button
                        className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-red-500"
                        onClick={() => handleCancel(task.id)}
                      >
                        取消任务
                      </button>
                    )}
                  </div>
                  {task.preview_url ? (
                    <a
                      href={task.preview_url}
                      className="text-sm font-semibold text-brand-secondary underline"
                      target="_blank"
                      rel="noreferrer"
                    >
                      预览
                    </a>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {selectedTaskId ? (
        <TaskDetailPanel taskId={selectedTaskId} onClose={() => setSelectedTaskId(null)} />
      ) : null}
    </div>
  );
};
