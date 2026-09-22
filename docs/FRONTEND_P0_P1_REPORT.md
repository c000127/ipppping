# P0/P1 实施与验证记录

日期：2026-09-22。范围：本地与隔离验证，以及获准后的 P1 生产发布。**P1 已于 08:12 UTC 部署，公网验证通过。**下文保留阶段验证边界，发布记录见第 8 节。

## 1. 状态与结论

- P0：已建立支撑 P1 的代码/实机基线、需求边界、合成 RRD 黄金样本、可复现浏览器故障实验和截图。完整跨设备性能基线仍有下述缺口，不能把整个升级计划的 G0 全部打勾。
- P1：数据状态、请求治理和兼容性修复已实现；44 项 Python 测试、4 项 Node 测试、14 组浏览器检查及实机合成 RRD 实验通过。Python 测试包含真实 HTTP Handler 的新增脚本可达性检查，而不只使用浏览器模拟服务器。
- 隔离实验阶段无生产文件变更，只使用自动清理的 `ipppping-p1-lab-*` 临时目录。随后获准部署 P1，只替换 API/前端资源并重启 API；节点配置、上传协议、采样频率和保留策略未变。
- 本阶段主要证明正确性和故障减载，不宣称正常路径全面提速。冷缓存增加一次 `rrdtool lastupdate`，成本明确列在第 5 节。

## 2. P0 基线

代码基线为 `0b33aa6d72cff615433c7312b7116b5b0d6c1f63`。开始改动前，本地和生产 `server.py`、`web/app.js` 逐行比较无差异；CSS/HTML 的生产 SHA256 与前次审阅一致。Windows CRLF 与 Linux LF 的原始字节散列可能不同，不能据此误判业务代码漂移。

生产观察：

| 项目 | 结果 |
| --- | --- |
| 主控系统 | Debian 13；2 vCPU，Xeon Platinum 8160M；约 1,971 MiB RAM |
| API 服务 | Python `/opt/ipppping/server.py`；观察时 MemoryCurrent 18,239,488 B，单点值不是峰值 |
| nodes | 18 个 VPS、6 个 External；共 24 个公开元数据条目 |
| 后端限制 | 配置默认选择最多 20 节点、500 pairs；未提高限制 |
| RRD 代表样本 | `ExternalIPv6/google_dns_v6~akari_jp.rrd`；step=60，20 个 ping DS，heartbeat=120 |
| RRA | 存在 180/1440 行的 60 秒 AVERAGE 档，以及 12/144 PDP 合并档；未改变保留结构 |
| 原始更新语义 | `lastupdate` 输出真实写入时间、loss 和 median；uptime 可以是 U，不据 uptime 判定全缺测 |
| CDN | JS 响应观察到 `max-age=14400,must-revalidate`；旧固定资源查询串问题仍留待 P2 内容指纹方案 |
| 原测试 | 33 项后端测试通过 |

公开节点 ID 快照（不含 IP、端口、密码或密钥）：

```text
VPS:
alphavps_sea bugnet_sea datawave_akari_de datawave_akari_hk
datawave_akari_lax dmit_hk dmit_jp gomami akari_jp akari_sg
legendsg miaomoe_de polo_de polo_tw_10g rfc_jp_co_lite
vps_town_a1 xzhk yxvm_jp_vol

External:
cloudflare_dns google_dns tg5 gd_telecom_tcp80 gd_mobile_tcp53 gd_unicom_tcp80
```

需求沿用升级计划 R01–R12。本阶段验证了节点选择上限、pair 上限、Fixed 外部方向、双栈 Ext 标签、Telegram DC5 仅 v4、首次不预取、手动提交、480 卡片和快速时间范围切换。没有进行 P2 的视觉体系、键盘焦点或统一轴算法重构。

### 已冻结的 P1 资源边界

- 单页面 JSON 与 PNG 共用 4 个在途名额，不提高后端 RRDtool/HTTP 并发。
- 429/503 最多额外重试 2 次，遵守 Retry-After；长 Retry-After 导致本次超时结束，而非提前重试。
- 超时覆盖 fetch、重试等待和 JSON body 读取；节点列表/单项默认 15 秒，批量 30 秒。
- 只有 404/501 可触发批量接口兼容降级；网络故障、超时、畸形 JSON、503 不散射。
- Native PNG 无法检查 Retry-After，因此取消自动图片重试，保留显式 Retry，仍受公共队列控制。
- 浏览器统计缓存最多 1,024 条/估算字符串载荷 2 MiB；读取更新 LRU。60 秒后标注缓存过期。不是总 JS 堆上限。
- sessionStorage 按窗口只保存当前选择；每项保存文本最多 500,000 字符，恢复最多 500 条、5 分钟内的数据；恢复后仍按真实缓存时间判断过期。
- 页面每 15 秒只刷新本地状态文案，不发送采样请求；默认仍为手动刷新。

## 3. P1 数据契约及兼容性

### 3.1 `state=p1` 显式启用

新版前端调用：

```text
/api/stats?source=...&target=...&type=v4&dur=10800&state=p1
/api/stats-batch.json?nodes=...&dur=10800&state=p1
```

未传 `state=p1` 的旧客户端仍获得原五字段响应，Current 保持其旧 LAST 语义；空窗口保持原错误响应。这是缓存标签页兼容措施，不代表旧语义已正确。新版与旧 API 配合时显示“测量时间未知”，不伪造新鲜度。

新版字段：

| 字段 | 含义 |
| --- | --- |
| `current_ms` | 最近一次 RRD 原始写入的 median，转换为 ms；未知则 null，不回退平均值或历史 LAST |
| `last_valid_ms` | RRDtool 图形统计的历史 LAST，仅供兼容/诊断，不由新版作为 Current 展示 |
| `avg_ms/min_ms/max_ms/loss_pct` | 原有请求窗口图形统计；本阶段未统一为新的 P3 规范统计算法；全无有效 loss 时为 null |
| `current_loss_pct` | 最新原始写入的丢包比例，按 ping DS 数换算；与窗口平均 loss 分开 |
| `rrd_updated_at` | 最近 RRD 写入时间，即便本次全为 U 也可存在 |
| `measurement_updated_at` | 该写入包含有效 loss 或 median 时才提供；全部未知则 null |
| `measurement_state` | measured / missing / unknown；unknown 包括读取失败，不表示健康 |
| `observed_at` | 元数据读取时刻，不是测量时刻 |
| `stale_after_seconds` | 当前沿用 600 秒过期阈值，与既有代表性探针检查一致 |
| `freshness_source` | `rrd_lastupdate`；不使用文件 mtime 或数组末端代替测量时间 |
| `stats_semantics` | `p1-raw-current`，便于定位新旧语义 |

100% 丢包属于有效测量：Current 可以是 null，同时 `current_loss_pct=100`，时间有效。历史统计仍可有非空数值；页面状态明确注明最新探测全丢包。窗口平均 Loss 不能与最新一次 Loss 混为一谈。

前端分别表达：未知测量、没有测量、测量已过期、缓存已过期、刷新失败、时钟偏差。失败时保留旧数字并标记，不把旧值当作刚收到的数据。后端读原始时间失败时，Current 保守返回 null，而不是退回错误的历史值。

### 3.2 series 的有限修复

- 全部缺测的 summary loss 从错误的 0 改为 null；前端当前不调用该接口。
- 最新 Current/测量时间来自同一 raw reader；丢包换算使用实际 ping DS 数。
- 旧 `last_update` 仍保留原 bucket-end 含义以兼容，并新增明确的 `last_update_semantics`；新逻辑禁止使用该字段判定新鲜度。
- avg/min/max 仍为 fetch 桶统计，未声称与 graph 像素合并统计完全等价。字段统一、降采样与 Canvas 属于 P3，未提前实施。

### 3.3 缓存与一致性边界

raw 元数据与 stats/series 共用原有 256 条/8 MiB、15 秒 TTL 的服务器缓存；没有新建无界缓存。mtime 仅用于缓存失效，不用于证明测量新鲜。读取仍受原有 RRDtool 信号量控制。

图形窗口统计与最后原始写入分两次读取；采样恰好写入时可能跨一个更新周期。这不是 P3 的原子快照协议，接口文档不宣称二者是同一次冻结快照。

## 4. 浏览器与回归结果

环境：Windows，Chrome 153.0.8010.53，Playwright headless；仅访问本地 HTTP 测试服务。模拟响应延迟 40 ms，不是公网测速。节点和数值是合成 fixture，不含生产登录信息。

| 检查 | 结果 |
| --- | --- |
| 首开 | 无矩阵请求；提交三节点后 8 卡片、4 Ext、4 v6 |
| 一次批量 503：旧版 | 1 次 batch 后散射 8 次单项；峰值 8 |
| 相同 503：P1 | 总计 3 次有限 batch 尝试；0 次单项；峰值 1 |
| 503 后切协议 | 不重新发起失败的散射请求 |
| 404 兼容降级＋PNG | 混合请求峰值 4 |
| 断网、畸形 JSON | 单次失败，明确状态，无自动散射 |
| 全缺测、100% 丢包、过期测量 | 正确区分，Current 不显示平均值 |
| 部分失败 | 保留失败项的旧值且仅标记该项；手动刷新可恢复 |
| 草稿快速切为 24h | 旧响应不覆盖新结果，显示新窗口的 24.0 测试值 |
| 请求去重 | 5 次相同并发请求只发生 1 次网络调用 |
| 缓存边界 | 插入 1,100 条大记录后仍满足条目/载荷上限 |
| body 超时 | 已返回 header、延迟 body 的请求在 50 ms 测试阈值取消 |
| 规模边界 | 16 双栈 VPS 的 480 卡片只发 1 次 batch；超过 500 pairs/20 nodes 被阻止 |
| Fixed/外部/单栈 | 外部 anchor 仅向目标方向；Telegram DC5 不生成 v6 |
| 页面异常 | 未出现未捕获 JS 异常 |

同一三节点 fixture、40 ms 模拟响应、30 次强制刷新实验：旧版中位数 81.3 ms / p95 84.7 ms；P1 80.9 ms / p95 82.2 ms。差异小于可据以宣称性能收益的水平；此实验仅证明该正常路径未出现明显回退，不是 Web Vitals。

390/768/1024/1440/1800 px 均生成截图；已人工检查移动和宽屏新增状态文本没有遮挡结果。既有低对比度次级数字、抽屉键盘焦点等 P2 问题仍存在，没有在本阶段宣称修好。

## 5. 实机隔离 RRD 实验

实验程序 `tests/run-rrd-lab.py` 在主控临时目录中生成 20 ping DS、60 秒 step 的合成 RRD，包含正常值、尖峰、全丢包与未知更新；使用现成 Python/RRDtool，不安装软件。每版本每场景 30 次，冷缓存明确清除实验进程内缓存，暖缓存先预热；未清生产缓存。

| 场景 | 基线中位/p95 | P1 中位/p95 |
| --- | --- | --- |
| 3h stats，冷缓存 | 17.20 / 20.99 ms | 33.98 / 37.76 ms |
| 3h stats，暖缓存 | 0.0147 / 0.0289 ms | 0.0072 / 0.0139 ms |
| 3h series，冷缓存 | 27.72 / 31.00 ms | 43.99 / 57.10 ms |
| 3h series，暖缓存 | 0.0130 / 0.0221 ms | 0.0067 / 0.0121 ms |

说明：这些是函数级调用耗时，不含 HTTP/CDN/浏览器；暖缓存微秒差异受测量噪声影响。P1 冷缓存增加约 17 ms 是真实代价。最新 raw reader 的缓存可跨同文件 stats/series 共用；没有把额外子进程成本隐藏在“轻量化”结论里。此组计时发生在增加旧客户端响应筛选之前；该筛选不改变所测函数的 RRDtool 调用流程。

准入判断：可进入 P1 生产候选验证，但不能凭该实验扩大到 Canvas 或承诺 CPU 节省。应在生产获准发布后继续观察批量延迟与 RRDtool 占用；如出现不可接受退化，先回滚 P1 制品，不提高并发或更改采样。

## 6. 如何复现

在仓库根目录，使用可用的 Python 3 和 Node：

```sh
python -m unittest -v
python -m py_compile server.py test_measurement.py tests/run-rrd-lab.py deploy/install-api.py
node --check web/app.js
node --check web/request-state.js
node --test tests/request-state.test.cjs
node tests/frontend-browser.cjs --baseline
node tests/frontend-browser.cjs
```

浏览器脚本需要能解析 `playwright`；可用现有安装设置 NODE_PATH。若没有其捆绑浏览器但已安装 Chrome，可设 `BROWSER_CHANNEL=chrome`。生产不需要 Node 或 Playwright。

实机合成实验为显式命令：`python tests/run-rrd-lab.py root@HOST PORT`。它通过现有 SSH 认证运行临时实验，不自动部署。

本地生成的 `test-results/p0/`、`test-results/p1/` 包含报告 JSON 与截图，`test-results/rrd-lab.json` 为 RRD 实验；这些生成物已 gitignore。可持续维护的用例在 `test_measurement.py`、`tests/request-state.test.cjs`、`tests/frontend-browser.cjs` 中，基线前端由 Git `0b33aa6` 读取，未复制出第二套生产 UI。

## 7. 发布准备与尚未完成事项

发布涉及 `server.py`、`web/request-state.js`、`web/app.js`、`web/styles.css`、`web/index.html`。安装助手已补齐新增资源，按依赖先、HTML 后顺序替换，原备份/回滚流程保留；执行记录见第 8 节。

P1 使用新的资源版本查询串防止沿用旧 URL 缓存；完整内容 hash、旧制品保留和原子清单切换仍是 P2 工作，不能声称本阶段已经实现。

以下尚未完成，禁止标记为已验收：

- 真实手机、Firefox/WebKit、多 DPR/200% 缩放的完整矩阵；本次是桌面 Chrome 模拟不同宽度。
- 全部 1/3/6/24h 的真实网络冷暖、服务器 CPU/RSS 与公网传输基线，以及现场 p75 Web Vitals。
- 30/60 分钟图表生命周期浸泡测试、内容指纹、虚拟化、Canvas 与规范统一统计；分别属于后续阶段或 P0 扩展验证。
- 24–48 小时持续观察；当前只完成发布前后及数个采样周期的即时核验。
- 实际切回旧版的生产回滚演练；未为演练而中断已正常运行的新版。

因此本次完成了“P0 的 P1 必需基线＋P1 实现与发布”，不是整份升级计划完成；后续性能重绘仍受原计划 G0/G3 的完整证据门槛约束。

## 8. 生产发布记录

- 用户确认后于 2026-09-22 08:12:37 UTC（16:12:37 UTC+08:00）执行发布；只重启 `ipppping.service`，未重启 SmokePing 或任何节点容器。
- 部署前生产源文件与原基线一致；本地与远程 main 无分叉。44 项 Python、4 项 Node、14 组浏览器测试复跑通过，实机暂存目录的 44 项 Python 测试也通过。
- 完整运行文件备份：`/root/ipppping-backup-20260922T081237Z`。恢复该备份中的 config.py、runtime.py、server.py、web/app.js、web/styles.css、web/index.html 后重启 API 即可回到旧版；新增 request-state.js 在旧 HTML 下不被引用，可以保留。恢复时只操作这些明确文件，不覆盖节点配置或 RRD。
- 公开站点真实浏览器验证：24 个节点，首次只请求 nodes；Halo Akari JP → Google DNS 的 v4/v6 Results 与两张 PNG 均成功，Ext 和协议标签完整，没有未捕获脚本异常。
- 公网 `app.js`、`request-state.js`、`styles.css` 的 SHA256 与发布文件逐字节一致，确认新版本 URL 没有命中旧内容。
- 新 `state=p1` 响应包含实际 RRD 测量时间；同链路旧请求仍为原五字段响应。代表样本测量时间在 600 秒阈值内。
- 发布前后 47/47 项代表性 slave/probe 新鲜度检查均通过，涵盖 FPing、FPing6、TCPPing；这是代表性覆盖，不是所有链路无丢包的声明。
- API active，NRestarts=0；一次观察的 MemoryCurrent 约 15.8 MB，不能据此宣称长期节省比例。上传链路未修改，发布后 RRD 继续更新。
- `tests/production-smoke.cjs` 保留低请求量的公开站点复验脚本；截图及完整报告位于被忽略的 `test-results/production-p1/`。
- 发布制品和文档随后同步到 GitHub main；准确提交号以该记录所在的 Git 历史为准。
