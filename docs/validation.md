# 验证与性能记录

2026-11-15 清理后验证：192项 Jest 测试与覆盖率检查通过，Go race/vet通过；两个Mac架构的当前CLI ZIP各通过14项检查，Windows x64完成交叉构建与包结构检查。新增4项清理/源文件保护测试，删除仅覆盖已移除辅助函数的9项测试和1项空断言，其余功能回归保留。26个夹具及本地样图的哈希保持不变。

## 当前验证命令

```bash
npm test -- --runInBand
npm run test:coverage -- --runInBand
go test -race ./...
go vet ./...
npm run build:all
node scripts/verify-cli.mjs darwin/arm64
node scripts/verify-cli.mjs darwin/amd64
node scripts/verify-compression.mjs dist/cli-darwin-arm64/batch-image-processor
```

CLI 验证会解压当前版本的 ZIP，检查无系统 Node/PATH 时执行、JSON/JSONL、跨目录转换、4/10/20 线程、大小限制、原图保留及取消。Windows 原生 CI 使用 `node scripts/verify-cli.mjs windows/amd64`；macOS 交叉编译只能验证产物，不能代替 Windows 实机运行。Intel Mac CLI 在本机通过 Rosetta 执行。

大小重试验证使用临时生成的高细节 4000×4000 PNG，确认首轮质量100超限、从原图以95重试后小于20,000,000字节，源哈希和像素尺寸不变。程序调用语义以 [CLI 文档](cli.md) 为准。

1.6.1 布局在 WebKit 和 Chromium 的 1080×780、928×670、760×600、380×600 视口验证过：展开设置说明、显示长提示、滚动内容及处理中，底部开始/停止按钮保持可见。桌面最小窗口为760×600。

## 线程池测量（2026-11-14，1.6.0）

Apple M1 Max、10核、64 GiB内存。60张同一合成4032×3024 HEIC的独立路径副本，质量90、严格20MB，各档交替运行三轮，统计新进程启动至退出的时间，文件缓存预热。此处是历史测量，不表示以后版本已重新压测。

| 线程 | 耗时中位数 | 进程峰值RSS中位数 |
| --- | --- | --- |
| 4 | 13.349秒 | 1,424 MiB |
| 10 | 9.236秒 | 2,468 MiB |
| 20 | 9.430秒 | 4,432 MiB |

三个档位都达到请求的实际并发，线程复用且未触发内存降档。540/540张转换成功、结果逐字节一致且均小于20MB。20线程在这批图片上未提高吞吐，却增加内存；其他格式、机器或磁盘的表现可能不同。原始数据保留在 [基准记录](benchmarks/heic-twenty-threads-1.6.0-2026-11-14.json)。一次性压测脚本、生成图片与中间结果已经清理，不再作为可运行入口。

HEIC 当前使用 heic-decode 解码原始像素后由 sharp 一次编码，避免旧版 JavaScript JPEG 编码及二次压缩。内置解码仍有CPU开销；不能据此承诺硬件解码，也不承诺完整保留原HEIC的EXIF/ICC。
