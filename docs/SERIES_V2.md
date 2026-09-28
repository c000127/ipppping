# Experimental series v2 contract

Status: v2 series deployed 2026-09-23 for the separate opt-in `/chart-trial`;
the bounded summary-batch endpoint and `/chart-matrix-trial` were deployed as
another opt-in path on 2026-09-28. Legacy `/api/series`, stats and PNG remain
compatible. The main page still uses PNG charts. See the
[public release record](FRONTEND_PUBLIC_RELEASE.md).

`GET /api/v2/series?source=ID&target=ID&type=v4&dur=10800&points=720`

The default `encoding=objects` returns `bins` as before. `encoding=columns`
returns `encoding: "columns-v1"` and a `columns` object whose equal-length arrays
use the same fields and order as `bins`; this is lossless, not downsampling.
The trial requests columns; object clients remain compatible. `Accept-Encoding:
gzip` is negotiated with quality values, `Vary: Accept-Encoding` is emitted, and
gzip/identity bytes are cached within the existing shared bounded stats cache.
An API test checks that actual HTTP gzip decompresses to the identity response.

`GET /api/v2/summary` accepts the same parameters but omits `bins` and aggregation
metadata. Both use the same snapshot/statistics implementation and existing
8 MiB / 256-entry total stats cache, not independent unlimited caches. A batch
summary and matrix integration were deferred until G3 passed. P4 now exposes
a bounded summary-batch endpoint for its separate trial page, but the production
main Charts page does not use it.

## P4 summary-batch (opt-in trial; not main Charts)

`GET /api/v2/summary-batch?nodes=ID,ID&anchor=ID,ID&dur=10800&end=E&offset=0&limit=16`
uses the same selection and multi-Fixed direction rules as `/api/pairs`. `anchor`
is optional. It returns `schema: "ipppping.summary-batch.v2"`, a stable
`selection_id` digest of the ordered legal pair list, frozen `end`, `dur`,
`offset`, `limit`, `total`, `next_offset` and `items` in pair order. Each
successful item is the regular `/api/v2/summary` contract plus
`source`/`target`/`protocol`; an unavailable route instead has those identities
and `error: no_data`, `snapshot_changed` or `rrd_error`. A single route failure
does not discard the other summaries or automatically request PNG.

`limit` is 1–32, default 16; `offset` is 0–`total`. The response always includes
the chosen minute-aligned `end`, which the client must explicitly reuse on every
page to avoid crossing a sampling boundary while constructing one unified axis.
The client must also reject pages whose `selection_id` or `total` differs.
The existing 20-node/500-pair selection limits apply. Each page uses at most
two RRDtool workers (or fewer if the configured shared worker limit is lower).
Only one v2 summary page is admitted at a time, alongside the shared batch
admission limit (default four) and executor used by legacy stats-batch. Gzip is negotiated with
`Accept-Encoding` and `Vary`;
`Cache-Control: no-store` prevents a browser from silently reusing a partial
matrix. A busy page returns 503 with `Retry-After: 2`. Raw RRD snapshots share
the existing bounded stats cache; this endpoint creates no independent cache.
The opt-in `/chart-matrix-trial` frontend requests pages sequentially. Its first
page may omit `end` and accept the server's completed-minute value; every later
summary page and visible series request explicitly reuses that value. It checks
`selection_id`, `total`, page order, route identity and window before drawing.
Only after all summaries arrive does it freeze the unified Y axis. At most four
visible Canvas instances and two series requests run at once; the series cache
is limited to eight entries / 2 MiB. This trial is public but not linked from
the production main page. A 480-route hot-inode synthetic RRD benchmark and
30-minute local Chrome lifecycle test are recorded in the [P4 report](FRONTEND_P4_REPORT.md);
full production-scale load, main-page integration and final G4 acceptance remain open.

## Parameters and errors

- `source`, `target`: existing inventory IDs, different, supported protocol.
  External nodes are destination-only. No user-supplied path is accepted.
- `type`: v4/v6; `dur`: 3600/10800/21600/86400 seconds.
- `end`: optional Unix seconds, minute-aligned, not future, within the past 48h;
  defaults to the latest completed minute. Requested window is `(end-dur,end]`.
- `points`: one of 120, 360, 720, 1440; a hard output-bin bound, not a guarantee
  that an aggregate is an original sample. Trial permits explicit budget selection.
- 400 invalid parameters/route; 404 no RRD; 502 invalid/failed RRD read;
  503 when RRD changes during both read attempts, with Retry-After: 2.
  Legacy server HTTP-worker capacity also remains bounded.

Fetch and lastupdate run under the existing RRDtool semaphore. File mtime is
checked before/after the two calls, only as a snapshot consistency revision,
**never as a measurement timestamp**. A changed file is retried once; a partial
snapshot is not served. Cache keys include path/revision/window but not pixel size.

## Envelope

- `schema`: `ipppping.series.v2`.
- `source`, `target`, `protocol`: stable identities.
- `generated_at`: construction time, not probe time; may be cached.
- `snapshot_id`: content digest including window, raw current metadata and rows;
  independent of output budget and generation time. Identical contents can share IDs.
- `units`: latency ms, loss percent, time Unix seconds.
- `window`: requested bounds, actual full-bucket coverage bounds, actual step,
  bucket timestamp = end. Only buckets fully inside the requested window count.
- `pings_per_probe`: inferred from validated `pingN` DS columns, not fixed at 20.
- `consolidation`: RRD AVERAGE. Already-consolidated history cannot recover
  individual ping timings or missed peaks within an RRA's historical averaging.
- `current`: raw lastupdate timestamp and values only if the update lies within
  the requested window. Outside-window values are null and state explicitly
  `outside_window`; no last-valid/average substitution. A just-arrived input may
  therefore be outside the last completed-minute window. `rrd_updated_at` remains
  available to explain this. Unknown loss and median give a missing measurement.
- `freshness`: sourced from lastupdate; stale threshold 600 seconds. Clients must
  evaluate age using measurement time, not generation time. No polling implied.

## Summary (before drawing aggregation)

All included buckets have equal duration, verified from fetch timestamps.

- `average_ms`: arithmetic mean of finite consolidated bucket medians.
- `min_median_ms` / `max_median_ms`: extrema of those medians, **not ping extrema**.
- `loss_pct`: mean of finite per-bucket loss fractions ×100; unknowns excluded.
- `bucket_count`, `latency_bucket_count`, `loss_bucket_count`: explicit denominators.
- `measurement_coverage`: buckets with a finite median OR loss × step / duration.
- `latency_coverage`: finite-median buckets × step / duration.
- `last_valid_latency_bucket_end`: historical valid bucket end, not Current.

Empty valid sets give null, not zero. An all-loss bucket can be a valid measurement
with null latency. Unknown coverage is not silently counted as successful probes.
Coarse RRA buckets represent their full duration; no precision is invented at edges.

## Drawing aggregation: interval-envelope-v1

Partition consecutive rows into groups of `ceil(input_points / points)`.
Each output bin describes its true start/end and number of source buckets:

- `median_mean_ms`: mean of medians only when **every** member RTT is known;
  otherwise null, forcing a line break across the aggregate interval.
- `min_median_ms`, `max_median_ms`: extrema of known medians even in a partial
  interval. The opt-in single-route trial can inspect them as isolated marks;
  the matrix trial omits the median-range overlay. Neither bridges RTT gaps.
- `loss_mean_pct`, `loss_max_pct`: known-loss mean/maximum.
- `loss_event_count`, `full_loss_count`, `missing_latency_count`,
  `missing_measurement_count`: retain event severity/count without pretending to
  preserve unbounded individual event timestamps in a bounded response.

The opt-in matrix trial uses an interval-width mean-loss block only when
`loss_event_count == count` and `missing_measurement_count == 0`; a narrow mark
otherwise shows `loss_max_pct` at the aggregate interval's center. Where a
filled mean-loss block also has a higher maximum, the narrow peak mark begins
at the mean height. These shapes do not locate an individual lost ping within
the interval. Adjacent equal-height fills may merge without altering data.

Exact event timing inside an aggregate is not implied. Use a larger allowed
budget/shorter window to inspect more precise consolidated buckets. No interpolation,
spline smoothing, gap filling or derived jitter is used. Dense alternating gaps
may suppress the mean line entirely, while extrema/events remain visible and tabulated.

## Compatibility caveat

P1 legacy stats use graph-pixel consolidation; v2 uses fetched RRA buckets.
Across isolated 24h synthetic RRD runs, v2 reported a 999 ms maximum and about
10.688 ms average / 0.0869% loss. Depending on graph-pixel alignment, legacy
statistics reported a maximum of either 504.5 or 999 ms, with differing average
and loss. Graph-pixel alignment can affect extrema as well as averages; no fixed
divergence is assumed.
This is why v2 is opt-in and not silently substituted into existing cards.
The trial PNG button uses the existing rolling-window endpoint, explicitly labelled
as such; only the isolated benchmark freezes PNG and v2 to exactly the same window.
