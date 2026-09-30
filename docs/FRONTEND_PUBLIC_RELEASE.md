# P2 主页面与 P3 独立试用页：公网发布记录

2026-09-30 最新候选：主页面 `/?renderer=canvas` 已接入与矩阵试用页
共用的 renderer，而不是跳转试用 HTML。默认 PNG 保留，依赖按提交
加载，运行模块/采样未改、API 未重启。当前指纹和回滚/验收记录见
[主页面候选报告](FRONTEND_MAIN_CANVAS_REPORT.md)。尚未默认切换，
24–48 小时默认生产观察也尚未开始。

2026-09-30 04:56 UTC：最终主页面默认制品长测停留在 23.5 分钟，
本机同期进入/退出待机；原 gate 拒绝不完整报告。有限自动跟进已暂停，
未执行默认切换。复核公网仍为 PNG，主控 API/Caddy 正常且 API 无重启。
详细证据及剩余步骤见上述主页面候选报告。

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
数值字号为其它指标的 1.66 倍。宽屏 Charts 仍是五列，不放大。

本次最终字号调整发布资源为 `styles.94695086f2c542c9.css`、
`app.8e4fc24c16c31d92.js`；主页面 SHA-256
`60e3625651b1b885fd0742e8c1a5609016caa3a84a68297202fc8d483c97b7fe`，试用页
SHA-256 `409ed961c5f626b27716159414e40e14703f90a098eb5f6dde5fe5ff38bb4458`。
传输包 SHA-256 为 `2501899784d5b289a6cd57eed35a1451210b25d3ebbc52f9dc09bcd3426f8cff`，
开发机与主控机一致。主控 staging 为 `/root/ipppping-stage-4AiT4f`，安装器自动备份
为 `/root/ipppping-backup-20260923T115403683074Z`。

本地 72 项 Python unittest、4 项 Node 测试、Chrome 153 与 WebKit 26.5 浏览器
回归通过；Chrome axe 无违反项。公网 Chrome 153 于 2026-09-23 11:54 UTC
核对两个 HTML 与八个指纹资源，并通过真实结果、PNG、Chart Trial、侧栏时间及
多 Fixed 验证。桌面五列五项数值均 18px；390px 窄屏 CURRENT 为 26.56px、其余四项
16px；无横向溢出，窄屏分隔线与右侧文字边缘误差 0px。结果卡状态元素数为 0、
状态文案匹配为 false。服务 `ipppping` 健康，安装后 NRestarts 为 0。结果报告和
截图位于 Git 忽略的 `test-results/production-p2p3/`；节点配置、采样、凭据及 RRD
未改动。Cloudflare 注入的 inline/beacon CSP 事件仍被页面策略阻止，应用无页面错误。

### 2026-09-23 CURRENT 数值与单位同行适配

在左侧 CURRENT + 右侧 2×2 布局中，数值和 `ms`/`μs` 固定同行。宽度不足时，
通过布局/数据更新后的测量按需缩小数值字号，单位保持 12px，并留出防止贴住
右侧分隔线的空间；宽度恢复后数值回到 1.66 倍基准。五列模式不变。

最终资源为 `styles.a83ed987ee4407d0.css`、`app.a24a3ce8cd38c69a.js`；主页面
SHA-256 `f2b758d5d4d5966aad1e8dec3d5d53f75c0d9d0a9bd8c00c9ffafe42edb00a56`，
试用页 SHA-256 `b428076f4368a620b2198e28d78863943f35e5ba489341aa1cc4c6c0c826bdf6`。
传输包 SHA-256 `048124b88c9639fb836a2fbf334ba077a7de0543421b4b113374582388d9ac72`，
开发机与主控机一致；staging `/root/ipppping-stage-gZ6Yoa`，自动备份
`/root/ipppping-backup-20260923T122138457978Z`。

Chrome 153 与 WebKit 26.5 多断点回归通过，Chrome axe 无违规；本地长数值场景
验证了字号收缩、同行和分隔线间距。公网 Chrome 153 于 12:22 UTC 核对两个 HTML
及八个指纹资源；移动实测数值/单位间隔 2px、无换行/溢出，单位距分隔线 46.1px。
结果卡状态提示仍为 0，应用无页面错误，生产服务 active 且 NRestarts 为 0。

### 2026-09-23 Fixed nodes 选择/取消动效

Fixed 节点按钮选中时短暂弹性强调，取消时柔和回收；按钮固定为 50px 宽，避免
`Fix`/`Fixed` 文案切换造成横向布局跳动。动效遵从系统 `prefers-reduced-motion`。

发布资源为 `styles.12df13fdd1e91a31.css` 与 `app.e036d7b6d2eaa8be.js`；主页面
SHA-256 `3617d0cf04b62daf4a00fc6eca7ce454190f6ec9e04b253f18276db4932d0bdf`，试用页
SHA-256 `91a78c5e3535343e46b5079b454cbd6152781e4ffba56a171ecb9b65cd5bee09`。传输包
SHA-256 `61cd7f81427bb5e1e0f687fe84e39cea254d08562ca6f720d35b5e95ce0a110f`，开发机与
主控一致；staging `/root/ipppping-stage-fixed-nodes-0df5821b`，自动备份
`/root/ipppping-backup-20260923T134453214317Z`。

72 项 Python、4 项 Node、Chrome 153 构建产物回归通过；公网 Chrome 153 于
13:45 UTC 核验两个页面及八个指纹资源，并实际验证选中/取消动效、按钮宽度稳定、
双 Fixed 结果、图表和移动布局，应用页面无未捕获错误。部署后 API 保持 21 个剩余
节点，三个已移除节点未重新出现；API 健康、SmokePing 容器运行中。

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

## 2026-09-28 验收与后续

### 2026-09-28 G0/G2 Chrome 复验

按用户确认，G0/G2 的浏览器验收只要求 Chrome，Firefox/Safari 不再作为这两阶段
的通过条件。Windows Chrome 153.0.8010.53 对最新构建版通过 17 组浏览器回归，
axe WCAG 2.0–2.2 A/AA 自动审计 0 项违规；Python 72 项与 Node 4 项通过。
本地回归的 API 使用模拟数据，不代表公网生产数据。

当日 01:05:17、01:09:02 UTC 的 Chrome 公网访问曾返回 Cloudflare 521。
根因是主控机重启后 Caddy 加载了发行版默认配置，而生产站点配置仍在
`/root/smokeping/Caddyfile`，Caddy 服务账户无法读取。现已将生产配置和受限权限
证书安装到 `/etc/caddy`，为 Caddy 增加启动前校验与失败重启 drop-in；旧配置备份在
`/root/smokeping/Caddyfile.before-recovery-20260928`。主机未再次重启。API、Docker、
Caddy enabled/active，SmokePing 容器持续运行；本机 HTTPS 反代健康检查和 Chrome
公网页面均已恢复。

2026-09-28 09:30–09:39 UTC+08 的真实 Chrome 扩展标签验收：生产清单加载为 15 个
VPS 节点、6 个外部目标；DataWave Akari DE、Polo DE、YXVM JP Vol 未重现。新 HTML
使用 `request-state.3ae7845d62246ad7.js`、`ui-components.78740c2f538b47f9.js`、
`app.e036d7b6d2eaa8be.js`、`styles.12df13fdd1e91a31.css`；主页面未载入 Canvas/uPlot
运行时。Halo Akari JP → Google DNS 的结果卡显示 Ext+v4、Ext+v6，当前值、统计和
单位正常；对应 4 张生产 PNG 均加载成功，原图为 1980×750，Chrome 控制台 error 为 0。
两个 Fixed 节点加一个非 Fixed 外部目标得到 4 条链路，仅有两个 Fixed 各自到 Google
DNS 的 v4/v6 结果，不产生 Fixed↔Fixed 结果。Space 键可选中/取消节点；All/Ext/v6
筛选、Results/Charts、统一纵轴、1h 查询与恢复 3h、未应用状态均已核验。当前视口
1380×687、DPR 1.5，文档宽度等于视口，无横向溢出。

2026-09-28 09:42–09:47 UTC+08，用户将真实 Chrome 缩放调至 200% 后完成最后复核：
布局视口为 720×384、DPR 3（100% 基线为 1380×687、DPR 1.5）。Results 与 Charts
模式下 4 条 Ext v4/v6 结果均可见，指标未横向挤出；4 张生产 PNG 均加载（缩放视口
图像为 1532×630），文档/主内容宽度均不超过视口。侧栏移动抽屉全宽显示，节点清单
在自身滚动区内可滚动，筛选、模式、提交和结果状态控件均可达。验收后恢复原 Charts
模式、固定节点与筛选状态；控制台没有 error。

因此 G0 公网验收与 G2 Chrome 验收通过。200% 下侧栏清单的可视高度较短（60px），
但列表可独立纵向滚动，记录为后续 UI 打磨观察项。当前直接打开旧 `/static/app.js`
被 Chrome 本地标记为 `ERR_BLOCKED_BY_CLIENT`，本次未重验该旧资源路径；此前公网检查
曾确认旧路径可访问，当前客户端拦截不代表源站 404。人工读屏复核未做（若仍要求）。

随后补完的单链路 G3 成本与稳定性见下节和 [P3 报告](FRONTEND_P3_REPORT.md)。
G4 全矩阵 Canvas 资源上限、G5 默认迁移、24–48 小时观察及回滚演练仍未完成。
该记录不代表整个 P2–P5 升级计划完成，也不宣称手机 CPU/内存或全站公网延迟
已有确定百分比的改善。

## 2026-09-28 G3 试用页 PNG 新鲜度修复

试用页重复提交后切到 PNG 对照时，浏览器可复用带长缓存头的旧 PNG。现每次提交
生成不同的 `refresh` 令牌，同一快照内 Canvas/PNG 往返沿用同一令牌。仅修改
`web/chart-trial.js` 的指纹资源和引用它的试用页 HTML；主页面 HTML SHA-256
仍为 `3617d0cf04b62daf4a00fc6eca7ce454190f6ec9e04b253f18276db4932d0bdf`，
主页面默认 PNG 路径未改变。

本地构建验证 8 项指纹资源；Python 74 项、主页面 Chrome 17 组浏览器回归、
试用页 Chrome 合成 RRD/压缩传输回归均通过。发布包 SHA-256
`f0b92bd4e8abaa0d3dfacf18f2129fb254b46e435503500a6858c293290f0104`，
主控 staging `/root/ipppping-stage-g3-CNwvsCAi` 校验一致。安装器于
02:34 UTC 成功发布并创建备份 `/root/ipppping-backup-20260928T023452206618Z`。
新试用页 HTML SHA-256 为
`04be375071b426c6cc9622fd5702c84cc8a790776713ed420b3e52f0b74af76b`，
新 JS 为 `chart-trial.ede65ab7e5d7ab13.js`；主控文件哈希与本地清单一致。
安装器健康检查通过，随后复查 API、Caddy、Docker 均 active，`/healthz`
返回 `ok`。历史资产与旧浏览器标签页所需文件未删除。公网 Chrome 30 次重复
提交得到 30 个不同 PNG 刷新令牌、30 次 HTTP 200，无页面异常；成本数字和边界
见 [P3 报告](FRONTEND_P3_REPORT.md)。

另修正只读 RRD 新鲜度定时检查：仅对 API 节点配置中的 14 台有效 slave 进行
核验，保留 SSH 库存中 3 台已退役机器的节点名/端口记录，不再把它们的旧 RRD
误判为现役故障；现役节点若缺库存行仍判失败。生产脚本先候选试跑、再备份旧版至
`/opt/ipppping/check_freshness.py.before-g3-20260928` 并安装；手动与下一次定时
执行均成功，39 项探测为 `ok`，未更改 RRD、库存或采样服务。

同日隔离 Chrome 长测完成 3,605 秒、676 次循环，GC 后 DOM 976、监听器 54
不变；启动后预热两分钟至结束的 JS 堆增长 475,344 B。改动后的最终构建另通过
10 分钟/112 次循环与进程内存抽样，未见持续增长。结合固定 RRD 正确性、既有
Android Chrome 实机操作及同路由公网成本，**单链路 G3 闸门通过**。此结论
只允许开始 P4 的有界研发；主页面仍使用 PNG，不表示 G4/G5 已通过。

## 2026-09-28 P4 独立矩阵试验入口

发布范围仅为新 `/api/v2/summary-batch` 和独立 `/chart-matrix-trial`，不改
主页面默认 PNG。安装前 81 项 Python、Node 分页契约、本地 Chrome 480 链路
滚动/固定节点/局部缺失、axe 自动检查和主页面 17 组回归通过；主控隔离
合成 RRD 的 480 路径基准及本地 Chrome 30 分钟生命周期记录见
[P4 报告](FRONTEND_P4_REPORT.md)。

本机构建清单 SHA-256 为
`3c1950db6120fbecfd57a1d27167fcd8406eb26a58fd872ae5b1b885cef07ca5`；
主控 staging `/root/ipppping-stage-p4-lOuc0l` 的清单及 `server.py` 均与本机
逐项哈希相同。`deploy/install-api.py` 在 06:47 UTC 安装并自动备份至
`/root/ipppping-backup-20260928T064702995808Z`。主页面 HTML 源文件 SHA-256
仍为 `3617d0cf04b62daf4a00fc6eca7ce454190f6ec9e04b253f18276db4932d0bdf`，
原单链路试用页仍为 `04be375071b426c6cc9622fd5702c84cc8a790776713ed420b3e52f0b74af76b`；
新增矩阵页为 `bb9265dd4d62bb43dcc6d18da64aafd1d820a96b3659a074fe5424161b8ac427`，
指纹 JS 为 `chart-matrix-trial.20292b49f589b5dc.js` 和
`matrix-data.75b822e655ccc6fc.js`。旧资源未删除，安装器保留了兼容回退。

安装后本地 API、Caddy、`/healthz` 均正常，`ipppping` 的 `NRestarts=0`，
freshness timer 下一轮执行成功。公网 Chrome 低速核验：
`akari_jp→google_dns` v4/v6 的两项摘要可获取，gzip 传输有效、v4 序列
与摘要峰值相等；两个 Fixed VPS 到 Google DNS 显示 4 个 Ext v4/v6 结果，
可见 Canvas 生成，无页面脚本错误。此核验不等于 G4 完整生产矩阵压测。
最终构建另完成本地 480 卡 10 分钟 Chrome 进程/GPU 内存抽样，未见 DOM、
监听器或 Canvas 积累；进程内存有波动，尚不足以代替 60 分钟和主页面集成后
的观察，详见 P4 报告。
Cloudflare 会在公网 HTML 尾部动态注入挑战脚本，公网整页哈希会变化；
主控源文件 SHA 和主页面指纹资产才是本次“不改默认页面”的校验依据。

若试验入口出现回归，先保留主页面 PNG 服务并停止使用该独立入口；
需要回退时依据上述自动备份恢复对应应用文件后重启 `ipppping`，不要碰
`config/nodes.json`、RRD 或节点密钥。尚未做破坏性回滚演练；G4/G5 未通过。

## 2026-09-28 P4 独立矩阵试验页视觉精修

只更新 `/chart-matrix-trial` 的 CSS/JS/HTML：三级暗色分层、Current 主指标、
共享置顶图例、弱化网格及青色 RTT / 紫色区间 / 珊瑚色丢包点。公网主页
仍默认 PNG，`/chart-trial` 与后端/节点采样逻辑不变；设计依据和模拟边界见
[P4 报告](FRONTEND_P4_REPORT.md)。

本机发布清单 SHA-256 为
`36f6b9b8097929b9dc53b15ed856a77e28885b2b8060f9f32ce62a46049eb132`；
主控 staging `/root/ipppping-stage-visual-VsPJfMRy` 的清单、矩阵 HTML、
新 CSS/JS 与本机逐项哈希一致，服务端五个运行文件亦与已安装版本一致。
沿用 `deploy/install-api.py` 发布，自动备份至
`/root/ipppping-backup-20260928T085004179798Z`。矩阵页 HTML 新哈希为
`e2435c5695e5d97a95f1f9e23ca6696858e9c02234adf83636c9681ea1d666bb`，
指纹资源为 `chart-matrix-trial.d5b661ee68c251e7.css`、
`chart-matrix-trial.4b51049b2ce2c168.js`。主页 HTML 仍为
`3617d0cf04b62daf4a00fc6eca7ce454190f6ec9e04b253f18276db4932d0bdf`，
单链路试用页仍为
`04be375071b426c6cc9622fd5702c84cc8a790776713ed420b3e52f0b74af76b`。

发布前 81 项 Python、Node 摘要契约、本地 Chrome 480 路模拟、axe 自动无障碍、
主页面 17 组回归及旧单链路试用页回归通过；最终视觉版本 60 秒滚动中
DOM/监听器/Canvas 上限恒定。发布后低速公网 Chrome 通过 2 路与双 Fixed 4 路
Ext v4/v6 核验、可见 Canvas 与主指标样式检查，无脚本异常；实机截图保存于
Git 忽略的 `test-results/p4-matrix-live.png`。主控 `ipppping`、Caddy、
freshness timer 均 active，`/healthz` 返回 `ok`，`NRestarts=0`。
保留旧资源与上述备份；本次视觉更新不是 G4 全矩阵生产负载通过证明。

## 2026-09-28 P4 试验页原站控件整合

仅更新独立 `/chart-matrix-trial` 的 HTML、CSS、JS，纳入主页面的顶栏、
节点选择、多 Fixed、协议筛选、Results/Charts、统一轴、两行状态和五指标卡；
图表不再出现随鼠标移动的十字虚线。Results 使用旧统计批量 API，Charts
使用有界 v2 Canvas；主页默认 PNG、单链路试用页及后端数据契约不变。
设计取舍及 G4 未完成项见 [P4 报告](FRONTEND_P4_REPORT.md)。

本机构建清单 SHA-256 为
`f3cdedd501e1919b1a97e674603ffc8bb30952b60a150d6f3430b88edc05a8fe`；
主控 staging `/root/ipppping-stage-integration-YQxmgT` 的清单、矩阵 HTML
与主页 HTML 逐项哈希相同。11 个资产均由安装器验证；新试验页指纹资源为
`chart-matrix-trial.e0aba646e13fc129.css` 和
`chart-matrix-trial.1fa6d701ae2328a3.js`。沿用带自动回滚的
`deploy/install-api.py` 发布，备份位于
`/root/ipppping-backup-20260928T110853829101Z`。发布后主页面 HTML SHA-256
保持 `3617d0cf04b62daf4a00fc6eca7ce454190f6ec9e04b253f18276db4932d0bdf`，
单链路试验页保持
`04be375071b426c6cc9622fd5702c84cc8a790776713ed420b3e52f0b74af76b`；
本页变为 `3b208c7f4eed8ec77b6d08a02f2386480db67740f8cb37158a3f03c550549d15`。

发布前 81 项 Python、Node 摘要契约、主页面 17 组 Chrome 回归、旧单链路
试验页回归以及整合页 480 模拟链路与 axe 自动检查通过。新整合版 60 秒
滚动的 DOM/监听器/Canvas 数量保持稳定，但 480 张完整卡片约 2.98 万个
DOM 节点仍须 G4 长测。发布后公网 Chrome 低速核验：
`akari_jp→google_dns` 的 v4/v6、Results→Charts、两个 Fixed VPS 到
Google DNS 的 4 条 Ext v4/v6 链路及可见 Canvas 均正常；主页面应用
指纹仍为 `app.e036d7b6d2eaa8be.js`，无脚本异常。`ipppping`、Caddy
均 active 且 `NRestarts=0`；未触碰节点列表、RRD 和采样服务。

## 2026-09-28 无边框与五列指标对齐修正

根据公网站点复核，恢复无常驻外框风格，保留指标内部分隔以及链路/指标/
图表之间的结构线；堆叠卡的链路/指标横线延伸到卡片两侧。主页面与试验页
共用的五列指标规则调整为标签/数值左对齐、整组居中，宽/窄 2×2 规则不变。
独立矩阵试验页的逐点须线及丢包圆环改为淡色区间带和细丢包竖条。
严格规则和回归断言见 [前端视觉不变量](FRONTEND_DESIGN_RULES.md)。

发布清单 SHA-256 为
`f4fc6f19bde25b04ea02f1e311eb9b0ab9228acdb9d0e0952a68ebd2eb11464a`；
主控 staging `/root/ipppping-stage-alignment-sikvBv` 的清单、主页面及
矩阵页 HTML 与本机构建逐项哈希相同。安装器自动备份于
`/root/ipppping-backup-20260928T113429865830Z`。新的共享样式为
`styles.d41cde42f0aa8bf5.css`，矩阵试验页资源为
`chart-matrix-trial.cb0b94f5373516e5.css` 和
`chart-matrix-trial.6a57bc7b53cd28d9.js`；应用脚本指纹
`app.e036d7b6d2eaa8be.js` 未变。主页面 HTML SHA-256 为
`3329562ba2d07fdf1edc1b221bafc2caf84312fafa65c7719e7c384931bf2af2`，
单链路试验页为 `0e6d099ffc5a651d1a54848a06313d5747c94faf2adedbc805fb23cf226642aa`，
矩阵试验页为 `7fbc38944aa9b309f37b34467fe68c692b8ee345ad1831e7bae9de08441f0972`。
后两页 HTML 哈希变化包含共享 CSS 指纹更新；单链路 JS/CSS 与主站 JS
逻辑未变，主页 Charts 仍默认 PNG。

发布前 81 项 Python、主页面源码及指纹构建的 Chrome 回归、独立矩阵
480 条模拟链路/axe、单链路试验回归均通过。新矩阵视觉版 60 秒/30 次
滚动中 DOM 29,850、监听器 55、Canvas 4 数量恒定。发布后低速公网
Chrome 对主页面两条 Results、两张 PNG 图、五列对齐/全宽分隔线和全部
11 个指纹资产哈希均通过；矩阵试验页两条 Google DNS 双栈及两个 Fixed
VPS 的 4 条链路可见 Canvas、无边框和对齐断言通过。页面无脚本错误，
`ipppping` 与 Caddy active、`NRestarts=0`。这不是 G4 长时间负载验收。

## 2026-09-28 矩阵试验页丢包渐变与完整中断区间

只更新独立 `/chart-matrix-trial` 的 HTML、CSS、JS：移除 Median range
图形与图例，丢包竖条及 Loss 数字改为按百分比的琥珀→橙→红梯度；
完整 100% 丢包区间铺满对应时间跨度和绘图区高度，混合区间的 100%
峰值仍保留细竖条。v2 数据字段、首页 PNG、`/chart-trial` 和采样服务
均未改动。语义及短时模拟结果见 [P4 报告](FRONTEND_P4_REPORT.md)。

本机构建及主控 staging `/root/ipppping-stage-loss-Yq1peC7N` 的清单
SHA-256 均为 `a4787fb40b1e54629eab9fad7d48a37d4bfc9e2725d891331b9b8d4da87485b7`；
安装器健康检查通过并自动备份于
`/root/ipppping-backup-20260928T115921547463Z`。矩阵资源指纹为
`chart-matrix-trial.5bc83f885132bb27.css` 与
`chart-matrix-trial.516d1aebfee28456.js`。主页面 HTML SHA-256 保持
`3329562ba2d07fdf1edc1b221bafc2caf84312fafa65c7719e7c384931bf2af2`，
单链路试验页保持 `0e6d099ffc5a651d1a54848a06313d5747c94faf2adedbc805fb23cf226642aa`，
矩阵页为 `1a00021b4f65d7da2d5a5b6ef7ec33fafbaabf1dc705262bdba53e21f94147b5`；
线上文件与本机构建逐项一致。

发布前 81 项 Python、矩阵契约、本地 Chrome 主页面源码/指纹版、单链路
试验页及矩阵 480 路/axe 回归均通过；25%、混合峰值 100% 和完整
100% 的模拟绘制几何均通过。矩阵 60 秒/30 次滚动未见资源计数增长或
脚本错误，但不等同 G4 长测。发布后低速公网 Chrome 验证矩阵两条
Google DNS 双栈链路、两 Fixed 到外部节点四条链路、可见 Canvas、
首页 Results/两张 PNG 图和 11 个指纹资源哈希，均通过。`ipppping`
与 Caddy active，`NRestarts=0`。

## 2026-09-28 丢包时间跨度全宽修正

根据进一步的视觉复核，独立 `/chart-matrix-trial` 取消图内丢包竖条的
琥珀→红渐变，统一使用珊瑚色；卡片 Loss 数值仍随百分比连续变色。
完整 100% 丢包区间不再呈现为淡色带加中心细条，而是直接填满该时间
区间的宽度和绘图区高度；相邻区间合并为无缝连续块。若整个查询窗口
均有 100% 丢包测量，绘图区横向全部覆盖；未知测量区间不涂色，混合
区间中的 100% 峰值仍只画细条。图例与 [视觉不变量](FRONTEND_DESIGN_RULES.md)
同步修正，首页 PNG 和单链路试验页未改。

本机构建与主控 staging `/root/ipppping-stage-lossspan-E3wVSGWC` 的
manifest SHA-256 均为
`f2666b6dd60b98a0085680e3ae4e5d1e230a3ed8c2a6bc1da836b43680ecb0fb`。
安装器自动备份至 `/root/ipppping-backup-20260928T122816445431Z`。
矩阵资源指纹为 `chart-matrix-trial.dc4201076df4074c.css` 与
`chart-matrix-trial.91a9e48df44993bd.js`；矩阵页 HTML SHA-256 为
`d10e474cd803be063b1ddb6e3f5157cfb68c304e3d487e50211dc2fc09ebfb42`。
首页和单链路页 HTML 哈希分别保持
`3329562ba2d07fdf1edc1b221bafc2caf84312fafa65c7719e7c384931bf2af2`、
`0e6d099ffc5a651d1a54848a06313d5747c94faf2adedbc805fb23cf226642aa`。

发布前 81 项 Python、Node 契约、主页面 Chrome 构建版、单链路试验及
矩阵 480 路/axe 回归均通过；10 个连续完整丢包桶的模拟仅产生一个
覆盖绘图区全宽的矩形。60 秒滚动资源计数稳定，无脚本错误，但 G4 长测
仍未完成。发布后公网低速 Chrome 验证两条 Google DNS 双栈链路、
多 Fixed 外部链路、固定色图例、首页两张 PNG 和全部 11 个指纹资源
哈希均通过；`ipppping` 与 Caddy active，`NRestarts=0`。

## 2026-09-28 混合丢包编码与块/条同色

独立 `/chart-matrix-trial` 将整块和细条统一为珊瑚色、`.65` 透明度，
消除旧版 `.5`/`.8` 合成后的色差。所有源桶均有丢包时，块的宽度表示
合并区间，块高表示平均丢包率；有更高峰值时细条从均值上缘延伸至
峰值。正常与丢包混杂、或含缺测的区间只显示窄峰值标记，不虚构精确
丢包时刻。图例和设计规则已同步；主页 PNG 与单链路试验页未改。

本机构建及主控 staging `/root/ipppping-stage-mixedloss-SFkeqg9v` 的
manifest SHA-256 均为
`028457d099fa3104e651417861bc7652f9684d755c82a8cedd29036d63596ad7`。
安装器健康检查通过，自动备份于
`/root/ipppping-backup-20260928T125142494371Z`。矩阵 CSS/JS 指纹分别为
`chart-matrix-trial.f79b6c0d67cacddc.css`、
`chart-matrix-trial.eca743f2d6c19cdf.js`；矩阵页 HTML SHA-256 为
`f432ac95c622ebcc02f5f528b67b06079447d77d6419a4d6e62d49427c87a9ae`。
首页与单链路页哈希仍为
`3329562ba2d07fdf1edc1b221bafc2caf84312fafa65c7719e7c384931bf2af2`、
`0e6d099ffc5a651d1a54848a06313d5747c94faf2adedbc805fb23cf226642aa`。

发布前 81 项 Python、矩阵契约、主页面 Chrome 构建版、单链路试验和
矩阵 480 路/axe 回归通过；模拟图同时覆盖正常、孤立、连续、混合峰值
与整窗 100% 丢包，色值/透明度及绘制范围断言通过。60 秒/30 次滚动中
DOM 29,849、监听器 55、Canvas 4 不增长，GC 后 heap 从 3.51 MB
至 3.74 MB，无脚本错误；这不是 G4 长测。发布后公网低速 Chrome
验证独立矩阵双栈链路、多 Fixed 外部链路、首页 Results/两张 PNG
和全部 11 个指纹资产，均通过。`ipppping`、Caddy active 且
`NRestarts=0`；线上页面及矩阵资源哈希与本地清单一致。

## 2026-09-29 独立矩阵页统一动效

仅更新 `/chart-matrix-trial` 的 HTML、CSS、JS：三个分段控件采用同一
180 ms 滑块；Fixed nodes、侧栏、Unified Y-axis 用短时无回弹动效。
Results/Charts 的 Show 提交期间保留旧结果，成功后只给视口内至多
六张卡片做 4 px、160 ms 入场。手动刷新且数值改变时，Current/Loss
可各触发一次 240 ms 微光。图表仅首次可见时对绘图区做 220 ms 水平
揭示，不反复绘制 Canvas。减弱动态效果关闭这些动画。行为规范与
手工验收口径见 [前端视觉不变量](FRONTEND_DESIGN_RULES.md)。主页面
PNG、单链路页、v2 API 和采样服务未改。

最终构建和主控 staging `/root/ipppping-stage-motion-final-mKEvoGf4` 的
manifest SHA-256 均为
`426f9fde82d1995e88ff69c4a1bab97ad9b6abe64c753f6a15582e4e112ef0f9`。
安装器健康检查通过，自动备份于
`/root/ipppping-backup-20260928T161508668413Z`（UTC）。矩阵 CSS/JS
指纹分别为 `chart-matrix-trial.cc0b27d397962e06.css` 和
`chart-matrix-trial.71dabdb65b46f3ce.js`，矩阵页 HTML SHA-256 为
`2139efeabd3b135e9915bd3352635e5944b8260e4e40b12239c49cf246682344`。
同日较早的初版已被最终版取代；若需回到本次动效改动前，较早安装
保留的备份为 `/root/ipppping-backup-20260928T161000525330Z`（UTC）。
首页和单链路页 HTML 哈希仍为
`3329562ba2d07fdf1edc1b221bafc2caf84312fafa65c7719e7c384931bf2af2`、
`0e6d099ffc5a651d1a54848a06313d5747c94faf2adedbc805fb23cf226642aa`。

发布前 81 项 Python、矩阵契约、本地 Chrome 主页面/单链路/矩阵
480 路与 axe 回归均通过；测试覆盖延迟与失败查询保留旧卡片、
数值变化脉冲、分段滑块对齐、绘图区揭示、后台中断恢复和 reduced
motion。60 秒/30 次滚动中 DOM 29,877、监听器 57、Canvas 4 数量
不增长，GC 后 JS heap 3.95→4.08 MB，无脚本错误；并非 G4 长测。
发布后低速公网 Chrome 验证双栈链路、多 Fixed 外部链路、滑块
180 ms 与 reduced motion 0 ms、首页 Results/两张 PNG 及全部 11 个
指纹资源，均通过。线上 HTML/矩阵资源哈希与清单一致；`ipppping`、
Caddy active，`NRestarts=0`。

## 2026-09-29 主站显式 Canvas 试用入口

用户已验收独立矩阵测试页。本次只在生产主站侧栏底部增加
“Try Canvas Charts” 入口，往返保留草稿节点、多个 Fixed、时间范围、
过滤及统一轴选择；均不自动提交查询。主站 Charts 默认仍用 PNG，
试验页的 Results 与 Canvas Charts 由用户手动 Show 加载。
同时增加严格的链接状态验证；失效节点或非法参数不被恢复。
新增资源 `query-handoff.js` 被构建为指纹文件，旧指纹资源保留。

构建和主控 staging `/root/ipppping-stage-handoff-reEh1taZ` 的
manifest SHA-256 均为
`b951944bb25fbf639dd7299f8cdfd500a608c8174ba31b21537f4faaaadb654c`。
安装器验证后备份至
`/root/ipppping-backup-20260928T164653244968Z`（UTC）。
首页、矩阵页 HTML SHA-256 分别为
`8b4daf2eb5ad5e9de0fbfefff9ddba3d1939c3efe3df31a2cac309df44420364`、
`6e3dcc3e9cb88a42de277654e6b4c6a8630cbbf2e7b60f183e3fafd467f703ed`；
主页面脚本 `app.b92c93ed00659b99.js`，矩阵脚本
`chart-matrix-trial.61f2e51454a1f3b7.js`。

发布前 Python 81 项、查询状态单测、主页面 Chrome（含 axe 0 项）、
480 卡 Chrome（含 axe 0 项）、原单链路及请求契约检查通过。
发布后 Chrome 校验首页 Results、两张 PNG、全部 12 个指纹资源、
入口往返 0 次矩阵请求、独立页双栈与多 Fixed 的 4 个外部结果
及 Canvas，均无脚本错误。安装后主控页面/服务端哈希对应本次
构建，`ipppping` 与 Caddy active、`NRestarts=0`、swap 0。
真实 477 路单次成本及尚未完成的 G4 长测见 [P4 报告](FRONTEND_P4_REPORT.md)；
此发布不是 G4 或 G5 默认迁移。

同日修正：试验页改变协议过滤或统一轴后，返回 PNG 的链接也立即
同步两项草稿选择。最终 staging 为
`/root/ipppping-stage-handoff-fix-1W5udt8z`，manifest SHA-256
`c08420895fd2b971e8f0d87742bfd2b4edd68590e4d6c5bfa7636e4aa067a992`，
矩阵页 HTML SHA-256
`abf87d59a4dce047f4bc2b896a3625f22ebc6676f60beb4f96a80c16815eaf73`，
新脚本为 `chart-matrix-trial.730b487120834cb4.js`；首页 HTML 与
`app.b92c93ed00659b99.js` 均未变。安装器再次健康检查通过，
自动备份 `/root/ipppping-backup-20260928T165523759957Z`。
本地 480 卡和主页面 Chrome 往返回归、Python 81 项通过，公网
再次验证过滤/统一轴往返与 Canvas、多 Fixed 链路，无脚本错误。
较早的 `/root/ipppping-backup-20260928T164653244968Z` 仍可用于
回到本轮显式入口之前。

## 2026-09-29 独立矩阵试用页实例复用

用户验收后继续优化试用页：滚动时最多复用 4 个 uPlot/Canvas 实例，
同一路由重复提交复用卡片，并修正取消的旧请求短暂清除新请求
`aria-busy` 的问题；序列缓存上限在 2 MiB 不变的条件下由 8 项增至
16 项。切至 Results、隐藏页面或离开页面时销毁空闲实例并释放背板。
不更改主站默认 PNG、服务端限流或节点配置。

本地 480/499 路 Chrome 功能、axe、主站内建发布包与 Python 81 项
回归通过。完整 60 分钟高频滚动的内存闸门**未通过**：
Chrome 渲染进程后 30 分钟约 +0.746 MiB/分钟，
末/前 15 分钟中位数差 +10 MiB，均超过预定门槛。
因此本次只更新已有的 opt-in 路径，**不批准 G4/G5，
不把 Canvas 设为默认**。完整测量与限制见 [P4 报告](FRONTEND_P4_REPORT.md)。

构建与 staging `/root/ipppping-stage-pool-oF7BW3bC` 的 manifest
SHA-256 均为
`be8b5fc3685564c274568cd618f6e0a6ead364ab87692219b57b83ea9418a62b`。
`deploy/install-api.py` 检验并安装后生成自动备份
`/root/ipppping-backup-20260929T090048046875Z`。
首页 HTML SHA-256 仍为
`8b4daf2eb5ad5e9de0fbfefff9ddba3d1939c3efe3df31a2cac309df44420364`；
矩阵页 HTML 为
`fcc5a6ccdcee1195d0aedb4082f9620011d0f3dcb8c9b16a1453ba5e6a392608`，
新矩阵脚本为 `chart-matrix-trial.5c45b1f1d5a49654.js`。

发布后低速公网 Chrome 验证双栈序列、多 Fixed 外部链路、
主站试用入口往返无自动矩阵请求、试用页 Canvas 与主站两张 PNG；
全部 12 个指纹资源哈希一致、无脚本错误。
`ipppping` 与 Caddy 均 active、`NRestarts=0`，备份存在。

## 2026-09-30 按需区间明细与无重启前端发布

仅更新矩阵试用页：图面点击/Enter/Space 打开当前卡片的原生明细
dialog，至多 120 行，展示区间均值中位 RTT、均值/峰值丢包及
缺测/全丢包桶数；关闭释放表格，焦点恢复不跳页。同时显式释放
已完成的 WAAPI 效果。主站无边框、五列指标内部左对齐、结构
分隔线、默认 PNG、节点、探针和上传配置均未改变。

构建及 staging `/root/ipppping-stage-motion-data-AV3fy5Sm`
的 manifest SHA-256 均为
`6813eb86bf17c0181295f1142e73620179cadc11ab9691409da93354aeba3b8b`。
矩阵脚本 `chart-matrix-trial.658684c78370ac48.js`，独立样式
`chart-matrix-trial.f64e0f8b8b6c3a8a.css`；矩阵 HTML SHA-256 为
`63bc5f3a7283797eac9102222d509b17f3934367a091f9b65746ae48b06f70f4`。
首页 HTML 仍为
`8b4daf2eb5ad5e9de0fbfefff9ddba3d1939c3efe3df31a2cac309df44420364`，
主页面脚本仍为 `app.b92c93ed00659b99.js`。

新增的安装器 `--frontend-only` 先比对全部五个 runtime 文件与
生产端逐字节一致，不写 runtime、不重启 API；仍检查指纹冲突、
依赖、API/静态资源可达性，HTML 最后切换，失败恢复旧 HTML。
原有完整 API/前端安装模式不变。新增三项安装/拒绝/故障回滚单测，
共 84 项 Python 测试通过；默认不将不一致 runtime 悄然忽略。

首次发布自动备份 `/root/ipppping-backup-20260930T003955604857Z`。
随后用新版安装器与已验证的旧 staging
`/root/ipppping-stage-pool-oF7BW3bC` 做真实试用版本回滚：公网
HTML 确认恢复旧 `5c45b1f1d5a49654` 脚本，首页仍 PNG、采样仍
新鲜，回滚前新页备份为 `/root/ipppping-backup-20260930T004106654866Z`。
再安装本次新 staging 恢复新页，最终安装备份为
`/root/ipppping-backup-20260930T004124096143Z`。所有备份为 0700，
保留新旧指纹资源。本轮备份仅含前端页面/许可证，不冒称完整
runtime 快照；此前完整备份继续保留。三次安装 API PID 均为
157219，启动时间均为 `2026-09-29 09:00:48 UTC`，NRestarts=0。
可用同一安装器、已验证旧 staging 和 `--frontend-only` 回退本轮，
不要将当前 runtime 未核对的历史 staging 用于仅前端回退。

发布前主页面、单链路、矩阵 480/499、节点选择不跳页、120 行
表格/键盘/移动与 axe 回归通过。公网 Chrome 两次验证 2/4 路
Canvas、多 Fixed、Ext/v4/v6、指示块及 reduced-motion：区间表
90 行，额外序列请求 0，Escape 后焦点/滚动不变，无脚本错误。
主站两张真实 PNG、旧五字段兼容和全部 12 个资源哈希通过；
API/Caddy active。多用户与内存证据见 [P4 报告](FRONTEND_P4_REPORT.md)。
这完成的是 **opt-in 试用版本回滚**，不是主页面默认 Canvas
迁移后的 G5 回滚/24–48 小时观察验收；G4/G5 默认迁移仍不放行。

本轮后续测量未改变已发布制品：相同 manifest 的两种无 Network
调试记录、正常 Canvas/动效的 Chrome 60 分钟内存测试全部通过
原门槛，其中 120 点逐段遍历实际覆盖 480/480 路。历史 Playwright
长测失败仍保留；对照证据表明测试记录贡献部分增长，不把差值
当成已证明的全部根因。三用户十分钟隔离读取与两用户各一次
477 路公网遍历也通过原预算/保护线。上述是本地内存与有限试用
子项，不是主页面默认 Canvas 上线或 G5 生产观察完成。
复现、精确数字和剩余接入边界见 [P4 报告](FRONTEND_P4_REPORT.md)。
