import json
import gzip
import threading
import urllib.request
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import server
import series_contract as contract
import series_v2


def fixture(values, step=60, start=0):
    lines = ['uptime loss median ping1 ping2']
    for i, (median, loss) in enumerate(values, 1):
        val = 'U' if median is None else str(median / 1000)
        loss = 'U' if loss is None else str(loss * 2 / 100)
        lines.append(f'{start + i * step}: U {loss} {val} {val} {val}')
    return '\n'.join(lines)


class ContractTests(unittest.TestCase):
    def test_unknown_loss_and_full_loss_are_distinct(self):
        rows, step, pings = contract.parse_fetch(fixture([(10, 0), (None, 100), (None, None)]), 0, 180)
        self.assertEqual((step, pings), (60, 2))
        result = contract.summarize(rows, step, 0, 180)
        self.assertEqual(result['loss_pct'], 50)
        self.assertAlmostEqual(result['measurement_coverage'], 2 / 3)
        bins = contract.aggregate(rows, step, 120)
        self.assertEqual(bins[1]['full_loss_count'], 1)
        self.assertEqual(bins[1]['missing_measurement_count'], 0)
        self.assertEqual(bins[2]['missing_measurement_count'], 1)

    def test_all_unknown_never_becomes_zero(self):
        rows, step, _ = contract.parse_fetch(fixture([(None, None)] * 10), 0, 600)
        result = contract.summarize(rows, step, 0, 600)
        self.assertIsNone(result['loss_pct'])
        self.assertIsNone(result['average_ms'])
        self.assertEqual(result['measurement_coverage'], 0)

    def test_edges_only_include_full_buckets(self):
        rows, _, _ = contract.parse_fetch(fixture([(1, 0)] * 10), 75, 555)
        self.assertEqual([r['end'] for r in rows], list(range(180, 541, 60)))

    def test_coarse_step_not_claimed_as_raw_probe_precision(self):
        rows, step, _ = contract.parse_fetch(fixture([(2, 0)] * 5, step=300), 0, 1500)
        self.assertEqual(step, 300)
        self.assertEqual(contract.aggregate(rows, step, 120)[0]['start'], 0)

    def test_spike_and_loss_events_survive_every_budget(self):
        values = [(10, 0)] * 1440
        values[19] = (999, 25)
        values[20] = (None, 100)
        rows, step, _ = contract.parse_fetch(fixture(values), 0, 86400)
        for budget in contract.POINT_BUDGETS:
            bins = contract.aggregate(rows, step, budget)
            self.assertLessEqual(len(bins), budget)
            self.assertEqual(max(b['max_median_ms'] or 0 for b in bins), 999)
            self.assertEqual(sum(b['loss_event_count'] for b in bins), 2)
            self.assertEqual(sum(b['full_loss_count'] for b in bins), 1)
            self.assertEqual(sum(b['missing_latency_count'] for b in bins), 1)
            self.assertTrue(all(b['median_mean_ms'] is None for b in bins if b['missing_latency_count']))

    def test_alternating_gaps_never_connect_aggregates(self):
        rows, step, _ = contract.parse_fetch(fixture([(None, None), (10, 0)] * 720), 0, 86400)
        bins = contract.aggregate(rows, step, 120)
        self.assertTrue(all(b['median_mean_ms'] is None for b in bins))
        self.assertEqual(sum(b['missing_measurement_count'] for b in bins), 720)

    def test_summary_independent_of_budget_and_generation_time(self):
        text = fixture([(1, 0), (9, 100)] * 180)
        latest = {'rrd_updated_at': 21600, 'measurement_updated_at': 21600, 'current_ms': None,
                  'current_loss_pct': 100, 'measurement_state': 'measured'}
        snap = contract.snapshot(text, latest, 0, 21600, 21610)
        other = contract.snapshot(text, latest, 0, 21600, 21620)
        self.assertEqual(snap['snapshot_id'], other['snapshot_id'])
        for budget in contract.POINT_BUDGETS:
            result = contract.response(snap, budget)
            self.assertEqual(result['summary']['average_ms'], 5)
            self.assertEqual(result['summary'], snap['summary'])
            self.assertIsNone(result['current']['current_ms'])
        self.assertNotIn('bins', contract.response(snap, summary_only=True))

    def test_raw_current_outside_window_never_backfilled(self):
        snap = contract.snapshot(fixture([(9, 0)] * 10), {'rrd_updated_at': 601, 'current_ms': 5}, 0, 600, 602)
        self.assertIsNone(snap['current']['current_ms'])
        self.assertEqual(snap['current']['state'], 'outside_window')

    def test_invalid_rows_rejected(self):
        for text in ('median loss\n60: 1 0', fixture([(1, 0), (2, 0)]).replace('120:', '60:'),
                     fixture([(1, 0), (2, 150)])):
            with self.assertRaises(ValueError):
                contract.parse_fetch(text, 0, 120)


class ReaderTests(unittest.TestCase):
    def setUp(self):
        server.STATS_CACHE.clear()

    def test_columns_are_lossless_and_smaller(self):
        snap = contract.snapshot(fixture([(1.2345, 0), (None, 100)] * 720), {}, 0, 86400, 86400)
        original = contract.response(snap, 720)
        compact = contract.response(snap, 720, encoding='columns')
        columns = compact['columns']
        reconstructed = [dict(zip(columns, row)) for row in zip(*columns.values())]
        self.assertEqual(reconstructed, original['bins'])
        self.assertEqual(original['summary'], compact['summary'])
        self.assertLess(len(json.dumps(compact)), len(json.dumps(original)) / 2)

    def test_wire_cache_is_shared_and_skips_reaggregation(self):
        snap = contract.snapshot(fixture([(1, 0)] * 10), {}, 0, 600, 600)
        first = series_v2.wire_response(snap, 720, False, ('a', 'b', 'v4'), 'columns', True)
        with patch.object(series_v2, 'response', side_effect=AssertionError('recomputed warm payload')):
            second = series_v2.wire_response(snap, 720, False, ('a', 'b', 'v4'), 'columns', True)
        self.assertEqual(first, second)
        self.assertEqual(json.loads(gzip.decompress(first))['encoding'], 'columns-v1')

    def test_compression_negotiation(self):
        for header in ('gzip', 'br, gzip;q=0.5', '*;q=0.8'):
            self.assertTrue(series_v2.accepts_gzip(header))
        for header in (None, '', 'br', 'gzip;q=0,*;q=1', 'gzip;q=NaN', 'gzip;q=2'):
            self.assertFalse(series_v2.accepts_gzip(header))

    def test_real_http_gzip_and_identity_are_equivalent(self):
        snap = contract.snapshot(fixture([(10, 0)] * 60), {}, 0, 3600, 3600)
        httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        worker = threading.Thread(target=httpd.serve_forever, daemon=True)
        worker.start()
        try:
            address = f'http://127.0.0.1:{httpd.server_address[1]}/api/v2/series?source=akari_jp&target=google_dns&type=v6&encoding=columns'
            with patch.object(server, 'resolve_rrd', return_value=('fixture', {}, {})), patch.object(server, 'read_snapshot', return_value=snap):
                with urllib.request.urlopen(urllib.request.Request(address, headers={'Accept-Encoding': 'gzip'})) as response:
                    self.assertEqual(response.headers['Content-Encoding'], 'gzip')
                    self.assertEqual(response.headers['Vary'], 'Accept-Encoding')
                    encoded = response.read()
                    self.assertEqual(int(response.headers['Content-Length']), len(encoded))
                with urllib.request.urlopen(urllib.request.Request(address, headers={'Accept-Encoding': 'gzip;q=0'})) as response:
                    self.assertIsNone(response.headers.get('Content-Encoding'))
                    plain = response.read()
                self.assertEqual(gzip.decompress(encoded), plain)
                self.assertLess(len(encoded), len(plain))
        finally:
            httpd.shutdown(); httpd.server_close(); worker.join(timeout=3)

    def test_cache_reused_and_both_processes_share_semaphore(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'fixture.rrd'
            path.touch()
            output = SimpleNamespace(stdout=fixture([(1, 0), (2, 0)]))
            with patch.object(series_v2.subprocess, 'run', return_value=output) as run:
                a = series_v2.read_snapshot(path, 0, 120, lambda text: {})
                b = series_v2.read_snapshot(path, 0, 120, lambda text: {})
            self.assertEqual(a, b)
            self.assertEqual(run.call_count, 2)
            self.assertIs(series_v2.STATS_CACHE, server.STATS_CACHE)
            self.assertIs(series_v2.GRAPH_SEMAPHORE, server.GRAPH_SEMAPHORE)

    def test_changing_rrd_retries_once_then_fails(self):
        revisions = [SimpleNamespace(st_mtime_ns=i) for i in range(4)]
        with patch.object(series_v2.os, 'stat', side_effect=revisions), patch.object(series_v2.subprocess, 'run', return_value=SimpleNamespace(stdout='')) as run:
            with self.assertRaises(RuntimeError):
                series_v2.read_snapshot('changing', 0, 120, lambda text: {})
        self.assertEqual(run.call_count, 4)

    def test_invalid_parameters_never_invoke_rrd(self):
        base = {'source': ['akari_jp'], 'target': ['google_dns'], 'type': ['v6']}
        for extra in ({'points': ['1000000']}, {'end': ['1']}, {'source': ['google_dns']}):
            with patch.object(server, 'read_snapshot') as read:
                _, status = server.handle_series_v2({**base, **extra})
                self.assertEqual(status, 400)
                read.assert_not_called()

    def test_api_summary_and_series_share_contract_and_old_api_unchanged(self):
        snap = contract.snapshot(fixture([(10, 0)] * 5), {}, 0, 300, 300)
        params = {'source': ['akari_jp'], 'target': ['google_dns'], 'type': ['v6']}
        with patch.object(server, 'resolve_rrd', return_value=('fixture', {}, {})), patch.object(server, 'read_snapshot', return_value=snap):
            data, status = server.handle_series_v2(params)
            summary, _ = server.handle_series_v2(params, True)
        self.assertEqual(status, 200)
        data, summary = json.loads(data), json.loads(summary)
        self.assertEqual(data['summary'], summary['summary'])
        self.assertEqual(data['snapshot_id'], summary['snapshot_id'])
        self.assertNotIn('bins', summary)


if __name__ == '__main__':
    unittest.main()
