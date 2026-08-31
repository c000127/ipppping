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
  GET /api/pairs?nodes=...
  GET /api/stats-batch.json?nodes=...&dur=...
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
the API remains the authority for which pairs are valid.

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
selection state, request cancellation, stable card identities, Results/Charts
rendering, unified-axis calculation, and image retry behavior. `web/styles.css`
contains the responsive layout and the animation rules. `web/index.html` is the
small shell served by the Python process.

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

`ipppping.service` should bind to loopback and run as a dedicated unprivileged
user that can read the API RRD tree. SmokePing requires its own permissions,
raw-network capabilities, and configuration. The reverse proxy is the only
component that should be reachable from the public network.
