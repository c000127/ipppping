# Charts 离屏保留 — 2026-10-02

用户要求 Charts 图表滚出可视范围后不再消失。本轮已仅前端发布；不修改
节点、采样、RRD、API 或服务配置。时间为 Asia/Singapore。

## 行为

- 已完成绘制的图表离屏后，保留包含坐标轴、延迟和丢包标记的本地无损 PNG
  预览，不回到空白/“Chart loads when visible”。没有调用 PNG API。
- 回到视口恢复共享 Canvas；命中现有序列缓存时不再请求数据。首次加载仍按需，
  不因保留预览而一次请求整个矩阵。缓存淘汰后的按需重取规则不变。
- 同时最多四个活跃/池化 Canvas、两路并发 series，原像素预算和 16 项/2 MiB
  序列缓存不变。预览按当前最多 500 路查询保留，**增加的压缩图像及浏览器解码
  内存并不包含在原序列缓存预算中**；不能把历史长测结论直接用于这个新策略。
- 更换查询、过滤或统一坐标轴，以及离开/隐藏 Charts 时清理旧预览，防止旧数据
  或旧坐标轴混入新状态。预览不会代替真实的 interval 数据。
- 仅保存已经完成绘制的 Canvas，避免保存 uPlot 的默认空画布或前一条复用链路。

## 验证

- 本机安装的 Chrome：主页面 480 路、矩阵 480/499 路、移动/高 DPR、模式切换、
  故障和竞态回归通过；新增离屏图片与原 Canvas 编码逐像素一致断言。
- 三个入口的 UI surface/Fixed 回归通过，101 项 Python 测试通过（包括 OpenSSL
  测试，无跳过）；没有重新执行或改写历史一小时观察。
- 公网 Chrome 在 23:37:54 验证三个节点、8 路结果：1 次 summary、6 次按需 series，
  滚回缓存图表无新增请求，没有旧 stats/PNG 请求或页面异常。10 个实际加载资源
  的 SHA-256 与清单一致；3 张已离屏预览的编码字符串估算为 134,500 字节，
  **不是浏览器完整内存测量**。
- Cloudflare 在 HTML 末尾追加 beacon/challenge。初次整页哈希断言因此失败；
  调查确认应用 HTML 未变。修正专用公网检查为精确匹配整个应用 HTML 前后段，
  只识别该已知 CDN 后缀，同时仍严格核对每个实际加载资源。源站 HTML 由安装器
  完整逐字节核验。未改变 Cloudflare 或 CSP。

## 制品与回退

- 本机构建：`build/web-release-retained-charts`，Canvas 默认，显式 PNG 入口保留。
- manifest SHA-256：`0506e031147cd6724758fbda62231d881bea9db4fc970e25284513964069f3ed`。
- 首页 SHA-256：`1da0627a675684a3b28bd49e610147bb7ec194edc2e979cdfc8af3c0a9f8598b`。
- 发布 staging：`/root/ipppping-stage-retained-charts-lXyWvf`。
- 23:34:52 由 `install-api.py --frontend-only` 安装，自动回退备份：
  `/root/ipppping-backup-20261002T153452162913Z`。保留旧指纹资源，不破坏已有标签页。
- API 发布前后 PID 4089341、NRestarts 0、启动单调时间均一致，没有重启 API。

如需回退，只恢复该备份中原有前端页面/许可证，保留新旧哈希资源；不要拿当前
runtime 不匹配的历史 staging 绕过仅前端安装检查，也不要恢复 RRD 或重启采集器。

可复验：`tests/main-canvas-browser.cjs`、`tests/chart-matrix-browser.cjs`
（`BROWSER_CHANNEL=chrome`）、`tests/ui-surfaces-browser.cjs`。
专用公网脚本 `tests/retained-charts-public.cjs` 需显式设置
`CHART_RETENTION_PUBLIC_PASS=1`、`IPPPPING_SITE`、恰好三个节点的
`CHART_RETENTION_NODES` 和对应 `TEST_RELEASE_ROOT`；不允许用它施压全矩阵。
