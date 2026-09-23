# P2：组件、样式与静态资源治理

日期：2026-09-22，复核于 2026-09-23。状态：**P2 主页面已于 2026-09-23 发布；当时工作树尚未提交或推送，后续仓库同步见公网发布记录**。
下文的本地测试数字和当时的“未上线”表述保留为历史实验记录；实际发布范围、制品、生产验收与回滚位置见 [公网发布记录](FRONTEND_PUBLIC_RELEASE.md)。

后续说明：P3 已扩展本地构建/安装器，当前工作树制品不再是纯 P2 包。
本报告的四资源/51 测试数字记录 P2 当时状态；最新制品与额外依赖见
[P3 报告](FRONTEND_P3_REPORT.md)，不要按下文历史文件清单漏传新增模块。

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

公网真实数据 PNG、Chrome 主流程及移动断点已复核。用户取消低端机测试要求；
Firefox/Safari、屏幕阅读器、实际缩放及人工对比度/可访问性仍未全部验收，
不声称 G2 的全部人工验收已关闭。尚未完成长时间生产观察；发布未修改采样、
节点、密钥或 RRD 数据。

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

## 发布与回滚约束（已执行；后续发布继续遵循）

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
