"""P4-only v2 summary pagination; the production Charts page does not use it yet."""
import gzip
import json
import threading
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from unittest.mock import patch

import server
import series_contract as contract
from test_series_v2 import fixture


NODES = [
    {'id': 'akari_jp', 'label': 'Akari JP', 'group': 'vps', 'v4': True, 'v6': True},
    {'id': 'legendsg', 'label': 'Legend SG', 'group': 'vps', 'v4': True, 'v6': True},
    {'id': 'google_dns', 'label': 'Google DNS', 'group': 'dns', 'v4': True, 'v6': True},
]


class SummaryBatchTests(unittest.TestCase):
    def setUp(self):
        self.end = int(time.time()) // 60 * 60
        self.snapshot = contract.snapshot(fixture([(10, 0)] * 180, start=self.end - 10800),
                                          {}, self.end - 10800, self.end, self.end)

    def params(self, extra=''):
        values = urllib.parse.parse_qs(
            f'nodes=akari_jp,legendsg,google_dns&anchor=akari_jp,legendsg&dur=10800&end={self.end}')
        values.update(urllib.parse.parse_qs(extra.lstrip('&')))
        return values

    def test_fixed_selection_pages_preserve_order_and_summary_contract(self):
        with patch.object(server, 'NODES', NODES), \
             patch.object(server, 'resolve_rrd', return_value=(Path('fixture.rrd'), None, None)), \
             patch.object(server, 'read_snapshot', return_value=self.snapshot) as read:
            first_bytes, first_status = server.handle_v2_summary_batch(self.params('&limit=2'))
            second_bytes, second_status = server.handle_v2_summary_batch(self.params('&offset=2&limit=2'))
        first, second = json.loads(first_bytes), json.loads(second_bytes)
        self.assertEqual((first_status, second_status), (200, 200))
        self.assertEqual(first['schema'], 'ipppping.summary-batch.v2')
        self.assertEqual(first['selection_id'], second['selection_id'])
        self.assertEqual(len(first['selection_id']), 64)
        self.assertEqual((first['total'], first['next_offset'], second['next_offset']), (4, 2, None))
        self.assertEqual(first['end'], second['end'])
        self.assertEqual(read.call_count, 4)
        items = first['items'] + second['items']
        self.assertEqual([(item['source'], item['target'], item['protocol']) for item in items],
                         [('akari_jp', 'google_dns', 'v4'), ('akari_jp', 'google_dns', 'v6'),
                          ('legendsg', 'google_dns', 'v4'), ('legendsg', 'google_dns', 'v6')])
        for item in items:
            self.assertEqual(item['summary'], self.snapshot['summary'])
            self.assertEqual(item['snapshot_id'], self.snapshot['snapshot_id'])
            self.assertNotIn('bins', item)

        with patch.object(server, 'NODES', NODES), \
             patch.object(server, 'resolve_rrd', return_value=(Path('fixture.rrd'), None, None)), \
             patch.object(server, 'read_snapshot', return_value=self.snapshot):
            other, status = server.handle_v2_summary_batch(self.params('&anchor=akari_jp'))
        self.assertEqual(status, 200)
        self.assertNotEqual(json.loads(other)['selection_id'], first['selection_id'])

    def test_invalid_page_or_window_never_reads_rrd(self):
        extras = ('&offset=-1', '&offset=5', '&limit=0', '&limit=33', '&dur=17',
                  '&end=1', '&anchor=unknown')
        with patch.object(server, 'NODES', NODES), patch.object(server, 'read_snapshot') as read:
            for extra in extras:
                body, status = server.handle_v2_summary_batch(self.params(extra))
                self.assertEqual(status, 400, extra)
                self.assertIn('error', json.loads(body))
            read.assert_not_called()

    def test_busy_and_partial_missing_data_do_not_fan_out(self):
        with patch.object(server, 'NODES', NODES), patch.object(server, 'BATCH_SLOTS') as slots:
            slots.acquire.return_value = False
            body, status = server.handle_v2_summary_batch(self.params())
            self.assertEqual((status, json.loads(body)['error']['code']), (503, 'busy'))
            slots.release.assert_not_called()

        def resolve(source, target, typ):
            if source == 'akari_jp' and typ == 'v4':
                raise FileNotFoundError
            return Path('fixture.rrd'), None, None

        with patch.object(server, 'NODES', NODES), patch.object(server, 'resolve_rrd', side_effect=resolve), \
             patch.object(server, 'read_snapshot', return_value=self.snapshot) as read:
            body, status = server.handle_v2_summary_batch(self.params())
        items = json.loads(body)['items']
        self.assertEqual(status, 200)
        self.assertEqual(items[0]['error'], 'no_data')
        self.assertTrue(all('summary' in item for item in items[1:]))
        self.assertEqual(read.call_count, 3)

    def test_page_respects_configured_rrd_worker_limit(self):
        nodes = [{'id': f'v{i}', 'label': f'V{i}', 'group': 'vps', 'v4': True, 'v6': True}
                 for i in range(5)]
        lock = threading.Lock()
        active = peak = 0

        def read(path, start, end, parse):
            nonlocal active, peak
            with lock:
                active += 1
                peak = max(peak, active)
            time.sleep(0.01)
            with lock:
                active -= 1
            return self.snapshot

        params = urllib.parse.parse_qs(f'nodes=v0,v1,v2,v3,v4&dur=10800&end={self.end}&limit=32')
        with patch.object(server, 'NODES', nodes), \
             patch.object(server, 'resolve_rrd', return_value=(Path('fixture.rrd'), None, None)), \
             patch.object(server, 'read_snapshot', side_effect=read) as calls:
            body, status = server.handle_v2_summary_batch(params)
        self.assertEqual(status, 200)
        self.assertEqual(len(json.loads(body)['items']), 32)
        self.assertEqual(calls.call_count, 32)
        self.assertGreaterEqual(peak, 1)
        self.assertLessEqual(peak, server.MAX_GRAPH_WORKERS)

    def test_near_maximum_matrix_only_reads_requested_pages(self):
        nodes = [{'id': f'v{i}', 'label': f'V{i}', 'group': 'vps', 'v4': True, 'v6': True}
                 for i in range(16)]
        selected = ','.join(node['id'] for node in nodes)
        base = f'nodes={selected}&dur=10800&end={self.end}&limit=32'
        with patch.object(server, 'NODES', nodes), \
             patch.object(server, 'resolve_rrd', return_value=(Path('fixture.rrd'), None, None)), \
             patch.object(server, 'read_snapshot', return_value=self.snapshot) as read:
            first, status = server.handle_v2_summary_batch(urllib.parse.parse_qs(base))
            last, last_status = server.handle_v2_summary_batch(urllib.parse.parse_qs(base + '&offset=448'))
        first, last = json.loads(first), json.loads(last)
        self.assertEqual((status, last_status), (200, 200))
        self.assertEqual((first['total'], first['next_offset']), (480, 32))
        self.assertEqual((last['total'], last['next_offset']), (480, None))
        self.assertEqual(read.call_count, 64)

        too_many = nodes + [{'id': 'v16', 'label': 'V16', 'group': 'vps', 'v4': True, 'v6': True}]
        with patch.object(server, 'NODES', too_many), patch.object(server, 'read_snapshot') as read:
            _, status = server.handle_v2_summary_batch(urllib.parse.parse_qs(
                f'nodes={selected},v16&dur=10800&end={self.end}'))
            self.assertEqual(status, 400)
            read.assert_not_called()

    def test_changed_snapshot_is_a_single_item_error(self):
        def read(path, start, end, parse):
            if 'akari_jp' in str(path):
                raise RuntimeError('revision changed')
            return self.snapshot

        def resolve(source, target, typ):
            return Path(source + '.rrd'), None, None

        with patch.object(server, 'NODES', NODES), patch.object(server, 'resolve_rrd', side_effect=resolve), \
             patch.object(server, 'read_snapshot', side_effect=read):
            body, status = server.handle_v2_summary_batch(self.params())
        items = json.loads(body)['items']
        self.assertEqual(status, 200)
        self.assertEqual([item.get('error') for item in items],
                         ['snapshot_changed', 'snapshot_changed', None, None])

    def test_http_gzip_and_identity_have_equal_content(self):
        httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        worker = threading.Thread(target=httpd.serve_forever, daemon=True)
        worker.start()
        try:
            url = (f'http://127.0.0.1:{httpd.server_address[1]}/api/v2/summary-batch?'
                   f'nodes=akari_jp,legendsg,google_dns&anchor=akari_jp,legendsg&end={self.end}&limit=2')
            with patch.object(server, 'NODES', NODES), \
                 patch.object(server, 'resolve_rrd', return_value=(Path('fixture.rrd'), None, None)), \
                 patch.object(server, 'read_snapshot', return_value=self.snapshot):
                with urllib.request.urlopen(urllib.request.Request(url, headers={'Accept-Encoding': 'gzip'})) as response:
                    self.assertEqual(response.headers['Content-Encoding'], 'gzip')
                    self.assertEqual(response.headers['Vary'], 'Accept-Encoding')
                    self.assertEqual(response.headers['Cache-Control'], 'no-store')
                    encoded = response.read()
                    self.assertEqual(int(response.headers['Content-Length']), len(encoded))
                with urllib.request.urlopen(urllib.request.Request(url, headers={'Accept-Encoding': 'gzip;q=0'})) as response:
                    self.assertIsNone(response.headers.get('Content-Encoding'))
                    plain = response.read()
            self.assertEqual(gzip.decompress(encoded), plain)
            self.assertLess(len(encoded), len(plain))
            with patch.object(server, 'NODES', NODES), patch.object(server, 'BATCH_SLOTS') as slots:
                slots.acquire.return_value = False
                with self.assertRaises(urllib.error.HTTPError) as raised:
                    urllib.request.urlopen(urllib.request.Request(url, headers={'Accept-Encoding': 'gzip'}))
                self.assertEqual(raised.exception.code, 503)
                self.assertEqual(raised.exception.headers['Retry-After'], '2')
                self.assertIsNone(raised.exception.headers.get('Content-Encoding'))
                raised.exception.close()
        finally:
            httpd.shutdown()
            httpd.server_close()
            worker.join(timeout=3)


if __name__ == '__main__':
    unittest.main()
