# Image to JPG

一个强大的跨平台 **Electron GUI 应用**，专门用于将 HEIC、LIVP、PNG、DNG、TIFF 等格式图片批量、高质量地转换为 JPG 格式。同时保留了强大的 **命令行 (CLI)** 模式。

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D14.0.0-brightgreen)](https://nodejs.org)
[![Electron App](https://img.shields.io/badge/Platform-Electron-blue)](https://www.electronjs.org/)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)

## 💻 快速开始 (GUI)

通过以下步骤在本地启动图形化界面进行测试：

```bash
# 1. 安装依赖
npm install

# 2. 启动图形化界面
npm start 
```

## 📦 构建发布版本

```bash
# 构建 macOS (.dmg)
npm run build:mac

# 构建 Windows (.exe)
npm run build:win
```

## ✨ 功能特点

### 图形界面 (GUI) 特性
- **零学习成本**: 简洁的拖拽界面或 “添加文件夹” 按钮选择目录，即刻开始处理。
- **质量精确控制**: 提供 JPG 压缩质量滑块 (1-100)，支持设置输出品质。
- **JPG 智能处理**: 可选是否对源目录中原有的 JPG 文件进行二次压缩 (基于设定的质量)。
- **快速定位**: 处理完成后，一键打开输出文件夹 (`/jpg`)。
- **实时反馈**: 详细的实时处理日志、进度条和结果统计。

### 核心处理能力
- **批量转换**: 自动扫描并处理 HEIC、LIVP、PNG、DNG、TIFF 和 JPG (可选压缩) 文件。
- **文件头识别**: 优先使用文件头 (magic number) 判断格式，扩展名与实际类型不一致时自动按真实类型处理并给出警告。
- **格式转换**: 将 HEIC、PNG 和 DNG (RAW) 文件转换为 JPG 格式，保持高质量。
- **LIVP 提取**: 从 Apple 的 LIVP 图像包中提取图像，并转换为 JPG。
- **DNG 支持**: 支持 Adobe Digital Negative RAW 格式，使用内置预览设置处理白平衡。
- **无污染输出**: 所有结果集中存放在源目录下的 `/jpg` 子目录，源文件保持不变。
- **智能重命名**: 自动处理文件命名冲突。

### 命令行 (CLI) 模式
- **并发处理**: 支持文件级并发，大幅提升大批量文件的处理速度。
- **灵活配置**: 丰富的命令行选项（如 `--concurrency`, `--output-dir`, `--skip-existing` 等）满足自动化需求。
- **错误恢复**: 单个文件失败不影响整体处理，自动记录详细错误信息。
- **性能优化**: 可选的积极内存清理模式 (`--memory-cleanup`)。

### 技术亮点
- **双转换引擎**: 优先使用sharp库进行HEIC转换，自动回退到内置的 Wasm 解码器，并最终回退到 ImageMagick (CLI)。
- **模块化架构**: 清晰的模块划分，便于维护和扩展。
- **详细日志**: 支持verbose模式，提供详细的处理信息。

## 架构与模块

### 模块结构

```
Image to JPG/
├── src/
│   ├── ui/
│   │   ├── main/
│   │   │   ├── index.js           # Electron主进程：窗口、IPC通信调度
│   │   │   ├── preload.js        # 预加载脚本：IPC安全桥接
│   │   │   └── conversion-worker.js  # Worker线程处理转换
│   │   └── renderer/
│   │       ├── index.html         # 界面结构 (GUI)
│   │       ├── styles.css        # 界面样式 (GUI)
│   │       └── renderer.js       # 渲染进程：UI逻辑、事件处理
│   ├── core/
│   │   ├── converters/           # 格式转换器
│   │   │   ├── index.js           # 转换器工厂
│   │   │   ├── base.js            # 基类
│   │   │   ├── image-converters.js # HEIC/PNG/DNG/TIFF转换
│   │   │   ├── heic-logic.js      # HEIC转换逻辑
│   │   │   ├── livp-logic.js      # LIVP提取逻辑
│   │   │   ├── livp-converter.js  # LIVP转换器
│   │   │   ├── dng-logic.js       # DNG转换逻辑
│   │   │   ├── tiff-logic.js      # TIFF转换逻辑
│   │   │   └── jpg-converter.js    # JPG转换器
│   │   ├── services/             # 共享服务
│   │   │   ├── file-manager.js    # 文件管理
│   │   │   ├── file-signature.js  # 文件头识别
│   │   │   ├── progress-reporter.js # 进度报告
│   │   │   └── error-handler.js   # 错误处理
│   │   └── batch/
│   │       └── index.js          # 批处理编排
│   └── cli/
│       └── index.js              # CLI入口
├── testimage/                    # 测试用图片文件
├── assets/                       # 应用图标
├── package.json
└── AGENTS.md                    # 开发规范
```

### 核心模块说明

#### src/ui/main/ - Electron主进程
负责窗口创建、IPC通信调度、文件对话框，以及Worker线程管理转换任务。

#### src/ui/renderer/ - 渲染进程
负责用户界面交互、配置读取、以及主进程与渲染进程之间的IPC通信。

#### src/core/converters/ - 格式转换器
- `index.js`: 转换器工厂，管理所有格式转换器
- `base.js`: 转换器基类
- `image-converters.js`: HEIC/PNG/DNG/TIFF转换器实现
- `heic-logic.js`: HEIC转换核心逻辑（支持sharp + Wasm回退）
- `livp-converter.js` / `livp-logic.js`: LIVP归档提取和转换
- `dng-logic.js`: DNG RAW格式转换
- `jpg-converter.js`: JPG压缩处理

#### src/core/services/ - 共享服务
- `file-manager.js`: 输出目录管理、文件复制、冲突解决
- `file-signature.js`: 文件头(magic number)识别真实格式
- `progress-reporter.js`: 实时进度显示和统计
- `error-handler.js`: 错误分类、安全执行包装器

#### src/core/batch/ - 批处理
负责目录扫描、文件分类、批量处理流程编排、并发控制。

#### src/cli/ - 命令行入口
使用commander解析命令行参数，提供完整的CLI功能。

## 安装

### 前提条件

- Node.js (推荐v14或更高版本)
- npm或yarn包管理器

### 安装步骤

1. 克隆或下载此仓库
2. 进入项目目录
3. 安装依赖：

```bash
npm install
# 或者使用yarn
yarn install
```

4. 全局安装（可选，用于 CLI 模式）：

```bash
npm install -g .
# 或者使用yarn
yarn global add file:.
```

## 命令行 (CLI) 使用方法

### 基本用法

```bash
node batch-processor.js <目录路径>
```

或者如果全局安装了：

```bash
batch-image-processor <目录路径>
```

### 命令行选项

| 选项 | 简写 | 描述 |
|------|------|------|
| `--verbose` | `-v` | 启用详细日志记录 |
| `--memory-cleanup` | `-m` | 启用积极的内存清理（适用于大批量处理） |
| `--skip-existing` | `-s` | 跳过已有JPG版本的文件 |
| `--concurrency <数字>` | `-c` | 并发处理的文件数量（默认：1） |
| `--output-dir <路径>` | `-o` | 自定义JPG文件的输出目录（默认：./jpg） |
| `--quality <数字>` | `-q` | JPG 输出质量（1-100，默认：95） |
| `--compress-jpg` | | 同时对源目录中原有的 JPG 文件进行二次压缩 |
| `--legacy` | `-l` | 以传统模式运行（仅处理当前目录中的LIVP文件） |
| `--no-copy` | | 不将处理后的文件复制到jpg目录 |
| `--help` | `-h` | 显示帮助信息 |
| `--version` | | 显示版本信息 |



## 处理流程

1. 程序接受目标目录路径作为命令行参数（或 GUI 拖拽/选择）
2. 扫描目录中的所有HEIC、LIVP、PNG、DNG、TIFF和JPG文件
   - 优先使用文件头识别真实格式，扩展名冲突时按真实类型处理并给出警告
3. 处理HEIC文件：将其转换为JPG格式
4. 处理PNG文件：将其转换为JPG格式
5. 处理DNG文件：将RAW格式转换为JPG格式（使用内置预览设置）
6. 处理LIVP文件：提取内部图像，如果是HEIC格式则转换为JPG
7. 处理JPG文件：根据 `--compress-jpg` 选项决定是否进行二次压缩
8. 将处理后的JPG文件复制到输出目录（默认为输入目录下的jpg子目录）
9. 显示处理进度和结果摘要

## 错误处理

程序设计为即使在处理个别文件失败的情况下也能继续运行：

- 如果无法读取文件，程序会记录错误并继续处理下一个文件
- 如果图像转换失败，程序会记录错误并继续处理下一个文件
- 如果LIVP提取失败，程序会记录错误并继续处理下一个文件
- 如果复制到jpg目录失败，程序会记录错误并继续处理下一个文件

## 性能优化

### 并发处理
通过调整并发级别可以显著提高处理速度：
```bash
batch-image-processor ./photos --concurrency 4
```

建议的并发值：
- **小批量（< 100文件）**: 1-2（默认）
- **中批量（100-1000文件）**: 2-4
- **大批量（> 1000文件）**: 4-8
- **超大批量（> 10000文件）**: 8-16

### 内存管理
处理大量文件时启用内存清理：
```bash
batch-image-processor ./huge-photos --memory-cleanup
```

### 跳过已处理文件
使用`--skip-existing`选项避免重复处理：
```bash
batch-image-processor ./photos --skip-existing
```

## 最佳实践

1. **首次处理**: 使用详细模式 (`--verbose`) 了解处理过程。
2. **大批量处理**: 启用并发 (`--concurrency`) 和内存清理 (`--memory-cleanup`)。
3. **增量处理**: 使用跳过选项 (`--skip-existing`) 只处理新文件。
4. **磁盘空间**: 确保有足够的磁盘空间存放输出文件（大约是输入文件的1-2倍）。
5. **备份**: 处理重要文件前建议先备份。

## 输出示例

```
Target directory: /Users/username/photos
Found 5 HEIC files
Found 3 LIVP files
Found 2 PNG files
Total files to process: 10
Processing file 1/10: vacation.heic
✓ Successfully processed vacation.heic
...
✅ Processing complete
  • Processed 10 files in 4.12 seconds
  • Successful: 10, Failed: 0
  • 10 files copied to /Users/username/photos/jpg directory
```

## 故障排除

### 常见问题

#### 1. HEIC转换失败
**问题**: HEIC文件无法转换为JPG

**解决方案**:
- 确保sharp库正确安装
- 如果sharp不支持HEIC，程序会自动回退到内置的 Wasm 解码器。若仍失败，安装 ImageMagick 作为最终备选方案（仅限 CLI 模式）：
  ```bash
  # macOS
  brew install imagemagick
  
  # Linux
  sudo apt-get install imagemagick
  ```
- 使用`--verbose`选项查看详细错误信息

#### 2. LIVP提取失败
**问题**: LIVP文件无法提取图像

**解决方案**:
- 检查LIVP文件是否损坏
- 确保LIVP文件是有效的ZIP归档
- 使用详细模式查看具体错误：
  ```bash
  batch-image-processor ./photos --verbose
  ```

#### 3. 权限错误
**问题**: 无法读取或写入文件

**解决方案**:
- 检查文件和目录的读写权限
- 使用`chmod`修改权限（Linux/macOS）：
  ```bash
  chmod +r ./photos/*
  chmod +w ./jpg
  ```

#### 4. 磁盘空间不足
**问题**: 处理过程中磁盘空间不足

**解决方案**:
- 检查可用磁盘空间
- 将输出目录指向有足够空间的磁盘：
  ```bash
  batch-image-processor ./photos --output-dir /external/drive/jpg
  ```

#### 5. 内存不足
**问题**: 处理大量文件时内存不足

**解决方案**:
- 启用内存清理（CLI 模式）：
  ```bash
  batch-image-processor ./photos --memory-cleanup
  ```
- 减少并发数：
  ```bash
  batch-image-processor ./photos --concurrency 1
  ```
- 分批处理文件

#### 6. 处理速度慢
**问题**: 文件处理速度较慢

**解决方案**:
- 增加并发数：
  ```bash
  batch-image-processor ./photos --concurrency 4
  ```
- 使用SSD存储提高IO性能
- 使用`--skip-existing`跳过已处理的文件

#### 7. 文件名编码问题
**问题**: 包含特殊字符的文件名处理失败

**解决方案**:
- 使用`--verbose`查看具体哪个文件失败
- 临时重命名包含特殊字符的文件
- 确保系统使用正确的编码设置

### 调试技巧

1. **启用详细日志**:
   ```bash
   batch-image-processor ./photos --verbose
   ```

2. **测试单个文件**:
   将问题文件放在单独的目录中进行测试

3. **检查依赖**:
   ```bash
   npm list sharp adm-zip
   ```

4. **运行测试**:
   ```bash
   npm test
   ```

5. **查看系统资源**:
   - 磁盘空间: `df -h` (Linux/macOS)
   - 内存使用: `free -h` (Linux) 或 `vm_stat` (macOS)

## 许可证

ISC

## 更新日志

### Version 1.0.0
- **主要更新**: 转换为 Electron GUI 应用程序 (Image to JPG)
- **新功能 (GUI)**:
    - 添加 JPG 压缩质量滑块 (1-100)
    - 添加 “压缩现有 JPG” 选项
    - 添加 “添加文件夹” 按钮（文件对话框选择目录）
    - 添加 “打开输出文件夹” 按钮
- **修复**: 调整 macOS 隐藏标题栏模式下的 UI 元素重叠问题
- **优化**: 调整目录清理逻辑，改为在批量任务开始时一次性清空 `jpg` 目录。
- 初始版本发布（CLI 模式）
- 支持HEIC、LIVP、PNG和JPG批量处理
- 并发处理支持
- 详细进度报告
- 完善的错误处理和恢复机制
- 支持双引擎图像转换（sharp + ImageMagick/Wasm）
- 完整的单元测试和集成测试

## 贡献指南

欢迎贡献！如果你想为这个项目做出贡献，请遵循以下步骤：

1. Fork这个仓库
2. 创建你的特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交你的更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启一个Pull Request

### 开发规范

- 遵循现有的代码风格和约定
- 为新功能添加适当的测试
- 更新相关文档
- 使用JSDoc风格添加代码注释
- 确保所有测试通过：`npm test`

### 运行测试

```bash
# 运行所有测试
npm test

# 运行测试并监听文件变化
npm run test:watch

# 生成测试覆盖率报告
npm run test:coverage
```

## 技术支持

如果你遇到问题或有任何疑问，请：

1. 查看[故障排除](#故障排除)部分
2. 检查现有的[GitHub Issues](https://github.com/yourusername/livp/issues)
3. 如果问题仍未解决，创建新的Issue并提供：
   - 详细的错误信息
   - 使用的命令和选项
   - 操作系统版本
   - Node.js版本 (`node --version`)

## 致谢

- [sharp](https://github.com/lovell/sharp) - 高性能图像处理库
- [adm-zip](https://github.com/cthackers/adm-zip) - ZIP文件处理
- [commander](https://github.com/tj/commander.js) - 命令行接口
- [Jest](https://jestjs.io/) - JavaScript测试框架
