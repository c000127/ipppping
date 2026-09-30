# Frontend visual invariants

Updated 2026-09-30. These are acceptance rules for both the production page
and the opt-in matrix trial, not optional styling suggestions. When changing
`web/styles.css`, `web/chart-matrix-trial.css`, the metric markup, or chart
rendering, update the corresponding Chrome assertions before release.
The [closeout index](FRONTEND_UPGRADE_CLOSEOUT.md) maps these rules to accepted
Chrome evidence. A capacity waiver does not relax visual or accessibility rules.

## Borderless surfaces, structural separators

- Cards, segmented controls, action buttons, tags, and the trial legend have
  no persistent outline. Background contrast and hover/selected fill establish
  hierarchy. Keyboard `:focus-visible` outlines are required and are not
  considered persistent borders.
- Keep the metric-to-metric dividers and the separators between route, metrics,
  and chart. In a stacked card, the route/metrics horizontal separator must
  reach both outer card edges; the metrics/chart separator already spans the
  full card width. In the wide Results layout, retain the vertical route/metrics
  separator aligned with the right-hand text block. In the narrow 2×2 metrics
  layout, retain the vertical Current/support divider.
- Canvas horizontal gridlines and CSS separators use the same low-contrast
  `--trial-rule` token. Do not restore visible vertical chart gridlines.

## Five metrics in one row

At container widths above 460px, except the wide two-column Results layout,
the five metrics remain one row of five equal cells. **Within each cell, the
label and the number/unit group share the same left edge** (within 1 CSS px).
Their combined block is centered in its cell (within 2 CSS px); this is the
only centering intended. Do not center the label and value independently or
set `text-align:center` on the five-column metric items. Keep the normal
five-column CURRENT number size equal to the other four; the 1.66× emphasis
belongs only to the wide or narrow Current+2×2 layouts. Numeric glyphs remain
tabular, and Current plus its unit must stay together when space permits.

At container width ≤460px, use Current left with a 2×2 support group on the
right; at ≥1360px, Results may use its established side-by-side route/metrics
layout. Those layouts retain their existing right/left alignments and
separator lengths. Breakpoints are based on the main container, not the
browser viewport.

## Trial chart marks

The opt-in matrix chart has no hover crosshair, median-range band, or
per-sample whisker/cap/halo icons. All chart-loss marks use the **same fixed
coral color and .65 opacity**, without overlapping fill and peak rectangles.
Do not color chart marks by severity or apply a vertical gradient. Only the
card's Loss number follows the amber→orange→red percentage scale; 0% is neutral.

At the consolidated RRD-bucket resolution, loss in **every** source bucket of
an aggregate interval fills that interval's true time width up to its mean
loss percentage. Merge adjacent intervals only when their means are equal,
so there are no seams and no fabricated smoothing. If the peak exceeds that
mean, a narrow stem extends **from the mean to the peak**, not through the
filled block. If only some buckets have loss or the interval contains missing
measurements, draw only a narrow peak mark. Its horizontal position is the
aggregate interval's center, **not an exact ping timestamp**. At 100% loss in
every bucket, the filled region reaches the plot top; a whole-window outage
fills the plot width. Unmeasured gaps remain unfilled. Missing RTT breaks its
line. The legend must distinguish filled mean-loss intervals from peak marks.
The PNG renderer and v2 data contract are unchanged by the approved
2026-09-30 main-page default migration.

## Canvas motion on the opt-in matrix entries

These rules also apply to the shared-renderer production main page (Canvas
default, with explicit `/?renderer=canvas` still supported). Manual PNG and
Results retain their existing layout and do not load Canvas dependencies.
Canvas controls retain decorative,
non-focusable sliding indicators; switching back to Results hides them when
the Canvas-only stylesheet scope is inactive.

Use productive, short motion: 150–180 ms for controls/cards, 220 ms for the
one-time plot reveal, and 240 ms for a changed number. Entrance moves no more
than 4 px with `cubic-bezier(.16, 1, .3, 1)`; the segmented indicator uses
`cubic-bezier(.2, .8, .2, 1)`. No bounce, scale overshoot, animated counter,
per-sample drawing, or chart motion on every scroll. The native time-range
select remains a select; only the actual filter, pairing, and view segments
receive sliding indicators. Indicator elements are decorative and must not
alter group height or keyboard focus.

Results/Charts is a draft setting until **Show Results/Charts** is submitted.
Keep the old grid visible while the request is pending or fails; replace it
only when a complete new response is ready. Animate at most six currently
visible cards with 14 ms stagger, never all 480. On a manual re-submit, pulse
only a genuinely changed Current value and a changed positive Loss value;
there is no automatic one-second data refresh. A first-visible chart may use
a 220 ms compositor reveal over its plot rectangle, not repeated Canvas
redraws or an overlay covering the axes. Never replay the reveal on scroll
re-entry or unified-axis toggles. Cancel animations on replacement/disposal.
`prefers-reduced-motion: reduce` must present final states immediately with
no CSS/WAAPI transition, while preserving selected state and data semantics.
For a completed re-submit with the same route order and view mode, update
existing card elements in place instead of recreating the full matrix DOM.
Refresh every metric and loss color; clear an old error when the route recovers.
Changing route order or Results/Charts mode may still replace the necessary
cards. At most four uPlot/Canvas instances may be recycled across visible
routes; every reassignment must update the frozen-window data, loss marks,
Y range and size before display. Reusing card DOM or Canvas must never show
stale series. Leaving Charts or hiding the page destroys idle instances and
zeros backing stores.
After a WAAPI effect completes, remove its cleanup listeners and cancel the
finished effect so a detached reveal cover cannot keep a forwards-filled
animation alive. Its final visual state must already match normal CSS.
Only the currently owning series request may clear a reused plot's
`aria-busy` state; a replaced card resets it before starting new work.

## On-demand interval data

The trial plot is a keyboard-focusable button that opens one native modal
dialog on click, Enter or Space. Do not add permanent per-card toolbars or
prebuild tables for every route. Generate at most 120 rows from the same
validated, frozen-window series used by the chart; share cached/in-flight
work. Pin the inspected route inside the existing four-route work budget,
not a separate request queue. Show mean median RTT, mean/peak loss and
bucket counts, including full-loss, missing measurement and missing RTT.
Missing values must read `Missing`, never zero. Visible interval boundaries
include seconds; accessible time labels and ISO datetime attributes retain
the full date and UTC+08:00 context, including midnight crossings.

Close/Escape clears the table DOM and restores plot focus without scrolling.
The modal's Escape must not open the sidebar. Query replacement, filtering,
page hiding and page exit close the modal. On narrow screens, center the
borderless dialog inside the viewport and scroll the table internally;
never overflow the page. These details do not restore a Last measurement
line or freshness badges inside result cards.

Acceptance diagnostics must not change those card rules. A frozen-window
`outside_window` current stays unknown/null even if a separate live health
witness is fresh. Do not backfill chart numbers/timestamps or add status copy
because the production observation uses an independent raw-measurement read.
The completed one-hour observation actually encountered this outside-window
case in its last passing sample; no UI value was backfilled to make it pass.

## Explicit Canvas trial entry

The production page defaults to Canvas. On the manual PNG page, “Try Canvas
Charts” carries the **draft** node selection, Fixed nodes, duration, filter and
unified axis to `/?renderer=canvas`; “Use PNG Charts” carries the same controls
to `/?renderer=png`. Neither navigation may submit a query automatically, and
the destination must validate all IDs and limits against the fresh node list
before restoring controls. An invalid or stale link falls back to empty
controls. These links are explicit renderer navigation, not an access-control
boundary. The user must press Show Charts/Results to load.

## Required checks

Run `tests/query-handoff.test.cjs`, `tests/frontend-browser.cjs` and
`tests/chart-matrix-browser.cjs` and `tests/main-canvas-browser.cjs` in Chrome
after changes to these rules. They assert borderless surfaces, edge-to-edge
stacked separators, five-column per-item left alignment with whole-item
centering, and the 2×2 divider at representative container widths. Review
desktop and 390px chart screenshots; run the production smoke test only after
authorized deployment. Automatic checks complement, but do not replace,
visual and keyboard inspection.
