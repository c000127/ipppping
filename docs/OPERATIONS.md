# Operations

## Routine checks

```bash
systemctl is-active ipppping.service
systemctl status ipppping.service --no-pager
journalctl -u ipppping.service -n 100 --no-pager
curl --fail http://127.0.0.1:8082/healthz
docker compose -f /srv/smokeping/docker-compose.yml ps
docker compose -f /srv/smokeping/docker-compose.yml logs --tail=50 smokeping
```

Inspect RRD freshness without copying the data into Git:

```bash
find /srv/smokeping/data -type f -name '*.rrd' -mmin -10 | head
rrdtool info /srv/smokeping/data/ICMPv4/example-target.rrd
```

The schema used by the current API expects `median` and `loss` data sources.
Confirm the actual schema before changing conversion logic. Loss is converted
to a percentage by the API according to the deployed RRD convention; do not
assume that another SmokePing schema uses the same scale.

## Safe application update

1. Record the current commit and service status.
2. Make a filesystem backup of the current application and private config.
3. Fetch the reviewed commit into a staging directory.
4. Run tests and syntax checks against the staging copy.
5. Keep `config/nodes.local.json` and the RRD path outside the Git checkout or
   restore them from the private deployment store.
6. Replace the application files atomically where practical.
7. Restart the API, then verify health, nodes, stats, and graph endpoints.

Example verification shape:

```bash
curl --fail http://127.0.0.1:8082/api/nodes
curl --fail 'http://127.0.0.1:8082/api/pairs?nodes=example-a,example-b'
curl --fail 'http://127.0.0.1:8082/api/stats?source=example-a&target=example-b&type=v4&dur=10800'
curl --fail -o /tmp/ipppping-check.png 'http://127.0.0.1:8082/api/graph.png?source=example-a&target=example-b&type=v4&dur=10800&w=900&h=320'
file /tmp/ipppping-check.png
```

## Configuration changes

SmokePing target changes require a coordinated rollout:

1. Edit the private inventory or target source.
2. Generate and validate `Targets` and `Slaves`.
3. Restart the master collector and inspect its logs.
4. Synchronize the changed master/slave relationship to every affected slave.
5. Wait for fresh samples and confirm RRD files are updated.
6. Update the private API node file if IDs or capabilities changed.
7. Restart the API only after the node file is valid.

Do not rename an ID casually. The ID is part of the RRD lookup contract.

## Backup and recovery

Back up these classes separately:

- SmokePing config and generated target files;
- shared secret and TLS credentials, stored encrypted and access-controlled;
- API private node inventory and systemd/reverse-proxy config;
- RRD data, using filesystem snapshots or a backup tool that preserves file
  ownership and timestamps.

Never make secrets part of the application archive. To recover, restore the
collector config and RRD tree first, then install the API and point
`IPPPING_DATA_DIR` at the restored export. Validate with `rrdtool info` and the
health/API checks before re-enabling public traffic.
