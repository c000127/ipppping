import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
from unittest.mock import Mock

from runtime import BoundedCache, serialized_keys, windowed_map


class RuntimeTests(unittest.TestCase):
    def test_lru_and_size_bound(self):
        cache = BoundedCache(2, 10000)
        cache.put('a', b'a', 30)
        cache.put('b', b'b', 30)
        self.assertEqual(cache.get_value('a'), b'a')
        cache.put('c', b'c', 30)
        self.assertIsNone(cache.get_value('b'))
        cache.put('large', b'x' * 20000, 30)
        self.assertLessEqual(cache.bytes, 10000)
        self.assertIsNone(cache.get_value('large'))

    def test_unaccessed_mtime_keys_expire(self):
        cache = BoundedCache(256, 10000)
        with patch('runtime.time.monotonic', return_value=1):
            cache.put(('file', 1), {}, 15)
        with patch('runtime.time.monotonic', return_value=17):
            cache.put(('file', 2), {}, 15)
        self.assertEqual(len(cache.entries), 1)
        cache.clear()
        self.assertEqual(cache.bytes, 0)

    def test_duplicate_misses_share_result(self):
        cache = BoundedCache(2, 10000)
        calls = []

        @serialized_keys
        def fetch(key):
            value = cache.get_value(key)
            if value is None:
                calls.append(key)
                time.sleep(0.02)
                value = 42
                cache.put(key, value, 30)
            return value
        with ThreadPoolExecutor(8) as pool:
            self.assertEqual(list(pool.map(fetch, ['same'] * 8)), [42] * 8)
        self.assertEqual(calls, ['same'])

    def test_window_never_submits_entire_matrix(self):
        class ImmediateExecutor:
            pending = 0
            peak = 0
            def submit(self, function, item):
                self.pending += 1
                self.peak = max(self.peak, self.pending)
                owner = self
                class Future:
                    def result(self):
                        owner.pending -= 1
                        return function(item)
                    def cancel(self):
                        pass
                return Future()
        executor = ImmediateExecutor()
        self.assertEqual(list(windowed_map(executor, lambda x: x, range(500), 4)), list(range(500)))
        self.assertEqual(executor.peak, 4)

    def test_frontend_does_not_prefetch_all_nodes(self):
        from pathlib import Path
        source = (Path(__file__).parent / 'web/app.js').read_text(encoding='utf-8')
        self.assertNotIn('prefetchStatsSnapshot', source)
        self.assertNotIn('statsSnapshotPromise', source)
        self.assertIn("nodes: nodeIds.join(',')", source)

    def test_http_admission_rejects_before_spawning_thread(self):
        import server
        httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        request = Mock()
        try:
            for _ in range(server.MAX_HTTP_WORKERS):
                self.assertTrue(httpd.request_slots.acquire(False))
            with patch.object(httpd, 'shutdown_request') as close:
                httpd.process_request(request, ('127.0.0.1', 1))
            self.assertIn(b'503', request.sendall.call_args.args[0])
            close.assert_called_once_with(request)
        finally:
            httpd.server_close()

    def test_batch_admission_is_bounded(self):
        import server
        from urllib.parse import parse_qs
        slots = threading.BoundedSemaphore(1)
        slots.acquire()
        with patch.object(server, 'BATCH_SLOTS', slots):
            _, status = server.handle_stats_batch(parse_qs('nodes=legendsg,akari_jp'))
        self.assertEqual(status, 503)


if __name__ == '__main__':
    unittest.main()
