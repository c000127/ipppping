"""Bounded P4 lab on the controller; synthetic temporary RRD only.

Copies source text over stdin, does not install it, touch production RRDs or
restart a service. The 480 hard links have distinct path/cache keys but share
one hot inode; this is a subprocess/CPU/API cost test, not cold-disk evidence.
Usage: python tests/run-matrix-rrd-lab.py root@HOST PORT
"""
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
FILES = ('server.py', 'config.py', 'runtime.py', 'nodes.py', 'rrd.py', 'series_v2.py', 'series_contract.py')
REMOTE = r'''
import gzip, json, os, pathlib, resource, subprocess, sys, tempfile, threading, time
os.nice(10)
with tempfile.TemporaryDirectory(prefix='ipppping-p4-lab-') as temp:
    root = pathlib.Path(temp)
    for name, contents in payload.items():
        (root / name).write_text(contents)
    sys.path.insert(0, str(root))
    import server
    end = int(time.time()) // 60 * 60 - 120
    start = end - 10800
    rrd = root / 'synthetic.rrd'
    ds = ['uptime', 'loss', 'median'] + [f'ping{i}' for i in range(1, 21)]
    subprocess.run(['rrdtool', 'create', str(rrd), '--start', str(start-60), '--step', '60']
        + [f'DS:{name}:GAUGE:120:0:U' for name in ds] + ['RRA:AVERAGE:0.5:1:240'], check=True)
    updates = []
    for i in range(181):
        median, loss = ('0.250', '4') if i == 75 else ('0.010', '0')
        updates.append(f'{start+i*60}:U:{loss}:{median}:' + ':'.join([median] * 20))
    subprocess.run(['rrdtool', 'update', str(rrd)] + updates, check=True)
    server.NODES = [{'id': f'v{i}', 'label': f'V{i}', 'group': 'vps', 'v4': True, 'v6': True}
                    for i in range(16)]
    ids = [node['id'] for node in server.NODES]
    pairs = server.make_pairs(ids)
    assert len(pairs) == 480
    files = {}
    for index, pair in enumerate(pairs):
        route = (pair['source'], pair['target'], pair['type'])
        link = root / f'route-{index}.rrd'
        os.link(rrd, link)
        files[route] = link
    server.resolve_rrd = lambda source, target, kind: (files[(source, target, kind)], None, None)
    original_run = subprocess.run
    guard = threading.Lock()
    counts = {'calls': 0, 'active': 0, 'peak': 0}
    def counted_run(command, *args, **kwargs):
        if command[0] != 'rrdtool':
            return original_run(command, *args, **kwargs)
        with guard:
            counts['calls'] += 1
            counts['active'] += 1
            counts['peak'] = max(counts['peak'], counts['active'])
        try:
            return original_run(command, *args, **kwargs)
        finally:
            with guard:
                counts['active'] -= 1
    subprocess.run = counted_run
    server.STATS_CACHE.clear()
    page_times = []
    identities = set()
    selected = ','.join(ids)
    bytes_plain = bytes_gzip = 0
    before_child = resource.getrusage(resource.RUSAGE_CHILDREN)
    before = time.perf_counter()
    for offset in range(0, 480, 32):
        params = {'nodes': [selected], 'dur': ['10800'], 'end': [str(end)],
                  'offset': [str(offset)], 'limit': ['32']}
        started = time.perf_counter()
        body, status = server.handle_v2_summary_batch(params)
        page_times.append((time.perf_counter() - started) * 1000)
        assert status == 200, (offset, status, body[:200])
        decoded = json.loads(body)
        assert decoded['total'] == 480 and len(decoded['items']) == 32
        assert all('summary' in item for item in decoded['items'])
        identities.add(decoded['selection_id'])
        bytes_plain += len(body)
        bytes_gzip += len(gzip.compress(body, compresslevel=3, mtime=0))
        time.sleep(0.05)
    after_child = resource.getrusage(resource.RUSAGE_CHILDREN)
    assert len(identities) == 1
    assert counts['calls'] == 960, counts
    report = {'synthetic': True, 'production_rrds_read': False,
              'distinct_path_cache_keys': 480, 'shared_hot_inode': True,
              'pages': 15, 'items': 480, 'page_limit': 32,
              'total_wall_ms': (time.perf_counter() - before) * 1000,
              'page_ms': {'min': min(page_times), 'median': sorted(page_times)[7], 'max': max(page_times)},
              'rrdtool_calls': counts['calls'], 'peak_rrdtool_processes': counts['peak'],
              'child_cpu_ms': ((after_child.ru_utime + after_child.ru_stime) -
                               (before_child.ru_utime + before_child.ru_stime)) * 1000,
              'api_peak_rss_kib': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
              'cache_items_at_end': len(server.STATS_CACHE.entries),
              'cache_bytes_at_end': server.STATS_CACHE.bytes,
              'json_bytes': bytes_plain, 'gzip_bytes': bytes_gzip}
    server.BATCH_EXECUTOR.shutdown()
    print(json.dumps(report))
'''

if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    payload = {name: (ROOT / name).read_text(encoding='utf-8') for name in FILES}
    script = 'payload = ' + repr(payload) + '\n' + REMOTE
    result = subprocess.run(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
                             '-o', 'StrictHostKeyChecking=yes', '-p', sys.argv[2],
                             sys.argv[1], 'python3', '-'], input=script.encode(),
                            capture_output=True, timeout=300)
    if result.returncode:
        raise SystemExit(result.stderr.decode(errors='replace'))
    report = json.loads(result.stdout)
    target = ROOT / 'test-results/p4-matrix-rrd-lab.json'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2))
