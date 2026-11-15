# Image to JPG

基于 [MyGO 0.8.3](https://mygo.egoist.dev/) 的本地批量图片转换工具，支持 macOS（Apple Silicon / Intel）和 Windows x64，同时提供独立的无窗口 CLI。桌面窗口使用系统 WebView，不再依赖 Electron；安装包内置 Node.js 与转换依赖，用户无需另装 Node.js。

## 功能

- 拖入或多选文件夹，递归处理所有子目录；重复添加和重叠目录自动去重。
- HEIC、LIVP、PNG、DNG、TIFF、JPG/JPEG 转为 JPG，优先按文件头识别实际格式。
- 每个源目录分别输出到自身的 `jpg/`；自动跳过 `jpg` 输出目录和目录符号链接。
- JPG 质量 1–100、原 JPG 重新压缩或原样复制、跳过已有结果、默认4个工作线程，可选10或20线程。
- 可设置“仅压缩大于指定 MB 的 JPG”，未超过阈值直接复制。
- 可强制所有结果小于 20 MB；先按设置处理，只有输出仍超限才从原图逐次降低5点质量重试，不缩小像素尺寸。
- 全局进度、格式数量、逐文件日志、每个目录的结果统计及打开输出目录。
- 跨文件夹共用真正的工作线程池，按图片尺寸估算内存并限制并发；停止时保留已完成文件并清理本次暂存。
- 设置持久化，并读取旧版 electron-store 的质量与 JPG 压缩设置。
- 跟随系统深浅色模式，支持 macOS `Cmd+O` / Windows `Ctrl+O` 选择文件夹。

### 输出安全

原图不修改、不删除。不会清空已有 `jpg/` 目录；重名自动生成 `photo_1.jpg`、`photo_2.jpg` 等文件。每张图先在独立临时目录转换，成功后以禁止覆盖的方式写入输出目录；失败不影响已有结果。启用“跳过已有结果”时，目标必须是普通、非空且带 JPEG 文件头的文件；非法目标报告错误。此检查不比对源图内容或参数。

## 运行环境

**使用安装包：**

- macOS 13.5 或更新版本，分别提供 arm64 与 amd64 安装包。
- Windows 10/11 x64；需要 Microsoft [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)。Windows 11 通常自带，Windows 10 缺少时需安装。
- ImageMagick 为可选依赖，部分 DNG 或 HEIC 需要它作为兜底。

**开发和构建：**

- Node.js 22.12+ 与 npm（推荐 24.18.0）。
- Go 1.27.3+（`go.mod` 固定最低版本，Go 可自动下载所需工具链）。
- Bun，供 MyGO 读取 TypeScript 配置；验证使用 1.4.3。

```bash
npm ci
npm start
```

首次启动会从 Node.js 官方站下载目标平台运行时并核对 SHA-256，再安装锁定的转换依赖。缓存保存在 `.mygo/`，生成的运行环境位于 `resources/<os>-<arch>/`；后续启动直接复用缓存并刷新转换源码。需要重新安装运行环境时，删除对应生成目录后再运行 `npm run runtime:prepare`。

只开发界面可运行 `npm run dev:web`。普通浏览器仅能预览布局；文件系统与转换功能需在 MyGO 桌面窗口中使用。

## CLI

供其他程序调用时，使用完整解压后的独立 CLI 包，无需安装 Node.js 或 WebView2：

```bash
# macOS
./batch-image-processor "/photos" -r -o "/exports" --json
```

```powershell
# Windows PowerShell
.\batch-image-processor.exe 'D:\照片' -r -o 'D:\导出' --json
```

源码开发仍可使用 `npm run cli -- ./photos -r --json`。程序集成应直接启动可执行文件或 `node src/cli/index.js`，使用参数数组并同时排空 stdout/stderr。

- `--json`：stdout 只输出一条版本化最终结果；`--jsonl`：流式事件，最后一条为 result。
- stderr 专门输出诊断和进度；结果含逐文件实际路径、成功/跳过/失败/待处理状态和扫描错误。
- 退出码：0 成功或无文件，1 部分/全部转换或扫描失败，2 参数/环境错误，130 取消，143 SIGTERM。
- `--existing rename|skip|error` 明确已有结果策略，默认 rename；兼容 `--skip-existing`。
- `-c 10`：最多10个可复用工作线程；默认4，内存保护可能降低实际数量。
- `--cancel-file <path>` 支持 Mac 和 Windows 的程序化优雅取消。
- `-o` 配合 `-r` 保留相对目录结构，避免跨目录同名图共用结果；默认仍输出到各目录的 jpg/。
- `--compress-above-mb 5`：只压缩源大小超过 5 MB 的 JPG；`--force-under-20mb`：所有结果严格小于 20 MB。
- 保留 `--quality`、`--concurrency`、`--compress-jpg`、`--verbose` 等原参数。

完整协议、重试语义、取消与调用示例见 [CLI 集成文档](docs/cli.md)，验证方法与历史实测见 [验证记录](docs/validation.md)。

## 格式转换链

| 输入 | 处理方式 |
| --- | --- |
| HEIC | 支持 HEVC 的 sharp → 内置 heic-decode 解出原始像素 + sharp 一次 JPEG 编码 → 可选 ImageMagick |
| LIVP | 从 ZIP 中读取首张 HEIC/JPEG；HEIC 继续走上述转换链 |
| PNG | sharp；透明区域铺白，避免输出黑底 |
| DNG | sharp → 可选 ImageMagick，实际 RAW 支持取决于解码器与 ImageMagick delegates |
| TIFF | sharp |
| JPG/JPEG | 根据设置使用 sharp 压缩或直接复制 |

HEIC 已去掉 JavaScript JPEG 编码和质量 100 的二次编码，真实使用指定质量；内置解码器仍负责 HEVC 解码。基准与边界见 [验证记录](docs/validation.md)。

元数据保留方式延续原转换器实现；不同解码链保留的元数据可能不同。LIVP 输出静态照片，不输出动态视频。

ImageMagick 安装：

```bash
# macOS
brew install imagemagick

# Windows，也可使用官网下载的安装程序并启用 Add to PATH
winget install ImageMagick.ImageMagick

# Ubuntu / Debian
sudo apt-get install imagemagick
```

Windows 只探测 `magick`，避免误调用系统的磁盘转换程序 `convert.exe`。安装后重新启动应用以刷新 PATH 和探测结果。

## 打包

```bash
npm run build:all    # 在 Mac 上构建 Apple Silicon、Intel Mac 和 Windows x64（含独立 CLI）
npm run build:mac    # Apple Silicon、Intel 各自的 .app 与 .dmg
npm run build:win    # Windows x64，生成可整体解压使用的 portable.zip
npm run build:linux  # Linux x64，保留此前的 Linux 打包能力
npm run build:cli:mac # 只生成两种 Mac 架构的独立 CLI ZIP
npm run build:cli:win # 只生成 Windows x64 的独立 CLI ZIP

# 只构建指定平台
npm run build -- -platform darwin/arm64
npm run build -- -platform darwin/arm64,darwin/amd64,windows/amd64
```

桌面产物位于 `dist/<os>-<arch>/`，独立 CLI 位于 `dist/cli-<os>-<arch>/`，桌面构建也会生成对应 CLI ZIP。Windows 便携包必须整体解压，保留 exe 旁的 `bin/` 和 `engine/`。在 Windows 构建时 MyGO 可自动获取 NSIS 生成安装程序；在 macOS/Linux 交叉生成 Windows 安装程序需另装 NSIS（`makensis`），未安装时仍生成便携 ZIP。macOS 的 DMG 和签名步骤需在 Mac 上完成。

发布签名可通过 `MACOS_SIGNING_IDENTITY` 和 `WINDOWS_CERTIFICATE` 配置。macOS 默认本机 ad-hoc 签名；对外正式发布仍需 Developer ID 和公证配置。CI 工作流覆盖两种 Mac 架构、Windows 及 Linux 的测试和打包，未配置发布或上传外部商店。

## 清理

```bash
npm run clean -- --dry-run # 预览待清理路径
npm run clean             # 清理确认属于本项目的历史产物和临时报告
```

清理旧 `build/`、Electron 安装包/解压目录、旧版本安装包、一次性压测与 UI 测试目录、QA 临时报告和覆盖率输出。保留当前版本的 `dist` 产物、平台运行时、Node 下载缓存、依赖、测试夹具及 `testimage/` 原始样图，不跟随符号链接删除外部目录。

旧安装包的自动清理步骤只在桌面构建全部成功后执行，并仅处理本次目标目录。独立 CLI 构建仍只重建对应平台目录。

## 验证

```bash
npm test -- --runInBand
npm run test:coverage -- --runInBand
go test ./...
go test -race ./...
go vet ./...
npm run build:web
node scripts/verify-cli.mjs darwin/arm64 # 当前平台的 CLI ZIP 原生验证
node scripts/verify-compression.mjs # 真实 1600 万像素图片的 20 MB 降质量重试验证
```

新增回归覆盖真实 PNG/TIFF/JPG/LIVP 转换、同名冲突、旧输出保留、重叠目录去重、停止处理、错误文件、透明 PNG 白底以及设置迁移。CLI 回归使用真实子进程，覆盖协议、参数、扫描权限、部分失败、800 文件慢消费者输出完整性、同名输入、取消和安全退出。CI 会完整解压各平台 CLI ZIP 并执行原生验证。跨平台编译和打包不代替 Windows 真机或不同版本系统的交互验证。

## 项目结构

```text
main.go / desktop.go        MyGO 窗口、目录选择、服务绑定
engine.go                  Go 与转换子进程的 JSON 流协议
settings.go                设置保存、旧版配置迁移
src/ui/renderer/           HTML/CSS/JS 界面及生成的 mygo.ts 绑定
src/desktop/worker.js       独立转换进程、全局扫描和进度
src/core/                  格式转换器、扫描与安全输出服务
src/core/workers/          可复用转换线程池、取消与内存准入
src/cli/                   公开 CLI 和版本化机器协议
cmd/batch-image-processor/  无 GUI 的 Go CLI 启动器
internal/cliapp/            运行时定位、环境隔离和信号转发
scripts/                   运行时准备和 MyGO 构建
runtime/                   转换运行时依赖清单和 lockfile
resources/                 自动生成的平台运行时（不纳入 Git）
.github/workflows/         各平台测试与打包
```

修改转换核心后，通过 `npm start` 或构建脚本刷新打包源码。正在运行的开发进程不会监视 Node 转换核心变化，修改后需重启开发命令。

## License

ISC。发布包包含 Node.js 及第三方转换依赖对应的许可证。
