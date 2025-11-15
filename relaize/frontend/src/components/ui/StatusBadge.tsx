import clsx from "classnames";

import type { TaskStatus } from "../../types/tasks";

type StatusBadgeProps = {
  status?: TaskStatus | string | null;
  size?: "sm" | "md";
};

const STATUS_MAP: Record<
  TaskStatus | "unknown",
  { label: string; icon: string; className: string }
> = {
  pending: {
    label: "待处理",
    icon: "⏳",
    className: "bg-amber-50 text-amber-700 ring-1 ring-amber-100",
  },
  processing: {
    label: "处理中",
    icon: "⚙️",
    className: "bg-sky-50 text-sky-700 ring-1 ring-sky-100",
  },
  completed: {
    label: "已完成",
    icon: "✅",
    className: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100",
  },
  failed: {
    label: "失败",
    icon: "⚠️",
    className: "bg-rose-50 text-rose-700 ring-1 ring-rose-100",
  },
  cancelled: {
    label: "已取消",
    icon: "🛑",
    className: "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
  },
  unknown: {
    label: "未知",
    icon: "❓",
    className: "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
  },
};

export const StatusBadge = ({ status, size = "md" }: StatusBadgeProps) => {
  const normalized = status && STATUS_MAP[status as TaskStatus] ? status : "unknown";
  const config = STATUS_MAP[normalized as keyof typeof STATUS_MAP];

  return (
    <span
      className={clsx(
        "status-badge",
        size === "sm" ? "status-badge--sm" : "status-badge--md",
        config.className,
      )}
    >
      <span aria-hidden>{config.icon}</span>
      {config.label}
    </span>
  );
};

