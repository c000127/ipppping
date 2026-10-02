# 前端升级收尾与验收索引

2026-10-02 Charts 离屏保留图片已仅前端上线，当前制品和有限 Chrome 验证见
[离屏保留报告](FRONTEND_RETAINED_CHARTS_REPORT.md)。首次加载仍按需；新增预览
存储未做新的长期容量验收，不继承历史长测结论。

更新：2026-09-30。本页是当前状态索引；阶段报告中的早期失败、待办与
测量数字仍保留为历史证据，不用新结论覆盖旧报告。

2026-10-01 后续视觉反馈已修订并仅前端上线，当前制品与新增 Chrome 核验见
[颜色/模块层级/Fixed 报告](FRONTEND_UI_SURFACES_REPORT.md)。以下冻结指纹及
“此次收尾未重新发布”描述属于 2026-09-30 当次收尾，不冒充新 UI 的长测。
已完成观察仍停止，长期容量豁免和原报告字节保持不变。

## 范围决定与最终状态

用户明确要求暂时忽略长期全矩阵容量验收、默认放行。这一项记为
**用户豁免 / 接受未验证风险**，不是实测通过，不再阻塞本次升级收尾。
不新增生产压测、监控窗口、并发预算或采样变更。
完整的一小时本地主页面 G4 长测、生产回滚和修订后一小时 G5 观察
已经实际通过，并非因本次豁免改写为通过。

| 阶段 | 当前结论 | 证据及范围 |
| --- | --- | --- |
| P0 / G0 | 当前用户要求的 Chrome 基线验收通过 | [P0/P1](FRONTEND_P0_P1_REPORT.md)、[P2](FRONTEND_P2_REPORT.md)：真实浏览器级 200% 缩放复验；低端机及 Firefox/Safari 门槛由用户取消 |
| P1 / G1 | 正确性与请求治理完成 | P0/P1 报告、Python 数据契约/HTTP 测试、`tests/request-state.test.cjs`、Chrome 故障回归；未知不补零、Current 不借用均值、失败不散射 |
| P2 / G2 | 组件/资源治理、Chrome 验收完成 | P2 报告、指纹清单、键盘/抽屉/缩放、[设计不变量](FRONTEND_DESIGN_RULES.md) |
| P3 / G3 | 单链路净收益与兼容验证通过 | [P3 报告](FRONTEND_P3_REPORT.md)：隔离真实 RRDtool、同链路公网 v2/新鲜 PNG 对照、历史 Android Chrome 验证；不外推所有路由 |
| P4 / G4 | 共享主页面功能、资源边界、实际制品 60 分钟原门槛通过 | [主页面报告](FRONTEND_MAIN_CANVAS_REPORT.md)、[P4 报告](FRONTEND_P4_REPORT.md)；480 路本地模拟、120 点、正常 Canvas/动效、原分析器判读 |
| P5 / G5 | 默认切换、回滚、旧标签页及用户修订后的一小时观察完成 | [公网发布记录](FRONTEND_PUBLIC_RELEASE.md)；五个真实通过样本覆盖 61m54.232s，`complete1h=true`；首个失败窗口保留，有限自动跟进已暂停 |
| 长期全矩阵容量 | 用户豁免，不是测量通过 | 保留已做的一次性/隔离有界并发证据，不宣称持续吞吐、完全冷盘或任意用户数容量 |

当前获准范围已收尾。下面列出的可选事项不阻塞本次验收，也不自动执行。

## 需求—证据对照

最新用户要求优先于原计划的示例状态文案和视觉建议。

| 原计划需求 | 落实与验证入口 |
| --- | --- |
| R01 名称、短别名、排序、删除不复现 | 前端只使用 `/api/nodes` 返回清单，不内置生产节点；`sortNodesByLabel` 按标签排序、同标签以 ID 排序且不改写 ID。`tests/frontend-browser.cjs` 验证自然数字/大小写排序、原数组不变及分组列表 ID。清单删除由既有部署记录负责，本次不更改或重新认证私有 inventory |
| R02 多 Fixed、方向及数量限制 | Python pairs/summary-batch 测试，Chrome 主页面和兼容页边界/多 Fixed 测试：Fixed 之间不生成 results；保留 20 节点 / 500 pairs 限制 |
| R03 真实单/双栈及外部目标 | Python 配对及 v2 契约测试、`tests/main-canvas-browser.cjs`：IPv6-only 不制造 v4，外部不作采集端，Telegram DC5 不制造 v6 |
| R04 Ext 与 v4/v6 标签 | 兼容页/共享主页面 Chrome 自动断言及历史公网两/四路和一小时观察；外部卡片同时保留两类标签 |
| R05 视图、时间窗口、手动提交与草稿 | 主页面与兼容页 Chrome：Results/Charts、窗口切换、草稿未应用、多 Fixed、PNG 往返携带状态；导航不自动提交 |
| R06 五指标和未知语义 | Python 黄金 RRD/聚合/窗口测试、[v2 契约](SERIES_V2.md)、Chrome missing/loss/partial failure；窗口外 Current 为空，100% Loss 不伪造 RTT |
| R07 全集合冻结统一轴 | `tests/matrix-data.test.cjs`、主页面 Chrome 480 路/15 页：冻结 end/selection/全选摘要，滚动与过滤不重新定义上限 |
| R08 可信状态，不以失败伪装成功 | 兼容页故障实验和主页面取消/503/代次/部分成功/失败保留快照；按用户要求彻底移除结果卡里的 Last measurement、Cached result、Latest probe 等状态文案。节点选择状态保留两行，全局未应用/提交失败反馈与未知值仍有效 |
| R09 深色、数字与布局 | 两套 Chrome 视觉断言及用户试验页验收：无常驻边框、结构分隔线全宽；五列仅整体居中，标签/数值内部左对齐；Current+2×2 才用 1.66× 字号，数字/ms 同行并按需缩小 |
| R10 鼠标、触屏与键盘 | Chrome 抽屉/Fixed/焦点/Escape/表格测试、历史 Android 测试、共享主页面 axe；人工读屏不是已测通过项，本次不访问 Android |
| R11 PNG 与旧客户端 | 真实 default→PNG→default、旧标签页跨切换、共享主页面 PNG 携带草稿及兼容页测试；旧 API/旧资源/PNG 均保留 |
| R12 不全量预取、失败不放大 | Chrome 启动零矩阵请求、仅提交 Charts 后加载依赖、统一四请求池/两条 visible series；摘要忙时至多两次重试，不自动请求旧 stats/PNG |

视觉与动效细则以设计不变量为准：无十字虚线、Median range 或逐点光标；
丢包条固定颜色，依真实时间桶覆盖宽度，数值可按丢包率变色；
短时无弹性动效、仅可视卡片、完成效果释放、尊重 reduced-motion。

## 已部署字节与证据冻结

- 前端实现来自 `a32fa4c641bcd625697fcbf5cb1d47b96d1e362e`；后续验收脚本和
  文档提交不等于新一次生产发布。主页面真实恢复为 Canvas 默认的时间是
  **2026-09-30T13:42:40.783Z**（新加坡 21:42）。
- Canvas 清单 SHA-256：`2d9d735cca2e84fe2e76113c6a2c513025ce925dccbbf89d3a9cb937bdce8885`。
  PNG 回退清单：`a8183f88638a80b8967474ac8541632a84ff153dc9ccaeafa96843ef84cad999`。
  两者 13 个指纹资源相同，仅主 HTML 配置不同；精确 HTML、staging 和备份见主页面报告。
- 实际主页面本地长测：
  `test-results/p4-matrix-cdp-soak-3600s-off-main-default-awake-20260930t075649z.json`。
  使用原样 `node tests/analyze-p4-soak.cjs REPORT` 判定，不削弱门槛。
  渲染器斜率约 +0.162 MiB/min（门槛 +0.2）、中位数差 +2.84 MiB（门槛 8）；
  四实例、16 序列 / 估算 2 MiB 缓存及像素/DOM/监听边界通过，不宣称零增长。
- 首个失败生产报告 `test-results/main-canvas-observation.json` 保留不变，SHA-256
  `ad7710bc4114218c8c508e3dd6a0d7645a2c435aa88c613f3c94e5c9544667a3`。
- 修正后的独立报告 `test-results/main-canvas-observation-health-v2.json`，SHA-256
  `6c8d03af92ec293c7bd48c6d470683e95744fd9ef3a56165e5cb3d119d3bcf6a`。
  startedAt `14:15:56.093Z` 与 releasedAt 分开；五个实际检查时间
  `14:15:56.450 / 14:32:23.342 / 14:47:18.507 / 15:03:21.370 / 15:17:50.682Z`，
  覆盖 3714.232 秒，最大间隔 986.892 秒，distinct 15 分钟 bins 为 0–4。
  健康诊断 GET 不属于页面回退请求；不放宽原 300 秒时效 / 60 秒未来偏差。
  API 原 PID/启动时间/重启数不变，约 40.22 MiB，原 128 MiB / 主机可用 256 MiB 安全线通过。
- 原始详细报告在 Git 忽略的 `test-results/`，不将私有数据或大测试输出推送仓库。
  中断的长测、旧工具路径的失败、首个生产失败和首轮回滚演练失败仍是失败/未完成，
  不因用户豁免改记通过。

## 发布保护收尾

此次仅新增开发构建入口和验收索引，生产 HTML、JS/CSS、API、节点、采样、
RRD、缓存和凭据均不变。不重新部署、演练或开启观察。
`build_web.py` 提供显式参数，防止维护者把保守的 PNG 默认构建误当成生产 Canvas。

新候选使用独立目录，不重建覆盖已验收的冻结制品：

```sh
python build_web.py --default-renderer canvas --output build/web-release-candidate
python build_web.py --verify-only --output build/web-release-candidate
python build_web.py --default-renderer png --output build/web-release-png-candidate
```

`--verify-only` 仅校验现有字节并打印实际 renderer / manifest SHA-256，
不生成或写文件；不能与 `--default-renderer` 一起传入。
不带参数仍构建 PNG，维持既有开发及兼容行为。安装器仍只读 staging 的
`build/web-release`，不能因为新增输出参数跳过发布打包或精确校验。
前端独立发布继续要求五个 runtime 模块与现网逐字节一致，使用
`--frontend-only`，不重启 API；未来发布仍需单独审核实际变更。

收尾回归：89 项 Python、28 项 Node 自动测试通过；安装的 Chrome
154.0.8037.59 通过共享主页面（含 axe）与兼容前端回归。
四项 CLI 测试覆盖显式 Canvas 与原构建逐字节一致、默认 PNG、
只读校验不改变字节/mtime 且拒绝篡改、非法/冲突参数在写入前拒绝。
对上述已冻结 Canvas/PNG 制品只读校验，清单指纹保持不变。
这些新回归是本地 fixtures，不冒充新生产观察。

## 非阻塞风险及后续可选事项

1. 长期全矩阵/完全冷盘持续容量由用户豁免，仍无容量保证。
   已记录真实 477 链路首轮摘要约 17.8 秒等待、约 3.5 万卡片 DOM；
   图表实例有界不代表卡片完全虚拟化。若未来实际人数或清单增长，再
   单独决定渐进呈现/虚拟化及容量测试，不预先扩大服务端限制。
2. 没有真实用户 p75 LCP/INP/CLS 现场数据；实验室及低并发观察不能
   宣称达成所有 Web Vitals 或长期无泄漏。人工读屏/更多浏览器可另行验收。
3. `server.py` 仍含历史内嵌 HTML 常量。它与旧 API、无指纹资源不是同一种
   清理对象；本次不移除 runtime 代码，避免为文档收尾重启 API。
   若要清理，须另做引用检查、兼容与 runtime 发布审核，不能顺带删除旧接口。
4. 保留已验证 PNG staging、回滚备份及旧指纹/无指纹资源。至少覆盖
   7 天回滚窗口，并考虑长期旧标签页，不能仅凭 CDN TTL 批量删除。
   此次没有自动清理脚本或材料删除。
