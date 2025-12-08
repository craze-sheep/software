# Relaize Image Restoration — 全方位说明

> 一个面向夜景、雾霾、老照片、日常风景等多场景的图像修复平台，内置上传 → 队列 → 超分 + 调参 → 对比 → 报告流水线。前端基于 React/Vite（React Router、TanStack Query、Tailwind、Zustand），后端基于 FastAPI + Redis + Final2x 处理栈，整体通过 REST 接口无缝衔接。

## 1. 项目总览

```
relaize/
  backend/            # FastAPI 应用、任务/服务/模型目录、Redis + Final2x 引擎
  frontend/           # React SPA（Upload、Adjustment、Comparison、Report 等页面 + 公共组件/状态）
  storage/            # 由 backend 配置自动维护的 uploads/processed/reports/models 目录
  UI设计/             # 设计稿 HTML
```

前端通过 `VITE_API_BASE_URL`（`relaize/frontend/.env`）映射至后端 `settings.api_prefix`（`/api`）。后端 `app/core/config.py` 定义基础路径、Redis URL、Final2x 参数、存储目录并自动创建 `storage/` 结构，因此项目运行前只需准备 Redis + 权重文件。`backend/.env` 提供 `FINAL2X_ENABLED`、模型路径、允许 CORS、Redis 连接等覆盖值。

## 2. 后端架构（`relaize/backend/app`）

### 2.1 配置 + 生命周期
- `app/core/config.py`：`Settings` 继承 `pydantic-settings.BaseSettings`，通过 `.env` 加载；字段包括 API 前缀、环境、存储目录、Redis URL、Final2x 超分开关/设备/tile、模型路径、是否在预览中启用 Final2x；`ensure_directories()` 会在第一次访问时创建 `storage/uploads`/`processed`/`reports`。`get_settings()` 用 `lru_cache` 缓存配置。
- `app/main.py`：`create_app()` 创建 FastAPI 应用、注册 CORS（允许前端默认 origin）、挂载 API 路由；`lifespan` 上下文管理器初始化 Redis 客户端、`TaskService`、`ReportService`、后台 `TaskWorker`（`workers/processor.py`），关闭时清理并停止 worker。

### 2.2 模型与管线目录
- `models/catalog.py`：
  * `ModelSpec`、`PipelineStageSpec`、`PipelineSpec` 数据类描述模型/管线；`MODEL_CATALOG` 包含 RealESRGAN/HAT/SwinIR/DAT/RealCUGAN/GFPGAN/PromptFix/IOPaint/CTSDG/ShiftNet/CRFill 等条目。
  * `PIPELINE_CATALOG` 定义 `superres_basic`、`old_photo_restore`（GFPGAN + RealESRGAN）、`prompt_inpaint`（PromptFix）、`mask_inpaint`（IOPaint）、`structure_fill`（CTSDG → ShiftNet → CRFill）等流程。
  * `list_models/list_pipelines` 返回字典列表供 API，`get_model_spec/get_pipeline_spec` 提供查找。

### 2.3 图像处理服务
- `services/final2x_engine.py`：
  * `Final2xEngine` 负责缓存 Final2x-core `AutoModel`，支持 `device` 选择、tile、OOM 回退（逐步缩小 tile，之后尝试 CPU），`process()` 接收 BGR 图像并输出超分 + 可选 target_scale。
  * `_build_engine` 用 `lru_cache(maxsize=8)` 对不同配置缓存模型实例，`get_final2x_engine` 以环境配置（`final2x_device`/`final2x_model_name`）生成。
  * `resolve_model_for_adjustments` 判断 `adjustments` 中的 `model_name`、`preset_id`，将 Preset 映射到默认模型（night→HAT、haze→SwinIR、vintage→RealESRGAN、daily→DAT），用于调参预览/处理。

- `services/processor.py`：
  * `_gray_world_balance`/`_apply_color_temperature`/`_apply_saturation`/`_apply_adjustment_pipeline` 实现本地色彩与对比增强，使用 OpenCV（CLAHE、bilateral filter、Gaussian blur + addWeighted）。
  * `enhance_image`：读取原图、如 Final2x 启用则先 run 超分，再调用 `_apply_adjustment_pipeline`，保存 JPEG 到 `processed` 目录，计算 `uiqm`/`uciqe`/`entropy`/`clarity` 指标，返回 `{"uiqm": {...}, ...}`。
  * `generate_preview_image`：用于调参预览，行为与 `enhance_image` 类似，但输出 base64 PNG（`cv2.imencode`）+ 指标供前端展示。

- `services/model_wrappers.py`：
  * 提供 `_run_final2x_superres`/`_run_gfpgan`/`_run_promptfix`/`_run_iopaint` 等，分别调用 Final2x、GFPGAN、PromptFix (diffusers + torch)、IOPaint；`StageNotConfiguredError` 描述依赖未安装或配置缺失（如 GFPGAN 权重、PromptFix mask/prompt）。
  * `_ensure_data_url_image` 解析前端上传的 data URL 掩膜；`run_model_stage` 基于模型 ID 选择 handler。

- `services/pipeline_runner.py`：
  * `_resolve_pipeline` 默认 `superres_basic`，支持 `adjustments.pipeline_id` 覆盖；`stage_overrides` 允许替换管线 stage 使用的模型。
  * 每个 stage 记录执行耗时/状态/message，遇 `StageNotConfiguredError` 则在非 optional 阶段抛出异常，optional 阶段依赖未满足时跳过但记录 message。

### 2.4 任务管理与队列
- `services/tasks.py`：
  * 基于 Redis 存储任务 JSON（`TASK_DATA_PREFIX`）、维护 zset（`tasks:index`）和队列（`tasks:queue`）。
  * `create_from_upload`：生成 UUID，写文件到 `storage/uploads/{task_id}_{filename}`，创建 `TaskDetail`（含 `source_url` 指向 `GET /api/tasks/{id}/source`），将任务状态设为 `pending` 并入队。
  * `list_tasks` 支持 `status` 过滤、分页（`offset/limit`）；`get_task`/`update_task` 负责读取/更新；`mark_completed` 设定 metrics、`processed_at`；`apply_adjustments` 保存 `adjustments`、附带 `parameters/preset_id/model_name/note` 信息并重新排队；`cancel_task` 设置 `cancelled`。
- 辅助方法 `get_source_path/get_processed_path` 构建文件路径，供预览写入与 `FileResponse` 返回。

- `workers/processor.py`：
  * `TaskWorker` 继承 `threading.Thread`，循环从 Redis `blpop` 队列拉取 ID，`_process_task` 调用 `enhance_image` 处理，正常时更新 `TaskUpdate` 为 `completed` 并写入 `preview_url`，异常时标记 `failed` 并写错误 message。
  * `stop()` 将 `__shutdown__` 入队以触发退出，异常时有 `time.sleep(1)` 保护。

### 2.5 API 路由
- `api/routes/health.py`：`GET /api/health` 返回 `{status: ok}`。
- `api/routes/uploads.py`：`POST /api/uploads` 通过 `UploadFile` 接收图像，验证 `filename`，调用 `TaskService.create_from_upload` 返回 `UploadResponse`（`task_id` + `filename`）。
- `api/routes/tasks.py`：  
  * `GET /api/tasks`：分页 + status 过滤，返回 `TaskSummary` 列表。  
  * `GET /api/tasks/{task_id}`：详情，404 不存在。  
  * `PATCH /api/tasks/{task_id}`：更新状态/metrics/message。  
  * `POST /api/tasks/{task_id}/process`：调用 `enqueue_task` 重新入队。  
  * `POST /api/tasks/{task_id}/adjust`：`AdjustmentPayload` 包含 `parameters/preset_id/model_name/target_scale/note`，更新任务并重新排队。  
  * `POST /api/tasks/{task_id}/cancel`：标记为 cancelled，返回更新后的任务。  
  * `POST /api/tasks/{task_id}/preview-adjust`：合并 payload 与现有 adjustments，调用 `generate_preview_image`，返回 `preview_base64` + metrics；错误会写入 `preview-errors.log`（`tasks.py:23`）并返回 500。  
  * `GET /api/tasks/{task_id}/preview` 与 `/source` 分别返回 processed/source 文件。
- `api/routes/reports.py`：调用 `ReportService.generate`，处理不存在任务的情况变 404。
- `api/routes/catalog.py`：通过 `list_models/list_pipelines` 返回模型 + 管线；`CatalogResponse` 含 `models`、`pipelines`。

### 2.6 Schema 与类型
- `schemas/tasks.py`：`TaskStatus` 枚举（pending/processing/completed/failed/cancelled）、`TaskBase`/`TaskSummary`/`TaskDetail`/`TaskUpdate`/`AdjustmentPayload`/`TaskPreviewResponse`，附带默认时间戳 `created_at`/`updated_at`。
- `schemas/catalog.py`：`ModelInfo`/`PipelineStageInfo`/`PipelineInfo`/`CatalogResponse`。
- `schemas/reports.py`：`MetricPair`（name/before/after/delta）、`ReportSection`（title/summary/metrics）、`ReportResponse`、`ReportListResponse`。

## 3. 前端细节（`relaize/frontend`）

### 3.1 构建 + 入口
- 技术栈：Vite 7 + React 18 + TypeScript + React Router 7 + TanStack Query 5 + Tailwind + Radix Slider/clsx。
- `main.tsx`：创建 `QueryClient`（`refetchOnWindowFocus: false`）、提供 `QueryClientProvider`、`RouterProvider` 与 `ReactQueryDevtools`。
- `router.tsx`：根路由 `/` 使用 `AppLayout`，子路由 `upload`/`adjustment`/`comparison`/`report`，其他路径重定向；`AppLayout` 包含 header、logo 文案、导航链接（`navItems`）并渲染 `<Outlet />`。

### 3.2 通用组件与状态
- `components/ui/StatusBadge.tsx`：根据 `TaskStatus` 输出对应 label/icon/style（pending/processing/completed/failed/cancelled/unknown）。
- `components/ui/SliderControl.tsx`：Radix Slider 封装组件，提供 `label`/`description`/格式化文字/禁用样式。
- `components/tasks/TaskDetailPanel.tsx`：使用 React Query 请求 `fetchTaskDetail`，展示 ID/状态/时间/metrics，提供下载原图/修复图按钮（`resolveFileUrl` + anchor download）。
- `store/adjustmentStore.ts`（Zustand）：保存 8 个滑块参数，提供 `setParameter`/`setParameters`/`reset`，初始值 `DEFAULT_ADJUSTMENT_PARAMS`。
- `lib/api.ts`：封装 axios（`API_BASE_URL`），提供 `resolveFileUrl`（将相对 API 文件路径拼接成绝对）、`fetchTasks`/`fetchTaskDetail`/`uploadImage`/`fetchReport`/`applyAdjustments`/`fetchTaskPreview`/`processTask`/`cancelTask`。

### 3.3 Upload 页面（`UploadPage.tsx`）
- 文件选择：支持浏览器 file input、拖拽（`handleDrop`）、文件夹（`collectFilesFromEntries` + `showDirectoryPicker` + `<input webkitdirectory>`），自动过滤非图片。
- 状态：`files`（带 preview URL）、`statusMessage`/`errorMessage`、`isUploading`、`selectedTaskId`。
- 上传：`handleUpload` 并行 `uploadImage`、提示成功/失败数量、清理 preview URL、调用 `refetch`；按钮禁用状态、信息提示会在上传过程中变化。
- 任务列表：`useQuery(["tasks", statusFilter])` 获取任务，`statusFilter` 可选 `all/pending/processing/completed/failed/cancelled`；`sortedTasks` 按创建时间降序。
- 每个任务提供状态徽章、下载按钮（先 `resolveFileUrl(task.preview_url)` 再 `fetch` 创建 blob）、重新处理（`processTask`）、取消（`cancelTask`）、查看详情（打开 `TaskDetailPanel`）。
- 页面还包含提示框（如文件夹上传、参数建议）、清空/刷新按钮、drag-drop 区域 UI、任务表格 cards。

### 3.4 调参页面（`AdjustmentPage.tsx`）
- 任务选择框：`useQuery(["tasks"])` + 下拉选择（默认第一个任务），并实时 `useQuery` 获取任务详情（`["task-detail", selectedTaskId]`，5000ms 刷新）。
- 图像展示：左图显示原图（`resolveFileUrl(task.source_url)`），右图显示最新修复图或自定义预览，顶部标签（原始/修复/预览状态）。
- 滑块参数及预设：`PRESET_OPTIONS` 定义四套 presets（night/haze/vintage/daily），`applyPreset` 会 `setParameters`、设定 `activePresetId`、默认模型/提示信息；`custom` 模式时 `setHasLocalChanges` 并更新 `statusMessage`。滑块通过 `SliderControl` 显示 8 个参数（`compensation`/`colorTemp`/`saturation`/`contrast`/`sharpness`/`dehaze`/`denoise`/`edgePreserve`），变化会自动切换 `custom` 模式与标记本地更改。
- 预设保存：`handleSavePreset` 将当前组合保存到 `localStorage`（`PRESET_STORAGE_KEY`），页面加载时 `loadStoredPreset` 读取并应用。
- 模型选择：`MODEL_OPTIONS` 包含 RealESRGAN/HAT/SwinIR/DAT/RealCUGAN 等，侧边栏 `<select>` 切换 `activeModelId`。
- 预览：若有本地变更会在 600ms 后调用 `fetchTaskPreview` 生成 base64 预览图并更新 `previewImage` + 指标（`previewBadgeText` 显示状态）；若没有变更则默认展示后端 `preview_url`，可通过 `isPreviewOpen` 全屏预览。
- 应用修复：`handleApply` `POST /tasks/{id}/adjust`，payload 包括 parameters/preset_id/model_name/note，成功后 refresh `tasks` + `task-detail` 缓存，提示跳转对比页（`lastSubmittedTaskId`）。
- 建议区：提供调参建议（夜景、雾霾、保存预设）、状态/错误提示、跳转按钮（到对比页）。

### 3.5 对比页面（`ComparisonPage.tsx`）
- 数据源：`useQuery(["tasks","comparison"])` 拉取 `completed` 任务，5 秒自动 refresh；`selectedTaskId` 由 URL 搜索参数控制（`useSearchParams`）。若 `query` 中 task ID 不存在则默认选第一个，反馈 `setSearchParams` 更新。
- 视图模式：`mode` 可选 `split`（左右卡片各自展示）、`slider`（单图用 `clipPath` 与 `sliderPosition` 显示 before/after）；滑动模式支持同步视图（`isSyncEnabled`）与标注 overlays（`GuideOverlay`）。
- 指标面板：`metricCards` 用 `metricsMap`（后端 metrics or `FALLBACK_METRICS`）生成 UIQM/ UCIQE/ Clarity/ Entropy/处理耗时卡片，带百分比提升、summary 文本。
- 操作按钮：下载 before/after（异步 fetch + blob），打印导出（`window.print`）、跳到报告、返回上传。
- 反馈条（`feedback`）用于提示下载、导出、暂无图像等 message。

### 3.6 报告页面（`ReportPage.tsx`）
- `useQuery(["tasks"])` 获取任务列表，默认选择第一个 `completed`。
- `useQuery(["report", selectedTaskId])` 调用 `fetchReport`；`report?.sections` 分段展示指标，第一段 `primarySection` 弹性展示前后 `MetricPair`，其他 sections 使用 `summary`/`metrics` 列表。
- 页脚包含 recommendations，配合导出/下载/返回按钮（目前仅 UI placeholder）。
- 错误状态（`isError`）显示对应提示文本。

### 3.7 TypeScript types
- `types/tasks.ts`：`TaskStatus` 联合类型、`AdjustmentPayload`、`TaskSummary`、`TaskDetail`、`TaskPreviewResponse`；`TaskSummary` 结构与后端 `TaskSummary` Pydantic 模型一一对应（包含 `preview_url`, `metrics`, `adjustments` 等）。
- `types/report.ts`/`types/catalog.ts`：与后端 `ReportResponse`/`PipelineInfo` 对应，为 axios 返回值提供静态类型。

## 4. 数据流与交互

1. 用户在 Upload 页面拖拽/选中文件，`handleUpload` 调 `uploadImage` 上传 `multipart/form-data`，后端 `UploadService.create_from_upload` 保存到 `storage/uploads` 并将任务入 Redis 队列。
2. 后端 `TaskWorker` 通过 `redis.blpop` 拉取 `task_id`，调用 `enhance_image`（Final2x + 调参 pipeline）保存 processed 图、更新 metrics、写入 `preview_url`，并将 task status 设为 `completed`。指标用 `TaskUpdate` 保存到 Redis。
3. 前端 Upload 页面轮询 `GET /api/tasks`（依据 `statusFilter`）显示每个任务状态、大小、 download/preview 按钮，并可进入 `TaskDetailPanel` 查看 metrics 与链接；失败或取消任务可重新 `processTask` 或 `cancelTask`。
4. 调参页面依据 `selectedTask` 改变 sliders/模型/预设，在本地更改后自动调用 `fetchTaskPreview` `POST /api/tasks/{id}/preview-adjust` 生成实时预览；点击“应用修复”调用 `POST /api/tasks/{id}/adjust` 提交参数并重新排队，后台 worker 复用 pipeline 生成新结果。
5. 对比页面 `fetchTasks({ status: "completed" })` 后将 `source_url`/`preview_url` 转换为下载链接并提供 split/slider view、指标卡、下载/导出操作。
6. 报告页面调用 `GET /api/reports/{task_id}` 获取 `ReportResponse`（metrics + recommendations）并渲染成段落卡片。

## 5. 运行准备与注意事项

- 推荐流程：  
  1. 启动 Redis（如 `docker run -d --name redis-uw -p 6379:6379 redis:7`）；  
  2. 进入 `relaize/backend`，使用 `conda`（`python 3.11`）或 `venv` 安装依赖 `pip install -r requirements.txt`；  
  3. 在 `backend/.env` 中配置 `REDIS_URL`, `ALLOWED_ORIGINS`, `FINAL2X_ENABLED`, `GFPGAN_MODEL_PATH`, `PROMPTFIX_MODEL_PATH`, `IOPAINT_MODEL_PATH`（如果需要）。  
  4. 启动后端 `uvicorn app.main:app --reload --host 0.0.0.0 --port 8000`；  
  5. 另开终端进 `relaize/frontend`，运行 `npm install`（若未安装）、`npm run dev` 开启前端开发服务器。

- 存储目录：`storage/uploads`, `storage/processed`, `storage/reports`, `storage/models`（需手动丢权重），仅其中 `storage/models` 需要额外准备权重文件。
- 日志与调试：`backend/preview-errors.log` 记录预览生成异常；`uvicorn` 控制台会 log stage/loading 信息。
- 网络安全：`.env` 中 `ALLOWED_ORIGINS` 默认 localhost + 127.0.0.1，部署到生产时务必追加实际域名。
- 扩展点：  
  * 在 `models/catalog.py` 添加新 `PipelineSpec`（可组合不同模型）并前端同步。  
  * 为 `ComparisonPage` 加入真实导出（PDF/图片）逻辑。  
  * 在 `ReportPage` 实现 `Download report` 按钮调用后端导出 API。  
  * 将 `final2x_engine` 中的 `PRESET_MODEL_OVERRIDES` 暴露给前端供默认模型选择。

## 6. 附录

- `backend/README.md`/`frontend/README.md` 各自含最小运行命令与目录说明。  
- `storage/` 会自动被 `get_settings().ensure_directories()` 创建，因此无需手动新建。  
- UI 设计稿位于 `UI设计/`，可通过浏览器预览 `upload.html`/`adjustment.html`/`comparison.html`/`report.html` 查看 UI 原型。  
- 若发现 `pydantic` 报 `final2x_enabled` 相关错误，请检查 `.env` 中是否写错 `true`（已修复为 true）。  
