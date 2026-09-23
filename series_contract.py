"""Pure v2 bucket statistics. No filesystem, clock, network or chart dependency."""
import hashlib
import json
import math
import re

POINT_BUDGETS = (120, 360, 720, 1440)
BIN_FIELDS = ('start', 'end', 'count', 'median_mean_ms', 'min_median_ms',
              'max_median_ms', 'loss_mean_pct', 'loss_max_pct', 'loss_event_count',
              'full_loss_count', 'missing_latency_count', 'missing_measurement_count')


def number(token):
    try:
        value = float(token)
    except (ValueError, TypeError):
        return None
    return value if math.isfinite(value) and value >= 0 else None


def parse_fetch(text, start, end):
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if not lines or len(lines) > 10002:
        raise ValueError('invalid or excessive RRD fetch output')
    names = lines[0].split()
    if not {'median', 'loss'}.issubset(names) or len(set(names)) != len(names):
        raise ValueError('invalid RRD columns')
    pings = sum(bool(re.fullmatch(r'ping\d+', name)) for name in names)
    if not pings:
        raise ValueError('ping count unavailable')
    rows = []
    stamps = []
    for line in lines[1:]:
        stamp, sep, rest = line.partition(':')
        values = rest.split()
        if not sep or len(values) != len(names):
            raise ValueError('invalid RRD row')
        stamp = int(stamp)
        if stamps and stamp <= stamps[-1]:
            raise ValueError('unordered RRD rows')
        stamps.append(stamp)
        data = dict(zip(names, map(number, values)))
        loss = data['loss']
        if loss is not None and loss > pings:
            raise ValueError('loss exceeds ping count')
        rows.append({'end': stamp, 'median_ms': None if data['median'] is None else data['median'] * 1000,
                     'loss_pct': None if loss is None else loss * 100 / pings})
    steps = {b - a for a, b in zip(stamps, stamps[1:])}
    if len(steps) != 1:
        raise ValueError('RRD step is unavailable or irregular')
    step = steps.pop()
    # Only fully covered consolidated buckets. Never invent partial-bucket precision.
    return [row for row in rows if start <= row['end'] - step and row['end'] <= end], step, pings


def mean(values):
    return sum(values) / len(values) if values else None


def summarize(rows, step, start, end):
    medians = [r['median_ms'] for r in rows if r['median_ms'] is not None]
    losses = [r['loss_pct'] for r in rows if r['loss_pct'] is not None]
    measured = [r for r in rows if r['median_ms'] is not None or r['loss_pct'] is not None]
    return {'average_ms': mean(medians), 'min_median_ms': min(medians) if medians else None,
            'max_median_ms': max(medians) if medians else None, 'loss_pct': mean(losses),
            'bucket_count': len(rows), 'latency_bucket_count': len(medians), 'loss_bucket_count': len(losses),
            'measurement_coverage': len(measured) * step / (end - start),
            'latency_coverage': len(medians) * step / (end - start),
            'last_valid_latency_bucket_end': next((r['end'] for r in reversed(rows) if r['median_ms'] is not None), None)}


def aggregate(rows, step, budget):
    if budget not in POINT_BUDGETS:
        raise ValueError('unsupported point budget')
    width = max(1, math.ceil(len(rows) / budget))
    result = []
    for offset in range(0, len(rows), width):
        group = rows[offset:offset + width]
        latencies = [r['median_ms'] for r in group if r['median_ms'] is not None]
        losses = [r['loss_pct'] for r in group if r['loss_pct'] is not None]
        result.append({
            'start': group[0]['end'] - step, 'end': group[-1]['end'], 'count': len(group),
            # Any absent RTT breaks the line across the entire aggregate interval.
            'median_mean_ms': mean(latencies) if len(latencies) == len(group) else None,
            'min_median_ms': min(latencies) if latencies else None,
            'max_median_ms': max(latencies) if latencies else None,
            'loss_mean_pct': mean(losses), 'loss_max_pct': max(losses) if losses else None,
            'loss_event_count': sum(r['loss_pct'] is not None and r['loss_pct'] > 0 for r in group),
            'full_loss_count': sum(r['loss_pct'] == 100 for r in group),
            'missing_latency_count': len(group) - len(latencies),
            'missing_measurement_count': sum(r['median_ms'] is None and r['loss_pct'] is None for r in group),
        })
    return result


def snapshot(fetch_text, latest, start, end, generated_at):
    rows, step, pings = parse_fetch(fetch_text, start, end)
    if latest.get('pings') is not None and latest['pings'] != pings:
        raise ValueError('lastupdate/fetch ping count mismatch')
    # Raw latest input may be newer than this explicit historical window.
    stamp = latest.get('rrd_updated_at')
    in_window = stamp is not None and start < stamp <= end
    current = {'scope': 'raw_lastupdate_within_requested_window',
               'rrd_updated_at': stamp, 'measurement_updated_at': latest.get('measurement_updated_at') if in_window else None,
               'current_ms': latest.get('current_ms') if in_window else None,
               'current_loss_pct': latest.get('current_loss_pct') if in_window else None,
               'state': latest.get('measurement_state', 'unknown') if in_window else 'outside_window'}
    result = {'schema': 'ipppping.series.v2', 'generated_at': generated_at,
              'window': {'start': start, 'end': end, 'bucket_timestamp': 'end', 'interval': '(start,end]',
                         'actual_start': rows[0]['end'] - step if rows else None,
                         'actual_end': rows[-1]['end'] if rows else None, 'step_seconds': step},
              'units': {'latency': 'ms', 'loss': 'percent', 'time': 'unix_seconds'},
              'pings_per_probe': pings, 'consolidation': 'RRD AVERAGE; not raw individual pings',
              'current': current, 'freshness': {'source': 'rrd_lastupdate', 'stale_after_seconds': 600,
                                               'allowed_future_skew_seconds': 120},
              'summary': summarize(rows, step, start, end), 'rows': rows}
    fingerprint = {key: value for key, value in result.items() if key != 'generated_at'}
    result['snapshot_id'] = hashlib.sha256(json.dumps(fingerprint, sort_keys=True, allow_nan=False).encode()).hexdigest()[:24]
    return result


def response(value, budget=720, summary_only=False, encoding='objects'):
    if encoding not in ('objects', 'columns'):
        raise ValueError('unsupported series encoding')
    result = {key: item for key, item in value.items() if key != 'rows'}
    if not summary_only:
        bins = aggregate(value['rows'], value['window']['step_seconds'], budget)
        if encoding == 'columns':
            result['encoding'] = 'columns-v1'
            result['columns'] = {key: [b[key] for b in bins] for key in BIN_FIELDS}
        else:
            result['bins'] = bins
        result['aggregation'] = {'algorithm': 'interval-envelope-v1', 'requested_budget': budget,
                                 'input_points': len(value['rows']), 'output_points': len(bins),
                                 'gap_policy': 'any missing RTT breaks aggregate line',
                                 'extrema': 'min/max of consolidated medians, not individual ping extrema'}
    return result
