"""P0 golden RRD-output fixtures; P1 unknown/loss/freshness regressions."""
import json
import subprocess
import tempfile
import threading
import unittest
import urllib.request
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from urllib.parse import parse_qs

import server


def raw_update(timestamp=1700000060, loss="0", median="0.010"):
    return ("uptime loss median " + " ".join(f"ping{i}" for i in range(1, 21))
            + f"\n\n{timestamp}: U {loss} {median} " + " ".join([median] * 20) + "\n")


class MeasurementTests(unittest.TestCase):
    def setUp(self):
        server.STATS_CACHE.clear()
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / "synthetic.rrd"
        self.path.touch()

    def test_raw_normal_and_all_loss_are_measurements(self):
        normal = server.parse_lastupdate(raw_update())
        self.assertEqual(normal["current_ms"], 10)
        self.assertEqual(normal["current_loss_pct"], 0)
        self.assertEqual(normal["pings"], 20)
        lost = server.parse_lastupdate(raw_update(loss="20", median="U"))
        self.assertIsNone(lost["current_ms"])
        self.assertEqual(lost["current_loss_pct"], 100)
        self.assertEqual(lost["measurement_updated_at"], 1700000060)

    def test_unknown_is_not_zero_or_fresh_measurement(self):
        unknown = server.parse_lastupdate(raw_update(loss="U", median="-nan"))
        self.assertIsNone(unknown["current_ms"])
        self.assertIsNone(unknown["current_loss_pct"])
        self.assertIsNone(unknown["measurement_updated_at"])
        self.assertEqual(unknown["measurement_state"], "missing")
        self.assertEqual(unknown["rrd_updated_at"], 1700000060)

    def test_malformed_raw_metadata_is_rejected(self):
        for text in ["", "median loss\n123: 0 0", "median loss ping1\n123: 0", "median loss ping1\n0: 0 0 0"]:
            with self.subTest(text=text), self.assertRaises(ValueError):
                server.parse_lastupdate(text)

    def test_metadata_is_bounded_cached_and_uses_rrd_not_mtime(self):
        response = SimpleNamespace(stdout=raw_update(), returncode=0)
        with patch("server.subprocess.run", return_value=response) as run, patch("server.time.time", return_value=1700000200):
            first = server.rrd_latest_measurement(self.path)
            second = server.rrd_latest_measurement(self.path)
        self.assertEqual(run.call_count, 1)
        self.assertEqual(first, second)
        self.assertEqual(first["measurement_updated_at"], 1700000060)
        self.assertEqual(first["observed_at"], 1700000200)

    def test_raw_read_failure_keeps_unknown_not_graph_last(self):
        with patch("server.subprocess.run", side_effect=subprocess.TimeoutExpired("rrdtool", 5)):
            result = server.rrd_latest_measurement(self.path)
        self.assertIsNone(result["current_ms"])
        self.assertIsNone(result["measurement_updated_at"])
        self.assertEqual(result["measurement_state"], "unknown")

    def test_all_unknown_graph_is_successful_empty_data(self):
        response = SimpleNamespace(returncode=0, stdout="0x0\n-nan\n-nan\n-nan\n-nan\n-nan\n")
        latest = server.parse_lastupdate(raw_update(loss="U", median="U"))
        with patch("server.subprocess.run", return_value=response), patch.object(server, "rrd_latest_measurement", return_value=latest):
            stats = server.rrd_fetch_stats(self.path)
        self.assertIsNotNone(stats)
        self.assertIsNone(stats["loss_pct"])
        self.assertIsNone(stats["current_ms"])
        self.assertEqual(stats["measurement_state"], "missing")

    def test_series_gap_and_total_loss_do_not_resurrect_old_latency(self):
        output = "uptime loss median ping1 ping2\n1700000000: U 0 .010 .009 .011\n1700000060: U 2 U U U\n1700000120: U U U U U\n"
        response = SimpleNamespace(returncode=0, stdout=output, stderr="")
        latest = server.parse_lastupdate(raw_update(loss="20", median="U"))
        with patch("server.subprocess.run", return_value=response), patch.object(server, "rrd_latest_measurement", return_value=latest):
            result = server.rrd_fetch_series(self.path)
        self.assertEqual(result["median"], [10, None, None])
        self.assertEqual(result["loss"], [0, 100, None])
        self.assertIsNone(result["summary"]["current_ms"])
        self.assertEqual(result["summary"]["average_ms"], 10)
        self.assertEqual(result["measurement_updated_at"], 1700000060)
        self.assertEqual(result["last_update"], 1700000120)

    def test_series_all_missing_loss_remains_null(self):
        response = SimpleNamespace(returncode=0, stdout="uptime loss median ping1\n1700000000: U U U U\n", stderr="")
        with patch("server.subprocess.run", return_value=response), patch.object(server, "rrd_latest_measurement", return_value={}):
            result = server.rrd_fetch_series(self.path)
        self.assertIsNone(result["summary"]["loss_pct"])
        self.assertNotIn("NaN", json.dumps(result, allow_nan=False))

    def test_legacy_clients_keep_five_fields_and_current_contract(self):
        data = {"current_ms": None, "last_valid_ms": 10, "avg_ms": 8,
                "min_ms": 5, "max_ms": 11, "loss_pct": 0,
                "measurement_updated_at": 1700000060}
        legacy = server.stats_response_view(data)
        self.assertEqual(len(legacy), 5)
        self.assertEqual(legacy["current_ms"], 10)
        self.assertIs(server.stats_response_view(data, True), data)
        data["loss_pct"] = None
        self.assertIsNone(server.stats_response_view(data))
        self.assertIsNone(server.stats_response_view(data, True)["loss_pct"])

    def test_http_state_opt_in_and_batch_are_backward_compatible(self):
        stats = {"current_ms": None, "last_valid_ms": None, "loss_pct": None,
                 "measurement_state": "missing"}
        with patch.object(server, "resolve_rrd", return_value=(self.path, {}, {})), patch.object(server, "rrd_fetch_stats", return_value=stats):
            _, old_status = server.handle_stats(parse_qs("source=legendsg&target=akari_jp"))
            body, new_status = server.handle_stats(parse_qs("source=legendsg&target=akari_jp&state=p1"))
            batch, status = server.handle_stats_batch(parse_qs("nodes=legendsg,akari_jp&state=p1"))
        self.assertEqual(old_status, 502)
        self.assertEqual(new_status, 200)
        self.assertIsNone(json.loads(body)["loss_pct"])
        self.assertEqual(status, 200)
        self.assertTrue(all(item["stats"]["measurement_state"] == "missing" for item in json.loads(batch)["items"]))

    def test_actual_http_handler_serves_new_script_and_html_dependency(self):
        httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        worker = threading.Thread(target=httpd.serve_forever, daemon=True)
        worker.start()
        try:
            base = f"http://127.0.0.1:{httpd.server_address[1]}"
            with urllib.request.urlopen(base + "/static/request-state.js?v=test", timeout=3) as response:
                self.assertEqual(response.status, 200)
                self.assertIn("text/javascript", response.headers["Content-Type"])
                self.assertIn(b"const RequestState", response.read())
            with urllib.request.urlopen(base + "/", timeout=3) as response:
                html = response.read()
                self.assertLess(html.index(b"/static/request-state.js"), html.index(b"/static/app.js"))
        finally:
            httpd.shutdown()
            httpd.server_close()
            worker.join(timeout=3)


if __name__ == "__main__":
    unittest.main()
