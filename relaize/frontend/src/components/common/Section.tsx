import type { PropsWithChildren } from "react";

type SectionProps = PropsWithChildren<{
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}>;

export const Section = ({ title, subtitle, action, children }: SectionProps) => (
  <section className="space-y-4 rounded-3xl bg-white/90 p-6 shadow-card">
    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
      <div>
        <h2 className="text-xl font-semibold text-slate-800">{title}</h2>
        {subtitle ? <p className="text-sm text-slate-500">{subtitle}</p> : null}
      </div>
      {action}
    </div>
    {children}
  </section>
);
