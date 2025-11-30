# Frontend (React + Vite + TypeScript)

## 技术栈
- React 18 + TypeScript
- Vite 7
- React Router 7
- TanStack Query 5
- Zustand（调参状态）
- Tailwind CSS + Radix Slider（UI 控件）

## 本地开发
```powershell
cd frontend
npm install          # 已执行，可在必要时重新安装
npm run dev          # 启动开发服务器（由你来运行）
```

### 环境变量
在 `frontend/.env` 中配置：
```
VITE_API_BASE_URL=http://localhost:8000/api
```

## 目录
```
src/
  components/   # UI 组件、卡片、滑块
  layouts/      # 布局（含导航、头部）
  pages/        # 对应 upload / adjustment / report 页面
  store/        # Zustand 状态
  lib/          # Axios 实例等
```
