import { NavLink, Outlet } from "react-router-dom";
import clsx from "classnames";

const navItems = [
  { label: "仪表板", path: "/" },
  { label: "上传", path: "/upload" },
  { label: "自动修复", path: "/auto" },
  { label: "手动调整", path: "/adjustment" },
  { label: "效果对比", path: "/comparison" },
  { label: "评估报告", path: "/report" },
];

export const AppLayout = () => (
  <div className="min-h-screen bg-gradient-to-br from-slate-100 to-indigo-100">
    <header className="bg-gradient-to-r from-brand-primary to-brand-secondary text-white shadow-lg">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-6 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.3em] opacity-80">水下图像修复系统</p>
          <h1 className="text-3xl font-bold tracking-wide">Underwater Vision Studio</h1>
        </div>
        <nav className="flex flex-wrap gap-3">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                clsx(
                  "rounded-full px-4 py-2 text-sm font-semibold transition",
                  isActive ? "bg-white/20 shadow-md" : "bg-white/10 hover:bg-white/20",
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </header>

    <main className="mx-auto max-w-6xl px-4 py-10">
      <Outlet />
    </main>
  </div>
);
