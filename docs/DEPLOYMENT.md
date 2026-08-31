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

At the time of the repository inventory, the API service was active on a
loopback listener, while the visible local Caddy service configuration did not
contain an ipPping site block. Treat proxy routing as an environment-specific
dependency and confirm which Caddy instance, tunnel, or upstream owns the
public route before changing it.

## Release checklist

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
