# Frontend visual invariants

Updated 2026-09-29. These are acceptance rules for both the production page
and the opt-in matrix trial, not optional styling suggestions. When changing
`web/styles.css`, `web/chart-matrix-trial.css`, the metric markup, or chart
rendering, update the corresponding Chrome assertions before release.

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
The production PNG renderer and the v2 data contract are unchanged until a
separately approved migration.

## Trial motion, only on `/chart-matrix-trial`

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

## Explicit Canvas trial entry

The production page remains PNG by default. Its “Try Canvas Charts” link may
carry the **draft** node selection, Fixed nodes, duration, filter and unified
axis to `/chart-matrix-trial`; the trial's “Production PNG” link carries the
same controls back. Neither navigation may submit a query automatically, and
the destination must validate all IDs and limits against the fresh node list
before restoring controls. An invalid or stale link falls back to empty
controls. This link is an opt-in navigation path, not a default renderer switch
or an access-control boundary. The user must press Show Charts/Results to load.

## Required checks

Run `tests/query-handoff.test.cjs`, `tests/frontend-browser.cjs` and
`tests/chart-matrix-browser.cjs` in Chrome
after changes to these rules. They assert borderless surfaces, edge-to-edge
stacked separators, five-column per-item left alignment with whole-item
centering, and the 2×2 divider at representative container widths. Review
desktop and 390px chart screenshots; run the production smoke test only after
authorized deployment. Automatic checks complement, but do not replace,
visual and keyboard inspection.
