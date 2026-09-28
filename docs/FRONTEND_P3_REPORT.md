# P3 试点与剩余阶段状态

P3 证据复核于 2026-09-28；P2/G2 Chrome 验收亦于当日复核。**P3 独立单链路试用页与兼容 API 已上线，单链路 G3 闸门通过；P4 全矩阵与 G5 默认迁移仍未实施，主页面继续使用 PNG。**
首次发布时尚未推送；节点与采样未修改。后续仓库同步及公网制品核验见 [公网发布记录](FRONTEND_PUBLIC_RELEASE.md)；下文实验室数据不自动等于公网端到端收益。

## 已完成

- 新增 [v2 契约](SERIES_V2.md)、纯统计/聚合函数与一致性读取层。
  摘要与序列复用同一快照，不受点数或画布尺寸影响。旧 API 保持原语义。
- 独立 `/chart-trial` 页面：仅主动提交一个合法方向；自托管 uPlot 1.6.32
  （MIT、固定版本/校验和），不在主页面加载图表库，不切换默认渲染器。
- Canvas + DOM 摘要、键盘/触屏区间滑块、每页最多 50 行的可访问数据表；
  缺失断线、独立极值标记、丢包标记、显式 PNG 比较入口。
- 硬上限：单实例、1440 个聚合区间、1280×280 CSS 图面、
  约 143 万画布像素（像素数量，不是总内存承诺）。使用原生 DPR 保持文字清晰，
  高 DPR 时缩窄图面使总像素不超预算；极端缩放到宽度不足 240 CSS px 时提示使用 PNG/表格。
  隐藏页销毁实例、取消请求，
  恢复时只本地重绘，不自动取数。503 不自动重试或散射 PNG。
- v2 额外提供无损 `encoding=columns`，试用页选择列式传输；Python API 按
  `Accept-Encoding` 提供 gzip/identity，序列化结果与压缩结果共用现有有界缓存。
- P2 发布构建扩展为两个 HTML、八个指纹资源；主页面仍只引用原四项资源。
  安装器增加两个 Python 模块并将试用页纳入备份、健康检查、回滚。

## 验证记录

- Python 68 项通过；请求状态 Node 4 项。
- 主页面 16 组构建产物浏览器回归通过，包括 480 卡片。
- 新增 P3 Chrome 153 与 WebKit 26.5 浏览器实验：零预取、外部节点仅作目标、尖峰/缺口、
  极值像素检查、键盘查看、分页表、30 次重建保持单实例、PNG 切换回收、
  503/畸形 JSON/取消代次、可见性事件模拟、DPR 1.5/2/3/4 触屏模拟及
  非整数桌面 DPR 像素预算。
- 320/390/768/1440/1800 Chrome 截图；Chrome/WebKit 非截图流程无 CSP 违规或未捕获浏览器异常。
  WebKit 的 Playwright 截图自身注入样式并触发测试 CSP，不能误判为应用代码违规。
- axe-core WCAG 2.0–2.2 A/AA 规则对 P2/P3 Chrome 与 WebKit 构建页面均未报违规；这不代替读屏实测。
- 加速 300 次 Canvas/PNG/提交切换后，清理 GC 的 DOM 节点数与事件监听数均保持不变。
  早期测试脚本未释放 `waitForFunction`/`waitForSelector` 句柄，造成假性内存增长；
  已修正并通过堆快照溯源，不能将早期读数归咎于页面。
- 修正测试句柄后，Chrome 正式单实例长测运行 1805 秒、338 次提交/展开表格/
  PNG/Canvas 切换；清理 GC 后 DOM 节点始终 976、事件监听始终 54、文档数始终 1。
  JS 堆从 3,247,764 B 到 3,841,500 B；预热两分钟后至结束增加 452,444 B，
  最后数分钟基本持平。此结果支持 **30 分钟单链路稳定**，不证明 60 分钟或
  P4 多实例全矩阵稳定。长测在本轮高 DPR 小幅修正前启动；所测生命周期
  路径与最终构建相同，非整数 DPR 预算另由最终构建的 Chrome/WebKit 回归覆盖。
- 模拟 40 ms 网络的 30 次端到端提交，中位约 99 ms、P95 约 101 ms。
  与主页面的刷新测试不是同一 UI 工作量，不能直接拿来算提速比例。
- 当前线上 server/app 与仓库 P1 HEAD 的 **LF 归一化哈希**一致；
  字节哈希因 CRLF/LF 不同而不同。没有将此误判为线上代码漂移。
- 新增 Android 16 / Chrome 152 实机本地隔离验证：P2 布局/标签与 P3 Canvas、
  区间触摸、分页表、PNG 回退通过；100 次重复提交后的结构指标稳定。

## 真实 RRDtool 隔离对照

通过主控已有 Python/RRDtool 1.7.2，在自动删除的临时目录创建合成 RRD，
不读取生产 RRD、不改服务。固定相同结束时间、数据、900×320 PNG 参数，
顺序执行，每组 30 次；cold 指应用缓存清空，不声称内核文件缓存冷启动。

| 窗口 / 路径 | 冷缓存中位 / P95 | 暖缓存中位 | 返回字节 |
| --- | ---: | ---: | ---: |
| 3h PNG | 237.29 / 296.95 ms | 0.18 ms | 36,093 |
| 3h v2 列式 identity | 45.29 / 53.87 ms | 0.18 ms | 11,456 |
| 3h v2 列式 gzip | 43.31 / 52.55 ms | 0.18 ms | 1,493 |
| 24h PNG | 240.01 / 292.76 ms | 0.19 ms | 42,253 |
| 24h v2 列式 identity | 106.93 / 120.89 ms | 0.18 ms | 41,160 |
| 24h v2 列式 gzip | 111.49 / 140.07 ms | 0.17 ms | 3,328 |

RRDtool 子进程 CPU 中位：3h PNG 220.57 ms / v2 列式 28.37 ms；
24h PNG 232.02 ms / v2 列式 44.04 ms。冷缓存各调用 2 个 RRDtool 进程。
列式和压缩版本共用有界的已序列化响应缓存，故暖缓存接近 PNG；
此次 24h identity 与 PNG 体积接近，gzip 返回体显著更小。gzip 字节和耗时来自主控
隔离实验的实际 `wire_response`，并有独立 HTTP 测试验证压缩头和内容等价；
**不代表公网/CDN 实际传输或客户端 CPU**。数据为同次实验顺序采样，
不宜据此宣称全站已提速。

本次 24h 黄金样本 v2 最大值 999 ms、平均约 10.6878 ms、loss 约 0.0869%；
legacy 像素统计最大值 999 ms、平均 11.37 ms、loss 0.1%。
另一次不同图形像素对齐下，legacy 最大值只达 504.5 ms，说明差异
会随图形对齐变化；契约已说明两者口径不同，不静默替换生产值。
聚合点数从 1440 降至 120 不改变 v2 摘要，丢包计数及缺失标记保留。
同一 24h 合成 RRD 另导出真实 PNG 和列式 JSON，Chrome/WebKit 的单链路试用页
在这组配对数据上通过切换与生命周期测试。首次对照发现 PNG 自动纵轴
探测沿用 RRDtool 默认图宽，与最终图宽不同，可能使尖峰触顶；改为同图宽
探测后，新 PNG 与 v2 图均完整显示本样本尖峰。修复随后随本次制品上线，
公网双栈 PNG 与 v2 试用链路已通过加载核验，但未完成长期极端尖峰观察。
同一列式 JSON 以 gzip HTTP 响应重测 Chrome/WebKit，浏览器自动解压、解析、
绘图与错误路径均通过；这仍是本地模拟服务，并非公网压缩链路验收。

uPlot 库本体 JS 51,081 B / gzip 22,093 B，CSS 1,858 B / gzip 764 B。
试用脚本约 14.5 KB，所有库只在试用页加载；初始主页面不增加这些下载。

## Android 实机补验（2026-09-23）

设备 PJE110，物理 1264×2780、密度 560；Android 16、Chrome 152.0.7977.82。
页面实测 361 CSS px / DPR 3.5，`navigator.deviceMemory=8`、`hardwareConcurrency=8`，
这是浏览器提供的近似设备档位，并非实测物理 RAM；该设备**并非低端**。
使用 ADB reverse 连接电脑本地隔离站点，
只在新建的 QA 标签页操作；CDP 注入的是该机 Chrome 的触摸事件，不等同人工手势。
当时服务端返回先前隔离 RRDtool 实验生成的配对合成 PNG/列式 JSON，**没有请求生产
RRD、没有发布代码**；之后的独立生产发布另见 [发布记录](FRONTEND_PUBLIC_RELEASE.md)。

- P2：8 张结果卡、4 个 Ext 与 4 个 v6 标签；抽屉与 Charts 切换正常，滚动后
  8 张 PNG 全部加载，页面无横向溢出。截图详见 [P2 报告](FRONTEND_P2_REPORT.md)。
- P3：单 Canvas 后备像素 1,101,520，小于 1,433,600 像素预算；999 ms 尖峰、
  缺失区间、触摸滑块读数、50 行/页的第 2 页、PNG 回退均通过，无横向溢出。
- 100 次本地重复提交：清理 GC 后第 20/40/60/80/100 次 DOM 节点均为 2022，
  事件监听均为 89；JS 堆第 20 次约 4.82 MB、第 100 次约 4.93 MB。
  点击至 Canvas 可见的自动化测时中位 176 ms、P95 193 ms，**包括 CDP/ADB
  往返和本地 fixture 请求**，不是纯绘制 CPU 或公网真实用户延迟。
  页面异常与 CSP 违规均为 0；这仅支持该设备短时单链路稳定，不证明峰值内存
  或低端机表现。

完整数据及截图位于 Git 忽略的 `test-results/android-device/`：`report.json`、
`p3-canvas.png`、`p3-png.png` 等。`operations.log` 逐项记录本轮 ADB 命令、
测试标签页导航/触摸、宿主机截图和临时 reverse 清理。开始日志前曾执行设备清单/
版本只读查询、启动 Chrome 的 `about:blank` 标签和建立 `tcp:9222` CDP forward；
这三类前置动作在本报告补记。测试未用 ADB 读写/删除手机文件；浏览器自身可能
正常更新缓存/历史。仅关闭 QA 新建标签页；测试后已撤销本轮创建的 `tcp:9222`
forward，检查 forward/reverse 列表均为空。

## G3 公网同链路成本补验（2026-09-28）

对 `akari_jp → google_dns` v4、3h、720 个列式区间，在公网做低频顺序采样，
各路径 30 次；PNG 为 1280×280，与桌面试用页实际图面一致。每次强制刷新的
PNG 带独立查询令牌；另列相同 URL 的 CDN 边缘缓存命中作为解释项，不把旧图
命中速度当作一次新鲜查询的速度。

| 路径 | 总耗时中位 / P95 | 传输体中位 | CDN 状态 |
| --- | ---: | ---: | --- |
| v2 列式 gzip | 368 / 435 ms | 2,130 B | DYNAMIC 30/30 |
| 新令牌 PNG | 2,095 / 2,283 ms | 51,448 B | MISS 30/30 |
| 相同 URL PNG | 206 / 453 ms | 51,448 B | HIT 25/30，EXPIRED 4/30，MISS 1/30 |

同一公网单链路试用页再由 Chrome 153 做 30 次提交、显式 PNG 切换、Canvas
本地重绘。提交至 v2 Canvas 可见中位/P95 为 370/485 ms；在已有 v2 快照下切到
新 PNG 为 1,214/2,215 ms；Canvas 本地重绘为 37/41 ms。相应主线程任务时间
中位为 16.6/23.6/6.4 ms。30 张 PNG 均为不同刷新令牌且 HTTP 200，无页面
异常；v2 31 次均 HTTP 200。此分阶段测量不等于完整主页面 Charts 耗时，也不
等于同一冻结 RRD 快照的逐像素比较，不能外推到全部路由或图表矩阵。此前
冻结合成 RRD 的数值/缺口/极值配对验证仍是数据正确性的依据。

Chrome 进程私有内存（7 个进程之和）从第 0 次 274.7 MiB，到第 15/20/25/30
次分别为 342.6/326.0/341.1/329.1 MiB；同期 GPU 进程为
120.0→185.2/172.9/186.9/174.4 MiB，呈预热与回收波动而非这一短程内
单调上升。清理 GC 后 JS 堆约 2.40→2.99 MiB，DOM 节点 509→521 后稳定，
监听数 47→53 后稳定。Canvas-only 25 次对照在预热后进程私有内存约
290–303 MiB，PNG-only 25 次未显示持续上升；这两个控制组基于修复前试用页，
PNG-only 会复用旧 URL，专为定位内存来源，不作为新鲜 PNG 的速度对照。早期旧页
反复交替 PNG/Canvas 曾显示 GPU 内存增长，因此仍以 60 分钟实验室长测及后续
多实例 G4 验证为准。
这些是独立 Chrome 进程的抽样，不是连续峰值或 Android 物理内存测量。

发布后的新构建又在本机合成 RRD/gzip 隔离服务上做 10 分钟 Chrome 复测，
112 次提交/表格/PNG/Canvas 循环通过，无页面异常。DOM 976、监听器 54、
文档 1 始终不变；GC 后 JS 堆从 3,265,444 B 到 3,548,908 B。
启动时的高 DPR 预热峰值在首分钟回收，此后采样的 Chrome 进程私有内存
约 390–416 MB、其中 GPU 约 220–235 MB；没有持续单调上升。
本次报告为 `test-results/p3-chromium-g3-final/browser-report.json`，只使用本机合成数据，
不是生产 10 分钟负载测试。它验证了 PNG 新令牌的最终构建生命周期，
不替代下面的 60 分钟单实例测试或未来 G4 多实例上限测试。

此前一轮开始于本次 PNG 新令牌改动前的同一单实例试用页，独立运行
3,605 秒、676 次提交/表格/PNG/Canvas 循环，正式通过 60 分钟 Chrome
断言。GC 后 DOM 始终 976、监听器 54、文档 1；JS 堆从 3,259,688 B 到
3,875,072 B，预热两分钟后的增长 475,344 B，最后半小时仅增长约 20 KB。
这一轮测的是 PNG 令牌改动前的生命周期实现；新版独立 10 分钟复测和
公网 30 次刷新覆盖了改动后的代码。旧轮 `test-results/p3-chromium/browser-report.json`
有完整检查点。旧轮运行约 22–59 分钟期间抽查的 GPU 进程私有内存约
180–207 MiB，未单调上升；此项是人工离散抽查，不是连续峰值追踪。

试用页原本对重复提交的 PNG 对照复用相同 URL，可能在浏览器缓存里显示旧图。
现按提交代次生成新 PNG 令牌，同一快照的模式往返保持令牌不变；本地浏览器
回归验证该行为，2026-09-28 公网发布后 Chrome 的 30 次实测亦确认每次更新。
详细原始 JSON 位于 Git 忽略的 `test-results/g3/`，测量脚本为
`tests/g3-public-compare.cjs` 和 `tests/g3-browser-cost.cjs`。公网传输测试每次
请求后停 1 秒，顺序而非并发压测。

## G3 判定与扩大边界

单链路 G3 通过的依据：固定合成 RRD 的数值、缺口和极值对照及 PNG 显式回退；
Android Chrome 实机 100 次操作；同一路由公网 v2/新鲜 PNG 传输和 Chrome
端到端分阶段成本；原生命周期 60 分钟与最终构建 10 分钟复测。这个判定仅允许
启动 P4 的受控开发与验收，不授权把 Canvas 切成主页面默认。公网 CDN 命中
的旧 URL PNG 仍可能比 v2 快，但与主动刷新不是同一语义。

尚未覆盖手机端纯解析/绘制 CPU、连续浏览器进程峰值、其他路由及完整 Charts
矩阵的服务端总负载。低端机专项由用户取消；G0/G2 浏览器闸门按用户确认只需
Chrome。人工读屏与 Safari 可在另有需求时补验，不误写成已通过。
G4 仍须验证 v2 批量摘要、统一轴口径、最多 500 链路的按需实例/缓存/像素
上限、30/60 分钟多实例测试；G5 还须受控发布、至少 24 小时观察与回滚演练。

## 剩余计划（保留验收依赖）

| 阶段 | 下一步 | 当前状态 |
| --- | --- | --- |
| P2 / G2 | 后续仅保留可选读屏复核与长期生产观察 | 2026-09-28 Caddy 恢复后，Chrome 公网节点/资源/真实图表、外部双栈标签、Fixed 多选、键盘及用户设置的真实浏览器级 200% 缩放复核通过；720×384、DPR 3 下无横向溢出，Results/Charts 卡片正常，G0/G2 Chrome 闸门通过。200% 下侧栏列表可视高度较短但可独立滚动，列为后续 UI 打磨观察项；低端机与 Firefox/Safari 均非当前门槛 |
| P3 / G3 | 后续保留可选的更多路由/设备诊断 | 单链路 G3 通过：固定 RRD 正确性、Android Chrome、高 DPR、公网 v2/PNG 成本、30 次新版公网 Chrome、60 分钟原生命周期及 10 分钟最终构建稳定性均有记录；不外推到全矩阵 |
| P4 / G4 | v2 批量摘要、全矩阵统一轴、有限可视实例、像素/缓存总预算、全矩阵 30/60 分钟测试 | 批量摘要本地草案及单测已开始，未部署；主页面未迁移，不把单实例上限冒充已完成 |
| P5 / G5 | 依据证据决定是否切默认；24–48h 观察和回滚验证 | 兼容 API/独立试用已部署；默认迁移、长期观察和回滚演练未完成 |

下一阶段可开始 P4 的有界 v2 摘要和完整 Charts 设计/实现，但先完成 G4 才能
进入 P5 默认迁移。当前上线制品仍是 P2 主页面及隔离的 P3 试用页，不能误作
“主页面已切换 Canvas”。

## 复现与制品

```sh
python build_web.py
python -m unittest -q
node --test tests/request-state.test.cjs
BROWSER_CHANNEL=chrome TEST_BUILT_RELEASE=1 node tests/frontend-browser.cjs
PYTHON=python BROWSER_CHANNEL=chrome node tests/chart-trial-browser.cjs
python tests/run-series-lab.py root@HOST PORT
REAL_RRD_FIXTURE=1 BROWSER_CHANNEL=chrome node tests/chart-trial-browser.cjs
REAL_RRD_FIXTURE=1 GZIP_FIXTURE=1 SKIP_SCREENSHOTS=1 BROWSER_CHANNEL=chrome node tests/chart-trial-browser.cjs
REAL_RRD_FIXTURE=1 GZIP_FIXTURE=1 SKIP_SCREENSHOTS=1 BROWSER_CHANNEL=chrome SOAK_MINUTES=60 node tests/chart-trial-browser.cjs
REAL_RRD_FIXTURE=1 GZIP_FIXTURE=1 SKIP_SCREENSHOTS=1 BROWSER_CHANNEL=chrome SOAK_MINUTES=10 SOAK_MEMORY=1 TEST_OUTPUT_TAG=g3-final node tests/chart-trial-browser.cjs
G3_PNG_WIDTH=1280 G3_PNG_HEIGHT=280 node tests/g3-public-compare.cjs
G3_MODE=switch G3_ROUNDS=30 node tests/g3-browser-cost.cjs
ANDROID_CYCLES=100 node tests/android-device.cjs
```

PowerShell 用 `$env:` 设置变量，Playwright 所在目录通过 NODE_PATH 提供。
两条 `g3-*` 脚本会对公开生产站点发起低频只读请求，不能放进普通 CI；
复跑前应确认站点可承载且获得生产测试授权。
Android 脚本还要求设备授权、Chrome 已启动、合成 fixture 已生成，并事先由测试者
确认端口未被他人占用后建立
`adb -s SERIAL forward tcp:9222 localabstract:chrome_devtools_remote`。
脚本只创建并清理自己的随机 reverse 映射；
`tcp:9222` forward 应由创建者在结束后精确撤销，不能清理他人的映射。
主控实验仅使用现有 rrdtool 和自动回收临时目录；复跑脚本还设置 nice=10 与
请求间短间隔，避免把顺序对照变成生产压力测试。
产物与详细 JSON 在 `build/web-release/`、`test-results/p3/`、
`test-results/p3-chromium/`、`test-results/p3-webkit/`（Git 忽略）。
同源浏览器配对需要先运行主控隔离实验，生成 `rrd-24h.png` 与
`rrd-24h-columns.json`；不读取生产 RRD。可选 `RUN_AXE=1` 需另备
开发专用 axe-core 4.13.0 的 `build/qa-deps/package/axe.min.js`，该依赖不进入发布包。
本次开发包来自 npm 的 `axe-core-4.13.0.tgz`，SHA-1 为
`f868ecb1bd61d982321760e51d841ab497ab86d0`；`RUN_AXE=1` 才读取它。
发布准备必须额外包含 `series_contract.py`、`series_v2.py` 及 uPlot MIT 许可证；
安装器已执行，详见 [公网发布记录](FRONTEND_PUBLIC_RELEASE.md)；尚未进行生产 24h 观察。
