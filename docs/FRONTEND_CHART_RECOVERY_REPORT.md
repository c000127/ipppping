# 主站 Charts 显示与恢复修正 — 2026-10-03

范围：主站选择多个节点后的 Charts，共享矩阵渲染器；仅前端发布。
时间为 Asia/Singapore。没有修改节点、采样、RRD、缓存或 API 服务。

## 根因与行为

1. 旧 PNG 样式 `.card-img img { opacity: 0 }` 同样作用于本地预览，
   导致图片虽加载成功却不可见。预览现在明确 `opacity: 1`。
2. 最近四条链路的固定优先级会饿死双列大视口中其余图表。现在优先补齐
   视口附近尚未绘制的图表，再保留本地无损画面并复用四个 Canvas。
   首次加载仍按需、并发 series 仍为二；不自动请求整个矩阵。
3. 公网只读复现：相同 source/target/type/end/dur，延迟合并补齐了窗口
   最后一个桶，覆盖率由 179/180 变为 180/180，均值也发生变化。
   冻结窗口不是服务器永久保存的不可变快照。原摘要一致性检查没有删掉：
   变化时提供 **Reload matrix**，以已展示的节点/Fixed/时长重新生成摘要
   和坐标轴；侧栏未提交的选择仍保留。网络错误提供 **Retry chart**。
   失败链路不随滚动无限自动请求，也不自动回退 PNG。
4. 同一快照的过滤、列数变化与 resize 保留已生成图片；新查询、坐标轴
   切换、离开/隐藏 Charts 清理图片。预览内存仍单独计量，不属于 2 MiB
   序列缓存预算；本次不声称通过新的长期容量验收。

## 验证与纠正过程

- 新增 `tests/chart-recovery-browser.cjs`：真实 Chrome + 本地可控传输，
  双列 >4 可见图、滚动/resize 保留、错误重试、摘要变化重建、保留草稿，
  同时断言预览 computed opacity/visibility。
- 主页面 480 路、独立矩阵 480/499 路、高 DPR/移动/动效/竞态、三个
  UI surface 回归通过；query-handoff 与旧前端本地回归通过。
- 最初新增测试的 1440px 窗口实际为单列；改为 1800px 并明确断言列数。
- 第一版修正 `f1ac36f54010dcb8dcd22589097be68a982f8707ea21173c233df68b4388fe4a`
  发布后，公网截图仍见预览空白，才发现 opacity 继承。图片解码/像素匹配
  不等于实际显示，已补充断言并重新构建发布；没有把旧验证冒充完整成功。
- 公网检测需等待近视口整批图片就绪，而不只等短暂的 pending=0；否则
  滚回时尚未首次加载的图被误判为“缓存重取”。原无重取断言保持不变。

## 当前制品

- `build/web-release-chart-recovery`，Canvas 默认。
- manifest SHA-256：`ef480cf18a2d134bd7cac2e2f755bd67dc5ec92dd30aa0c3607fd5c37c0987aa`。
- 04:02:44 最终仅前端安装，stage：`/root/ipppping-stage-chart-recovery-EMfs2r`。
  本次直接备份（中间版本）：`/root/ipppping-backup-20261002T200244214980Z`。
  两次安装前后 API 均为 PID 4089341、NRestarts 0、
  ExecMainStartTimestampMonotonic 379539374207；旧指纹资源保留。
- 04:04:26 最终公网 Chrome：三个节点、12 路，1 次摘要 / 12 次序列；
  双列 >4 可见图均绘制，预览 computed opacity=1 / visibility=visible，
  截图人工确认下方原空白图表可见。10 个实际加载资源指纹全部匹配，
  离屏保留逐像素一致，滚回缓存无新请求，无 PNG/旧 stats 请求及页面错误。
  12 张预览编码字符串估算 440,736 字节，**不是浏览器完整内存测量**。
- 首次中间版本回退备份：`/root/ipppping-backup-20261002T195918106403Z`，
  其中保存本轮修复前的旧前端。仅恢复前端页面/许可证并保留哈希资源，
  不恢复 RRD、不重启 API。

复验入口：`tests/chart-recovery-browser.cjs`、`tests/main-canvas-browser.cjs`、
`tests/chart-matrix-browser.cjs`、`tests/ui-surfaces-browser.cjs`；
`TEST_RELEASE_ROOT=build/web-release-chart-recovery`，Chrome channel chrome。
公网 `tests/retained-charts-public.cjs` 必须显式授权且限制三个节点，不能
替代全矩阵容量测试。最终需要刷新已打开的旧标签页才能获取新 HTML/资源。
