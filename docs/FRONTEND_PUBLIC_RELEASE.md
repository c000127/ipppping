# P2 主页面与 P3 独立试用页：公网发布记录

日期：2026-09-23。站点：<https://ipppping.hachimihaqile.top/>。

## 发布范围

- P2 主页面：组件/样式收敛、内容指纹资源、键盘与移动抽屉改进；结果和
  Charts 的默认数据链路仍是批量统计加 RRDtool PNG。
- P3 仅作为独立的 `/chart-trial` 试用页：一条链路的 v2 序列、Canvas、
  可访问明细表与显式 PNG 对照。主页面不加载 uPlot，也未默认切到 Canvas。
- 此前一轮 UI 微调取消各部分常驻白色边框，原生节点 checkbox 视觉隐藏但
  保留语义/键盘操作，并统一每张卡片五项数值的字号。
- 未改节点清单、采样配置、登录密钥、上传认证或 RRD 数据。此前发布时工作树
  尚未提交或推送到 GitHub；部署与仓库同步是两项独立状态。

## 制品与回滚位置

开发机 `build_web.py` 生成的 `build/web-release/manifest.json` 包含两个 HTML、
八个指纹资源及 uPlot 许可证校验和。此前 UI 微调包 SHA-256：
`52b705a36fae8e76d9b84ef4279c19d7e96813eb599158c83a216ee28c266389`。
主页面 HTML SHA-256：`8691b806a5d255907d4ba9e45dea07806017c02756f3455859656631c242de32`；
试用页 HTML SHA-256：`1dbe6dc65e037c9ba5bc915d21c093e5dae7ece727e1f1fae751d6cf3b09e20b`。
该轮主页面样式资源为 `styles.ba76e5b135935ea8.css`。

安装器报告先后创建，且发布后已再次核对目录存在：
`/root/ipppping-backup-20260922T230321693371Z`
（首次 P2/P3 发布前）与 `/root/ipppping-backup-20260923T024804656745Z`
（此前 UI 微调前）。回滚应先核对备份内容和当前服务状态，再按安装器恢复步骤
操作；尚未做生产回滚演练。历史无指纹资源仍保留供旧标签页使用。

### 2026-09-23 内部分隔线增量发布

按用户反馈恢复卡片内部的低对比度 `#363636` 分隔线：链路区/统计区、
统计项之间，以及统计区/图表区。宽屏 Results 保留链路与统计的竖线，
窄屏改为横线；卡片及控件外轮廓仍为 0，节点 checkbox 仍视觉隐藏，
五项数值字号规则不变。

新主页面样式为 `styles.59aedfaa1ce325ba.css`，主页面 HTML SHA-256 为
`4bf1f71d759c0ed76634f882af43b5d3c090ea69f1af3144ba2ca76e770f3744`；
因试用页也引用共享样式，其 HTML SHA-256 更新为
`3b51c97d340a1b61db125835743c047a811505a4b147c7759fa8606fc90355b4`。
发布包 SHA-256 为
`4c3a880d3d76883e70279da7d5b7db9633e8d9013216f89459468c9b8e83a661`，
本机与主控校验一致。主控 staging：`/root/ipppping-stage-gd72YI`；
安装器创建备份：`/root/ipppping-backup-20260923T030453208162Z`。
未删除旧资源、节点信息或历史数据。

构建后 Python 68 项、Chrome 153 与 WebKit 26.5 的多断点/480 卡片回归通过；公网 Chrome 153
再次核验八个指纹资源、真实双栈结果/PNG、P3 试用页。桌面 Results 的
链路/统计线与统计项线均为 1px，390px 移动 Results 的链路/统计线和
Current/其余统计项线均为 1px，Charts 的链路/统计与统计/图表线均为 1px；
卡片/控件外轮廓仍为 0，页面无横向溢出或应用异常。

### 2026-09-23 底部节点选择跳动修复

生产节点列表可复现：隐藏的节点 checkbox 使用 `position:absolute`，却没有
就近定位容器。选中列表最后一个节点时，浏览器把获得焦点的 1px 控件滚入视野，
桌面主页面被额外滚动 219px；移动模拟视口的侧栏外层也发生位移。
将 `.node-select` 设为定位容器，把隐藏 checkbox 的定位框固定在其所属行内，
保留视觉隐藏、标签整行点击、键盘焦点和复选框语义。

回归测试先在旧样式上复现 267px 页面滚动，再于修复样式上通过；Chrome 153、
WebKit 26.5 的构建产物测试及 Python 68 项、Node 4 项均通过。公网生产列表
再次测试底部 VPS 与最后一个外部节点：桌面点击和手机模拟触摸各两种场景，
页面、侧栏外层和列表滚动位置均未变化。测试及截图见 Git 忽略目录
`test-results/sidebar-scroll/`；公网完整冒烟也通过。

本轮样式指纹为 `styles.7ceb52253b08a946.css`；主页面 HTML SHA-256：
`2d05fcba0f6c8595f46d375b27b9db2902b125d53bfe132958fa0487ee28bd72`，
试用页 HTML SHA-256：`d8db4cb804ae32751c3e1a98aa6fe5e57bb8a2037df5797c08301fda3ba543fb`。
发布包 SHA-256：`8acf9e7ac492a9c8c09a2f23b40a23fa62a0115c622f51aaa3ebe170aa4838e8`；
主控 staging 为 `/root/ipppping-stage-Z7Gy4W`，安装备份为
`/root/ipppping-backup-20260923T031441852796Z`。未改动节点配置、采样或 RRD。

### 2026-09-23 多 Fixed 节点与稳定侧栏发布

`Fixed nodes` 允许同时标记多个已选节点，只生成 Fixed 与非 Fixed 之间的
结果，不生成 Fixed 之间或非 Fixed 之间的结果。原单 ID `anchor` API 保持
兼容；多 ID 使用逗号分隔。侧栏底部使用固定控制槽位，节点选择、结果/图表
切换及状态信息变化不会挤动节点列表。桌面侧栏与移动抽屉的开合、图表轴选项
和状态变化增加过渡，并尊重 reduced-motion 设置。

本次制品指纹：`styles.d530deba3d9ebc83.css`、
`app.e493ff9112d16cb6.js`；主页面 HTML SHA-256 为
`6bcaf3a9374ce372b2390bffb433512fd7640ffc6a1cde7d200fd6c4a44b7f51`，
试用页为 `214d3dc6a23cc4317d5bfdfc00eaf9a14a1c8f678c5ffaa4275dbe14de3ff56e`。
发布包 SHA-256 为 `64ca2cfacbb6360e6a1ecb700951fdb19dd8b99d27d2788a9ce05b01db782392`，
主控 staging 为 `/root/ipppping-stage-SQaLQx`，自动安装备份为
`/root/ipppping-backup-20260923T033857879851Z`。本机与主控包校验一致。

本地构建、Python 72 项、Node 4 项、Chrome 153 与 WebKit 26.5 的主页面
回归通过；独立图表试用页 Chrome 及 WebKit 无截图流程通过（WebKit 截图
会由测试工具注入内联样式，见 P3 报告）。公网 Chrome 验证两个 HTML、
八个指纹资源、原有真实双栈结果与 PNG、独立试用页。新增公网多 Fixed
用例返回 4 个 External 结果、无 Fixed 互测，底部区域高度始终 280px；
应用页面无未捕获错误。验证截图及 JSON 存于 Git 忽略的
`test-results/production-p2p3/`。发布后 `ipppping` active、`NRestarts=0`，
SmokePing 容器仍在运行；未改节点采样、凭据或 RRD 数据。

### 2026-09-23 自然高度侧栏与结果状态精简

应用户反馈，侧栏底部控件不再固定总高度；仅节点选择状态保留两行各 20px。
首行显示所选节点、Fixed 节点和结果数（或选择校验提示）；第二行有未提交
更改时显示 `Unapplied changes`，否则显示当前过滤结果中最大
`measurement_updated_at` 对应的 `Updated HH:mm`，使用站点时钟时区但不
显示日期和时区。无结果时显示 `No update yet`。普通结果卡不再重复显示
`Last measurement` 和时间戳；丢包、缺失、过期、刷新失败仍有逐卡提示。
一行五列指标居中；窄屏 2×2 与宽屏 Results 的分隔线跟右侧文字块上下边缘
对齐。移动抽屉改为不透明滑入，避免淡入途中与下层结果文字重叠。

最终发布指纹：`styles.f4dc930f4bf3fcaa.css`、
`app.a1675b972ad11386.js`；主页面 HTML SHA-256 为
`aab65a480aa09ea47fbb8fbafec8f3c61f3e641b06f5fd848217caa837305e1c`，
试用页为 `d3f0b514c2805508d0fcf9c4d20926803a1cb577d81b0d03ba79655dd0e6c7a3`。
最终发布包 SHA-256 为
`8a8372b5edc2e1c18907b9d8ea38a2095a2f01b959909f14d20d415d5595f914`，
本机与主控校验一致；主控 staging 为 `/root/ipppping-stage-Zgkfqk`，
最终自动备份为 `/root/ipppping-backup-20260923T054037864258Z`。
此前同轮首次部署的 staging 与备份分别是 `/root/ipppping-stage-8LhdoV`
和 `/root/ipppping-backup-20260923T053748283405Z`。

本地构建、Python 72 项、Node 4 项、Chrome 153 与 WebKit 26.5 主页面
回归通过；Chrome axe 无报告项，独立试用页 Chrome/WebKit 回归通过。
最终公网 Chrome 再次逐字节核验两个 HTML 与八个指纹资源、真实双栈
结果/PNG、独立试用页以及多 Fixed 流程。普通状态行隐藏、五项指标居中、
移动 2×2 分隔线对齐误差 0px、状态两行均为 20px；Results 底部控件区
为 236px，Charts 展开时自然增高。四条多 Fixed 结果的侧栏 HH:mm 与
批量 API 中最大测量时间一致。应用页面无未捕获错误；截图和 JSON 存于
Git 忽略的 `test-results/production-p2p3/`。节点、采样、凭据与 RRD 未改动。

### 2026-09-23 结果卡状态文案移除与 CURRENT 字号规则校正

主结果卡移除了逐卡状态 DOM 与样式，不再显示缓存过期、最新探测丢包、无数据、
过期或刷新失败等说明文字。缺失/未知值仍以 `—` 表示，LOSS 百分比指标保留；
侧栏最新更新时间与未提交状态不变。一行五列时五项数字维持同字号。只有左侧
CURRENT、右侧四项 2×2 的布局（窄屏 Results/Charts 与宽屏 Results），CURRENT
数值放大为其它指标的两倍。宽屏 Charts 仍是五列，不放大。

本次资源为 `styles.6ba475af2c1d5101.css`、`app.8e4fc24c16c31d92.js`；主页面
SHA-256 `f53c096329dd3f92328299d3466716e36061773d10e104b11494352bd4ac2115`，
试用页 SHA-256 `fb6a7ac44dcd8c8b321d1a8814d7db857eb4bb1a8098eb38113995507e855e6f`。
传输包 SHA-256 为 `79b28c611410e408be6527e3573df61e85b7e5d99f445e037bc587718d753ad6`，
开发机与主控机一致。主控 staging 为 `/root/ipppping-stage-CoIYsR`，安装器自动备份
为 `/root/ipppping-backup-20260923T113909206935Z`。

本地 72 项 Python unittest、4 项 Node 测试、Chrome 153 与 WebKit 26.5 浏览器
回归通过；Chrome axe 无违反项。公网 Chrome 153 于 2026-09-23 11:39 UTC
核对两个 HTML 与八个指纹资源，并通过真实结果、PNG、Chart Trial、侧栏时间及
多 Fixed 验证。桌面五列五项数值均 18px；390px 窄屏 CURRENT 为 32px、其余四项
16px；无横向溢出，窄屏分隔线与右侧文字边缘误差 0px。结果卡状态元素数为 0、
状态文案匹配为 false。服务 `ipppping` 健康，安装后 NRestarts 为 0。结果报告和
截图位于 Git 忽略的 `test-results/production-p2p3/`；节点配置、采样、凭据及 RRD
未改动。Cloudflare 注入的 inline/beacon CSP 事件仍被页面策略阻止，应用无页面错误。

## 验证证据

- 本地 Python 68 项、Node 请求状态 4 项、Chrome 构建产物主页面回归、
  Chrome P3 合成 RRD/真实 RRDtool fixture 测试通过；主页面 axe 自动检查无报告项。
  P2/P3 其他 WebKit 与 Android 实机证据见各自报告。用户取消低端机测试要求。
- 公网 Chrome 153 自动化检查：两个 HTML 的源站内容与 manifest 对应，八个
  指纹资源逐字节校验通过，旧 `/static/app.js` 仍可访问。Cloudflare 在公网
  HTML 注入脚本，使公网原始 HTML 哈希不同；剔除该注入后才与源站制品比较。
- 主页面选 Halo Akari JP 与 Google DNS：两张卡片分别显示 `Ext v4`、
  `Ext v6`；无横向溢出。五个 `.stat-value` 字号在桌面均为 18px、
  390px 移动视口均为 16px；卡片/控制组边框为 0，原生 checkbox
  采用视觉裁切但仍可由标签及键盘选择。两张公网真实 PNG 正常加载。
- 独立试用页：v2 契约、180 个区间及真实摘要可读取；Canvas 单实例绘制、
  PNG 对照入口及移动视口均通过。公网生产冒烟结果、截图存于 Git 忽略的
  `test-results/production-p2p3/`，可用
  `node tests/production-p2p3-smoke.cjs` 重新低频核验。
- 本机 Chrome 扩展控制的真实标签页再次手动选取同一组节点，结果和图表
  均可用；v4/v6 PNG 的 `naturalWidth` 均为 1980，十个数值的计算字号
  均为 18px，页面宽度等于 1440px 视口宽度。
- 发布后 `ipppping` systemd 服务为 active，`NRestarts=0`；SmokePing
  采样运行在名为 `smokeping` 的 Docker 容器中。公网 `state=p1`
  双栈批量接口均返回 `measurement_state=measured`，测量时间处于
  `stale_after_seconds=600` 新鲜窗口内。

公网自动化记录的四次 CSP 事件只对应 Cloudflare 动态注入的内联脚本和
`static.cloudflareinsights.com` beacon，被应用 CSP 阻止；应用页面无未捕获错误。
不能将该结果表述成“公网零 CSP 事件”，也不能据此证明所有浏览器/运营商链路
均无问题。

## 尚未关闭

G2 的 Firefox/Safari、屏幕阅读器、真实浏览器缩放与长期生产观察；G3 的
公网同场景完整成本比较、60 分钟与多实例稳定性；G4 全矩阵 Canvas 资源上限；
G5 默认迁移、24–48 小时观察及回滚演练仍未完成。现在的发布是隔离试用，
不是整个 P2–P5 升级计划的完成证明，也不宣称手机 CPU/内存或公网延迟已有
确定百分比的改善。
