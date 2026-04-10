# Image to JPG

一个基于 Electron 的批量图片处理工具，同时提供 GUI 和 CLI 两种使用方式。当前代码会把 `HEIC`、`LIVP`、`PNG`、`DNG`、`TIFF`、`JPG/JPEG` 统一处理到 JPG 输出目录中。

[![Electron App](https://img.shields.io/badge/Platform-Electron-blue)](https://www.electronjs.org/)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)

## 当前实现支持什么

- GUI：支持拖入或选择多个文件夹，按顺序处理。
- CLI：支持单目录处理和递归处理。
- 支持识别的输入类型：`.heic`、`.livp`、`.png`、`.dng`、`.tif`、`.tiff`、`.jpg`、`.jpeg`。
- 文件识别优先看文件头；扩展名和真实内容不一致时，优先按文件头处理并输出警告。
- 默认输出到源目录下的 `jpg/` 子目录。

## 安装

```bash
npm install
```

如果你要直接运行 GUI：

```bash
npm start
```

如果你要运行 CLI：

```bash
npm run cli -- <目录路径>
```

可选地安装成全局命令：

```bash
npm install -g .
```

安装后可使用：

```bash
batch-image-processor <目录路径>
```

## GUI 使用方式

GUI 入口是 `npm start`，实际行为如下：

- 可拖拽文件夹，也可通过“添加文件夹”按钮选择文件夹。
- 可一次排队多个文件夹，按顺序逐个处理。
- GUI 总是递归扫描子目录。
- 每个被处理到的目录都会在自身目录下生成一个 `jpg/` 子目录。
- 递归扫描时会跳过目录名为 `jpg` 的文件夹，避免重复处理输出结果。
- 提供 JPG 质量滑块和“同时压缩原有 JPG 文件”开关。
- 质量和 JPG 压缩开关会持久化到本地配置。
- 处理完成后可直接打开输出目录。
- 启动时会检查 ImageMagick；未检测到时，界面会给出提示。

注意：GUI 在处理每个目录分组时会先清空该目录下已有的 `jpg/` 输出目录。

## CLI 使用方式

### 基本命令

```bash
npm run cli -- ./photos
```

递归处理：

```bash
npm run cli -- ./photos -r
```

压缩已有 JPG：

```bash
npm run cli -- ./photos --compress-jpg --quality 85
```

跳过已经存在的输出文件：

```bash
npm run cli -- ./photos --skip-existing
```

### CLI 参数

| 参数 | 简写 | 说明 |
| --- | --- | --- |
| `--verbose` | `-v` | 输出更详细的日志 |
| `--recursive` | `-r` | 递归处理子目录 |
| `--skip-existing` | `-s` | 若预期输出文件已存在则跳过 |
| `--output-dir <path>` | `-o` | 指定输出目录 |
| `--concurrency <number>` | `-c` | 并发处理数量，默认 `1` |
| `--quality <number>` | `-q` | JPG 输出质量，默认 `90` |
| `--compress-jpg` |  | 对原有 JPG/JPEG 重新压缩；不启用时仅复制到输出目录 |

CLI 没有 `--memory-cleanup` 之类的额外参数，以上表格就是当前代码里实际支持的选项。

### CLI 退出行为

- 目标目录不存在：退出码 `1`
- 没有发现可处理文件：退出码 `0`
- 存在处理失败文件：退出码 `1`
- 全部成功：退出码 `0`

## 输出规则

### 默认输出

- 非递归 CLI：输出到 `<输入目录>/jpg`
- GUI：输出到每个已扫描目录自己的 `jpg/`
- 递归 CLI：默认也是每个已扫描目录各自生成 `jpg/`

### 自定义输出目录

- CLI 非递归模式下，`--output-dir` 会把结果写到指定目录。
- CLI 递归模式下，如果传入 `--output-dir`，所有目录分组都会写到同一个指定目录，而不是分别写到各自子目录的 `jpg/`。

### 重名处理

- 当原有 `JPG/JPEG` 在“不压缩、仅复制”模式下写入输出目录时，会自动追加 `_1`、`_2` 之类的后缀来规避重名。
- 其他转换输出默认使用固定目标文件名，例如 `IMG_0001.heic -> IMG_0001.jpg`。

## 各格式的实际处理逻辑

### HEIC

- 优先尝试 `sharp`
- 失败后降级到内置 `heic-convert`
- 再失败且系统可用时，最后尝试 `ImageMagick`

### LIVP

- 把 `.livp` 当作 ZIP 包读取
- 从归档中寻找第一个 `.heic`、`.jpg`、`.jpeg`
- 如果内部是 HEIC，继续走 HEIC 转 JPG 流程
- 如果内部已经是 JPG/JPEG，则按当前 JPG 处理设置保存到输出目录

### PNG

- 使用 `sharp` 直接转 JPG

### DNG

- 先尝试 `sharp`
- 失败后，如果系统可用，再降级到 `ImageMagick`

### TIFF

- 当前实现仅使用 `sharp`

### JPG/JPEG

- 开启 `--compress-jpg` 或 GUI 中“同时压缩原有 JPG 文件”时：使用 `sharp` 重新编码
- 未开启时：直接复制到输出目录

## ImageMagick 什么时候需要

不是所有格式都强依赖 ImageMagick。

- HEIC：仅在 `sharp` 和内置解码器都失败时才会作为最终兜底
- DNG：`sharp` 失败时作为兜底
- TIFF：当前代码没有 ImageMagick 兜底
- PNG / JPG：当前代码不依赖 ImageMagick

macOS:

```bash
brew install imagemagick
```

Ubuntu / Debian:

```bash
sudo apt-get install imagemagick
```

## 项目结构

```text
src/
├── ui/
│   ├── main/         # Electron 主进程、IPC、Worker
│   └── renderer/     # GUI 页面、样式、交互逻辑
├── core/
│   ├── batch/        # 扫描目录、分组、并发编排
│   ├── converters/   # 各格式转换逻辑
│   └── services/     # 文件管理、进度、错误处理、文件头识别
└── cli/
    └── index.js      # CLI 入口
```

## 开发命令

```bash
# 启动 GUI
npm start

# 运行 CLI
npm run cli -- <目录路径>

# 运行测试
npm test

# 监听模式
npm run test:watch

# 覆盖率
npm run test:coverage

# 构建发布
npm run build:mac
npm run build:win
npm run build:linux
```

当前 `electron-builder` 配置：

- macOS：`dmg`、`zip`
- Windows：`portable`（`x64`）
- Linux：`AppImage`

## 当前实现里的注意事项

- `package.json` 当前版本是 `1.3.0`，但 CLI 里的 `--version` 仍然硬编码为 `1.1.0`。
- GUI 通过 `electron-store` 保存设置，默认值是 `quality: 90`、`compressJpg: true`。
- GUI 的拖拽只接受文件夹，不接受单个文件。
- 递归扫描时会跳过名字正好是 `jpg` 的目录。
- `README` 以上内容以当前仓库代码为准，不再保留旧版本更新日志中的历史描述。

## 测试

仓库内已有 Jest 测试，覆盖批处理、文件头识别、转换辅助和错误处理等核心模块。

```bash
npm test
```

## License

ISC
