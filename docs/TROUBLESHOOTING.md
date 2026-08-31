# Troubleshooting

## Page is unavailable

Check the API locally before investigating DNS or TLS:

```bash
systemctl status ipppping.service --no-pager
curl -i http://127.0.0.1:8082/healthz
ss -lntp | grep 8082
```

If the API is healthy but the public page is not, inspect the actual reverse
proxy or tunnel that owns the public route. A local Caddy configuration may not
be the component serving the hostname.

## Nodes do not load

The API returns its validated node list from `IPPPING_NODES_CONFIG`. Check the
service environment and JSON syntax:

```bash
systemctl show ipppping.service -p Environment -p ExecStart
python3 -m json.tool /opt/ipppping/config/nodes.local.json
journalctl -u ipppping.service -n 100 --no-pager
```

Every node must have the six required fields, unique IDs, and a supported group.

## Stats or chart says no data

`no_data` means the derived RRD path does not exist. It is different from a
valid RRD whose latest probe samples are all lost. Check the category, target
basename, direction suffix, and permissions:

```bash
name='example-target'
find "$IPPPING_DATA_DIR" -type f -name "${name}*.rrd" -print
namei -l "$IPPPING_DATA_DIR"
rrdtool info "$IPPPING_DATA_DIR/ICMPv4/${name}.rrd"
```

For a 100% loss interval, a valid RRD can still produce a graph with loss and
unknown RTT samples. If the frontend reports `Graph unavailable`, inspect the
API log and call the graph endpoint directly. A missing file, unsupported data
source, malformed RRD, or `rrdtool` failure must be fixed at the data layer;
retrying cannot create missing history.

## Retry button appears ineffective

The frontend keeps the card frame and changes the image request token so the
browser does not reuse a failed cached image. Inspect the Network panel for a
new `/api/graph.png` request and the response status. If the request is new but
the response remains an error, use the backend error and `rrdtool` diagnostics.

## Graphs are slow

The batch stats endpoint avoids one initial round trip per card. Graph rendering
is bounded by `IPPPING_MAX_GRAPH_WORKERS`, and the frontend lazily loads visible
images. Check for an excessive node selection, slow `rrdtool graph` calls, or
an overloaded disk:

```bash
journalctl -u ipppping.service -f
time rrdtool graph /dev/null ...
iostat -xz 1 3
```

Do not raise the worker limit without measuring CPU, memory, and disk latency.

## IPv6 or TCPPing is missing

The API only creates IPv6 pairs when both nodes advertise `v6: true`. External
checks are represented as `group: dns` and normally use the v4 path. Confirm
that the private SmokePing target uses the expected probe, DNS name, and port,
then confirm fresh RRD files in the API-compatible category.

## Unexpected port exposure on a slave

Host networking makes container listeners host listeners. Check both the host
and container after any image update:

```bash
ss -H -lntp
docker exec smokeping-slave ss -H -lntp
docker inspect smokeping-slave
```

Use the supplied Apache-disable override only when it matches the container
image's service layout, and verify that SmokePing slave mode still starts.
