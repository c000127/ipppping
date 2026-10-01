# 2026-10-01：整页颜色统一、模块层级与 Fixed 控件

状态：仅前端发布完成，生产继续默认 Canvas、PNG 手动回退。
安装完成核验时间为 2026-10-01T04:27:36Z（新加坡 12:27:36）。
这是用户反馈后的视觉修订，不重开 2026-09-30 已完成的有限观察，
也不改写旧制品的长测结果。长期全矩阵容量仍是用户豁免项。

## 问题与实现

原 Canvas 成功提交时给 body 加 `.matrix-integrated-trial`，其样式
覆盖 page/sidebar/cards/text/badges/control 配色；Results 又移除该 class。
因此首次 Results、Canvas 和返回 Results 像不同主题；Canvas 卡片与
绘图区的近黑色又过于接近，不能只靠分隔线辨认模块。

现把公共 palette、圆角、标签及节点选中态收敛到 `styles.css`，Canvas
样式仅处理图表与动效，不覆盖全局底色。背景仍是近黑中性色，通过
工作区 → 导航 → 标题/数据卡 → 操作区 → 控件的明度阶梯建立层级。
画布底色单独下沉，突出上方指标。精确 token 见
[设计规则](FRONTEND_DESIGN_RULES.md)。不新增常驻边框、阴影或渐变底板，
保留结构分隔线和五列内部左对齐、Current+2×2 的既有字号/分割线规则。

节点名与 v4/v6 标签分层显示，Fixed 改为本地 SVG 图钉，保留一个固定
宽度的操作列。All/Fixed、Fix/Unfix 均不挤压名字或改变节点行高。
名字保持单行，真正过长时省略，完整 DOM 名称、原生悬停 title 和
可访问名称保留。按钮为桌面 32×32 / 移动 40×40，保持 `aria-pressed`、
全名动作提示、Space/Enter、多 Fixed 配对及 focus-visible；选择/取消
使用共用 160ms/2px 反馈，无回弹，reduced-motion 下无动画。

没有引入字体/图标库、页面级动画依赖或自动请求；没有改动数据契约、
统计口径、四实例/缓存/像素预算、探针、RRD 或服务端限额。
共享 `matrix-renderer.9c281a4998eb61a6.js` 与 matrix-data/uPlot 保持原字节。

## 验证

- 89 项 Python、28 项 Node 测试通过。
- Chrome 154.0.8037.59：主页面 480 路/15 页、部分失败/取消/清理/
  懒依赖/明细复用/移动 DPR 与 axe 通过；独立矩阵 480/499 路、设计、
  动效、表格/键盘/移动及 axe 通过；既有兼容页回归通过。
- 新 `tests/ui-surfaces-browser.cjs` 的三个入口全部通过：Canvas 主页面、
  显式 PNG、独立矩阵页。比较 Results→Charts→Results 的 CSS token 和
  公共模块 computed background/text color，验证六种独立背景层级、
  指标与画布的明度差、长名称/按钮几何、tooltip、键盘及 reduced-motion。
  1440px 桌面及 390px 移动截图已人工检查；名字不换行，按钮列不重排，
  页面不横向溢出，移动触控目标 ≥40px。
- 本地使用 JSON fixture 和专用极长标签；PNG fixture 仅验证真实图片
  加载流程及布局，不作为 RRDtool 内容/性能证据。新增脚本首轮发现
  fixture 不提供 PNG 路由，补齐测试图片后通过，没有为此改动产品逻辑。
- 公网同脚本用 `UI_PUBLIC_PASS=1`，三个入口均通过，13 个指纹资源
  SHA-256 正确，页面脚本错误 0。只选两个既有节点，真实 Results、
  Canvas 及 PNG 图片，使用原始生产清单，不注入长名称，不施压全矩阵。
  新旧客户端恢复资源继续保留。
- 未启动新一小时 soak 或观察；上述是此次 UI 回归和小规模上线核验，
  不称为新制品的长期容量/长测证据。原始失败和成功观察报告 SHA-256 不变。

本地 JSON/截图在 Git 忽略的 `test-results/ui-surfaces-local-20261001/`；
公网结果在 `test-results/ui-surfaces-public-20261001/`，均不提交私有输出。

## 发布、指纹与回退

构建使用独立 `build/web-release-ui-20261001`，不重建或覆盖原冻结制品。

| 项目 | 本次值 |
| --- | --- |
| Manifest SHA-256 | `6b629ceecfdfc543cda95ef536404194ecd3d3699cdabc1303da003d054aa46e` |
| 主 HTML SHA-256 | `66b85f230a6376a4f4555eec1e87bd560582720f2684f3a11d966973817e48ef` |
| CSS | `styles.59e2c2c47f6b29c0.css` / `chart-matrix-trial.5a0c6bcfc69fa6ef.css` |
| JS | `app.dfa24f600e5d4ce7.js` / `ui-components.1aaca8d721e8b4fb.js` / `chart-matrix-trial.af6a95dc798be7a7.js` |
| Staging | `/root/ipppping-stage-ui-20261001-FgwmZH0O` |
| 旧页面备份 | `/root/ipppping-backup-20261001T042736057994Z`，0700 |

仅传前端制品、builder 和安装器；staging 的五个 runtime 模块复用原已
验证 staging，并与 installed files 逐字节核对。生产 `server.py/config.py`
与仓库维护参考不同，未用仓库文件覆盖生产。`--frontend-only` 仍会拒绝
任何 runtime 不一致，不用 flag 绕过运行文件更新。
安装器校验 13 个资源、先放不可变资源最后激活 HTML，不写 runtime、不重启 API。
部署前后 MainPID=157219、NRestarts=0、启动时间 2026-09-29 09:00:48 UTC 不变。

若要回退本次视觉修订，使用原已验证 Canvas staging
`/root/ipppping-stage-main-cleanup-default-o2LWm9Zc` 与其自己的安装器，
确认 runtime 仍一致后执行 `--frontend-only`；它回到上次 Canvas 视觉而非
改变默认渲染模式。PNG staging、旧 hash/无指纹资源及所有回滚备份未删除。
回退仅在需要时执行，不为本次 UI 修订重复演练 default→PNG→default。

复现本地检查（有安装的 Chrome/Playwright 开发环境）：

```sh
python build_web.py --default-renderer canvas --output build/web-release-new-ui-candidate
TEST_RELEASE_ROOT=build/web-release-new-ui-candidate node tests/ui-surfaces-browser.cjs
TEST_RELEASE_ROOT=build/web-release-new-ui-candidate RUN_AXE=1 node tests/main-canvas-browser.cjs
TEST_RELEASE_ROOT=build/web-release-new-ui-candidate RUN_AXE=1 node tests/chart-matrix-browser.cjs
```

PowerShell 用 `$env:` 设置变量，并按开发环境设置 `NODE_PATH`。
公网开关仅用于已授权部署后的少量核验，不是持续监控或默认 CI。
