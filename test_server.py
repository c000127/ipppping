import json
import tempfile
import unittest
from pathlib import Path
from urllib.parse import parse_qs
from types import SimpleNamespace
from unittest.mock import patch

import server
from nodes import load_nodes
from rrd import find_rrd


class RequestValidationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data_tmp = tempfile.TemporaryDirectory()
        data_dir = Path(cls.data_tmp.name)
        (data_dir / "ICMPv4").mkdir()
        (data_dir / "ICMPv4" / "akari_jp.rrd").touch()
        (data_dir / "ICMPv4" / "akari_jp~legendsg.rrd").touch()
        cls.original_data_dir = server.DATA_DIR
        server.DATA_DIR = str(data_dir)

    @classmethod
    def tearDownClass(cls):
        server.DATA_DIR = cls.original_data_dir
        cls.data_tmp.cleanup()

    def setUp(self):
        server.STATS_CACHE.clear()
        server.GRAPH_CACHE.clear()

    def test_external_web_assets_are_available(self):
        web_dir = server.WEB_DIR if server.WEB_DIR.exists() else Path(__file__).parent
        app_source = (web_dir / "app.js").read_bytes()
        self.assertIn(b"/static/app.js", (web_dir / "index.html").read_bytes())
        self.assertIn(b"IntersectionObserver", app_source)
        self.assertIn(b"Number.isFinite(st.min_ms)", app_source)
        self.assertIn(b"searchParams.set('_retry'", app_source)
        self.assertIn(b"computeUnifiedRange(list, dur)", app_source)
        self.assertIn(b"activeImageCancels", app_source)
        self.assertIn(b"IMAGE_LOAD_TIMEOUT_MS", app_source)
        self.assertIn(b'id="unifiedAxisToggle"', (web_dir / "index.html").read_bytes())
        self.assertIn(b'id="pairMode"', (web_dir / "index.html").read_bytes())
        self.assertIn(b'class="pairing-mode-btn on"', (web_dir / "index.html").read_bytes())
        self.assertIn(b'data-pair-mode="fixed"', (web_dir / "index.html").read_bytes())
        self.assertIn(b"node-anchor", app_source)
        self.assertIn(b"anchor", app_source)
        self.assertNotIn(b"onclick=", (web_dir / "index.html").read_bytes())
        self.assertNotIn(b"onclick=", app_source)
        self.assertNotIn(b"fonts.googleapis.com", (web_dir / "index.html").read_bytes())

    def test_graph_has_no_duplicate_numeric_footer(self):
        source = Path(server.__file__).read_text(encoding="utf-8")
        self.assertNotIn("GPRINT:median_unit", source)
        self.assertNotIn("GPRINT:loss_pct", source)
        self.assertNotIn(":RTT", source)
        self.assertNotIn(":Loss", source)

    def test_node_configuration_is_valid(self):
        nodes = load_nodes(Path(__file__).parent / "config" / "nodes.example.json")
        self.assertGreater(len(nodes), 0)
        self.assertEqual(len({node["id"] for node in nodes}), len(nodes))

    def test_rrd_lookup_only_returns_existing_files(self):
        self.assertIsNotNone(find_rrd(server.DATA_DIR, "ICMPv4", "akari_jp"))
        self.assertIsNone(find_rrd(server.DATA_DIR, "ICMPv4", "missing"))

    def test_series_returns_structured_points_not_stats(self):
        fetch_output = (
            "uptime loss median ping1 ping2\n"
            "1700000000: 1 0 0.010 0.009 0.011\n"
            "1700000060: 1 0 0.011 0.010 0.012\n"
        )
        response = SimpleNamespace(returncode=0, stdout=fetch_output, stderr="")
        with patch("server.subprocess.run", return_value=response):
            body, status = server.handle_series(parse_qs(
                "source=legendsg&target=akari_jp&type=v4&dur=3600"
            ))
        self.assertEqual(status, 200)
        data = json.loads(body)
        # Phase 2 contract: timestamps + median present, NaN→null
        self.assertIn("timestamps", data)
        self.assertIn("median", data)
        self.assertGreater(len(data["timestamps"]), 0)
        for v in data["median"]:
            self.assertTrue(v is None or isinstance(v, (int, float)))

    def test_series_and_stats_caches_do_not_collide(self):
        """Regression: stats cache_key must not reuse series cache_key."""
        series_response = SimpleNamespace(
            returncode=0,
            stdout=(
                "uptime loss median ping1 ping2\n"
                "1700000000: 1 0 0.010 0.009 0.011\n"
            ),
            stderr="",
        )
        stats_response = SimpleNamespace(
            returncode=0,
            stdout="1.25\n1.10\n1.50\n0.90\n0.0200\n",
            stderr="",
        )
        with patch("server.subprocess.run", side_effect=[series_response, stats_response]):
            # Warm whichever runs first - series.
            sb, ss = server.handle_series(parse_qs(
                "source=legendsg&target=akari_jp&type=v4&dur=3600"
            ))
            tb, ts = server.handle_stats(parse_qs(
                "source=legendsg&target=akari_jp&type=v4&dur=3600"
            ))
        self.assertEqual(ss, 200)
        # Stats must return the small dict, never the series body
        self.assertEqual(ts, 200)
        stats = json.loads(tb)
        self.assertIn("avg_ms", stats)
        self.assertNotIn("timestamps", stats)

    def test_pair_endpoint_matches_selection_rules(self):
        body, status = server.handle_pairs(parse_qs(
            "nodes=vps_town_a1,legendsg,google_dns"
        ))
        pairs = json.loads(body)
        self.assertEqual(status, 200)
        self.assertEqual(len(pairs), 6)
        self.assertTrue(any(pair["ext"] for pair in pairs))
        self.assertTrue(any(pair["type"] == "v6" for pair in pairs))

    def test_pair_endpoint_includes_direction_metadata(self):
        body, status = server.handle_pairs(parse_qs("nodes=legendsg,akari_jp"))
        pairs = json.loads(body)
        self.assertEqual(status, 200)
        self.assertEqual(
            [(pair["type"], pair["direction"]) for pair in pairs],
            [("v4", 0), ("v6", 0), ("v4", 1), ("v6", 1)],
        )

    def test_fixed_node_generates_only_anchor_pairs(self):
        body, status = server.handle_pairs(parse_qs(
            "nodes=vps_town_a1,legendsg,akari_jp&anchor=vps_town_a1"
        ))
        pairs = json.loads(body)
        self.assertEqual(status, 200)
        self.assertEqual(len(pairs), 8)
        self.assertTrue(all(
            "vps_town_a1" in (pair["source"], pair["target"])
            for pair in pairs
        ))
        self.assertNotIn(
            frozenset(("legendsg", "akari_jp")),
            {frozenset((pair["source"], pair["target"])) for pair in pairs},
        )

    def test_fixed_node_supports_one_to_one(self):
        body, status = server.handle_pairs(parse_qs(
            "nodes=legendsg,akari_jp&anchor=akari_jp"
        ))
        pairs = json.loads(body)
        self.assertEqual(status, 200)
        self.assertEqual(len(pairs), 4)
        self.assertTrue(all(
            "akari_jp" in (pair["source"], pair["target"])
            for pair in pairs
        ))

    def test_fixed_node_keeps_external_target_rule(self):
        body, status = server.handle_pairs(parse_qs(
            "nodes=vps_town_a1,legendsg,google_dns&anchor=google_dns"
        ))
        pairs = json.loads(body)
        self.assertEqual(status, 200)
        self.assertEqual(len(pairs), 2)
        self.assertTrue(all(pair["ext"] for pair in pairs))
        self.assertTrue(all(pair["target"] == "google_dns" for pair in pairs))

    def test_pair_endpoint_rejects_anchor_outside_selection(self):
        body, status = server.handle_pairs(parse_qs(
            "nodes=legendsg,akari_jp&anchor=dmit_jp"
        ))
        self.assertEqual(status, 400)
        self.assertEqual(json.loads(body)["error"]["code"], "invalid_selection")

    def test_pair_endpoint_rejects_too_many_nodes(self):
        nodes = "vps_town_a1,legendsg,akari_jp"
        with patch.object(server, "MAX_SELECTED_NODES", 2):
            body, status = server.handle_pairs(parse_qs(f"nodes={nodes}"))
        self.assertEqual(status, 400)
        self.assertEqual(json.loads(body)["error"]["code"], "invalid_selection")

    def test_invalid_duration_is_a_client_error(self):
        body, status = server.handle_stats(parse_qs(
            "source=legendsg&target=akari_jp&dur=bad"
        ))
        self.assertEqual(status, 400)
        self.assertEqual(json.loads(body)["error"]["code"], "invalid_parameter")

    def test_invalid_axis_range_is_a_client_error(self):
        body, status = server.handle_graph(parse_qs(
            "source=legendsg&target=akari_jp&ymin=nan&ymax=2"
        ))
        self.assertEqual(status, 400)
        self.assertEqual(json.loads(body)["error"]["code"], "invalid_parameter")

    def test_invalid_graph_size_is_a_client_error(self):
        body, status = server.handle_graph(parse_qs(
            "source=legendsg&target=akari_jp&w=279&h=230"
        ))
        self.assertEqual(status, 400)
        self.assertEqual(json.loads(body)["error"]["code"], "invalid_parameter")

    def test_stats_uses_requested_graph_size(self):
        fake_rrd = Path(server.__file__)
        expected = {"current_ms": 1.1, "avg_ms": 1, "max_ms": 2, "min_ms": 1, "loss_pct": 0}
        with patch.object(server, "resolve_rrd", return_value=(fake_rrd, server.NODES[0], server.NODES[1])):
            with patch.object(server, "rrd_fetch_stats", return_value=expected) as fetch:
                body, status = server.handle_stats(parse_qs(
                    "source=legendsg&target=akari_jp&type=v4&dur=86400&w=346&h=230"
                ))
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), expected)
        fetch.assert_called_once_with(fake_rrd, 86400, 346, 230)

    def test_stats_batch_returns_all_pairs_in_one_response(self):
        fake_rrd = Path(server.__file__)
        expected = {"current_ms": 1.1, "avg_ms": 1, "max_ms": 2, "min_ms": 1, "loss_pct": 0}
        with patch.object(server, "resolve_rrd", return_value=(fake_rrd, server.NODES[0], server.NODES[1])):
            with patch.object(server, "rrd_fetch_stats", return_value=expected) as fetch:
                body, status = server.handle_stats_batch(parse_qs(
                    "nodes=dmit_jp,bugnet_sea&dur=10800&w=900&h=320"
                ))
        data = json.loads(body)
        self.assertEqual(status, 200)
        self.assertEqual(len(data["items"]), 4)
        self.assertTrue(all(item.get("stats") == expected for item in data["items"]))
        self.assertEqual(fetch.call_count, 4)

    def test_stats_batch_uses_fixed_node_pairs(self):
        fake_rrd = Path(server.__file__)
        expected = {"current_ms": 1.1, "avg_ms": 1, "max_ms": 2, "min_ms": 1, "loss_pct": 0}
        with patch.object(server, "resolve_rrd", return_value=(fake_rrd, server.NODES[0], server.NODES[1])):
            with patch.object(server, "rrd_fetch_stats", return_value=expected) as fetch:
                body, status = server.handle_stats_batch(parse_qs(
                    "nodes=vps_town_a1,legendsg,akari_jp&anchor=vps_town_a1&dur=10800&w=900&h=320"
                ))
        data = json.loads(body)
        self.assertEqual(status, 200)
        self.assertEqual(len(data["items"]), 8)
        self.assertTrue(all(item.get("stats") == expected for item in data["items"]))
        self.assertEqual(fetch.call_count, 8)

    def test_stats_reads_latest_valid_median_as_current(self):
        fake_rrd = Path(server.__file__)
        server.STATS_CACHE.clear()
        with patch("server.subprocess.run") as run:
            run.return_value.returncode = 0
            run.return_value.stdout = "1.25\n1.10\n1.50\n0.90\n0.0200\n"
            run.return_value.stderr = ""
            stats = server.rrd_fetch_stats(fake_rrd, 10800, 900, 320)

        self.assertEqual(stats["current_ms"], 1.25)
        self.assertEqual(stats["avg_ms"], 1.1)
        self.assertEqual(stats["loss_pct"], 0.1)
        command = run.call_args.args[0]
        self.assertIn("VDEF:vcurrent=median_ms,LAST", command)
        self.assertIn("PRINT:vcurrent:%5.2lf", command)

    def test_stats_preserves_loss_when_latency_is_unknown(self):
        fake_rrd = Path(server.__file__)
        server.STATS_CACHE.clear()
        with patch("server.subprocess.run") as run:
            run.return_value.returncode = 0
            run.return_value.stdout = "0x0\n-nan\n-nan\n-nan\n-nan\n20.0000\n"
            run.return_value.stderr = ""
            stats = server.rrd_fetch_stats(fake_rrd, 3600, 900, 320)

        self.assertEqual(stats, {
            "current_ms": None,
            "avg_ms": None,
            "max_ms": None,
            "min_ms": None,
            "loss_pct": 100.0,
        })

    def test_mobile_graph_size_is_accepted(self):
        fake_rrd = Path(server.__file__)
        with patch.object(server, "resolve_rrd", return_value=(fake_rrd, server.NODES[0], server.NODES[1])):
            with patch("server.subprocess.run") as run:
                run.return_value.returncode = 0
                run.return_value.stdout = "2\n1\n"
                run.return_value.stderr = ""
                body, status, mime = server.handle_graph(parse_qs(
                    "source=legendsg&target=akari_jp&w=346&h=230"
                ))
        self.assertEqual(status, 200)
        self.assertEqual(mime, "image/png")

    def test_mobile_24h_graph_uses_compact_time_labels(self):
        fake_rrd = Path(server.__file__)
        with patch.object(server, "resolve_rrd", return_value=(fake_rrd, server.NODES[0], server.NODES[1])):
            with patch("server.subprocess.run") as run:
                run.return_value.returncode = 0
                run.return_value.stdout = "2\n1\n"
                run.return_value.stderr = ""
                body, status, mime = server.handle_graph(parse_qs(
                    "source=legendsg&target=akari_jp&type=v4&dur=86400&w=346&h=260"
                ))
        self.assertEqual(status, 200)
        self.assertEqual(mime, "image/png")
        command = run.call_args_list[-1].args[0]
        grid_index = command.index("--x-grid")
        self.assertEqual(command[grid_index + 1], "HOUR:1:HOUR:6:HOUR:6:0:%H:%M")

    def test_desktop_24h_graph_keeps_default_time_labels(self):
        fake_rrd = Path(server.__file__)
        with patch.object(server, "resolve_rrd", return_value=(fake_rrd, server.NODES[0], server.NODES[1])):
            with patch("server.subprocess.run") as run:
                run.return_value.returncode = 0
                run.return_value.stdout = "2\n1\n"
                run.return_value.stderr = ""
                body, status, mime = server.handle_graph(parse_qs(
                    "source=legendsg&target=akari_jp&type=v4&dur=86400&w=900&h=320"
                ))
        self.assertEqual(status, 200)
        self.assertEqual(mime, "image/png")
        command = run.call_args_list[-1].args[0]
        self.assertNotIn("--x-grid", command)

    def test_unsupported_protocol_is_a_client_error(self):
        body, status = server.handle_stats(parse_qs(
            "source=rfc_jp_co_lite&target=akari_jp&type=v6"
        ))
        self.assertEqual(status, 400)
        self.assertEqual(json.loads(body)["error"]["code"], "invalid_pair")

    def test_unknown_node_does_not_reach_filesystem(self):
        body, status = server.handle_graph(parse_qs(
            "source=unknown&target=akari_jp"
        ))
        self.assertEqual(status, 400)
        self.assertEqual(json.loads(body)["error"]["code"], "invalid_pair")


if __name__ == "__main__":
    unittest.main()
