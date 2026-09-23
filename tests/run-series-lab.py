"""Isolated synthetic RRD benchmark on the controller; never opens production RRDs.

Usage: python tests/run-series-lab.py root@HOST PORT
Remote TemporaryDirectory is removed on exit. No installation or service restart.
"""
import json
import base64
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
FILES = ('server.py', 'config.py', 'runtime.py', 'nodes.py', 'rrd.py', 'series_v2.py', 'series_contract.py')
REMOTE = r'''
import base64, gzip, importlib, json, os, pathlib, platform, resource, subprocess, sys, tempfile, time
os.nice(10)
with tempfile.TemporaryDirectory(prefix='ipppping-p3-lab-') as temp:
    root = pathlib.Path(temp)
    for name, text in payload.items():
        (root / name).write_text(text)
    sys.path.insert(0, str(root))
    import server, series_contract, series_v2
    end = int(time.time()) // 60 * 60 - 120
    start = end - 86400
    rrd = root / 'synthetic.rrd'
    names = ['uptime', 'loss', 'median'] + [f'ping{i}' for i in range(1, 21)]
    subprocess.run(['rrdtool','create',str(rrd),'--start',str(start-60),'--step','60']
        + [f'DS:{name}:GAUGE:60:0:U' for name in names] + ['RRA:AVERAGE:0.5:1:1600'], check=True)
    updates = []
    for i in range(1441):
        median, loss = ('0.999', '5') if i == 1300 else ('0.010', '0')
        if i == 1301: median, loss = 'U', '20'
        if i == 1302: median, loss = 'U', 'U'
        updates.append(f'{start+i*60}:U:{loss}:{median}:' + ':'.join([median] * 20))
    subprocess.run(['rrdtool','update',str(rrd)] + updates, check=True)
    original_run = subprocess.run
    calls = 0
    # Freeze graph and legacy statistics to the same explicit window as v2.
    def frozen_run(command, *args, **kwargs):
        global calls
        if command[0] == 'rrdtool':
            calls += 1
            if command[1] == 'graph':
                command = list(command)
                pos = command.index('-s')
                command[pos+1] = str(end - duration)
                command += ['--end', str(end)]
        return original_run(command, *args, **kwargs)
    subprocess.run = frozen_run
    server.resolve_rrd = lambda *args: (str(rrd), {'label':'Fixture A'}, {'label':'Fixture B'})
    report = {'synthetic': True, 'same_frozen_window': True, 'platform': platform.platform(),
              'rrdtool': original_run(['rrdtool','--version'],capture_output=True,text=True).stdout.splitlines()[0],
              'samples_per_case': 30, 'cases': [], 'production_files_read': False}
    for duration in (10800, 86400):
        snap = series_v2.read_snapshot(str(rrd), end-duration, end, server.parse_lastupdate)
        assert snap['summary']['max_median_ms'] == 999
        assert snap['current']['current_ms'] == 10
        exact = series_contract.response(snap, 1440)
        compact = series_contract.response(snap, 120)
        assert exact['summary'] == compact['summary']
        assert sum(b['full_loss_count'] for b in compact['bins']) >= 1
        assert sum(b['missing_measurement_count'] for b in compact['bins']) >= 1
        assert all(b['median_mean_ms'] is None for b in compact['bins'] if b['missing_latency_count'])
        legacy = server.rrd_fetch_stats(str(rrd), duration)
        report.setdefault('statistics_comparison', []).append({'duration': duration, 'v2': snap['summary'], 'legacy_pixel_stats': legacy})
        params = {'source':['fixture_a'], 'target':['fixture_b'], 'type':['v4'], 'dur':[str(duration)], 'w':['900'], 'h':['320']}
        for method in ('png', 'v2-columns', 'v2-gzip'):
            for cache in ('cold', 'warm'):
                elapsed, cpu, processes = [], [], []
                for sample in range(31):
                    time.sleep(0.05)  # sequential, low priority; never load-test production
                    if cache == 'cold':
                        server.STATS_CACHE.clear(); server.GRAPH_CACHE.clear()
                    before_calls = calls
                    before_cpu = resource.getrusage(resource.RUSAGE_CHILDREN)
                    before = time.perf_counter()
                    if method == 'png':
                        body, status, *mime = server.handle_graph(params)
                        assert status == 200
                    else:
                        value = series_v2.read_snapshot(str(rrd), end-duration, end, server.parse_lastupdate)
                        body = series_v2.wire_response(value, 720, False, ('fixture_a', 'fixture_b', 'v4'), 'columns', method == 'v2-gzip')
                    after_cpu = resource.getrusage(resource.RUSAGE_CHILDREN)
                    if sample:
                        elapsed.append((time.perf_counter()-before)*1000)
                        cpu.append((after_cpu.ru_utime + after_cpu.ru_stime - before_cpu.ru_utime - before_cpu.ru_stime)*1000)
                        processes.append(calls-before_calls)
                elapsed.sort(); cpu.sort()
                report['cases'].append({'duration':duration, 'method':method, 'cache':cache,
                    'median_ms':elapsed[14], 'p95_ms':elapsed[28], 'rrd_child_cpu_median_ms':cpu[14],
                    'rrd_calls_per_request':max(processes), 'bytes':len(body), 'offline_gzip_bytes':len(gzip.compress(body))})
        if duration == 10800:
            for width in (320, 900):
                png, status, *mime = server.handle_graph({**params, 'w':[str(width)]})
                assert status == 200
                report.setdefault('png_fixtures', {})[str(width)] = base64.b64encode(png).decode()
        if duration == 86400:
            png, status, *mime = server.handle_graph(params)
            assert status == 200
            columns = series_v2.wire_response(snap, 720, False, ('fixture_a', 'fixture_b', 'v4'), 'columns', False)
            report['browser_fixtures'] = {'png': base64.b64encode(png).decode(), 'columns': base64.b64encode(columns).decode()}
    report['api_process_peak_rss_kib_cumulative'] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    server.BATCH_EXECUTOR.shutdown()
    print(json.dumps(report, indent=2))
'''

if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    payload = {name: (ROOT / name).read_text(encoding='utf-8') for name in FILES}
    script = 'payload = ' + repr(payload) + '\n' + REMOTE
    result = subprocess.run(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-p', sys.argv[2], sys.argv[1], 'python3', '-'],
                            input=script.encode(), capture_output=True, timeout=300)
    if result.returncode:
        raise SystemExit(result.stderr.decode(errors='replace'))
    report = json.loads(result.stdout)
    output = ROOT / 'test-results/p3/rrd-report.json'
    output.parent.mkdir(parents=True, exist_ok=True)
    for width, data in report.pop('png_fixtures', {}).items():
        (output.parent / f'rrd-{width}.png').write_bytes(base64.b64decode(data))
    browser = report.pop('browser_fixtures', {})
    if browser:
        (output.parent / 'rrd-24h.png').write_bytes(base64.b64decode(browser['png']))
        (output.parent / 'rrd-24h-columns.json').write_bytes(base64.b64decode(browser['columns']))
    output.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2))
