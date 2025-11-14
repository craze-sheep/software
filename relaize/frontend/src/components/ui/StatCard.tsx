type StatCardProps = {
  label: string;
  value: string;
  hint: string;
  variant?: "primary" | "success" | "warning";
};

const variantClasses: Record<NonNullable<StatCardProps["variant"]>, string> = {
  primary: "bg-gradient-to-br from-brand-primary/90 to-brand-secondary text-white",
  success: "bg-gradient-to-br from-emerald-400 to-emerald-500 text-white",
  warning: "bg-gradient-to-br from-amber-400 to-orange-500 text-white",
};

export const StatCard = ({ label, value, hint, variant = "primary" }: StatCardProps) => (
  <div className={`rounded-2xl p-6 shadow-card ${variantClasses[variant]}`}>
    <p className="text-sm uppercase tracking-[0.3em] opacity-80">{label}</p>
    <p className="mt-2 text-4xl font-bold">{value}</p>
    <p className="mt-1 text-sm opacity-90">{hint}</p>
  </div>
);
