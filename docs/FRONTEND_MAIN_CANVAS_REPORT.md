# Shared Canvas main-page acceptance

Updated 2026-09-30. The main page directly integrates the shared renderer at
`/?renderer=canvas`, rather than redirecting to trial HTML. Production still
defaults to PNG. The final default-build G4 run was interrupted and cannot
be accepted; automated follow-up is paused. G5 default promotion/rollback
and 24–48-hour observation have not started.

## Implemented boundaries

- `matrix-renderer.js` serves both main and independent trial: bounded uPlot
  allocations, visible-series scheduling, frozen axes, loss marks, motion
  cleanup and on-demand interval details. No new runtime service/framework.
- Main `app.js` owns node selection, multiple Fixed nodes, legal routes,
  generations, drafts/applied controls, filters and footer. Failed queries
  retain the previous committed snapshot; stale responses cannot commit.
  IPv6-only VPS nodes no longer manufacture IPv4 routes.
- Canvas uses v2 data without simultaneous legacy stats/PNG. JSON shares
  the four-slot pool; visible series uses two. Busy summary pages get at most
  two retries, never PNG fan-out. Partial errors stay unknown.
- Full legal-selection summaries freeze the window and unified axis before
  plotting; viewport/filter changes cannot redefine the maximum.
- Active+idle charts ≤4; cache ≤16 sequences/estimated 2 MiB; per-chart
  backing pixels ≤1,126,400; interval rows ≤120. Hiding destroys backstores;
  completed WAAPI effects are released. No sampling/node changes.
- Inert-template dependencies load sequentially only on explicit Canvas
  Charts submission, not Results/PNG navigation. Default navigation never
  submits. Manual PNG handoff preserves the actual draft mode and controls.
- `build(..., default_renderer='canvas')` changes only main HTML configuration;
  the 13 assets and trial pages match PNG. Explicit `/?renderer=png` wins.
- Main Canvas uses bounded visible-card entry/reveal and changed Current/Loss
  pulses, not 480-card legacy FLIP/entry effects; reduced motion is respected.
  Borderless surfaces, full separators, combined centering/internal left
  alignment, 1.66× Current only in Current+2×2, fixed-color loss and no
  crosshair/range/point icons remain unchanged.

## Regression evidence

85 Python tests and 15 Node test entries passed. Installed Chrome
154.0.8037.59 passed existing main regression, shared trial 480/499 routes
and axe checks. `tests/main-canvas-browser.cjs` passed both HTML configurations:
lazy/default no-auto-submit, multi-Fixed Ext v4/v6, frozen axes, cached details/
Escape/focus, stable cards and completed motion, failed-query retention,
latest-generation wins, bounded 503 retries, pending-query hiding, Results
cleanup, 480 routes/15 pages with partial errors, mobile and DPR 3.5 bounds.

An added test reproduced stale `aria-busy` when a cancelled busy series became
unavailable on a retained card. `pause`/`suspend` now clear cancelled plots'
flags before clearing ownership; obsolete finalizers still cannot clear a
replacement's flag. The reproduction passes; the long run was restarted
against changed bytes rather than reused.

Public smoke checks cover known main/trial two/four routes, no duplicate fetch,
interval reuse, real PNG, mobile metrics, Fixed animations and asset hashes.
The old test separately centering labels/values was corrected to the documented
combined-centering rule, without changing product styles to satisfy it.

## Final frozen release

| Artifact | PNG candidate (deployed) | Canvas default (prepared, not activated) |
| --- | --- | --- |
| Manifest SHA-256 | `a8183f88638a80b8967474ac8541632a84ff153dc9ccaeafa96843ef84cad999` | `2d9d735cca2e84fe2e76113c6a2c513025ce925dccbbf89d3a9cb937bdce8885` |
| Main HTML SHA-256 | `50ad2545f3f10d2bd30e5f34bd2823b6dcda692a283810ffcab5b3579e7ad6b3` | `80a5fe38b7c846dc849208ec93a1b345d37712709bf5ddd3f99b2a3907e994aa` |
| Staging | `/root/ipppping-stage-main-cleanup-png-CwLooNzj` | `/root/ipppping-stage-main-cleanup-default-o2LWm9Zc` |

Both use `app.7dabc39a5421eed4.js`, `matrix-renderer.9c281a4998eb61a6.js`,
`chart-matrix-trial.fe94102d53bd0753.js`; all 13 assets match. Main CSS and
single-route P3 page remain unchanged. Frontend-only candidate backup:
`/root/ipppping-backup-20260930T031108024830Z`.
API PID 157219/start 2026-09-29 09:00:48 UTC/NRestarts=0 unchanged, five
runtime modules byte-identical. No collector, node, credentials, production
RRD or global cache was modified.

## Historical runs and rollback

Initial opt-in candidate (`83cfece…`) was actually rolled back to the previous
opt-in release and restored; backups `20260930T022047144954Z` /
`20260930T022053942331Z`, no API restart. That proves opt-in recovery,
not default recovery. Intermediate `e831e183…` / `c4e5c942…` were public-tested.
Retain staging installers with their own validators: an old 12-asset release
cannot use the new 13-asset validator. Keep old immutable assets and backups.

Interrupted ~11-, ~8- and ~24-minute runs are incomplete, never acceptance.
An aborted run's owned `%TEMP%/ipppping-cdp-soak-ECVLwR` profile remains
because cleanup was blocked; no workaround was attempted. No user browser
profile or Android file was touched.

## Remaining gates

Normal motion, actual Canvas, 120-point full 480-route 60-minute testing
targets `/` from the Canvas-default build, not independent trial HTML:
`test-results/p4-matrix-cdp-soak-3600s-off-main-default-busy-cleanup.json`.
Manifest/main/renderer/harness hashes are recorded. Only a finished report
passing unchanged `tests/analyze-p4-soak.cjs` may promote. No weaker threshold
or disabled-render/motion control replaces production-like rendering.
Near-cap summary latency and ~30k DOM nodes remain measured trade-offs;
earlier bounded multiuser evidence is not arbitrary public capacity.

`tests/production-main-rollout.cjs` requires explicit opt-in, exact passing
gate and staging fingerprints. It verifies real default→PNG→default,
all public pages/assets, old PNG/Canvas tabs, manual PNG and unchanged API
PID/start/restarts; failure attempts verified PNG recovery.

`tests/production-main-observe.cjs` takes low-rate read-only samples from the
actual final default restoration. Timestamp/fingerprint cannot be silently
reset or mixed. Completion needs ≥25/49 passing samples spanning 24/48 real
hours, distinct hourly bins, baseline within 15 minutes and no >2-hour gaps.
Two endpoints do not count; gaps/failures remain incomplete, never inferred
successful solely from elapsed time.

## 2026-09-30 follow-up: interrupted local test, no promotion

The thread-attached hourly follow-up `ipppping-48` was created at
03:29:50 UTC with a finite 52-run limit. Its first check at 04:56 UTC found
the frozen final report still `complete=false`, last written at 03:31:06 UTC.
The last sample covers 1,411,918 ms (~23.5 minutes), not 60 minutes; 480/480
routes were visited, four allocations, ~2.45 MiB JS heap, and no recorded
script errors. These partial observations cannot pass the original gate.
The owned execution session and Node test processes no longer existed.

Windows System events record entry into modern standby at 11:33:29 and exit
at 12:54:51 Singapore time (Kernel-Power 506/507). This overlaps the stalled
test window and supports an environment interruption; it does not establish
that application memory passed or failed. No power settings were changed,
no test was automatically restarted, and no browser profile was deleted.

The original analyzer rejected the incomplete report before any rollout.
Per the approved safeguard, the follow-up was set to `PAUSED`, preserving
its prompt/schedule. Public main HTML remains PNG, origin main HTML hash
`50ad2545f3f10d2bd30e5f34bd2823b6dcda692a283810ffcab5b3579e7ad6b3`;
API PID/start/NRestarts remain unchanged, API and Caddy active (~41 MiB API
cgroup memory). No default rollout report or observation baseline exists.
Keep the verified candidate and staged default; resume requires a fresh full
60-minute run under the same gate with the local machine kept awake. Never
append synthetic samples or treat the previous partial run as acceptance.

Implementation/source commit: `a32fa4c641bcd625697fcbf5cb1d47b96d1e362e`.
It contains the deployed candidate frontend bytes; subsequent documentation
commits do not change their fingerprints.
