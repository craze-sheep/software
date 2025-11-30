# Final2x 使用说明

## 1. 项目概述
Final2x 是一款跨平台图像超分辨率工具，内置多种模型（如 RealCUGAN、RealESRGAN、Waifu2x 等），可在放大图像的同时尽可能保留细节与清晰度。它支持自定义放大倍率，从轻量增强到大尺度复原都能适用，并提供英语、中文、日语、法语等多语言界面，便于全球用户使用。

Final2x v4.0.0 起改用 cccv 作为后端框架，允许加载自定义模型并提供更灵活的算力适配；若需要 NVIDIA 50 系列 GPU 也可在 v3.x 起获得官方支持。

## 2. 快速安装
### Windows 客户端
1. 打开发布页下载最新安装包：<https://github.com/Tohrusky/Final2x/releases>
2. 直接运行 `.exe` 安装程序即可使用。
3. 如果希望通过包管理器升级，可使用 winget：
   ```powershell
   winget install Final2x
   ```
   > 说明：Winget/Scoop 中的版本可能滞后于 GitHub 发布，请以官方 release 为准。

### macOS / Linux / CLI 环境（参考）
- 需要 Python ≥ 3.9、PyTorch ≥ 2.0。
- 安装核心库：
  ```bash
  pip install Final2x-core
  Final2x-core -h  # 验证安装
  ```
- Linux 用户还需安装 `libomp5`、`xdg-utils` 等运行依赖。

## 3. CLI 使用示例
如果只想使用核心引擎，可在命令行执行（默认要求 Python ≥ 3.9、PyTorch ≥ 2.0）：
```bash
pip install Final2x-core
Final2x-core -h  # 查看帮助
```
典型的转换命令：
```bash
Final2x-core -i "input.jpg" -o "output.png" -m "realesrgan" -s 2
```
- `-i`：输入图片路径
- `-o`：输出图片路径
- `-m`：指定模型（例如 `realesrgan`、`realcugan` 等）
- `-s`：放大倍率（整数或浮点数）

> **Hardware**：推荐使用带 CUDA 的 NVIDIA GPU，以获得明显的推理速度提升；无独显时会退回 CPU，速度较慢。
> **Custom models**：从 v4.0 起可以加载自定义权重，只需将模型文件放入 Final2x 指定目录并在命令中通过 `-m` 引用即可。
> **效果提示**：超分质量依赖原图质量，对于极度模糊或尺寸过小的图片，AI 仍然难以恢复细节；但大部分情况下会有可见提升。

## 4. 在本项目中的使用方向
- 后端当前已安装 `Final2x-core` 并可通过 `AutoModel` 载入 RealESRGAN 等模型；可扩展为读取自定义权重，或在特定场景（夜景、雾霾、老照片）自动切换模型。
- 若需要图形化批处理，也可在 Windows 开发机上直接运行 Final2x 客户端处理素材，再将输出文件上传到系统做后续评估。
- CLI 方式（`Final2x-core`）适合与我们的 FastAPI Worker 集成，可通过配置文件指定模型、设备、目标倍率等参数实现全自动流程。

如需更多平台/脚本示例，请参阅上方 release 页面或官方 README。