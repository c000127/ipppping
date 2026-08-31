# ipPping

Self-hosted SmokePing monitoring with a small Python API and a customized,
responsive web frontend. The frontend presents Results and Charts views for
IPv4, IPv6, and external checks, with current/average/min/max/loss statistics,
RRD-backed PNG graphs, retry handling, and optional unified chart axes.

This repository is a sanitized maintenance reference for the deployed system.
It intentionally contains no production IP addresses, SSH material, shared
secrets, RRD databases, logs, or live node inventory.

## Repository layout

```text
server.py                  HTTP API and static asset server
config.py, nodes.py, rrd.py Backend configuration, node validation, RRD lookup
web/                       Deployed frontend and locally served fonts
config/nodes.example.json  Safe node-schema example
deploy/                    systemd, Caddy, and SmokePing templates
docs/                      Architecture, deployment, operations, and recovery
```

## Runtime model

```text
SmokePing master/slaves -> RRD files -> ipPping API -> Caddy/TLS -> browser
                                      |
                                      +-- /api/nodes
                                      +-- /api/pairs
                                      +-- /api/stats[-batch]
                                      +-- /api/series
                                      +-- /api/graph.png
```

SmokePing is the collector and owns the RRD schema. `server.py` is a read-only
presentation API: it validates node pairs, invokes `rrdtool`, caches short-lived
results, and serves the files in `web/`. The API listens on loopback by default;
put a TLS reverse proxy in front of it.

## Pairing modes

The sidebar defaults to `All pairs`, which keeps the original many-to-many
selection behavior. `Fixed node` changes only the pair derivation: choose one
selected node as the fixed node and the application creates links between it
and every other selected node. Selecting exactly one other node therefore
produces a one-to-one view. Existing IPv4/IPv6, external-target, statistics,
chart, and layout rules are unchanged.

The same rule is available to API consumers with an optional `anchor` query
parameter on `/api/pairs` and `/api/stats-batch.json`:

```text
/api/pairs?nodes=probe_sg,probe_jp&anchor=probe_sg
```

The anchor must be one of the selected node IDs. Omitting it preserves the
default many-to-many behavior.

## Local development

Install `rrdtool` and Python 3. Run from the repository root:

```bash
python3 server.py
```

Then open `http://127.0.0.1:8082/`. Set `IPPPING_DATA_DIR` to a directory with
the expected RRD categories and provide a local node file:

```bash
cp config/nodes.example.json config/nodes.local.json
IPPPING_NODES_CONFIG=config/nodes.local.json \
IPPPING_DATA_DIR=/path/to/smokeping/data \
python3 server.py
```

Run the backend tests with:

```bash
python3 -m unittest -v
python3 -m py_compile server.py config.py nodes.py rrd.py
```

The tests that inspect real RRD contents require a SmokePing data directory and
`rrdtool`; production data must never be copied into this repository.

## Deployment

Read [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the complete sequence. The
short version is:

1. Deploy the SmokePing collector and expose its RRD directory to the API host.
2. Install this project at a fixed path and create a private `nodes.local.json`.
3. Install `deploy/systemd/ipppping.service` after reviewing its user and paths.
4. Configure a reverse proxy from a private listener to `127.0.0.1:8082`.
5. Verify `/healthz`, `/api/nodes`, a stats response, and a graph response.

Never put the real inventory, shared SmokePing secret, SSH key path, or reverse
proxy credentials in Git. Use the templates under `deploy/` and keep local
overrides outside version control.

## License notes

The application code has no project license declared by this repository yet.
The bundled JetBrains Mono and Smiley Sans font files retain their upstream
SIL Open Font License notices in `web/fonts/`.
