# Architecture

## Components

The deployed system has four logical layers:

1. SmokePing master collects probes and writes RRD files.
2. SmokePing slaves run probes from remote locations and return results to the
   master using the SmokePing slave protocol.
3. `server.py` reads the API-compatible RRD tree and exposes validated JSON and
   PNG endpoints.
4. A TLS reverse proxy publishes the web application; the browser loads the
   static files from `web/` and calls the API on the same origin.

The collector and presentation service are deliberately separate. Restarting
the web service does not restart SmokePing probes, and changing a frontend file
does not change collection configuration.

## Request flow

```text
browser
  GET /
  GET /static/index assets and fonts
  GET /api/nodes
  GET /api/pairs?nodes=...&anchor=id1[,id2...]
  GET /api/stats-batch.json?nodes=...&dur=...&anchor=id1[,id2...]
  GET /api/graph.png?source=...&target=...&type=...&dur=...
       |
       v
  ipPping HTTP service on a loopback listener
       |
       +-- validates IDs, protocol, duration and graph dimensions
       +-- resolves a safe RRD path from known node metadata
       +-- runs rrdtool under a bounded semaphore
       +-- uses short-lived caches keyed by RRD mtime and request shape
       v
  SmokePing-compatible RRD files
```

The browser uses `/api/stats-batch.json` for the initial Results summary and
loads chart images as they become visible. `server.py` also provides
`/api/series` for structured data, while `/api/graph.png` remains the current
PNG compatibility path.

## Node and pair rules

`nodes.py` validates a JSON list. Every item has `id`, `label`, `v4`, `v6`,
`group`, and `region`; the only supported groups are `vps` and `dns`.

For two VPS nodes, the API creates both directions for IPv4 and, when both
nodes are dual stack, both directions for IPv6. For a VPS and an external node,
it creates the supported external direction. DNS-to-DNS pairs are rejected.
The frontend may reorder dual-stack cards for a narrow one-column display, but
the API remains the authority for which pairs are valid. The default selection
mode is many-to-many. In fixed-node mode, each `anchor` ID is paired with each
selected non-fixed ID; fixed-to-fixed and non-fixed-to-non-fixed routes are
omitted. One fixed node plus one non-fixed node is the one-to-one case. Anchors
must be unique selected IDs, and omitting them preserves the default pair set.

## RRD lookup

The API derives the filename from validated IDs; request parameters are never
used as an arbitrary filesystem path:

```text
ICMPv4/<target>.rrd or ICMPv4/<target>~<source>.rrd
ICMPv6/<target>_v6.rrd or ICMPv6/<target>_v6~<source>.rrd
External/<target>.rrd or External/<target>~<source>.rrd
```

The exact directory names must match the API export/sync tree. The production
collector may use different internal names such as `ICMP_IPv4`, `ICMP_IPv6`,
and `TCP_IPv4`; do not point the API at that tree without checking the lookup
contract or updating the adapter deliberately.

## Frontend structure

The shipped frontend is intentionally framework-free. `web/app.js` owns
selection state, request cancellation, Results/Charts rendering, unified-axis
calculation, and image retry behavior. `web/ui-components.js` owns DOM helpers,
stable card reconciliation and focus-managed mobile navigation. `web/styles.css`
contains the responsive layout and animation rules. `web/index.html` is the
small shell served by the Python process. Production HTML references
content-fingerprinted assets; old non-fingerprinted assets remain available for
already-open clients.

In Fixed nodes mode, both the local pair preview and the API use the same
fixed-to-non-fixed cross-product. Multiple comma-separated fixed IDs are
accepted; fixed-to-fixed and non-fixed-to-non-fixed routes are omitted. The
sidebar footer uses natural height, while its selection/update status reserves
exactly two text rows. Charts options expand smoothly; drawer and control
transitions honor `prefers-reduced-motion`. The status time is the latest
`measurement_updated_at` among currently displayed results, shown as HH:mm
in the site's clock timezone. Ordinary measurements omit the per-card time
line; exceptional states remain visible on their cards.

The current visual contract is a dark, dense monitoring console:

- two columns at wide desktop widths;
- one compact horizontal card at narrow widths;
- route and protocol remain visible in every card;
- Current is the primary value, with Average, Min, Max, and Loss as supporting
  values;
- normal loss uses the same quiet text treatment as other secondary values,
  while non-zero loss uses the established warning color;
- chart frames keep their geometry during refresh so a node change does not
  cause a collapse/re-grow cycle.

## Service boundaries

### P2 and isolated P3 trial (deployed 2026-09-23)

P2 extracts DOM helpers and uses fingerprinted assets. P3 adds `series_contract.py`
and `series_v2.py`, plus `/api/v2/series`, `/api/v2/summary` and a separate
`/chart-trial` page. This does not replace the deployed matrix/PNG path.
See [v2 contract](SERIES_V2.md) and [P3 gate report](FRONTEND_P3_REPORT.md).
The trial uses the same total stats cache and RRDtool semaphore. Its uPlot assets
load only on the trial page; no framework or Node service runs in production.
See the [public release record](FRONTEND_PUBLIC_RELEASE.md) for deployed hashes,
validation and remaining gates.

### P1 (deployed 2026-09-22)

The P1 frontend shares a four-slot request pool across JSON and PNG, removes
overload fan-out, and explicitly requests `state=p1` statistics. Raw RRD input
metadata distinguishes the latest measurement from graph-consolidated history.
Legacy requests retain their original five-field response contract. See
[the implementation report](FRONTEND_P0_P1_REPORT.md) for semantics, measured
costs, tests, deployment checks, and remaining long-duration validation.

`ipppping.service` should bind to loopback and run as a dedicated unprivileged
user that can read the API RRD tree. SmokePing requires its own permissions,
raw-network capabilities, and configuration. The reverse proxy is the only
component that should be reachable from the public network.
