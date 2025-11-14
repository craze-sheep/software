# Backend (FastAPI)

## 环境要求
- Python 3.10+（建议 3.11，方便与 Conda 环境匹配）
- Redis 7+（任务状态与队列必须，`redis://127.0.0.1:6379/0` 默认可用）

## 本地运行
推荐使用 Conda：

```powershell
conda create -n uw-restore python=3.11
conda activate uw-restore
```

随后安装依赖并启动（确保 Redis 先运行，例如 `docker run -d --name redis-uw -p 6379:6379 redis:7`）：

```powershell
cd backend
pip install -r requirements.txt    # 或 pip install -e .
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## 目录结构

```
app/
  core/        # 配置、常量
  api/routes/  # 路由模块
  schemas/     # Pydantic 模型
  services/    # 业务逻辑
  workers/     # 背景任务/队列占位
```
