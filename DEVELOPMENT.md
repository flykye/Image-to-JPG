# Image to JPG 开发文档

## 项目概述
一个基于 Electron 开发的跨平台图形化图片处理工具，专门用于将 HEIC、LIVP、PNG 格式图片批量转换为 JPG 格式。项目名称已变更为 **Image to JPG**。

## 核心功能
- **拖拽/选择处理**: 支持将整个文件夹拖入界面，或通过 “添加文件夹” 按钮选择目录，自动开始处理。
- **零污染设计**: 源目录文件保持原样，不进行任何修改或移动。
- **自动输出**: 所有处理结果统一存放在源目录下的 `jpg` 子目录。
- **自动清理**: 针对每次批量任务，在处理开始前一次性清空已存在的 `jpg` 目录，避免重复清理。
- **智能重命名**: 遇到同名文件自动添加序号（如 `img_1.jpg`）防止覆盖。
- **输出质量控制**: 提供 JPG 压缩质量滑块 (1-100) 及 “压缩现有 JPG” 选项。

## 技术架构
- **框架**: Electron (渲染进程与主进程通过 IPC 通信)。
- **图像处理**: 
  - `sharp`: 用于高性能转换。
  - `heic-convert`: 内置 Wasm 解码器，确保 Windows 在无插件情况下也能处理 HEIC。
  - `adm-zip`: 用于解析 LIVP (本质是 ZIP) 文件。
- **打包工具**: `electron-builder`。

## 平台兼容性实现 (重要)
### Windows (win32-x64)
- **HEIC 支持**: Windows 版本的 `sharp` 默认不带 HEIC 解码器。程序实现了三层降级方案：
  1. 尝试 `sharp`。
  2. 若报错，自动切换至内置的 `heic-convert` (Wasm)。
  3. 若还失败，尝试调用系统安装的 `ImageMagick` (magick 命令)。
- **原生模块**: `sharp` 已配置在 `asarUnpack` 中，防止在打包后的 exe 中加载失败。

### macOS (darwin-arm64)
- 适配 Apple Silicon 芯片，支持 dmg 和 zip 格式打包。

## 常用开发命令

### 本地测试 (macOS)
```bash
npm start
```

### 构建 Windows 版本 (.exe)
```bash
# 1. 确保安装了 windows 驱动 (若在 mac 下构建)
npm install --os=win32 --cpu=x64 sharp

# 2. 执行打包
npm run build:win

# 3. 构建完成后，如需恢复 mac 测试环境
npm install --os=darwin --cpu=arm64 sharp
```

### 构建 macOS 版本 (.dmg)
```bash
npm run build:mac
```

## 项目结构
- `main.js`: Electron 主进程逻辑，处理文件扫描和核心转换调度。
- `renderer.js`: 渲染进程逻辑，处理 UI 交互、日志显示及统计。
- `heic-converter.js`: 封装了三种降级方案的 HEIC 转换逻辑。
- `file-manager.js`: 处理目录创建、清空及文件复制。
- `assets/`: 存放应用图标等静态资源。

## 状态快照 (2026-01-09)
- [x] **修复：** LIVP 文件处理结果现在会在 UI 上正确显示压缩率信息。
  - 问题：`batch-processor.js` 中 `processLivpFile()` 调用 `logSuccess()` 时未传递压缩率相关参数。
  - 修复：添加 `compressionRatio`、`inputSize`、`outputSize` 参数，确保 LIVP 文件（无论内部是 HEIC 还是 JPEG）处理后都能在日志中显示压缩信息，例如：`(3.2 MB → 1.8 MB, 压缩率 43.8%)`。

## 状态快照 (2026-01-07)
- [x] 中文 UI 界面完成。
- [x] 实时日志动态滚动（新日志最前）完成。
- [x] 最终处理结果统计面板完成。
- [x] Windows 内置 HEIC 解码器集成完成。
- [x] **新功能：** 添加 JPG 压缩质量滑块 (1-100)。
- [x] **新功能：** 添加 “压缩现有 JPG” 选项。
- [x] **新功能：** 添加 “添加文件夹” 按钮，支持通过文件对话框选择目录。
- [x] **新功能：** 添加 “打开输出文件夹” 按钮。
- [x] **修复：** macOS 隐藏标题栏模式下 UI 元素与交通灯重叠的问题。
- [x] **修复：** 目录清理逻辑调整，改为在批量任务开始时一次性清空 `jpg` 目录。