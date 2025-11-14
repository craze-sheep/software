type QuickActionCardProps = {
  icon: string;
  title: string;
  description: string;
  actionLabel: string;
  onClick?: () => void;
};

export const QuickActionCard = ({
  icon,
  title,
  description,
  actionLabel,
  onClick,
}: QuickActionCardProps) => (
  <div className="flex flex-col gap-4 rounded-2xl bg-white p-6 text-center shadow-card transition hover:-translate-y-1 hover:shadow-2xl">
    <div className="text-5xl">{icon}</div>
    <div>
      <h3 className="text-lg font-semibold text-slate-800">{title}</h3>
      <p className="text-sm text-slate-500">{description}</p>
    </div>
    <button
      type="button"
      className="rounded-full bg-gradient-to-r from-brand-primary to-brand-secondary px-4 py-2 text-sm font-semibold text-white shadow"
      onClick={onClick}
    >
      {actionLabel}
    </button>
  </div>
);
