# Changelog

## 2026-09-23 — P2 main page and isolated P3 trial deployed

- Published the P2 main page and the separate opt-in `/chart-trial` with v2
  APIs; the main Charts view continues to use PNG. See the
  [public release record](FRONTEND_PUBLIC_RELEASE.md) for artifact checks and
  production tests. No node, probe, key or RRD data was changed.
- Removed persistent white borders from UI surfaces and hid native node
  checkboxes visually while retaining keyboard/accessible selection. All five
  metric values now use the same font size at each breakpoint.
- Restored the subtle internal metric, route/stat and stat/chart dividers after
  feedback, while keeping outer card/control borders removed.
- Anchored visually hidden node checkboxes within their rows so focusing a
  lower node no longer scrolls the page or sidebar shell.
- Allowed multiple Fixed nodes with only fixed-to-non-fixed results, preserving
  single-anchor API compatibility. Stabilized sidebar footer height and added
  reduced-motion-aware drawer/control transitions.
- The low-end-device test requirement was explicitly waived by the user.
  Cross-browser/manual accessibility checks, full end-to-end cost comparison,
  24–48h observation and default Canvas migration remain open.

## P3 — isolated trial implementation

- Explicit v2 bucket contract, consistent RRD snapshot reader and bounded
  interval envelopes preserving median extrema/loss counts/missing intervals.
- Self-hosted uPlot 1.6.32 on a separate opt-in chart trial page, with accessible
  interval inspection, single-instance cleanup and explicit PNG comparison.
- Added lossless columnar series encoding and negotiated gzip with bounded
  serialized-response caching; fractional-DPR canvas width obeys a fixed pixel budget.
- Real synthetic-RRD comparison and browser regressions recorded in
  [P3 report](FRONTEND_P3_REPORT.md). G3 is not yet passed; matrix migration and
  default Canvas rollout remain gated on end-to-end cost and stability evidence.

## P2 — implementation and local validation

- Consolidated CSS tokens/components and extracted DOM helpers; keyed card
  reconciliation and in-place metric updates replace repeated scans/rebuilds.
- Native keyboard selection, independent Fix buttons, inert/focus-managed mobile
  drawer, responsive text reflow and reduced-motion support.
- Deterministic content-fingerprinted build and staged installer preserving old
  client assets, with activation rollback tests. No production Node dependency.
- Increased RRDtool PNG Y-axis label allowance and matched axis-probe/output
  widths after synthetic and public-site read-only visual checks found clipped
  numeric labels or spikes; this change is included in the 2026-09-23 release.
- See [P2 report](FRONTEND_P2_REPORT.md) for measurements, release procedure and
  outstanding real-device/production validation.

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
