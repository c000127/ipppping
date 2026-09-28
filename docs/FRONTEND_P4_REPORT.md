# P4 完整 Charts 矩阵试验记录（进行中）

日期：2026-09-28。独立试验路径已上线，**G4 尚未通过，主页面默认 PNG 不变。** 本页区分已执行的
本地模拟、主控隔离 RRD 与公网小规模核验，以及尚缺的完整生产规模证据；
不得把 480 条模拟链路直接外推为生产承载能力。

## 已实现的隔离试验路径

- v2 `/api/v2/summary-batch` 每页最多 32 条，与 `/api/pairs` 共用节点、
  多 Fixed、外部节点及 500 链路限制；在既有 RRDtool 工作池中每页最多 2 个
  工作项，且全局只准一个 v2 摘要页同时运行；复用原缓存，无第二套
  无限缓存。单项失败不会丢弃整页。
- 独立 `/chart-matrix-trial` 页面，手动选择并提交。首个摘要页由服务端选取
  完成分钟，后续页面与可见序列均沿用该 `end`；客户端校验选择摘要、总数、
  页序、逐项链路身份与窗口。收齐全部合法链路摘要后才确定统一 Y 轴，
  即使滚动也不重算。
- 480 条摘要卡可留在 DOM；仅视口附近发起序列请求，同时最多 2 个请求、
  4 个 uPlot 实例。客户端序列缓存最多 8 项且不超过 2 MiB；每个实例背板
  最多 1,126,400 像素。离开视口后销毁实例，隐藏页面时暂停图表工作；
  快照摘要/区间不一致时提示重新构建，不会暗自以 PNG 伪装成功。
- 原 `/` 的 Results / Charts 和 `/chart-trial` 不引用本试验脚本；
  新页面与资源有独立的指纹发布、安装备份及回滚入口。

## 已有证据

| 检查 | 结果 | 范围限制 |
| --- | --- | --- |
| Python 后端及发布测试 | 81 项通过；包括 480 配对的请求页约束、共享工作池上限、gzip、安装后静态路径 | mock RRD，不是 480 次真实 `rrdtool` |
| Node 摘要分页契约 | 500 条、16 页、冻结时间及错页/错链路拒绝通过 | 纯函数模拟 |
| Chrome 本地模拟 | 16 个双栈 VPS 产生 480 条链路；15 页摘要；从顶部滚到底部仅 12 次可见序列请求；最多 4 实例、8 项缓存、无页面脚本错误 | 本地模拟 JSON；尚非生产网络与真实 RRD |
| Chrome UI / 回归 | 四条 Ext v4/v6 链路卡片、独立/统一 Y 轴切换、390/720/1440px 无横向溢出、DPR 3.5 背板预算及 axe WCAG 2 A/AA、2.1/2.2 A/AA 零违规；主页面 17 组回归与原单链路试用页压缩合成 RRD 回归通过 | 试验页为隔离入口；axe 自动规则不等于人工读屏 |
| Chrome 两分钟循环 | 480 卡、60 次三段滚动、370 次序列请求；GC 后 DOM 16,631、监听器 73、文档 1 恒定；JS heap 3,111,852 → 3,369,360 B；Canvas 4，背板合计 587,840 像素 | 短测仅排除明显泄漏；另有 30 分钟长测 |
| Chrome 30 分钟循环 | 480 卡、约 900 次三段滚动、5,379 次模拟序列请求；31 次 GC 后抽样中 DOM 16,631、监听器 73、文档 1、Canvas 4、背板 587,840 像素恒定；JS heap 前约 3 分钟预热后 3,741,136 → 3,769,860 B，无脚本错误 | 测试开始后又调整隐藏页取消与错误提示；最终构建另做进程内存复测，60 分钟仍待完成 |
| 最终构建 Chrome 10 分钟 | 480 卡、297 次三段滚动、1,796 次序列请求；DOM 16,631、监听器 73、文档 1、Canvas 4、背板 587,840 像素恒定；GC 后 JS heap 第 3 分钟约 3,570,408 B、结束 3,577,316 B；预热后 Chrome 进程私有内存 346,685,440–389,111,808 B、GPU 143,052,800–163,971,072 B，存在波动而非单调增长 | 进程内存末值高于预热初值，10 分钟不能排除慢速增长；需主页面接入后做 60 分钟观察 |
| 主控隔离真实 `rrdtool` | 480 个不同路径缓存键、15 页、960 次子进程调用；4/2/1 工作项总墙钟分别 8.72/9.32/15.56 秒，子进程峰值分别 4/2/1；2 工作项每页中位 577 ms、子进程 CPU 累计 9.48 秒、试验 API 峰值 RSS 45,284 KiB；15 页 JSON 490,268 B / gzip 16,299 B。故 P4 限为 2 工作项 | 自动删除临时目录，未读生产 RRD；480 硬链接共享同一热 inode，不能代表生产冷盘或并发用户 |
| 公网 opt-in 小规模 | `akari_jp→google_dns` 两个协议摘要与 v4 序列一致；gzip 命中、Chrome 可见 Canvas 2；两个 Fixed VPS 到同一外部目标产生 4 个结果且同时显示 Ext 与 v4/v6；主页面资产指纹未变、API/Caddy active、NRestarts=0、新鲜度 timer 成功 | 仅 2/4 路由低速核验，不是全量生产压测；Cloudflare 会动态注入挑战脚本，故公网整页 SHA 不可与源文件直接比 |

## 2026-09-28 独立试验页图表视觉精修

本轮仅调整独立 `/chart-matrix-trial`，仍以既有深色界面为基底，不在
主页面切换渲染器。设计取舍参考 [Grafana Saga 的任务优先原则](https://grafana.com/developers/saga/foundations/design-principles/)
与 [Grafana 时序图语义](https://grafana.com/docs/grafana/latest/visualizations/panels-visualizations/visualizations/time-series/)、
[IBM Carbon 坐标轴及缺口指引](https://carbondesignsystem.com/data-visualization/axes-and-labels/)、
[AntV 辅助标记](https://antv.antgroup.com/zh/specification/module/annotation/)、
[Tremor Metric Card](https://npm.tremor.so/docs/ui/card)。以下颜色和像素值是
适配本站暗色调的实现选择，不声称为这些体系的强制色值。

- 卡片、指标区和图面作三级暗色分层；`Current` 放大并独占主指标位，
  Average / Max median / Loss / Coverage 作 2×2 次级指标。窄于 420px
  时主指标改为整行，避免大数字挤占另外两列。
- RTT 中位数折线为青色、区间须为淡紫色、丢包峰值为珊瑚色空隙点，
  100% 丢包点加大实心标记。单个置顶图例说明三者，不仅靠颜色区分；
  不在 480 张卡上重复生成图例 DOM。
  移除垂直网格和刻度短线，只保留低对比度水平参考线；左右 Y 轴分别
  标明 RTT ms / Loss %。保持 0–100% 丢包轴、已有统一/独立 RTT 轴、
  冻结窗口与断点，不插值缺失测量。
- 无新增依赖、背景动效或网络请求；逐点绘制最多 120 个箱的区间须与
  非零丢包环形点，仍受 4 个 Canvas、2 个并发序列请求、8 项/2 MiB 缓存及
  每图背板像素上限约束。
- 本地 Chrome 模拟加入有起伏、25%/100% 丢包及缺口的可视样本；
  截图保存于忽略的 `test-results/p4-matrix-card.png` 和
  `test-results/p4-matrix-card-mobile.png`。自动 axe 未发现 WCAG 2 A/AA、
  2.1/2.2 A/AA 违规；自动检查不能代替时序详情的人工读屏验收。
- 最终布局在本地 Chrome 480 卡、60 秒/30 次滚动循环中，DOM 节点数
  17,128、监听器 73、Canvas 4、背板 579,920 像素均恒定；GC 后 JS heap
  3,332,332 → 3,492,068 B，进程私有内存 391,380,992 →
  363,298,816 B。与旧版 16,631 DOM 节点相比，视觉增量约 497 节点；
  这是短时模拟证据，不取代 G4 的长时与真实生产负载验收。

## G4 仍需完成

1. 已完成热 inode 的隔离 `rrdtool` 基准和小规模生产路由可用性；仍需生产
   API 的真实路由成本、CPU/RSS/响应体与持续吞吐，不能仅凭试验数值推断
   2 GiB 主控的冷盘及多用户承载性。继续保持低速、可回滚和默认 PNG。
2. 最终构建独立试验页 Chrome 全矩阵 10 分钟已完成；主页面集成后仍需 60 分钟滚动与反复提交，记录 GC 后 JS heap、DOM、
   listener、Canvas 像素、进程/GPU 私有内存趋势及错误；检查首次全摘要等待
   与交互延迟，确定是否需要进一步卡片虚拟化。
3. 将冻结摘要、可见图表实例与现有主页面 Charts 卡片/过滤器/选择状态接入同一套
   UI，仍以显式试用开关隔离；Results 和未开启试用的 PNG 路径不变。随后验证
   缺口、极值、100% 丢包、外部节点 v4/v6、多个 Fixed、200% 缩放、移动宽度、
   键盘/读屏等同等信息；局部失败和中断要有可恢复状态。
4. 已上线独立 opt-in 试验路径；完成主页面兼容集成及 G4 后再讨论 P5 默认
   迁移、受控回滚演练及 24–48 小时观察。独立试验上线不代表主页面切换。

复现：`python build_web.py`、`python -m unittest discover -q`、
`node tests/matrix-data.test.cjs`、`BROWSER_CHANNEL=chrome node tests/chart-matrix-browser.cjs`。
`SOAK_SECONDS=1800` 可启动本地 30 分钟模拟滚动；其报告写入 Git 忽略的
`test-results/p4-matrix-browser-soak-SECONDSs.json`。`python tests/run-matrix-rrd-lab.py
root@HOST PORT` 会在主控创建并自动移除专属临时目录；使用现成 rrdtool，
nice=10，不读取生产数据或重启服务，报告保存在 Git 忽略的
`test-results/p4-matrix-rrd-lab-WORKERS.json`。可附加 `1`、`2` 或 `4` 比较
隔离样本的并发成本。`BROWSER_CHANNEL=chrome node tests/production-p4-smoke.cjs`
只在明确授权的试验上线后运行，向公网发起低速只读的两/四路请求与 Chrome
可见性核验；不自动施压全矩阵。Chrome 本地模拟命令不向生产主控施压。
