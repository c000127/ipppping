"""Bounded P4 lab on the controller; synthetic temporary RRD only.

Copies source text over stdin, does not install it, touch production RRDs or
restart a service. The default 480 hard links share one hot inode. Optional
distinct files test inode fan-out; cold-hint asks Linux to evict only these
temporary files and reports actual child disk reads, without dropping global
page cache. This remains an isolated lab, not production cold-disk proof.
Usage: python tests/run-matrix-rrd-lab.py root@HOST PORT [workers=4] [shared|distinct|cold-hint] [serial|multiuser]
"""
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
FILES = ('server.py', 'config.py', 'runtime.py', 'nodes.py', 'rrd.py', 'series_v2.py', 'series_contract.py')
REMOTE = r'''
import gzip, json, os, pathlib, resource, shutil, subprocess, sys, tempfile, threading, time
os.nice(10)
try:
    subprocess.run(['ionice', '-c', '2', '-n', '7', '-p', str(os.getpid())],
                   check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
except FileNotFoundError:
    pass
with tempfile.TemporaryDirectory(prefix='ipppping-p4-lab-',
                                 dir='/root' if mode != 'shared' else None) as temp:
    root = pathlib.Path(temp)
    for name, contents in payload.items():
        (root / name).write_text(contents)
    sys.path.insert(0, str(root))
    import server
    server.MAX_GRAPH_WORKERS = worker_limit
    server.MAX_V2_SUMMARY_WORKERS = worker_limit
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
    if mode != 'shared':
        if os.stat('/root').st_dev != os.stat('/opt/ipppping').st_dev:
            raise RuntimeError('synthetic lab directory is not on the production filesystem')
        if (rrd.stat().st_size * 480 > 64 * 1024 * 1024 or
                shutil.disk_usage('/root').free < 256 * 1024 * 1024):
            raise RuntimeError('synthetic RRD size or free-space safety limit exceeded')
    server.NODES = [{'id': f'v{i}', 'label': f'V{i}', 'group': 'vps', 'v4': True, 'v6': True}
                    for i in range(16)]
    ids = [node['id'] for node in server.NODES]
    pairs = server.make_pairs(ids)
    assert len(pairs) == 480
    files = {}
    route_files = []
    for index, pair in enumerate(pairs):
        route = (pair['source'], pair['target'], pair['type'])
        link = root / f'route-{index}.rrd'
        if mode == 'shared':
            os.link(rrd, link)
        else:
            shutil.copyfile(rrd, link)
            if mode == 'cold-hint':
                with link.open('rb') as temporary:
                    os.fsync(temporary.fileno())
        files[route] = link
        route_files.append(link)
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
        if mode == 'cold-hint':
            for link in route_files[offset:offset+32]:
                with link.open('rb') as temporary:
                    os.posix_fadvise(temporary.fileno(), 0, 0, os.POSIX_FADV_DONTNEED)
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
              'distinct_path_cache_keys': 480, 'mode': mode,
              'distinct_inode_count': len({link.stat().st_ino for link in route_files}),
              'synthetic_rrd_bytes_total': rrd.stat().st_size * len(route_files),
              'temporary_directory': str(root),
              'fadvise_is_cold_proof': False,
              'pages': 15, 'items': 480, 'page_limit': 32, 'worker_limit': worker_limit,
              'total_wall_ms': (time.perf_counter() - before) * 1000,
              'page_ms': {'min': min(page_times), 'median': sorted(page_times)[7], 'max': max(page_times)},
              'rrdtool_calls': counts['calls'], 'peak_rrdtool_processes': counts['peak'],
              'child_cpu_ms': ((after_child.ru_utime + after_child.ru_stime) -
                               (before_child.ru_utime + before_child.ru_stime)) * 1000,
              'child_input_blocks': after_child.ru_inblock - before_child.ru_inblock,
              'child_major_faults': after_child.ru_majflt - before_child.ru_majflt,
              'api_peak_rss_kib': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
              'cache_items_at_end': len(server.STATS_CACHE.entries),
              'cache_bytes_at_end': server.STATS_CACHE.bytes,
              'json_bytes': bytes_plain, 'gzip_bytes': bytes_gzip}
    if scenario == 'multiuser':
        # Bounded admission test only. No production HTTP listener or RRD is used.
        from concurrent.futures import ThreadPoolExecutor
        server.STATS_CACHE.clear()
        counts.update(calls=0, active=0, peak=0)
        duration, clients, think_seconds = 120, 3, 2
        stop = threading.Event()
        barrier = threading.Barrier(clients)
        outcomes, rss_samples, stopped_for_memory = [], [], False
        def current_memory():
            rss = next(int(line.split()[1]) for line in pathlib.Path('/proc/self/status').read_text().splitlines()
                       if line.startswith('VmRSS:'))
            available = next(int(line.split()[1]) for line in pathlib.Path('/proc/meminfo').read_text().splitlines()
                             if line.startswith('MemAvailable:'))
            return {'rss_kib': rss, 'host_available_kib': available}
        multi_started = time.monotonic()
        deadline = multi_started + duration
        multi_child_before = resource.getrusage(resource.RUSAGE_CHILDREN)
        def client(client_id):
            result = {'client': client_id, 'accepted_pages': 0, 'busy': 0,
                      'completed_matrices': 0, 'failed_matrices': 0, 'page_ms': [], 'errors': []}
            round_number = 0
            barrier.wait()
            while time.monotonic() < deadline and not stop.is_set():
                query_end = end - (client_id + 1 + round_number * clients) * 60
                completed = True
                for offset in range(0, 480, 32):
                    accepted = False
                    for attempt in range(3):
                        if time.monotonic() >= deadline or stop.is_set():
                            break
                        params = {'nodes': [selected], 'dur': ['10800'], 'end': [str(query_end)],
                                  'offset': [str(offset)], 'limit': ['32']}
                        request_started = time.monotonic()
                        body, status = server.handle_v2_summary_batch(params)
                        if status == 200:
                            decoded = json.loads(body)
                            assert decoded['end'] == query_end and decoded['offset'] == offset
                            assert decoded['total'] == 480 and len(decoded['items']) == 32
                            assert all('summary' in item for item in decoded['items'])
                            result['page_ms'].append((time.monotonic() - request_started) * 1000)
                            result['accepted_pages'] += 1
                            accepted = True
                            break
                        if status != 503:
                            result['errors'].append({'status': int(status), 'offset': offset})
                            break
                        result['busy'] += 1
                        stop.wait(2)
                    if not accepted:
                        completed = False
                        break
                    stop.wait(think_seconds)
                if completed:
                    result['completed_matrices'] += 1
                elif time.monotonic() < deadline and not stop.is_set():
                    result['failed_matrices'] += 1
                round_number += 1
                stop.wait(think_seconds)
            return result
        with ThreadPoolExecutor(max_workers=clients) as executor:
            futures = [executor.submit(client, index) for index in range(clients)]
            while time.monotonic() < deadline and not all(future.done() for future in futures):
                sample = {'elapsed': time.monotonic() - multi_started, **current_memory()}
                rss_samples.append(sample)
                if sample['rss_kib'] > 128 * 1024 or sample['host_available_kib'] < 256 * 1024:
                    stopped_for_memory = True
                    stop.set()
                    break
                stop.wait(2)
            stop.set()
            outcomes = [future.result() for future in futures]
        multi_child_after = resource.getrusage(resource.RUSAGE_CHILDREN)
        latencies = sorted(value for result in outcomes for value in result['page_ms'])
        assert counts['peak'] <= worker_limit
        assert server.STATS_CACHE.bytes <= 8 * 1024 * 1024 and len(server.STATS_CACHE.entries) <= 256
        assert latencies and not any(result['errors'] for result in outcomes)
        assert not stopped_for_memory, 'isolated lab memory safety threshold reached'
        report['multiuser'] = {'simulated_clients': clients, 'scheduled_seconds': duration,
                              'observed_seconds': time.monotonic() - multi_started,
                              'think_seconds_per_page': think_seconds, 'retry_limit': 2,
                              'accepted_pages': sum(result['accepted_pages'] for result in outcomes),
                              'busy_responses': sum(result['busy'] for result in outcomes),
                              'rrdtool_calls': counts['calls'], 'peak_rrdtool_processes': counts['peak'],
                              'child_cpu_ms': ((multi_child_after.ru_utime + multi_child_after.ru_stime) -
                                               (multi_child_before.ru_utime + multi_child_before.ru_stime)) * 1000,
                              'page_ms': {'median': latencies[len(latencies)//2],
                                          'p95': latencies[min(len(latencies)-1, int(len(latencies)*.95))]},
                              'clients': outcomes, 'memory_samples': rss_samples,
                              'stopped_for_memory': stopped_for_memory,
                              'cache_items_at_end': len(server.STATS_CACHE.entries),
                              'cache_bytes_at_end': server.STATS_CACHE.bytes,
                              'production_capacity_proof': False}
    server.BATCH_EXECUTOR.shutdown()
    print(json.dumps(report))
'''

if __name__ == '__main__':
    if len(sys.argv) not in (3, 4, 5, 6):
        raise SystemExit(__doc__)
    workers = int(sys.argv[3]) if len(sys.argv) >= 4 else 4
    if workers not in (1, 2, 4):
        raise SystemExit('workers must be 1, 2 or 4')
    mode = sys.argv[4] if len(sys.argv) >= 5 else 'shared'
    if mode not in ('shared', 'distinct', 'cold-hint'):
        raise SystemExit('mode must be shared, distinct or cold-hint')
    scenario = sys.argv[5] if len(sys.argv) == 6 else 'serial'
    if scenario not in ('serial', 'multiuser'):
        raise SystemExit('scenario must be serial or multiuser')
    payload = {name: (ROOT / name).read_text(encoding='utf-8') for name in FILES}
    script = ('payload = ' + repr(payload) + '\nworker_limit = ' + repr(workers) +
              '\nmode = ' + repr(mode) + '\nscenario = ' + repr(scenario) + '\n' + REMOTE)
    result = subprocess.run(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
                             '-o', 'StrictHostKeyChecking=yes', '-p', sys.argv[2],
                             sys.argv[1], 'python3', '-'], input=script.encode(),
                            capture_output=True, timeout=300)
    if result.returncode:
        raise SystemExit(result.stderr.decode(errors='replace'))
    report = json.loads(result.stdout)
    suffix = '-' + mode if mode != 'shared' else ''
    if scenario != 'serial':
        suffix += '-' + scenario
    target = ROOT / f'test-results/p4-matrix-rrd-lab-{workers}{suffix}.json'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2))
