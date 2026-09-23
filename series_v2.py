"""Opt-in RRD reader using the existing total cache and subprocess semaphore."""
import os
import subprocess
import time
import gzip
import json

from config import GRAPH_SEMAPHORE, STATS_CACHE, STATS_CACHE_TTL, TIMEZONE
from runtime import serialized_keys
from series_contract import snapshot, response


def accepts_gzip(header):
    preferences = {}
    for entry in (header or '').lower().split(','):
        name, *params = entry.strip().split(';')
        quality = 1.0
        for param in params:
            if param.strip().startswith('q='):
                try:
                    quality = float(param.strip()[2:])
                except ValueError:
                    quality = 0.0
        preferences[name] = quality if 0 <= quality <= 1 else 0.0
    return preferences.get('gzip', preferences.get('*', 0)) > 0


def wire_response(value, budget, summary_only, identity, encoding='objects', compressed=False):
    key = ('v2-wire', value['snapshot_id'], budget, summary_only, identity, encoding, compressed)
    cached = STATS_CACHE.get_value(key)
    if cached is not None:
        return cached
    result = response(value, budget, summary_only, encoding)
    result.update(dict(zip(('source', 'target', 'protocol'), identity)))
    body = json.dumps(result, allow_nan=False, separators=(',', ':')).encode()
    if compressed:
        body = gzip.compress(body, compresslevel=3, mtime=0)
    STATS_CACHE.put(key, body, STATS_CACHE_TTL)
    return body


@serialized_keys
def read_snapshot(path, start, end, parse_latest):
    for attempt in range(2):
        revision = os.stat(path).st_mtime_ns
        key = ('series-v2', str(path), revision, start, end)
        cached = STATS_CACHE.get_value(key)
        if cached is not None:
            return cached
        env = {**os.environ, 'TZ': TIMEZONE}
        with GRAPH_SEMAPHORE:
            fetch = subprocess.run(['rrdtool', 'fetch', str(path), 'AVERAGE', '--start', str(start), '--end', str(end)],
                                   capture_output=True, text=True, timeout=12, check=True, env=env)
            latest = subprocess.run(['rrdtool', 'lastupdate', str(path)], capture_output=True, text=True,
                                    timeout=5, check=True, env=env)
        if os.stat(path).st_mtime_ns != revision:
            continue
        value = snapshot(fetch.stdout, parse_latest(latest.stdout), start, end, int(time.time()))
        STATS_CACHE.put(key, value, STATS_CACHE_TTL)
        return value
    raise RuntimeError('RRD changed while reading; retry later')
