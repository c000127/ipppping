# Frontend visual invariants

Updated 2026-09-28. These are acceptance rules for both the production page
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
per-sample whisker/cap/halo icons. Nonzero peak loss uses a narrow, fixed
coral-colored time bar, with height showing loss percentage. **Do not color
the bars by severity or apply a vertical color gradient.** Only the card's
Loss number follows the continuous amber→orange→red severity scale; 0% is
neutral. A 100% peak in a mixed interval stays a narrow full-height bar.
When **every** consolidated bucket in an interval has 100% loss, fill the
entire measured interval width and plot height instead of overlaying a thin
center bar. Merge adjacent complete-loss intervals into one seamless span;
if they cover the whole queried window, the entire plot width is filled.
Unmeasured gaps must remain unfilled. Missing latency remains a break in the
RTT line. The legend must describe the marks actually drawn. The production
PNG renderer and its data contract are unchanged until a separately approved
migration.

## Required checks

Run `tests/frontend-browser.cjs` and `tests/chart-matrix-browser.cjs` in Chrome
after changes to these rules. They assert borderless surfaces, edge-to-edge
stacked separators, five-column per-item left alignment with whole-item
centering, and the 2×2 divider at representative container widths. Review
desktop and 390px chart screenshots; run the production smoke test only after
authorized deployment. Automatic checks complement, but do not replace,
visual and keyboard inspection.
