import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  cancelTask,
  clearTasks,
  fetchTasks,
  processTask,
  resolveResultUrl,
  uploadImage,
} from "../lib/api";
import type { TaskSummary } from "../types/tasks";
import { TaskDetailPanel } from "../components/tasks/TaskDetailPanel";
import { StatusBadge } from "../components/ui/StatusBadge";

type DataTransferItemWithWebkit = DataTransferItem & {
  webkitGetAsEntry?: () => FileSystemEntry | null;
};

type PreviewFile = {
  id: string;
  file: File;
  previewUrl: string;
};

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "short",
  timeStyle: "short",
});

const isFileEntry = (entry: FileSystemEntry): entry is FileSystemFileEntry => entry.isFile;

const isDirectoryEntry = (entry: FileSystemEntry): entry is FileSystemDirectoryEntry =>
  entry.isDirectory;

const collectFilesFromEntries = async (entry: FileSystemEntry, files: File[]): Promise<void> => {
  if (isFileEntry(entry)) {
    const file = await new Promise<File>((resolve, reject) => entry.file(resolve, reject));
    files.push(file);
    return;
  }
  if (isDirectoryEntry(entry)) {
    const reader = entry.createReader();
    await new Promise<void>((resolve, reject) => {
      const readBatch = () => {
        reader.readEntries(
          async (entries) => {
            if (!entries.length) {
              resolve();
              return;
            }
            await Promise.all(entries.map((child) => collectFilesFromEntries(child, files)));
            readBatch();
          },
          (error) => {
            if (error) reject(error);
          },
        );
      };
      readBatch();
    });
  }
};

const collectFilesFromItems = async (
  items: DataTransferItemList | DataTransferItem[],
): Promise<File[]> => {
  const collected: File[] = [];
  const pending: Promise<void>[] = [];
  const itemArray = Array.isArray(items) ? items : Array.from(items);

  itemArray.forEach((item) => {
    if (item.kind !== "file") return;
    const entry = (item as DataTransferItemWithWebkit).webkitGetAsEntry?.();
    if (entry) {
      pending.push(collectFilesFromEntries(entry, collected));
    } else {
      const file = item.getAsFile();
      if (file) collected.push(file);
    }
  });

  await Promise.all(pending);
  return collected;
};

export const UploadPage = () => {
  const queryClient = useQueryClient();
  const [files, setFiles] = useState<PreviewFile[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
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

  const addFiles = useCallback((list: FileList | File[] | null) => {
    if (!list) return;
    const fileArray = Array.isArray(list) ? list : Array.from(list);
    const usableFiles = fileArray.filter((file) => file.type.startsWith("image/"));
    if (!usableFiles.length) {
      setErrorMessage("请选择图像文件（JPG、PNG、BMP、TIFF）");
      return;
    }
    const next = usableFiles.map((file) => ({
      id: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
    }));
    setFiles((prev) => [...prev, ...next]);
  }, []);

  const removeFile = (id: string) => {
    setFiles((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((item) => item.id !== id);
    });
  };

  const handleClearTaskList = async () => {
    setStatusMessage("正在清空服务器任务列表…");
    setErrorMessage(null);
    try {
      const result = await clearTasks();
      await queryClient.invalidateQueries({ queryKey: ["tasks"] });
      setStatusMessage(result.cleared ? `已删除 ${result.cleared} 条任务` : "列表已清空");
    } catch (error) {
      console.error(error);
      setErrorMessage("清空失败，请稍后重试或检查后端日志");
    }
  };

  useEffect(
    () => () => {
      files.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    },
    [files],
  );

  const handleDrop = useCallback(
    async (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      try {
        const items = event.dataTransfer?.items;
        if (items && Array.from(items).some((item) => (item as DataTransferItemWithWebkit).webkitGetAsEntry?.())) {
          const folderFiles = await collectFilesFromItems(items);
          addFiles(folderFiles);
          setStatusMessage(`已从拖拽的文件夹导入 ${folderFiles.length} 个文件`);
          setErrorMessage(null);
        } else {
          addFiles(event.dataTransfer?.files ?? null);
        }
      } catch (error) {
        console.error(error);
        setErrorMessage("解析文件夹内容失败，请重试或使用最新浏览器");
      }
    },
    [addFiles],
  );

  const handleFolderButtonClick = async () => {
    const directoryPicker = (window as typeof window & {
      showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
    }).showDirectoryPicker;

    if (directoryPicker) {
      try {
        const dirHandle = await directoryPicker();
        const collected: File[] = [];

        const walkDirectory = async (handle: FileSystemDirectoryHandle) => {
          const iterator = (handle as unknown as { entries?: () => AsyncIterableIterator<[string, FileSystemHandle]> }).entries?.();
          if (!iterator) return;
          for await (const [, entry] of iterator) {
            if (entry.kind === "file") {
              const file = await (entry as FileSystemFileHandle).getFile();
              collected.push(file);
            } else if (entry.kind === "directory") {
              await walkDirectory(entry as FileSystemDirectoryHandle);
            }
          }
        };

        await walkDirectory(dirHandle);
        addFiles(collected);
        setStatusMessage(`已从 ${dirHandle.name} 导入 ${collected.length} 个文件`);
        setErrorMessage(null);
        return;
      } catch (error) {
        if ((error as DOMException).name === "AbortError") {
          return;
        }
        console.error(error);
        setErrorMessage("读取文件夹失败，请重试或使用最新浏览器");
      }
    }

    if (folderInputRef.current) {
      folderInputRef.current.click();
    } else {
      setErrorMessage("当前浏览器暂不支持文件夹上传，请尝试 Chrome 107+");
    }
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

  const handleDownloadResult = async (task: TaskSummary) => {
    const fileUrl = resolveResultUrl(task.id);
    if (!fileUrl || task.status !== "completed") {
      setErrorMessage("该任务暂无可下载的修复结果");
      return;
    }
    try {
      const response = await fetch(fileUrl);
      if (!response.ok) {
        throw new Error("failed to fetch result");
      }
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = blobUrl;
      anchor.download = `enhanced-${task.filename}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(blobUrl);
      setStatusMessage(`已下载 ${task.filename} 的修复结果`);
      setErrorMessage(null);
    } catch (error) {
      console.error(error);
      setErrorMessage("下载修复结果失败，请稍后再试");
    }
  };

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8">
      <header className="text-center text-white">
        <div className="w-full rounded-3xl bg-gradient-to-r from-brand-primary to-brand-secondary p-10 text-white shadow-card">
          <h2 className="text-3xl font-bold">📥 上传待修复图像</h2>
          <p className="text-sm opacity-80">拖拽或选择文件，系统会自动识别夜景、雾霾、老照片、日常等场景</p>
        </div>
      </header>

      <section className="w-full rounded-3xl bg-white/90 p-8 shadow-card">
        <div
          className="flex flex-col items-center gap-4 rounded-2xl border-2 border-dashed border-brand-primary/60 bg-gradient-to-r from-indigo-50 to-purple-50 p-10 text-center"
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
        >
          <span className="text-6xl">⬆️</span>
          <h3 className="text-xl font-semibold text-slate-800">拖拽文件到此处或点击选择</h3>
          <p className="text-sm text-slate-500">支持 JPG / PNG / BMP / TIFF，单张建议不超过 100MB，便于浏览器本地处理</p>
          <div className="flex flex-wrap gap-4">
            <button
              type="button"
              className="rounded-full bg-gradient-to-r from-brand-primary to-brand-secondary px-5 py-2 text-sm font-semibold text-white shadow"
              onClick={() => inputRef.current?.click()}
            >
              📁 选择文件
            </button>
            <button
              type="button"
              className="rounded-full bg-slate-100 px-5 py-2 text-sm font-semibold text-slate-600"
              onClick={handleFolderButtonClick}
            >
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
          <input
            ref={(element) => {
              folderInputRef.current = element;
              if (element) {
                element.setAttribute("webkitdirectory", "true");
                element.setAttribute("directory", "");
              }
            }}
            type="file"
            className="hidden"
            multiple
            onChange={(event) => {
              addFiles(event.target.files);
              if (event.target) {
                event.target.value = "";
              }
            }}
          />
        </div>
        <div className="mt-6 rounded-2xl border-l-4 border-blue-500 bg-blue-50 p-4 text-sm text-blue-600">
          💡 提示：当前输出直接采用模型默认参数，无需手动调节；备注可用于标记夜景/雾霾/老照片等场景以便后续查看。
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
            <p className="text-sm text-slate-500">查看上传后的处理进度，完成后可进入对比与评估页面</p>
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
            <button
              className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={handleClearTaskList}
              disabled={isRefreshingTasks}
            >
              清空列表
            </button>
          </div>

        </div>

        {sortedTasks.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed border-slate-200 p-8 text-center text-slate-400">
            暂无任务，上传后即可看到最新状态
          </div>
        ) : (
          <div className="mt-6 space-y-3">
            {sortedTasks.map((task) => {
              const resultUrl = resolveResultUrl(task.id);
              return (
                <div
                  key={task.id}
                  className="flex flex-col gap-4 rounded-2xl border border-slate-100 bg-white/80 p-4 shadow-sm md:flex-row md:items-center md:gap-6"
                >
                  <div className="flex-1">
                    <p className="font-semibold text-slate-800">{task.filename}</p>
                    <p className="text-xs text-slate-500">
                      {dateFormatter.format(new Date(task.created_at))} ·{" "}
                      {task.size ? (task.size / 1024 / 1024).toFixed(2) : "?"} MB
                    </p>
                  </div>
                  <div className="flex flex-1 flex-col gap-2 md:flex-row md:items-center md:justify-end md:gap-3">
                    <div className="flex items-center gap-2">
                      <StatusBadge status={task.status} />
                      {task.status === "completed" && resultUrl ? (
                        <button
                          className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600"
                          onClick={() => handleDownloadResult(task)}
                        >
                          下载修复
                        </button>
                      ) : null}
                    </div>
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
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {selectedTaskId ? (
        <TaskDetailPanel taskId={selectedTaskId} onClose={() => setSelectedTaskId(null)} />
      ) : null}
    </div>
  );
};
