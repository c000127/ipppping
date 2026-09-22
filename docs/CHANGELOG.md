# Changelog

## 2026-09-22 — P1 correctness and request governance

- Shared four-slot browser request pool for JSON and PNG; overload no longer
  fans out into per-card requests. Added cancellation, deduplication and bounded retries.
- Added opt-in `state=p1` statistics with raw RRD measurement timestamps,
  nullable unknown values and explicit stale/error states; old clients retain
  their five-field response. Current no longer falls back to Average.
- Bounded browser statistics storage and retained manual refresh; removed the
  decorative live indicator and automatic PNG retries during backend failures.
- Added reproducible P0 fixtures, browser/real-RRD tests, and production smoke
  checks. P1 deployed; performance tradeoffs and remaining validation are in
  [the P0/P1 report](FRONTEND_P0_P1_REPORT.md).

## Unreleased

- Added IPv6 pairing and `ExternalIPv6` RRD resolution for external targets,
  including Guangdong carrier TCPPing targets while keeping Telegram DC5 IPv4-only.
- Added stable alphabetical node ordering, v4/v6 capability badges for every
  node, and separate `Ext` plus IP-family badges on external result cards.
- Added an optional fixed-node pairing mode for one-to-many and one-to-one
  checks while preserving the default many-to-many selection behavior.
- Added the `anchor` parameter to pair and batch-stat APIs and documented the
  selection workflow.

## Repository baseline

This initial maintenance baseline records the deployed application shape:

- Python `http.server` API with structured errors and security headers;
- RRD-backed Current, Average, Min, Max, and Loss statistics;
- batch stats, structured series, and PNG graph endpoints;
- bounded graph concurrency and short-lived caches keyed by RRD freshness;
- responsive Results/Charts frontend with IPv4, IPv6, external checks, retry,
  lazy image loading, and optional unified Y-axis ranges;
- locally served JetBrains Mono and Smiley Sans font assets with license files;
- systemd and reverse-proxy templates;
- SmokePing master/slave templates for FPing, FPing6, and TCPPing;
- sanitized documentation and examples.

Production deployment snapshots, generated configs, real inventories, RRD data,
and credentials are intentionally excluded.
