# P2：组件、样式与静态资源治理

日期：2026-09-22，复核于 2026-09-23。状态：**P2 主页面已于 2026-09-23 发布；当时工作树尚未提交或推送，后续仓库同步见公网发布记录**。
下文的本地测试数字和当时的“未上线”表述保留为历史实验记录；实际发布范围、制品、生产验收与回滚位置见 [公网发布记录](FRONTEND_PUBLIC_RELEASE.md)。

后续说明：P3/P4 已扩展本地构建/安装器，共享 Canvas 已成为主页面默认。
本报告的四资源/51 测试数字记录 P2 当时状态；最新制品与额外依赖见
[收尾索引](FRONTEND_UPGRADE_CLOSEOUT.md)及[部署指南](DEPLOYMENT.md)，
不要按下文历史文件清单漏传新增模块或把默认 PNG 构建当成生产 Canvas。

## 范围与实现

- `web/ui-components.js` 管理抽屉、统计 DOM、卡片索引与动画反馈；
  `app.js` 继续拥有查询、配对及测量状态；`request-state.js` 继续管理请求。
- 每次协调建立一次卡片 Map，预留尚未处理的精确匹配卡片，避免位置复用抢占；
  统计更新保留数字节点，Results/Charts 切换保留统计块。
- 移除逐卡文字缩放测量和通过 `offsetWidth` 重启动画；布局动画批量测量，
  删除卡片不再逐卡重新扫描并测量全网格。减少动态效果偏好同时约束 CSS 与 JS 动画。
- CSS 收敛到 token、组件及显式容器断点；保留深色卡片、侧栏、手动提交、
  Pairing/Fixed、Results/Charts、统一 Y 轴、Ext 与 v4/v6 标签。
  窄屏通过重排统计项和换行展示长名称，不靠将文字缩到难以阅读来适配。
- 原生 checkbox 与独立 Fix 按钮消除键盘事件冲突；关闭抽屉不可聚焦，
  移动端背景 inert、焦点约束、Escape 返回切换按钮，断点切换同步状态。
- 提交按钮跟随待提交模式；Results 隐藏图表轴控件；未应用选择有明确文字提示。
- `build_web.py` 使用 Python 标准库生成 4 个内容指纹资源及校验清单，
  统一文本换行保证跨平台构建稳定。不引入框架、图表库或生产 Node 服务。

这不是像素不变的整理：窄屏统计布局、宽屏字号及原生 checkbox 在当时有可见变化；
最终上线版按用户要求将 checkbox 视觉隐藏，语义和键盘操作仍保留。
保留的是产品信息与工作流，视觉样式采用统一规则。Canvas/序列 API 属于 P3，未提前实施。

## 体积和性能证据

比较仓库 P1 HEAD `0e58750` 与本次工作树，单位为字节：

| 资源 | P1 原始 / gzip | P2 原始 / gzip |
| --- | ---: | ---: |
| CSS | 79,149 / 11,499 | 13,324 / 3,495 |
| app.js | 53,075 / 14,199 | 47,195 / 12,893 |
| request-state.js | 3,286 / 1,234 | 3,286 / 1,234 |
| 新 UI 组件 | — | 5,941 / 2,103 |

CSS 原始体积减少约 83%；JS 分模块后 gzip 合计略增，而非声称所有资源都变小。
这里 gzip 是开发机估算，Python 服务本身不提供压缩，不等同实际公网传输字节。
字体实际加载 Regular/Bold 两个文件，共 186,752 字节，低于 200 KiB；
历史字体保留供旧客户端使用，但新 CSS 不再请求它们。

固定 40 ms 模拟网络、30 次刷新：中位约 81.3 ms，P95 约 82.4 ms。
结果与 P1 同量级；不能由此声称显著提速、生产 CWV 合格或 CPU/内存降低某个比例。
480 卡片功能路径通过，共享请求并发上限仍为 4。

## 验证

- Python 51 项：原有 44 项及新增 7 项构建/安装/HTTP 检查。
- 请求状态 Node 测试 4 项。
- Chrome 153 / Windows：构建产物浏览器测试 16 组，包括原有错误与兼容路径，
  原生键盘选择、Fix 不误取消、抽屉焦点、统计节点身份、字体预算、
  320/390/768/1024/1440/1800 宽度、长名称、DPR 2 触屏模拟。
- 640×450 CSS 视口验证 1280×900 在 200% 浏览器缩放下的等效重排，
  **不是操作真实浏览器缩放菜单**。
- 保存 Results 六断点、Charts 三断点和窄高抽屉截图。Charts 使用 1×1 PNG
  fixture，证明加载与容器布局，不证明真实 RRD 图中文字/曲线的最终视觉质量。
- 已人工查看代表性的 390/1800 Results、1440 Charts 和缩放等效抽屉截图。

后续复核：Chrome 与 WebKit 的主流程自动化通过；两者构建页的 axe-core
WCAG 2.0–2.2 A/AA 扫描无报告项。使用主控 RRDtool 1.7.2 在隔离临时目录
生成真实 PNG，发现高尖峰时纵轴 SI 标签被原图左边缘裁切；调整服务端
`--units-length` 预留宽度后复核 320/900 像素原图。另发现纵轴范围探测
使用默认图宽而非最终输出宽度，可能使尖峰触顶；已统一探测与绘图尺寸，
在同一 24h 合成 RRD 上复核尖峰完整显示。未更改生产服务。
另以只读请求查看公开站点 `akari_jp → google_dns / v6` 的 346×260 PNG，
线上旧绘图也有纵轴数字左裁切；这证明问题不只发生在合成图。新规则随后
随本次制品上线，生产双栈 PNG 已加载；是否覆盖所有极端尖峰仍需继续观察。
WebKit 测试截图工具会自行注入样式并触发测试 CSP，故无 CSP 结论只针对
非截图流程。Firefox 在本机因进程启动策略拒绝而未测，未绕过策略。

2026-09-23 补做 Android 实机 Chrome 验证：PJE110、Android 16、Chrome 152，
物理 1264×2780、密度 560；页面实测 361 CSS px / DPR 3.5。通过 ADB reverse
访问电脑本地隔离构建及合成 RRD fixture，CDP 注入触摸事件（并非人工手指操作）。
移动抽屉、三节点选择、Results/Charts 切换和最后一张图表加载通过；8 张结果卡
含 4 个 Ext 与 4 个 v6 标签，Ext+协议标签组合在截图中完整可见，无横向溢出。
滚动后 8 张 PNG 全部加载。截图见忽略目录
`test-results/android-device/p2-{results,ext-tags,drawer,charts,chart-last}.png`，
机器可读结果见 `test-results/android-device/report.json`，逐项操作记录见
`test-results/android-device/operations.log`。这补上了一台实机的触控/布局证据，
不代表低端机、人工触摸或整个浏览器矩阵均已通过。

截至 2026-09-23，公网真实数据 PNG、Chrome 主流程及移动断点已复核。用户取消
低端机测试要求；当时 Firefox/Safari、屏幕阅读器、实际缩放及人工对比度/可访问性
仍未全部验收，故该时点不声称 G2 人工验收已关闭。尚未完成长时间生产观察；发布
未修改采样、节点、密钥或 RRD 数据。后续 G0/G2 状态见下方 2026-09-28 复验补记。

## 2026-09-28 Chrome G0/G2 复验补记

用户确认 G0/G2 的浏览器验收只要求 Chrome；Firefox/Safari 不再作为这两阶段的
通过条件。使用仓库构建版在 Windows Chrome 153.0.8010.53 复跑：构建与校验
通过；Python 72 项、Node 4 项、浏览器回归 17 组通过；axe WCAG 2.0–2.2
A/AA 自动审计为 0 项违规。浏览器场景使用模拟 API/测试数据，不是公网数据。
覆盖启动不预取、Ext/v4/v6 标签、键盘/抽屉、响应式、长名称、缩放等效视口、
Fixed 多选与动效、请求错误/过期/缺失/全丢包、竞态、超时、缓存及 480 卡片。
人工查看了 390px Results、1440px Charts 和窄视口抽屉截图；Charts 截图使用
测试 PNG fixture，不能作为线上真实曲线验收。缩放场景是 200% 等效 CSS 视口，
不是实际操作 Chrome 缩放菜单。

先前两次 Chrome 公网检查分别在 01:05:17、01:09:02 UTC 收到 Cloudflare 521。
随后查明主控重启后 Caddy 启动了发行版默认配置，实际站点/TLS 配置留在
`/root/smokeping/Caddyfile` 且 Caddy 用户无法读取；修复与备份位置见
[运维记录](FRONTEND_PUBLIC_RELEASE.md)。

2026-09-28 09:30–09:39 UTC+08 使用连接到真实 Chrome 的扩展标签复验生产站：
加载了 15 个 VPS 与 6 个外部目标，三个已移除节点未重现；新指纹资源为
`request-state.3ae7845d62246ad7.js`、`ui-components.78740c2f538b47f9.js`、
`app.e036d7b6d2eaa8be.js` 和 `styles.12df13fdd1e91a31.css`。主页面没有加载
Canvas/uPlot 运行时；4 张公网图表均以 1980×750 PNG 完整加载，Chrome 控制台
无 error。外部链路卡片同时显示 Ext 与 v4/v6；双 Fixed 加一个 Google DNS
目标产生 4 条链路，固定节点之间没有结果。Space 键可选中/取消节点；在
1380×687、DPR 1.5 视口下 `scrollWidth=innerWidth`，无横向溢出。1h/3h 时间窗、
未应用状态、Results/Charts 与统一纵轴开关均在生产 Chrome 中核验。

2026-09-28 09:42–09:47 UTC+08 按用户设置，在真实 Chrome 浏览器级 200% 缩放下
复核生产站。视口从 1380×687、DPR 1.5 变为 720×384、DPR 3；Results 与 Charts
模式下均显示完整的 4 条 Ext v4/v6 结果，卡片五项指标保持在视口内，Charts 的
4 张 PNG 均加载成功（缩放视口请求图像为 1532×630）。两种模式下文档宽度均等于
视口宽度，无横向溢出。移动抽屉占满视口，节点列表为独立纵向滚动区（60px 可视高、
998px 内容高），实际滚动后节点可见；底部模式/筛选/提交控件可见且可操作。验收后
已恢复 Charts 模式、原固定节点/筛选状态；Chrome 控制台 error 仍为 0。

因此 G0 公网核验与 G2 Chrome 验收通过。200% 时侧栏节点列表的可视高度较短，
但可独立纵向滚动；作为后续 UI 打磨观察项记录，不影响本次无横向溢出及交互验收。
当前 Chrome 对直接打开旧 `/static/app.js` 返回 `ERR_BLOCKED_BY_CLIENT`，所以本次
未重新验证旧资源路径；此前公网检查曾通过该路径，浏览器本地拦截不等于源站 404。
人工读屏复核未做（若用户仍要求）。本地 Python 72 项、Node 4 项、Chrome 17 组及
axe 0 项违规记录仍有效；公网长期观察属于后续稳定性工作，不是本次短时冒烟测试的
结论。详见[当前验收记录](FRONTEND_PUBLIC_RELEASE.md)。

## 构建与复现

在仓库根目录（Python 3、Node、Playwright 开发环境）执行：

```sh
python build_web.py
python -m unittest -q
node --test tests/request-state.test.cjs
BROWSER_CHANNEL=chrome TEST_BUILT_RELEASE=1 node tests/frontend-browser.cjs
FIXTURE_PNG=1 BROWSER_CHANNEL=chrome TEST_BUILT_RELEASE=1 node tests/frontend-browser.cjs
```

PowerShell 请使用 `$env:BROWSER_CHANNEL='chrome'`、`$env:TEST_BUILT_RELEASE='1'`，
并按环境设置 `NODE_PATH`。不设置 `TEST_BUILT_RELEASE` 可测试源码页面。
后一条需要先运行 [P3 隔离 RRDtool 实验](FRONTEND_P3_REPORT.md)生成 PNG。
生成物在 `build/web-release/`，浏览器报告和截图在
`test-results/p2-chromium/` 或 `test-results/p2-webkit/`，均不纳入 Git。

## 历史 P2 runtime 发布与回滚记录

下面记录当时含 runtime 变更的安装。当前前端独立发布须用部署指南的
五 runtime 字节一致检查及 `--frontend-only`，不沿用这里的 API 重启步骤。
旧客户端资源保留、指纹与回滚要求继续有效。

1. 在开发机完成上述构建及测试。将 `build_web.py`、`deploy/install-api.py`、
   `config.py`、`server.py`、`runtime.py`、`build/web-release/` 放入独立 staging 目录。
   校验并传输整套构建产物，不在生产重建，不上传节点凭据。
2. 经发布确认后，在主控执行 `python3 <staging>/deploy/install-api.py <staging>`。
   这是现有 `/opt/ipppping` 的升级工具，不是空机安装工具；要求既有字体存在。
3. 安装器先校验 manifest、依赖及不可变资源碰撞；备份服务文件和旧 HTML。
   先放入新指纹资源、替换服务文件并重启，通过 API 与所有静态资源逐字节健康检查，
   最后原子替换 HTML 并验证。异常恢复服务文件与 HTML 后重启。
4. 保留所有历史 `/static/app.js`、`styles.css`、`request-state.js` 和历史指纹文件，
   **不要用 P2 源码覆盖生产旧无指纹资源**。旧 HTML 没有 UIComponents 依赖，直接覆盖会破坏它。
   当前不自动清理历史资源；后续制定保留/清理策略时至少覆盖 7 天回滚窗口，
   并评估长期打开旧标签页的影响。
5. HTML 与无指纹资源使用 no-cache；指纹资源使用一年 immutable。
   发布验证应从线上 HTML 解析资源 URL 并比对构建清单，不能再将旧无指纹 app.js
   与最新源码逐字节比较，也不能直接复用写死 P1 URL 的生产验证脚本。
6. 发布后仍需检查反向代理/CDN 缓存策略、真实双栈/Ext 结果、图表及浏览器控制台。
   安装备份路径打印于执行结果；手动回滚恢复备份中的 runtime 与 HTML 后重启，
   保留新增指纹文件无害，不执行广泛删除。
