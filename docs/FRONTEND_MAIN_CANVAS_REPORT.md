# Shared Canvas main-page acceptance

Updated 2026-09-30. Production main HTML now defaults to shared Canvas,
rather than redirecting to trial HTML; `/?renderer=png` is explicit fallback.
The fresh actual main-default 60-minute run passed the original G4 numerical
gate. Authorized default→PNG→default, public fingerprints and old tabs passed
at 13:42:40.783 UTC (21:42 Singapore time), without API restart.
The user shortened production observation from 12 hours to one hour. Its
first freshness assertion failed at 13:46:47.144 UTC; that report is retained.
The user explicitly authorized a corrected, separate observation starting
at 14:15:56.093 UTC (22:15 Singapore time). Five passing real samples through
15:17:50.682 UTC span 61m54.232s; `complete1h=true` and independent adjudication
agree. G5's user-revised finite observation is accepted; follow-up is stopped.
This is short-term low-concurrency evidence, not long-term/full-matrix capacity.

Final scope decision 2026-09-30: the user explicitly waived long-term
full-matrix capacity acceptance. Record it as waived, not tested passing.
The approved release is closed out; see the [requirement/evidence index and
build safeguards](FRONTEND_UPGRADE_CLOSEOUT.md). This does not rewrite failed
reports, re-open observation or change production bytes.

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

85 Python tests and 28 Node test entries passed. Installed Chrome
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

| Artifact | PNG (verified rollback) | Canvas default (deployed) |
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

## Final main-default gate and observation rules

Normal motion, actual Canvas, 120-point full 480-route 60-minute testing
targeted `/` from the Canvas-default build, not independent trial HTML:
`test-results/p4-matrix-cdp-soak-3600s-off-main-default-awake-20260930t075649z.json`.
Manifest/main/renderer/harness hashes are recorded. Only a finished report
passing unchanged `tests/analyze-p4-soak.cjs` may promote. No weaker threshold
or disabled-render/motion control replaces production-like rendering.
Near-cap summary latency and ~30k DOM nodes remain measured trade-offs;
earlier bounded multiuser evidence is not arbitrary public capacity.

`tests/production-main-rollout.cjs` requires explicit opt-in, exact passing
gate and staging fingerprints. It verifies real default→PNG→default,
all public pages/assets, old PNG/Canvas tabs, manual PNG and unchanged API
PID/start/restarts; failure attempts verified PNG recovery.

`tests/production-main-observe.cjs` takes low-rate read-only samples of the
actual final default release. The approved replacement window distinguishes
its observation start from the unchanged release timestamp; these cannot be silently
reset or mixed. Per the user's latest 2026-09-30 revision, completion needs ≥5
passing samples spanning one real hour, distinct 15-minute bins, baseline
within 15 minutes and no >30-minute gaps. The report uses `requiredHours=1`,
`sampleIntervalMinutes=15` and `complete1h`; former 12/24/48-hour requirements
are superseded. Execution stops within two hours and at most eight samples.
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

The user subsequently shortened production observation to 12 hours. The same
paused follow-up now has a 12-hour name/acceptance prompt and at most 16 hourly
runs (preflight/scheduling margin, not a 16-hour observation requirement).
It remains paused: changing duration does not authorize restarting the
interrupted G4 run or skipping default rollback. Completion stops follow-up.

## User-requested retry (2026-09-30, 15:56 Singapore time)

The user explicitly requested a new long test. Its separate report is
`test-results/p4-matrix-cdp-soak-3600s-off-main-default-awake-20260930t075649z.json`; the previous partial report is retained unmodified.
The unchanged main-default manifest, normal visible Canvas/motion,
1800×900/DPR 1, 120 points and full-matrix sweep ran for 3,600 seconds.
The driver and original analyzer are unchanged. All original checks passed:
1,760 cycles, 58 submissions, 480/480 routes, renderer last-30-minute slope
+0.162 MiB/min (limit +0.2), last/prior-15-minute median drift +2.84 MiB
(limit +8), heap 2.41→2.55 MiB, DOM 35,244–35,248, listeners 42–46,
exactly four allocations, cache ≤16 / 191,488 estimated bytes, at most four
canvases / 640,640 backing pixels, zero script exceptions. The positive
renderer growth is within the original gate, not proof of zero growth or
unlimited long-term capacity. Requests were local fixture traffic, not a
production full-matrix stress test.

`tests/start-matrix-soak.ps1` runs independently in a hidden local helper
with redirected logs. It verifies the frozen manifest, refuses existing
report/log paths, supplies the bundled test dependency path, and uses a
temporary ES_CONTINUOUS | ES_SYSTEM_REQUIRED request while waiting. No
display/away-mode request or persistent power-plan setting is changed.
The request is released on completion/error; a 65-minute watchdog can stop
only its owned test tree. This follows
[Microsoft's execution-state API](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-setthreadexecutionstate);
it cannot override deliberate sleep/lid-close actions.

One startup attempt could not resolve Get-FileHash in the helper environment,
and another lacked the Node fixture's Playwright module path; both stopped
before producing acceptance samples. The launcher now uses a .NET checksum
and explicitly supplies the bundled modules. Their diagnostic logs are
retained, not mistaken for valid tests. Wrapper parsing and analyzer/observation
regression tests passed; the current observation tests enforce one hour.

The owned helper/Node PIDs 13080/16736 exited at approximately 16:57 Singapore
time, and the temporary system-awake request was released. No persistent power
setting, frontend asset or runtime module changed during this long test.

## Authorized default rollout (2026-09-30)

`test-results/main-default-rollout.json` records a successful three-step
frontend-only rehearsal with all public pages and 13 assets verified at each
step, fresh queries from old PNG/Canvas tabs, explicit PNG handoff and no
automatic query or duplicated legacy fetch on Canvas:

| Step | Finished UTC | Backup |
| --- | --- | --- |
| Canvas default | 13:42:02.117 | `/root/ipppping-backup-20260930T134201160457Z` |
| PNG rollback | 13:42:22.350 | `/root/ipppping-backup-20260930T134221431925Z` |
| Canvas default restoration | 13:42:40.783 | `/root/ipppping-backup-20260930T134239857892Z` |

`passed=true`, `oldTabsPassed=true`, errors empty. API PID 157219,
NRestarts=0 and start time are unchanged. The staging installers rejected
any runtime mismatch; only main HTML configuration differs between variants.
Source/build CLI remains PNG-configured for conservative packaging, not a
claim that production still defaults to PNG.

The first attempt failed an old-PNG-tab test before the planned rollback
stage. Its already-complete images let the test inspect before a new image
response; recovery restored verified PNG automatically. The diagnostic report
`test-results/main-default-rollout-attempt1-image-race.json` is retained.
The test now requires a fresh successful PNG response and its decoded image;
no product bytes, original resource gates or assertions were weakened.

## Historical first observation failure: retained evidence

The real release start remains `2026-09-30T13:42:40.783Z`. The first sample at
13:46:47.144 UTC has `passed=false` and `complete1h=false`. API/Caddy were
active, API memory 43,589,632 bytes, host available memory 1,213,366,272 bytes,
swap used zero, PID/restarts unchanged. Failure occurred at the known v4
`current.measurement_updated_at` freshness assertion. Its response body was
not retained, so the exact failed timestamp/state cannot be reconstructed.

Read-only follow-up returned fresh v4/v6 measurements with no service change.
The contract and existing regression prove that a raw lastupdate newer than
the frozen minute-aligned window legitimately has `state=outside_window` and
null `measurement_updated_at`. This makes that field alone unsuitable for a
real-time health gate; it is a plausible explanation, not proof of what the
unrecorded failed response contained. Do not replace null with an invented
timestamp, infer health from RRD write time alone, or remove the failed row.

Production remains the successfully restored Canvas default; no automatic
configuration change or second observation was performed. The recurring task
is paused; the runner now refuses existing failed or completed observations
before any production read. Future checks also retain probe state/window,
requests and errors before their freshness assertion. Next work requires
resolving the health assertion with explicitly
measured evidence and separately authorizing a fresh finite observation,
retaining this failed report and original release timestamp. The user's
reported ≤2 users narrows the capacity claim, not the correctness gates.

Low-rate post-rollout Chrome smoke scripts passed main/manual PNG, the shared
matrix two/four external routes, interval reuse, multi-Fixed animation, mobile
metrics, structural dividers and all 13 asset hashes. Page errors were zero;
known CDN-injected scripts remained blocked by CSP. These checks do not erase
the failed observation or constitute its missing one-hour coverage.

## User-authorized health correction and new finite observation

The user explicitly approved correcting the health assertion, retaining the
failure, and starting a separate window. No production byte or configuration
changed and no rollout was repeated. The original release remains
`2026-09-30T13:42:40.783Z`. The original failed report remains byte-identical:
SHA-256 `ad7710bc4114218c8c508e3dd6a0d7645a2c435aa88c613f3c94e5c9544667a3`.

`tests/observation-health.cjs` separately validates the known v4 frozen
summary and one independent `GET /api/stats?...&state=p1` health witness.
The latter is a diagnostic request, not a browser legacy fetch or PNG
fallback. It must report measured raw RTT or loss and a real measurement
timestamp (age ≤300 seconds, future skew ≤60 seconds, unchanged thresholds).
An RRD write, average, null input or missing/unknown state cannot stand in.
100% loss remains a measurement. A recent summary's `outside_window` is
accepted only when its raw input is newer than its frozen end and all its
current values stay null, backed by independent real measured evidence.
Normal measured current must still belong to its window; stale/historical
summaries fail even with a fresh live witness. Twelve new regression tests
exercise those cases; all 28 Node tests pass.

New report: `test-results/main-canvas-observation-health-v2.json`, schema
`ipppping.production-observation.health-v2`, startedAt
`2026-09-30T14:15:56.093Z`, separately retained releasedAt above and the
original failure checksum. The runner requires the successful rollout's
manifest and unchanged API PID/restarts/start even for this new baseline.
It rejects changed timestamps/fingerprints/evidence, prior failure/completion
or an expired window. Each sample verifies main HTML and the actually loaded
asset hashes, Ext/v4/v6 labels, ≤4 chart instances, ≤3 summary attempts,
≤2 known-route series requests and no browser legacy/PNG fan-out.

Baseline at 14:15:56.450 UTC passed: measured state, two charts, one summary
and two series, no page errors, ten loaded asset hashes verified. API memory
42,172,416 bytes, host available 1,226,297,344 bytes, zero swap; API identity
unchanged. Four real scheduled passes followed; the fifth total sample set
`complete1h=true` at 15:17:50.682 UTC, before the two-hour hard deadline.
The follow-up stops after completion, with no extra production reads or
report resets. Neither independent-trial uptime nor the failed prior window
was added to coverage.

## Completed user-revised G5 observation (2026-09-30)

Independent `observation-state.complete` confirms the recorded result, five
passing samples in five distinct quarter-hour bins, baseline within one
second of the authorized start, elapsed 3,714.232 seconds and maximum gap
986.892 seconds (under the original 30-minute continuity limit):

| Checked UTC | Passed | Frozen current state |
| --- | --- | --- |
| 14:15:56.450 | yes | measured |
| 14:32:23.342 | yes | measured |
| 14:47:18.507 | yes | measured |
| 15:03:21.370 | yes | measured |
| 15:17:50.682 | yes | outside_window, current values remain null |

All five retained the same main HTML fingerprint and ten actually loaded
asset hashes, two Ext cards with v4/v6 labels, two chart instances, one
summary/two series requests, no browser legacy/PNG requests or page errors.
Each pass made exactly one independent known-v4 P1 diagnostic read. API PID
157219, NRestarts=0 and service start remained unchanged, API/Caddy active;
API memory 42,172,416–42,176,512 bytes (~40.22 MiB), host available memory
1,214,242,816–1,247,010,816 bytes, zero swap. No memory line was exceeded.

The final sample genuinely exercised the corrected boundary: frozen end
1790781420, raw input 1790781448, current fields null, live raw input measured
at 1790781448. This supports the correction without inventing window-local
values; it does not reconstruct the original failure's unretained response.

Completed report SHA-256:
`6c8d03af92ec293c7bd48c6d470683e95744fd9ef3a56165e5cb3d119d3bcf6a`.
Original failed report checksum remains
`ad7710bc4114218c8c508e3dd6a0d7645a2c435aa88c613f3c94e5c9544667a3`.
Both reports remain local/ignored and unmodified after completion. Source
health correction is commit `1004461af8ce1b1c012c6ead736030b8c568d31c`;
production assets remain from `a32fa4c641bcd625697fcbf5cb1d47b96d1e362e`.
The default build, explicit PNG staging, immutable old assets and rollout
backups above are retained. No cleanup, deployment, restart or sampling/RRD/
node/credential mutation was part of observation.

The approved one-hour acceptance is complete and finite follow-up is stopped.
This is five low-rate known-two-route Chrome snapshots under the user's
reported ≤2-user scope, not continuous telemetry, a new multiuser stress run,
or proof of long-term leak freedom/large public matrix capacity. Original G4
positive renderer growth and near-cap summary latency remain documented
trade-offs. Do not remove PNG compatibility, old assets or backups merely
because this finite window passed.
