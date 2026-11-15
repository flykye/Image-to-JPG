# 程序调用 CLI（协议版本 1）

`batch-image-processor` 是独立的无窗口入口。macOS 提供 arm64 与 amd64 版本，Windows 提供 x64 的 `batch-image-processor.exe`。CLI 包内有 Node 和转换依赖，使用者无需安装 Node.js、Go、Bun 或 WebView2。整个 ZIP 必须完整解压；`bin/`、`engine/` 必须与可执行文件保持相对位置。

## 调用

macOS / Linux：

```bash
./batch-image-processor "/photos" -r -o "/exports" --json
```

Windows PowerShell：

```powershell
.\batch-image-processor.exe 'D:\照片' -r -o 'D:\导出' --json
```

建议使用子进程 API 的可执行路径与参数数组。不要拼接 shell 命令，也不要通过 `npm run cli` 的展示日志解析结果。

```js
const { spawn } = require('node:child_process');
const child = spawn(cliPath, [inputDir, '-r', '-o', outputDir, '--json'], {
  shell: false,
  windowsHide: true
});
let stdout = '';
child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
child.stdout.on('data', text => { stdout += text; });
child.stderr.on('data', text => { process.stderr.write(text); });
child.on('error', error => { /* 启动失败：路径、权限或安装问题 */ });
child.on('close', (code, signal) => {
  // 应同时检查 code/signal、JSON 是否完整、schemaVersion 和 status。
  // 正式调用请按任务规模设置输出大小上限；超限时取消任务并继续排空管道。
  const result = JSON.parse(stdout);
  if (result.schemaVersion !== 1) throw new Error('Unsupported CLI protocol');
  console.log(code, signal, result.status, result.files);
});
```

## 参数

| 参数 | 行为 |
| --- | --- |
| `<directory>` | 必需的输入目录；不接受单个文件 |
| `-r, --recursive` | 包含子目录；默认仅处理该目录 |
| `-o, --output-dir <path>` | 自定义输出根目录；递归时保留输入的相对目录结构 |
| `-q, --quality <number>` | 十进制整数 1–100，默认 90 |
| `-c, --concurrency <number>` | 工作线程数，十进制整数 1–32，默认 4；可用 -c 10 或 -c 20，内存保护可降低实际并发 |
| `--compress-jpg` | 原 JPG/JPEG 重新编码；不传则原样复制（强制大小上限可覆盖） |
| `--compress-above-mb <number>` | 只压缩源大小严格大于该阈值的 JPG/JPEG；未超过直接复制。允许 0–1,000,000 的非负小数，0 为全部；显式传此参数会启用 JPG 压缩 |
| `--force-under-20mb` | 所有新结果必须严格小于 20,000,000 字节；超限从原文件重试，每次降低 5 点质量 |
| `--existing rename\|skip\|error` | 重名策略，默认 rename；始终不会覆盖旧文件 |
| `-s, --skip-existing` | 兼容别名，等同 `--existing skip` |
| `--json` | stdout 只输出一条完整 JSON 最终结果，包括参数和执行错误 |
| `--jsonl` | stdout 输出一行一事件的 JSON 流，以唯一的 result 事件结束 |
| `--cancel-file <path>` | 调用方创建该标记文件后，完成当前图片并停止启动新图片 |
| `-v, --verbose` | stderr 输出逐文件进度 |
| `-h, --help` / `-V, --version` | 信息命令成功退出；配合 --json 时也是 JSON |

--json 和 --jsonl 互斥。日志和诊断都输出到 stderr。未选择机器模式时，stdout 为简洁的人类可读汇总。

## 最终结果

```json
{
  "schemaVersion": 1,
  "version": "1.6.0",
  "status": "success",
  "inputDirectories": ["/photos"],
  "outputDirectory": "/exports",
  "total": 1,
  "processed": 1,
  "converted": 1,
  "skipped": 0,
  "failed": 0,
  "pending": 0,
  "scanComplete": true,
  "scanErrors": [],
  "warnings": [],
  "files": [
    {
      "input": "/photos/photo.png",
      "output": "/exports/photo.jpg",
      "type": "png",
      "status": "converted",
      "error": null
    }
  ],
  "durationMs": 12,
  "error": null
}
```

- `status`：success、partial、failed、no_files、cancelled、invalid；信息命令为 help/version，额外带 message。
- `total` 是已发现的可处理文件数。扫描不完整时不能当作整个目录的真实总数，必须检查 `scanComplete` 与 `scanErrors`。
- `processed = converted + skipped + failed`，`pending = total - processed`。
- `converted` 是本次实际生成的结果数量，包含未重新编码的 JPG 复制。`skipped` 是本次没有生成新结果的数量，独立计数。
- 每个已发现输入在 files 中有一条记录，状态为 converted/skipped/failed/pending；未完成或失败时 output 为 null。
- 1.4.0 起逐文件结果额外带 `inputSize`、`outputSize`（字节）、`quality`（最终 JPEG 质量，复制/跳过/失败/待处理为 null）、`attempts`（本次转换尝试次数，未处理或直接跳过为 0）。这些字段为 schemaVersion 1 的兼容性扩展；读取方应允许新字段。
- input/output 是绝对实际路径。调用方应使用返回的 output，不能自行猜测重名后缀。
- `error` 是任务级参数/环境等错误；逐文件失败位于 files[].error；扫描失败位于 scanErrors。
- 错误统一包含 code、message、input、systemCode。code 稳定供程序判断，message 供人阅读，systemCode 可为空。
- 代码包括 INVALID_ARGUMENT、INVALID_INPUT、INVALID_OUTPUT、ENVIRONMENT_ERROR、SCAN_ERROR、READ_ERROR、WRITE_ERROR、OUTPUT_EXISTS、OUTPUT_INVALID、OUTPUT_TOO_LARGE、RESOURCE_LIMIT、WORKER_ERROR、WORKER_TIMEOUT、UNSUPPORTED_FORMAT、CONVERSION_FAILED、INTERNAL_ERROR。

JSONL 每条事件都带 schemaVersion。事件包括 scanning/start/group-start/processing/success/error/warning/group-done，以及 compression-retry 和 1.5.0 的 worker-pool，最后一条：

```json
{"schemaVersion":1,"type":"result","result":{"schemaVersion":1,"status":"success"}}
```

上例中的 result 省略其他字段以展示帧结构；实际 result 与 --json 模式相同。逐文件事件可能按并发完成顺序到达；以 input 标识文件，以最终结果为准，不依赖事件序号或耗时的先后。

## 退出码

| 退出码 | 含义 |
| --- | --- |
| 0 | success/no_files/help/version；skip 是显式允许的结果，单独计数 |
| 1 | 转换全部/部分失败、扫描不完整或结果输出失败 |
| 2 | 参数、输入/输出路径配置或运行环境错误 |
| 130 | 用户取消 / SIGINT |
| 143 | SIGTERM 请求的优雅取消（支持信号的系统） |

正常受控错误仍会返回完整 JSON。系统强制终止、SIGKILL、Windows TerminateProcess、磁盘或管道故障不能保证最终 JSON；调用方须同时检查完整结果和进程状态。

## 输出与重试

不指定 -o 时，每个源目录仍输出到自身的 jpg/。递归自定义输出现在保留相对结构：a/photo.png -> out/a/photo.jpg，b/photo.png -> out/b/photo.jpg，不再扁平写到同一目录。扫描会排除自定义输出子目录、jpg 目录和目录符号链接。

同一目录下不同源格式若有相同目标名，按稳定的输入排序预先分配不同名称；可在 skip 重试时对应到各自的目标。

- rename：旧结果保留，新结果自动编号；重复调用会新增产物，不宣称幂等。
- skip：目标必须是普通、非空、带 JPEG 文件头的文件；目录、符号链接、空文件和其他格式会报 OUTPUT_INVALID。只校验目标类型和文件头，不比对源图内容、参数或完整 JPEG 解码，不能当作内容级缓存或强一致幂等证明。
- error：存在同名目标时该文件失败，报 OUTPUT_EXISTS，旧结果不变。

输出目录不能等于输入目录。转换成功后以禁止覆盖的方式发布；取消会完成已开始的图片并清理本次临时目录，不删除源图或旧结果。

## 工作线程与内存保护（1.5.0 起，1.6.0 扩展）

```bash
# 默认最多4个真正的转换工作线程
./batch-image-processor "/photos" -r --json
# 高性能模式：最多10线程
./batch-image-processor "/photos" -r -c 10 --jsonl
# 大内存机器：最多20线程；更多线程不一定更快
./batch-image-processor "/photos" -r -c 20 --jsonl
```

每个任务创建一个可复用 worker_threads 池，HEIC 解码及其他转换在工作线程执行，主线程处理任务调度、最终发布和协议输出。同一任务的所有子目录共用线程额度；跨目录可以同时处理，不会按目录数成倍增加线程。源文件仍只读，每图各自暂存，最终文件名由管理线程预先规划并禁止覆盖发布。

默认4线程；桌面可选1/2/3/4/10/20，旧设置中明确保存的合法数值保留。CLI继续接受1–32以保持兼容。选定值是请求上限，不保证任何时刻都忙满该数量。20线程主要用于大内存机器，CPU满载时继续加线程可能更慢，应按实际图片集测量。

内存按物理内存/运行环境约束的约25%估算准入预算，1.6.0将上限从4 GiB提高到16 GiB，最低仍为256 MiB。例如64 GiB机器的预算为16 GiB，16 GiB机器仍为4 GiB；这是预算上限，不会提前申请或占满这部分内存。读取图片元数据后，按像素和源大小估算转换开销；未知尺寸及LIVP使用保守估计，不在调度线程解压整个归档。根据本任务遇到的最大估计需求降低线程上限，并计入空闲线程已保留的高水位预算，必要时回收空闲线程。单图估计已超过任务预算时报 RESOURCE_LIMIT，不生成最终结果。这是并发准入保护，不能当作操作系统对原生/WASM内存的硬限制。

结果增加可选 execution 对象：mode=worker_threads、requestedConcurrency、effectiveConcurrency、peakActive、workersCreated、memoryBudgetMb、memoryLimited。effectiveConcurrency 是内存保护后的上限，peakActive 是实际最高在途任务数，workersCreated 是累计创建次数（回收/故障替换后可能大于同时在线数）。未进入转换阶段的参数/环境错误可以没有此对象。JSONL 的 worker-pool 事件包含这些状态及说明 message，调用方须容忍新增字段和事件。

线程异常对应文件报 WORKER_ERROR，其余任务继续；单图超时为 WORKER_TIMEOUT。线程启动默认30秒超时、单图5分钟后请求终止，连续启动失败会停止继续创建线程。每次任务结束都会关闭整个线程池。

## 按大小压缩与严格上限

```bash
# 只压缩超过 5 MB 的已有 JPG；其他格式仍按质量 90 转 JPG。
./batch-image-processor "/photos" -r --compress-above-mb 5 -q 90 --json

# 所有结果还必须严格小于 20 MB。
./batch-image-processor "/photos" -r --compress-above-mb 5 -q 90 --force-under-20mb --jsonl
```

统一按十进制计算：1 MB = 1,000,000 字节；20 MB = 20,000,000 字节。阈值只控制已有 JPG/JPEG，**等于阈值也直接复制**。未配置阈值等同 0；桌面端只有选中“压缩已有 JPG”时阈值生效，CLI 显式传 --compress-above-mb 会同时启用 JPG 压缩。关闭这两个新选项保留原行为。

--force-under-20mb 是对**输出结果**的严格限制。1.6.0统一先按正常设置转换或复制，再检查实际结果字节数，不按源文件大小提前进入降质流程。首轮已小于20 MB就直接结束，保留设定质量；只有结果大于或等于20 MB才重试。因此最终大小限制优先于JPG压缩开关与阈值，但不改变正常首轮的参数。

若 JPG 因压缩开关关闭或阈值而仅复制，且复制结果超限，则先从原图以**设定质量**压缩；这次编码仍超限，才开始每次减5。LIVP内的JPEG复制也遵循此规则。attempts包含首轮复制；例如“复制 → 质量90成功”为2次，首次重试的 previousQuality 为 null、quality 为90。

例如质量 90 的结果仍然 ≥20 MB，就从**原输入文件**以质量 85 重新生成，再按 80、75…继续；最低为 1（最后一步必要时截到 1）。不会对上一轮有损 JPEG 再编码，也不会缩小像素尺寸。最低质量仍超限则报 OUTPUT_TOO_LARGE，退出 1；清理本次暂存文件，不发布超限结果，不改变源图或旧输出。

JSONL 的 compression-retry 带 input、quality（下一次质量）、previousQuality、outputSize（上一轮字节数）、maxOutputBytes。重试不增加 processed；每个输入只产生一个最终文件结果。取消可在两轮之间生效，该文件保持 pending，超限暂存结果会清理。

与 --existing skip 同用时，已有目标也必须小于 20 MB。已有目标超限会报 OUTPUT_TOO_LARGE 并保留该旧文件；需要生成合规新结果时用 --existing rename，不会偷偷覆盖旧结果。

## 取消

跨 macOS 和 Windows 的程序调用均可使用 --cancel-file：给每个任务准备唯一、初始不存在的标记路径，取消时创建文件；无需向窗口发送按键。已生成的结果保留，未启动的文件为 pending，最终 status 为 cancelled，退出码 130。

macOS/Linux 也可向 CLI 发送 SIGINT/SIGTERM。launcher 通过内部自有标记通知转换进程，等待其返回结果后退出。Windows 的通用强制终止进程接口不会交付可处理的 POSIX 信号，Windows 调用方应使用 --cancel-file 实现优雅取消。

扫描过程中会定期让出执行权。取消后立刻停止分派新文件，排队文件保持 pending；已经开始的图片可完成当前编码，超限重试之间也会检查共享取消标记。10秒宽限后仍未结束的线程会被请求终止，并等待退出后才清理暂存目录，避免与仍在写文件的线程竞争。个别原生或外部解码调用会影响实际退出时间，因此这不是10秒硬截止。已发布的成功文件保留，程序在所有工作线程关闭后返回最终结果。

## 发布和构建

```bash
npm run build:cli:mac
npm run build:cli:win
# 所有桌面构建也会生成对应平台的独立 CLI ZIP
npm run build -- -platform darwin/arm64,darwin/amd64,windows/amd64
```

产物：dist/cli-<os>-<arch>/batch-image-processor-<version>-<os>-<arch>.zip。

桌面安装包也包含 CLI：Mac 位于 Image to JPG.app/Contents/Resources/batch-image-processor；Windows 与 GUI exe 同目录。CLI 入口本身只依赖 Go 标准库和打包的 Node 转换引擎，不加载 MyGO 或 WebView。
