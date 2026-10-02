# 迁移、重装与灾难恢复

本文是恢复入口，不是生产环境的一键覆盖脚本。先在**新主机或隔离目录**验证，
再安排切换；不要在现有主控上执行恢复覆盖、重启演练或重新运行历史部署脚本。
公网仓库是经过脱敏的代码与模板，**仅 clone 仓库不能恢复现有服务**。

## 1. 什么必须另外保存

| 内容 | 当前部署位置/来源 | 恢复用途 |
| --- | --- | --- |
| 实际 API 与全部 web 资源 | `/opt/ipppping` | 恢复实际运行版本、字体、旧标签页引用的哈希资源 |
| 私有节点配置 | `/opt/ipppping/config/nodes.json` | 节点 ID、名称、协议能力；不是公开仓库的示例文件 |
| 主控 Compose、采样配置与认证 | `/root/smokeping/docker-compose.yml`、`config/` | 探测、主从关系、上传端点、共享认证、Apache 上传专用配置 |
| RRD 历史数据 | `/home/smokeping/data` | 从 XML 还原；目录及 ID 与 API 查找规则保持一致 |
| 反代、证书与私钥 | `/etc/caddy` | HTTPS、公网站点与旧版上传路由；全部按秘密处理 |
| 服务、timer、drop-in | `/etc/systemd/system/ipppping*`、Caddy/Docker drop-in | 开机恢复、健康核验、服务运行用户 |
| 从节点配置 | `/root/smokeping-slave`、恢复脚本与 timer | 各节点的实际镜像、环境变量、挂载、上传协议与探针 |
| 版本、镜像 digest、挂载及权限 | 加密包内 `metadata.json`、`manifest.json` | 对照安装依赖、固定镜像、重建所有者和权限 |
| SSH 访问、DNS/CDN、DDNS、域名账户 | 独立密码库/控制台 | **不在本工具备份范围**；务必单独保管 |

路径是实机基线；新装模板里的 `/srv/smokeping/data` 与 `nodes.local.json` 是
可选部署布局，不能和上述默认值混用。若改路径，必须同时核对 Compose 挂载、
API 的 `IPPPING_DATA_DIR` / `IPPPING_NODES_CONFIG`、freshness 检查和文件权限。
备份中包含 secret、环境变量、TLS 私钥、真实地址，**绝不能上传 Git 或公开附件**。
不采集 SSH 私钥，不恢复旧日志、缓存、旧的根目录配置生成脚本。

## 2. 准备离机加密密钥

工具使用 OpenSSL 3 CMS AES-256-GCM（认证加密），不是未认证的 `openssl enc`。
公钥证书用于加密；解密私钥只留在操作者机器，并另外离线保存。
证书的 CN 只是备份标识，不是网站证书。不要将备份与唯一私钥一起放在同一故障域。

Linux 操作者示例（选择一个全新的私有目录，禁止覆盖旧密钥）：

```bash
umask 077
mkdir recovery-keys recovery-backups
openssl req -x509 -newkey rsa:3072 -nodes \
  -keyout recovery-keys/recovery.key -out recovery-keys/recovery.crt \
  -days 3650 -subj /CN=ipppping-recovery
```

这里生成的文件私钥没有口令，以便可靠验证；依靠目录访问控制和离线保管。
如组织政策要求口令，应另行管理密码输入，不将口令写到命令行、脚本或 Git。
Windows 不能依靠 `chmod`：先给备份目录、密钥目录设置仅当前用户和 SYSTEM
可访问的 NTFS ACL，再生成文件。示例中的用户名需要替换：

```powershell
New-Item -ItemType Directory C:/PrivateRecovery, C:/PrivateRecoveryKeys
icacls C:/PrivateRecovery /inheritance:r /grant:r 'YOUR_USER:(OI)(CI)F' 'SYSTEM:(OI)(CI)F'
icacls C:/PrivateRecoveryKeys /inheritance:r /grant:r 'YOUR_USER:(OI)(CI)F' 'SYSTEM:(OI)(CI)F'
```

公钥证书、私钥及 OpenSSL 可执行文件位置要记录在私有交接材料中。
密钥轮换时保留能解密保留期内所有旧备份的旧私钥；不能仅备份新密钥。

## 3. 在线备份（不会重启服务）

在拥有 SSH 密钥的操作者机器执行。先独立核对并信任主机指纹，工具不会关闭
`StrictHostKeyChecking`，也不会向主控复制节点登录密钥。Python 需 3.11+，
OpenSSL 需 3.x 且支持 CMS GCM；服务器需要 Python、Docker，主控另需 rrdtool。

```bash
python deploy/recovery/capture.py capture \
  --host root@MASTER --port SSH_PORT --role master \
  --certificate /private/recovery.crt --output /private/master-DATE.cms
python deploy/recovery/capture.py verify \
  --archive /private/master-DATE.cms \
  --certificate /private/recovery.crt --key /private/recovery.key
```

若 OpenSSL 不在 PATH，在 `capture`/`verify` 子命令**之前**加
`--openssl /absolute/path/to/openssl`。Windows 使用安装的实际 Python，避免
WindowsApps 的占位启动器。输出只有大小、校验和与计数，不输出认证内容。

从节点用 `--role slave`；普通登录用户可加 `--sudo`，要求 `sudo -n` 已授权。
工具按实际 `smokeping-slave` 容器采集，不安装 Docker、不重新部署节点。
逐台或最多两台并行；低配节点不做全矩阵压力测试。

重要边界：

- 主控备份包括所有现存 RRD（可能含旧历史），**不是自动恢复这些节点的授权**。
- 备份清单可能含退役行。恢复部署目标必须取当前 API 节点与 SmokePing `Slaves`
  的交集并人工核对；CSV 不是独立的权威上线清单。
- 每个 RRD 在前后修改时间和 `last` 一致时导出，然后 restore 到临时目录，
  比较完整规范 XML 和最后更新时间。失败即整包失败，不略过失败文件。
- 这是不停机的**逐文件一致性**备份；不同文件的采样时点不同。严格全局时间点
  需要另行批准文件系统快照/停写窗口，不应伪称本工具提供。
- 配置在采集结束时再次校验；服务 PID、容器 ID/启动时间/重启次数变化会使
  备份失败。故障不会修改生产配置，但可能留下加密的 `.partial`，不得视作可用包。
- 不自动清理旧备份，不安装定时任务；先确认存放空间、周期、保留策略与离线副本。
- 不备份 Docker 镜像层、OS 镜像、DNS/CDN/DDNS 控制台配置。digest 不能保证
  镜像仓库永久可用；离线重装还需要单独 `docker image save` 并加密保存镜像。
- 当前工具面向表中的现有部署布局。新增 `EnvironmentFile`、外部证书目录、额外
  bind mount 或自定义服务时必须先扩展采集范围，不能将成功校验误认为覆盖新依赖。

## 4. 隔离解密与验证

`receivedAt`/`verifiedAt` 使用操作者机器 UTC 时钟；包内 `startedAt`/`completedAt`
来自被备份主机。发现主机时钟异常时，不能把它的时间当成可信备份新鲜度证明。
先保留原始记录，在交接清单明确偏差；不要修改历史数据时间戳掩盖问题。

`verify` 先完成 GCM 认证，再验证每个成员的 SHA-256、大小、元数据及完整清单。
拒绝绝对路径、`..`、链接、设备文件、重复成员和未知命名空间。
可选 `--stage` 必须指向**不存在的新目录**；不向 `/` 解包，不自动应用所有者，
不启动服务；所有解包文件保持私有。例：

```bash
python deploy/recovery/capture.py verify \
  --archive /private/master-DATE.cms \
  --certificate /private/recovery.crt --key /private/recovery.key \
  --stage /private/restore-review-DATE
```

解密暂存位于备份的私有父目录，成功或失败后自动删除临时明文。
显式 `--stage` 的审阅副本不会自动删除。清理时只删除核实过的该目录，保留加密包。
验证通过只证明加密包/文件完整及导出时的 RRD 往返一致，不等于新主机公网验收。
加密不等于发送者签名：公钥证书持有人也能制作新包。恢复前须从可信私有交接记录
核对包的 SHA-256 和来源，不能仅相信包内自带的 manifest。

在有 rrdtool 的隔离 Linux 环境，可将完整审阅目录交给恢复工具：

```bash
python3 deploy/recovery/restore_rrds.py \
  --stage /private/restore-review-DATE --output /private/restored-rrd-DATE
```

输出必须不存在；工具验证 XML 校验和、逐个还原并比较内容，不激活服务、不改
生产目录、不自动应用所有者。失败保留 `.restore-incomplete`，不得上线半成品。
完成后才按目标主机账号核对目录遍历/读写权限。跨版本 dump 规范差异需人工审阅，
不能为了通过而跳过数据校验。

## 5. 新主控恢复顺序与验收门槛

1. **冻结变更并核对材料。** 核对包校验和、完成时间、角色和 RRD 数量，记录
   预计 RPO（最后一次成功备份到故障的时间差），不要承诺零数据损失。
2. **准备独立主机。** 参照包内 OS、架构、包版本安装 Python、rrdtool、Caddy。
   Docker 按[官方 Debian 方案](https://docs.docker.com/engine/install/debian/)安装；
   新的无 Docker 主机可用 `deploy/smokeping/install-docker-debian.py`。
   不执行不明冲突包卸载，不自动升级其他服务。
3. **隔离恢复配置。** 核对 `metadata.json` 的容器 mounts、实际 Compose 文件
   路径/顺序、镜像 RepoDigests、环境和 unit。创建 `ipppping` 系统用户。
   从 `files/` 拷贝审阅后的实际 app、config、units、TLS，而不是整个覆盖系统。
   原 UID/GID 是核对依据，不机械照搬另一台主机的数字用户。共享认证文件通常
   0600；证书私钥只允许 Caddy 所需账号读取；可执行 runtime 脚本恢复 0755。
4. **还原历史数据。** 对 `rrd/**/*.rrd.xml` 调用 `rrdtool restore` 到全新数据树，
   去掉末尾 `.xml`，保持相对层级；拒绝覆盖已有 RRD。逐个核对 `rrdtool last`
   与 metadata 记录，并比较 dump。数据目录由实际容器 PUID/PGID 写入，API
   只读。确保目录可遍历；不要给 API root 权限解决权限错误。
5. **离线配置检查。** 用备份记录的**精确镜像 digest**，避免恢复时自动拉最新。
   `docker compose ... config --quiet`（不打印合并环境里的秘密）；运行
   SmokePing 配置检查及 `caddy validate`。保留主控 Apache 的上传专用覆盖，
   不能把接收 slave 上报所需的 CGI 也关闭。
6. **隔离 API。** 指向还原数据与节点文件，绑定 `127.0.0.1` 的临时端口。
   核验 `/healthz`、`/api/nodes`、少量 v4/v6/Ext summary/series 和 PNG 请求。
   HTTP 200 不足以证明测量健康：旧备份的历史数据应如实显示旧时间，不能改时间戳。
   保留实际已部署的 Canvas 默认 HTML、旧哈希资源、字体和显式 PNG 入口，
   不要以新构建覆盖实际发布版本。`install-api.py` 是**升级器，不是全新安装器**。
7. **切换主控。** 安排停写/交接窗口，保证同一套正式 RRD 不被新旧采集器同时
   写入；切换上传 URL/DNS/CDN/防火墙时保证主从认证和 TLS/SNI 相符。新地址需要
   修改探测目标，不是只改网页。保留旧主机/包供回退，禁止边切换边清理。
8. **验证真实运行。** 开机启用 Docker/API/Caddy/freshness timer，检查公网 HTTPS、
   上传认证、每类探针进程及实际新样本。节点双栈/DDNS 需分别检查 IPv4 A 记录、
   IPv6 地址/路由和 NAT 端口；SLAAC 前缀变化需同步 Targets 与私有清单。
9. **最后才做重启验收。** 在新环境维护窗口验证开机恢复与真实数据新鲜度；
   不以 `is-active` 或 RRD mtime 替代有效测量。记录实际耗时作为 RTO，不预设通过。

回退：保持旧配置、证书、数据和镜像完整，恢复 DNS/上传路由到原主控；避免两个
主控同时采集写入同一数据树。新主机验证失败不得覆盖旧机。迁移成功后再另行批准
旧机退役、凭据轮换与备份保留期清理。

## 6. 从节点重装

仅重装当前启用的节点。安装 Docker 后，恢复该节点自己的 Compose、`.env`、
探针/healthcheck/apache-disable 脚本、恢复 timer 和主控认证，不复制别人的 hostname
或 shared secret。参考备份中 Docker Compose labels 记录的实际文件顺序：
老部署可能是 base + `ipppping.override.yml`；新部署可能已合并入单个 base，
**不能给所有节点机械加同一个 override，也不能漏掉现有 override**。

`install-slave-runtime.py` 同样是现有容器升级工具，不是零基础安装器。恢复后
核对 IPv4-only/dual-stack 的 `IPPPING_REQUIRED_PROBES`，上报地址族兼容配置、
低配机器的 swap/zram、日志上限和恢复 timer。NAT/DDNS/SLAAC 由主机网络管理，
不要从备份覆盖 `/etc/network` 或把旧 IPv6 当永不变化的身份。

## 7. 持续维护

建议每次节点/证书/部署变更后做配置备份，按可接受 RPO 决定历史数据周期。
先保留至少一份已恢复验证的旧包，再加入新包；推荐至少三份副本、两种介质，
其中一份离线。定期在新环境重做恢复验收，尤其是镜像、RRD 架构、Compose 或
认证配置变更之后。当前没有自动设置周期或承诺异地灾备。

技术依据：[RRDtool dump/restore 可跨架构迁移](https://oss.oetiker.ch/rrdtool/doc/rrddump.en.html)、
[OpenSSL CMS 的 GCM 认证加密](https://docs.openssl.org/3.3/man1/openssl-cms/)。
