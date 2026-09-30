# Deployment

This documents the split deployment observed during the inventory: a
containerized SmokePing collector, a separate Python API, and a reverse proxy.
All hostnames, addresses, usernames, and secret values below are placeholders.

## Prerequisites

- Linux host with Python 3 and `rrdtool`.
- Docker Engine and Compose on the SmokePing host.
- A dedicated service account for the API with read access to the API RRD tree.
- A private node file and private SmokePing shared secret.
- A TLS-capable reverse proxy and a DNS record managed outside this repository.

Install the runtime packages using the distribution's package manager. The
container image supplies SmokePing and its probe dependencies; verify the image
version before production use instead of relying blindly on `latest`.

## Install Docker Engine on Debian

For Debian hosts, use Docker's official apt repository instructions rather than
the distribution's unofficial `docker.io` package. The supported release list
and the canonical commands are maintained in the [Docker Engine installation
guide for Debian](https://docs.docker.com/engine/install/debian/).

The repository-based installation sequence is:

```bash
# Remove packages that can conflict with Docker Engine from Docker's repository.
conflicts=$(dpkg-query --show --showformat='${binary:Package}\n' \
  docker.io docker-compose docker-doc docker-buildx podman-docker containerd runc \
  2>/dev/null || true)
if [ -n "$conflicts" ]; then
    sudo apt remove -y $conflicts
fi

sudo apt update
sudo apt install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/debian/gpg \
    -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/debian
Suites: $(. /etc/os-release && echo "$VERSION_CODENAME")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io \
    docker-buildx-plugin docker-compose-plugin

sudo systemctl enable --now docker
sudo systemctl status docker --no-pager
sudo docker run --rm hello-world
docker compose version
```

Docker's Debian guide warns that published container ports can bypass `ufw` or
`firewalld`; review the host firewall and place Docker-specific filtering in
the `DOCKER-USER` chain when required. Do not copy production secrets, node
inventories, SSH keys, or RRD data into this repository.

## Install the API

```bash
install -d -o ipppping -g ipppping /opt/ipppping
git clone https://github.com/c000127/ipppping.git /opt/ipppping
cp /opt/ipppping/config/nodes.example.json /opt/ipppping/config/nodes.local.json
chown ipppping:ipppping /opt/ipppping/config/nodes.local.json
chmod 640 /opt/ipppping/config/nodes.local.json
```

Edit the private node file and set `IPPPING_DATA_DIR` to the API-compatible RRD
tree. Do not put the real values in a tracked file.

Before installing the service, run:

```bash
cd /opt/ipppping
IPPPING_NODES_CONFIG=/opt/ipppping/config/nodes.local.json \
IPPPING_DATA_DIR=/srv/smokeping/data \
python3 -m unittest -v
python3 -m py_compile server.py config.py nodes.py rrd.py
```

## systemd

Review `deploy/systemd/ipppping.service`, especially `User`,
`IPPPING_DATA_DIR`, and `IPPPING_NODES_CONFIG`, then install it:

```bash
install -m 0644 deploy/systemd/ipppping.service /etc/systemd/system/ipppping.service
systemctl daemon-reload
systemctl enable --now ipppping.service
systemctl status ipppping.service --no-pager
curl --fail http://127.0.0.1:8082/healthz
```

The service should remain loopback-only. Do not bind it to all interfaces just
to make reverse-proxy debugging easier.

## SmokePing master

`deploy/smokeping/docker-compose.master.example.yml` captures the deployed
shape: host networking, a mounted config tree, a mounted RRD data tree, and
raw-network capabilities for FPing/TCPPing. Create the real configuration in a
private directory and replace the example bind mounts.

The collector configuration is split into `General`, `Probes`, `Database`,
`Presentation`, `Alerts`, `Slaves`, `Targets`, `pathnames`, and the private
shared-secret file. The supplied examples show the important directives:

- FPing for IPv4;
- FPing6 for IPv6;
- TCPPing with a target port for external TCP checks;
- 60-second sampling and 20 pings per step;
- separate IPv4, IPv6, and external target namespaces;
- 3-hour, 24-hour, and longer RRD consolidation tiers.

Start and validate the collector:

```bash
cd /srv/smokeping
docker compose config
docker compose up -d
docker compose ps
docker compose logs --tail=50 smokeping
```

Do not publish the collector's administrative HTTP port. If host networking is
used, explicitly verify listeners on the host after every image or override
change. The slave Apache override template is provided for installations where
the image would otherwise start its web server.

## SmokePing slaves

Use `deploy/smokeping/docker-compose.slave.example.yml` per slave, with a unique
`hostname` equal to the alias in the master `Slaves` file. Keep the master URL,
shared secret, SSH management data, and any access token in a private secret
store or untracked environment file.

For each slave:

```bash
mkdir -p /srv/smokeping-slave/config /srv/smokeping-slave/data
cd /srv/smokeping-slave
docker compose config
docker compose up -d
docker compose logs --tail=50 smokeping-slave
ss -H -lnt
```

The last command is a security check as well as a health check. A slave that is
intended only for probing must not expose an unexpected HTTP listener.

## Reverse proxy

For the production master, use `deploy/caddy/Caddyfile.master.example`. Install
it as `/etc/caddy/Caddyfile`, and install the origin certificate and private
key as `/etc/caddy/cloudflare-origin.crt` and
`/etc/caddy/cloudflare-origin.key`. Keep both credentials out of the repository;
make them readable by the `caddy` group only (for example, owner `root`, group
`caddy`, mode `0640`). The Caddyfile should use the same owner/group and mode.
The example routes the public site to the loopback API and permits only the
SmokePing upload endpoints on the collector hostname.

Install `deploy/systemd/caddy.service.d/10-recovery.conf` as
`/etc/systemd/system/caddy.service.d/10-recovery.conf`. It validates the
Caddyfile before start and restarts Caddy after an unexpected failure. Save the
existing Caddyfile before replacing it, validate before reload, and do not reboot
the host merely to apply this configuration.

Use `deploy/caddy/Caddyfile.example` as a starting point:

```text
monitor.example.invalid {
    reverse_proxy 127.0.0.1:8082
}
```

Replace the example site address with the real value only in the host's private
Caddy configuration. Validate before reload:

```bash
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
curl --fail https://monitor.example.invalid/healthz
```

For a generic deployment, replace the example site address with the real value
in the host's private Caddy configuration.

## Release checklist

For an existing fingerprinted deployment, build with `python build_web.py`,
stage the three HTML files, every asset referenced by `manifest.json`, the
license, the five runtime modules listed in `deploy/install-api.py`, and the
installer/build validator. Verify the manifest hash on both machines before
activation. Do not install private inventories or credentials from a release
archive. The target remains `/opt/ipppping`; the installer is not bootstrap.

For a strictly frontend-only change, use:

```bash
python3 /absolute/staging/deploy/install-api.py /absolute/staging --frontend-only
```

This mode rejects the release before mutation unless all five staged runtime
modules are byte-identical to the installed files. It writes no runtime file
and does not restart the API, but still checks API/assets and activates HTML
last, restoring old HTML if activation fails. Its 0700 backup contains only
pages/license, **not** runtime or RRD data. Omit this flag for a reviewed
API/runtime change; the original restart and full-runtime backup behavior
then applies. Never use the flag to bypass a required API upgrade.

After installation verify public asset hashes, one fresh probe, the main PNG
path and the opt-in path. Record the returned backup and keep old immutable
assets for existing tabs. A frontend rollback can reinstall a previously
verified staging release with this flag only if its runtime still matches;
otherwise use the reviewed paired API/frontend recovery procedure. See
[actual releases and rollback evidence](FRONTEND_PUBLIC_RELEASE.md).

### Main Canvas configuration and acceptance

The source/default `python build_web.py` remains conservatively PNG-configured.
Production uses the explicitly gated Canvas-default variant since 2026-09-30.
Prepare that variant with:

```bash
python -c "from build_web import build; build('web', 'build/web-release-main-default', default_renderer='canvas')"
```

Package that variant at the staging path `build/web-release`; do not silently
point the installer at a different build folder. The setting changes only
main HTML's `data-chart-renderer`; the 13 immutable assets match PNG.
Explicit `/?renderer=png` always wins; Results keeps its existing API.
No automatic query or PNG fallback occurs. Keep verified PNG staging and all
old assets for existing tabs.

Main-default G4 must test the actual configured build, normal visible drawing
and motion, 120-point full-matrix scrolling and the unchanged 60-minute gate.
An independent trial or interrupted run cannot substitute. The explicitly
opted-in `tests/production-main-rollout.cjs` verifies exact gate/stages,
default→PNG→default and old tabs; see the [main report](FRONTEND_MAIN_CANVAS_REPORT.md).

The first post-restoration observation failed and is retained. The user
explicitly authorized a new finite window with corrected health semantics.
That window completed at 15:17:50.682 UTC with five passing samples. Do not
rerun it, change its start, or redeploy. The following is the historical
command used once per scheduled pass, not an instruction to keep monitoring:

```powershell
$env:MAIN_OBSERVATION_PASS='1'
$env:NODE_PATH='C:/Users/chow/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'
$env:TEST_RELEASE_ROOT='build/web-release-main-default'
$env:OBSERVATION_REPORT='test-results/main-canvas-observation-health-v2.json'
$env:OBSERVATION_STARTED_AT='2026-09-30T14:15:56.093Z'
node tests/production-main-observe.cjs
```

Use installed Chrome and the project's test runtime. The script reads
production and writes only an ignored local report; it cannot deploy, restart,
delete, or touch nodes. Per the user's latest revision, its one-hour gate needs
≥5 passing baseline/15-minute samples spanning at least one actual hour in
distinct quarter-hour bins, baseline within 15 minutes and no gap over 30
minutes. `complete1h` is the verdict; two endpoints are insufficient. The
runner permits fewer than eight existing samples and no execution after two
hours. Stop and investigate failures; never reset timestamps or failed samples.
The original `test-results/main-canvas-observation.json` must stay byte-identical;
the new report binds its checksum and retains `releasedAt=2026-09-30T13:42:40.783Z`
separately from the authorized `startedAt`. The new report has `complete1h=true`,
independently confirmed by observation-state; follow-up is stopped. The samples
cover 61m54.232s with maximum gap 16m26.892s. Window-local current may legitimately be
null for newer raw input; the corrected assertion validates that contract
and one separate known v4 P1 raw-measurement read, keeping the original
300-second age/60-second future limits. It never invents timestamps or
substitutes an RRD write for a measurement. The deadline is 16:15:56.093 UTC;
do not query beyond it or reuse failed/completed windows. See the main report.

- Confirm the working tree contains no private node file, RRD, log, key, or
  secret.
- Run backend tests and syntax checks.
- Validate the service unit and reverse-proxy config.
- Check `/healthz` and `/api/nodes` locally.
- Check one v4 stats request, one v6 request for a dual-stack pair, and one PNG
  request after RRD data exists.
- Check a failed graph and the frontend retry action.
- Roll out the API before changing the collector schema; keep a restore copy of
  both service configuration and RRD data.
