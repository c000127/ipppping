# Changelog

## 2026-10-02 — Retain Charts pictures outside the viewport

- Retain lossless locally encoded chart previews when recycling offscreen Canvas
  instances; returning to cached routes does not refetch series. First loading
  stays lazy; no PNG API fallback or full-matrix request fan-out.
- Preserve four native chart allocations and two concurrent series requests;
  expose extra preview storage separately. Clear previews on query/filter/axis
  replacement and page hiding; never capture an unrendered recycled bitmap.
- Chrome main/matrix/mobile/surface regression and 101 Python tests pass.
  Frontend-only production installation retained API identity and old assets;
  the eight-route public check passed. See [release evidence](FRONTEND_RETAINED_CHARTS_REPORT.md).

## 2026-10-02 — Migration/reinstallation and private recovery preparation

- Added a Chinese recovery runbook, deployment-state map, encryption/key custody,
  staging-only restoration, cutover/rollback and explicit incomplete gates.
- Added SSH-streamed authenticated-encrypted capture, integrity verification,
  safe staged extraction and new-directory RRD restoration tools. No restart,
  production overwrite, backup deletion schedule or server-side SSH key copying.
- Captured/verified the master (797 round-trip checked RRD exports) and all 15
  configured slaves off-host, completing the last backup after the user reported
  node recovery. See [the readiness record](RECOVERY_READINESS_REPORT.md).
- With separate approval, resynchronized the recovered node's stale clock by
  restarting only its time-sync service. Advancing real measurements and all
  42 freshness checks pass; collector and master API identities are unchanged.
  Kept the original backup timestamps and a new post-correction backup; capture
  receipts now distinguish operator time from the remote host's clock.
- Repaired and isolated-container-tested sanitized SmokePing examples, required
  deliberate image pinning and corrected deployment/recovery documentation.
  Docker image layers, provider accounts, full fresh-host/public cutover and
  independent offline custody remain separate work, not assumed passing.

## 2026-10-01 — Tamago IPv6 address synchronization

- Updated only the private IPv6 target and two address inventories, with retained
  restore copies. Validated SmokePing, advanced its main configuration version,
  gracefully reloaded CGI and HUPed the collector for normal peer synchronization.
- Controller and all 11 assigned IPv6 peers produced post-change, fresh
  non-unknown measurements and actual replies. Site P1 stats show measured current
  data; historical old-prefix outage remains in its original RRD window.
- No API restart, frontend release, secret/SSH/network alteration, IPv4 DDNS,
  sampling/probe or history/cache change. A transient DDNS SSH failure recovered
  on retry. See the [sanitized maintenance record](NODE_SMALL_HOST_REPORT.md).

## 2026-10-01 — Finite small-host NAT/SLAAC node trial and enrollment

- Added guarded new-host Debian Docker bootstrap using the official apt
  repository, required five packages, no recommends/distro upgrade/removal;
  refuses conflicts, partial vendor installs and existing/alternate sources.
- Tamago HKT passed isolated 38-target/60-second/20-ping testing before normal
  signed-upload production enrollment. Existing 256 MiB lz4 zram retained;
  unrelated services left running. Original image digest/runtime safeguards kept.
- All 65 assigned incoming/outgoing paths contain real advancing measurements;
  all 42 canonical slave/probe checks pass. Chrome verifies alphabetical
  placement, v4/v6 badges, four bidirectional Results cards and four Canvas plots.
- Private node/inventory/config backups retained, optional non-root `ssh_user`
  metadata supported, no credentials/IPs/private reports committed. One planned
  API restart loaded the new inventory; no code/UI/proxy/sample change or old
  frontend observation rewrite. Trial stopped and preserved, not deleted.
- 96 Python tests pass, including seven installer guard tests. Low memory margin,
  swapped collector pages, NAT gateway semantics and unmeasured reboot/DDNS
  rotation/long-term capacity are explicit in the [node report](NODE_SMALL_HOST_REPORT.md).

## 2026-10-01 — Unified page surfaces and compact Fixed pins

- Moved the neutral palette, badge/selected-node styling and corners to the
  shared stylesheet. Results/Canvas/manual PNG keep the same shell before
  querying and after returning from lazily loaded Canvas CSS.
- Distinct workspace, sidebar, header, data-card, action and control luminance;
  darker plot separates metrics from drawing without persistent borders or
  new decorative shadows. Existing separators and metric alignment retained.
- Reserved compact pin column, separate protocol metadata row and single-line
  ellipsis/full-name tooltip prevent long names wrapping when Fixed appears.
  Local SVG, 32px desktop/40px mobile targets, aria-pressed, keyboard/focus and
  shared short reduced-motion-aware feedback; no icon/font dependency.
- 89 Python/28 Node tests and Chrome main, matrix (axe), compatibility and new
  three-entry surface/Fixed regressions pass. Small real public checks verify
  all 13 asset hashes, live Results/Canvas/PNG and no script errors.
- Frontend-only installed at 04:27:36 UTC, API identity unchanged. Runtime,
  renderer/data contract, nodes, probes, RRD/cache limits untouched; old assets
  and rollback stages/backups retained. No new soak or observation claimed.
  See the [release/acceptance report](FRONTEND_UI_SURFACES_REPORT.md).

## 2026-09-30 — Approved frontend scope closed out; explicit build safeguards

- User explicitly waived long-term full-matrix capacity acceptance. Record
  acceptance by scope decision, not measured passing; actual G4 and finite G5
  evidence, historical failures and paused follow-up remain unchanged.
- Added the closeout/requirement-evidence index and aligned current-state
  documentation with shared Canvas main, retained PNG and old-client recovery.
- Added `build_web.py --default-renderer`, `--output` and read-only
  `--verify-only`; no-argument behavior stays PNG. Verification prints actual
  renderer and manifest hash. New candidates need separate directories and
  reviewed staging; this is not production activation.
- 89 Python and 28 Node tests, Chrome main/compatibility regressions pass.
  CLI regression proves byte identity and no-write verification; existing
  frozen Canvas/PNG fingerprints are unchanged. Added browser coverage for
  numeric/case-insensitive node ordering, ID preservation and immutable input.
- No production redeploy, API restart, node/sampling/RRD/cache change or
  compatibility/backup deletion. Long-term capacity and optional diagnostics
  remain explicitly unmeasured, not blocking this approved closeout.

## 2026-09-30 — User-revised one-hour production acceptance complete

- Five passing real Chrome samples, 14:15:56.450–15:17:50.682 UTC, span
  61m54.232s with maximum gap 16m26.892s. `complete1h=true` and independent
  observation-state adjudication agree; finite follow-up is stopped.
- Main/loaded asset fingerprints, Ext/v4/v6, bounded requests, known raw
  measurement freshness and memory safety passed. API PID/restarts/start
  unchanged, ~40.22 MiB API memory, zero swap, no page errors.
- The last sample legitimately had outside-window current nulls, backed by
  fresh independent measured evidence, without UI backfill or relaxed limits.
  Original failed evidence and release time remain unchanged.
- Production stays Canvas-default with explicit PNG compatibility and retained
  rollback stages/backups/old assets. No deployment/restart/node/RRD changes.
  This closes the approved finite low-concurrency observation, not long-term
  capacity, continuous telemetry or an unlimited full-matrix load claim.

## 2026-09-30 — Authorized independent health witness and new observation

- Kept the failed observation byte-identical and the actual release timestamp
  unchanged. User explicitly approved a separate one-hour retry, started
  14:15:56.093 UTC with a passing baseline; finite follow-up is active, G5 pending.
- Corrected the acceptance test, not production: validate frozen current and
  one independent P1 raw-current diagnostic GET. Outside-window nulls stay
  null. Real measured evidence must still be ≤300 seconds old / ≤60 seconds
  in the future; missing inputs and RRD writes alone cannot pass. Twelve new
  health regression cases pass, along with all 28 Node test entries.
- Bound the new report to the rollout fingerprint, original failure checksum
  and unchanged API identity; verified actual HTML/loaded assets, protocol
  tags and bounded requests. No deployment, API restart, sampling/node/RRD
  changes or added browser legacy requests. No elapsed-time-only acceptance.

## 2026-09-30 — Canvas default rollout; one-hour observation paused

- Passed the actual main-default 60-minute frozen-build gate unchanged:
  renderer slope +0.162 MiB/min, median drift +2.84 MiB, four allocations,
  zero script errors. Earlier interrupted reports remain unaccepted.
- Authorized frontend-only default→PNG→default and old PNG/Canvas tabs passed.
  Production defaults to Canvas; explicit PNG handoff, old assets and backups
  remain. No runtime/node/RRD changes or API restart.
- Corrected an old-tab PNG test race by requiring a fresh successful image
  response and its decoded image, not already-complete prior images. The first
  failed attempt automatically recovered PNG and its report is retained.
- User shortened production observation from 12 hours to one hour: ≥5 passing
  quarter-hour samples, not endpoint-only elapsed time. Its first freshness
  assertion failed; the report is retained, follow-up stays paused and G5 is
  not accepted. Frozen-window current can be null despite a newer raw update;
  follow-up must resolve the health-test semantics, not weaken thresholds.

## 2026-09-30 — User-requested one-hour acceptance retry

- Started a separate frozen-artifact main-default long test, retaining the
  interrupted report. Added a detached, bounded local launcher with a
  temporary system-awake request, automatic release and original gate
  analysis; no persistent power settings or production changes.
- Outcome pending; default rollout and 12-hour observation have not started.

## 2026-09-30 — Observation duration revision

- Changed production acceptance from 24–48 hours to 12 hours at the user's
  request: baseline plus ≥12 hourly checks spanning 12 actual hours.
- Updated the report to `complete12h`, tests, current plan and finite follow-up;
  historical records remain historical. Follow-up stays paused; G4 and
  default rollback requirements are unchanged. No production deployment.

## 2026-09-30 — Shared main-page Canvas candidate

- Integrated bounded Canvas into the actual main page, preserving drafts,
  multiple Fixed nodes, Results, labels, filters and manual PNG handoff.
  No duplicate legacy requests on Canvas.
- Added HTML-only default configuration and explicit PNG override, with lazy
  dependencies. Production remains PNG until final gates.
- Added main-page failure/race/resource/accessibility tests, including retained
  plot cancellation cleanup, guarded default rollback and finite observation
  tools. See the [main acceptance record](FRONTEND_MAIN_CANVAS_REPORT.md).
- The final local main-default soak was interrupted at ~23.5 minutes, with
  overlapping Windows standby events. Its incomplete report cannot pass G4;
  finite follow-up is paused and production remains PNG, without API restart.

## 2026-09-30 — Bounded matrix details and frontend-only releases

- Added keyboard-accessible, on-demand interval data on the Canvas matrix
  trial; at most 120 rows reuse the frozen visible series, with no extra
  request for an already loaded plot. Closing releases DOM and restores focus
  without moving the page.
- Released completed animation effects while retaining short productive
  motion and reduced-motion behavior. Preserved borderless cards, structural
  separators, five-column whole-block centering/internal left alignment,
  existing Current emphasis, and no per-result freshness/status copy.
- Added guarded no-API-restart frontend installation and verified an actual
  opt-in rollback/reinstall. All runtime bytes must match first.
- Added bounded isolated/public multiuser checks and direct Chrome memory
  controls without Network buffering; historical long-test failures remain
  recorded. See the [P4 report](FRONTEND_P4_REPORT.md) for exact scope.
- The default main renderer is still PNG; this is not G4/G5 default migration.

## 2026-09-23 — Fixed-node selection feedback

- Added separate selection and cancellation animations for Fixed nodes, while
  keeping the action button width stable and respecting reduced-motion settings.
- Deployed after local and public Chrome regression checks; see the
  [public release record](FRONTEND_PUBLIC_RELEASE.md).

## 2026-09-23 — Compact result status and metric alignment

- Returned the sidebar controls to natural height, retaining only a fixed
  two-line status: selection/result counts above, unapplied changes or the
  latest visible result's HH:mm measurement time below.
- Removed redundant per-card timestamps for normal measurements while keeping
  missing, stale, loss and refresh-failure indicators on affected cards.
- Centered five-column metrics and aligned dividers with the full 2×2 metric
  text block in narrow and wide Results layouts.

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
