#!/usr/bin/env python3
import http.server
import json
import os
import subprocess
import re
import threading
import time
import urllib.parse
import math
from concurrent.futures import ThreadPoolExecutor
from http import HTTPStatus
from socketserver import ThreadingMixIn
from config import (
    ALLOWED_DURATIONS, ALLOWED_THEMES, ALLOWED_TYPES, CACHE_LOCK, DATA_DIR,
    GRAPH_CACHE, GRAPH_CACHE_TTL, GRAPH_SEMAPHORE, HOST, LOG, MAX_GRAPH_WORKERS, MAX_PAIRS,
    MAX_SELECTED_NODES, NODES_CONFIG, PORT, STATS_CACHE, STATS_CACHE_TTL,
    TIMEZONE, WEB_DIR,
)
from nodes import load_nodes
from rrd import find_rrd as find_rrd_file

SECURITY_HEADERS = [
    ("X-Content-Type-Options", "nosniff"),
    ("Referrer-Policy", "strict-origin-when-cross-origin"),
    ("Permissions-Policy", "geolocation=(), microphone=(), camera=()"),
    ("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'"),
]

NODES = [
    {"id": "vps_town_a1",      "label": "VPS.Town A1",       "v4": True,  "v6": True,  "group": "vps",  "region": "US"},
    {"id": "legendsg",          "label": "Legend SG",          "v4": True,  "v6": True,  "group": "vps",  "region": "SG"},
    {"id": "rfc_jp_co_lite",   "label": "RFC JP Co Lite",     "v4": True,  "v6": False, "group": "vps",  "region": "JP"},
    {"id": "akari_jp",          "label": "Halo Akari JP",      "v4": True,  "v6": True,  "group": "vps",  "region": "JP"},
    {"id": "polo_tw_10g",       "label": "Polo TW 10G",        "v4": True,  "v6": True,  "group": "vps",  "region": "TW"},
    {"id": "gomami",            "label": "Gomami HK",          "v4": True,  "v6": False, "group": "vps",  "region": "JP"},
    {"id": "dmit_jp",           "label": "DMIT JP T1",         "v4": True,  "v6": True,  "group": "vps",  "region": "JP"},
    {"id": "dmit_hk",           "label": "DMIT HK T1",         "v4": True,  "v6": True,  "group": "vps",  "region": "HK"},
    {"id": "greencloudau",      "label": "Greencloud AU",      "v4": True,  "v6": True,  "group": "vps",  "region": "AU"},
    {"id": "alphavps_sea",      "label": "AlphaVPS SEA",       "v4": True,  "v6": True,  "group": "vps",  "region": "SEA"},
    {"id": "greencloudsg",      "label": "Greencloud SG",      "v4": True,  "v6": True,  "group": "vps",  "region": "SG"},
    {"id": "datawave_akari_hk", "label": "DataWave Akari HK",  "v4": True,  "v6": True,  "group": "vps",  "region": "HK"},
    {"id": "xzhk",              "label": "XZHK",               "v4": True,  "v6": False, "group": "vps",  "region": "HK"},
    {"id": "bugnet_sea",        "label": "BugNet SEA",         "v4": True,  "v6": True,  "group": "vps",  "region": "SEA"},
    {"id": "google_dns",        "label": "Google DNS",          "v4": True,  "v6": False, "group": "dns",  "region": "Global"},
    {"id": "cloudflare_dns",    "label": "Cloudflare DNS",      "v4": True,  "v6": False, "group": "dns",  "region": "Global"},
    {"id": "tg5",               "label": "Telegram DC5",         "v4": True,  "v6": False, "group": "dns",  "region": "Global"},
]
try:
    NODES = load_nodes(NODES_CONFIG)
except (OSError, ValueError) as exc:
    LOG.warning("could not load %s, using built-in nodes: %s", NODES_CONFIG, exc)

def find_rrd(category, target, slave=None):
    return find_rrd_file(DATA_DIR, category, target, slave)


def json_error(code, message, status):
    return json.dumps({"error": {"code": code, "message": message}}).encode(), status


def first_param(params, name, default=None):
    values = params.get(name)
    return values[0] if values else default


def parse_request(params, require_range=False):
    source = first_param(params, "source")
    target = first_param(params, "target")
    typ = first_param(params, "type", "v4")
    theme = first_param(params, "theme", "dark")
    raw_dur = first_param(params, "dur", "3600")
    if not source or not target:
        raise ValueError("source and target are required")
    try:
        dur = int(raw_dur)
    except (TypeError, ValueError):
        raise ValueError("dur must be an allowed integer duration")
    if dur not in ALLOWED_DURATIONS:
        raise ValueError("dur is not supported")
    if typ not in ALLOWED_TYPES:
        raise ValueError("type must be v4 or v6")
    if theme not in ALLOWED_THEMES:
        raise ValueError("theme must be dark or light")

    ymin = ymax = None
    if require_range or first_param(params, "ymin") is not None or first_param(params, "ymax") is not None:
        raw_ymin = first_param(params, "ymin")
        raw_ymax = first_param(params, "ymax")
        try:
            ymin = float(raw_ymin)
            ymax = float(raw_ymax)
        except (TypeError, ValueError):
            raise ValueError("ymin and ymax must be finite numbers")
        if not math.isfinite(ymin) or not math.isfinite(ymax) or ymin < 0 or ymax <= ymin:
            raise ValueError("ymin and ymax must satisfy 0 <= ymin < ymax")
        if ymax > 1_000_000:
            raise ValueError("y-axis range is too large")
    return source, target, typ, dur, theme, ymin, ymax


def resolve_rrd(source, target, typ):
    source_node = next((n for n in NODES if n["id"] == source), None)
    target_node = next((n for n in NODES if n["id"] == target), None)
    if not source_node or not target_node:
        raise LookupError("node not found")
    if source == target:
        raise ValueError("source and target must differ")
    if typ == "v4" and (not source_node["v4"] or not target_node["v4"]):
        raise LookupError("IPv4 is not supported for this node pair")
    if typ == "v6" and (not source_node["v6"] or not target_node["v6"]):
        raise LookupError("IPv6 is not supported for this node pair")
    if target_node["group"] == "dns" and source_node["group"] == "dns":
        raise ValueError("DNS to DNS probes are not supported")

    is_master = source == "vps_town_a1"
    if target_node["group"] == "dns":
        category, target_name = "External", target
    elif typ == "v4":
        category, target_name = "ICMPv4", target
    else:
        category, target_name = "ICMPv6", f"{target}_v6"
    path = find_rrd(category, target_name, None if is_master else source)
    if not path:
        raise FileNotFoundError("no data")
    return path, source_node, target_node


def cache_get(cache, key, ttl):
    now = time.monotonic()
    with CACHE_LOCK:
        value = cache.get(key)
        if value and now - value[0] < ttl:
            return value[1]
        if value:
            cache.pop(key, None)
    return None


def cache_put(cache, key, value):
    with CACHE_LOCK:
        cache[key] = (time.monotonic(), value)

def parse_graph_size(params):
    try:
        w = int(first_param(params, "w", "900"))
        h = int(first_param(params, "h", "320"))
    except (TypeError, ValueError):
        raise ValueError("w and h must be integers")
    if not 280 <= w <= 1600 or not 180 <= h <= 600:
        raise ValueError("w must be between 280 and 1600 and h between 180 and 600")
    return w, h


def rrd_fetch_stats(rrd_path, dur=3600, w=900, h=320):
    """Fetch the latest median plus range statistics for the duration."""
    cmd = [
        "rrdtool", "graph", "/dev/null",
        "-w", str(w), "-h", str(h),
        "-s", f"-{dur}",
        "--zoom", "2.0",
        f"DEF:median_r={rrd_path}:median:AVERAGE",
        f"DEF:loss_r={rrd_path}:loss:AVERAGE",
        "CDEF:median_ms=median_r,1000,*",
        "VDEF:vcurrent=median_ms,LAST",
        "VDEF:vavg=median_ms,AVERAGE",
        "VDEF:vmax=median_ms,MAXIMUM",
        "VDEF:vmin=median_ms,MINIMUM",
        "VDEF:lavg=loss_r,AVERAGE",
        "PRINT:vcurrent:%5.2lf",
        "PRINT:vavg:%5.2lf",
        "PRINT:vmax:%5.2lf",
        "PRINT:vmin:%5.2lf",
        "PRINT:lavg:%5.4lf",
    ]
    cache_key = ("stats", rrd_path, os.stat(rrd_path).st_mtime_ns, dur, w, h)
    cached = cache_get(STATS_CACHE, cache_key, STATS_CACHE_TTL)
    if cached is not None:
        return cached
    env = {**os.environ, "TZ": TIMEZONE}
    try:
        with GRAPH_SEMAPHORE:
            r = subprocess.run(cmd, capture_output=True, timeout=10, text=True, env=env)
        if r.returncode == 0:
            parts = [x for x in r.stdout.split() if x.strip()]
            vals = []
            for p in parts:
                try:
                    v = float(p)
                    vals.append(v if math.isfinite(v) else None)
                except ValueError:
                    pass
            if len(vals) >= 5 and vals[4] is not None:
                def rounded(value, digits=2):
                    return round(value, digits) if value is not None else None

                result = {
                    "current_ms": rounded(vals[0]),
                    "avg_ms": rounded(vals[1]),
                    "max_ms": rounded(vals[2]),
                    "min_ms": rounded(vals[3]),
                    "loss_pct": round(vals[4] * 5, 1),
                }
                cache_put(STATS_CACHE, cache_key, result)
                return result
    except (OSError, subprocess.SubprocessError) as exc:
        LOG.warning("stats failed for %s: %s", rrd_path, exc)
    return None


def _parse_rrd_value(token):
    """rrdtool fetch emits '-nan' / 'U' for unknown → JSON null, never NaN."""
    try:
        v = float(token)
    except ValueError:
        return None
    return v if math.isfinite(v) else None


def rrd_fetch_series(rrd_path, dur=3600):
    """Return a structured time series for the Canvas chart engine.

    A single `rrdtool fetch AVERAGE` call yields every DS column
    (uptime, loss, median, ping1..ping20). median is the RTT line;
    per-bucket min/max come from the spread of successful ping samples;
    jitter is a trailing rolling stddev of the median (per REDESIGN_PLAN
    §五 Jitter — never a fabricated primitive).
    """
    cache_key = ("series", rrd_path, os.stat(rrd_path).st_mtime_ns, dur)
    cached = cache_get(STATS_CACHE, cache_key, STATS_CACHE_TTL)
    if cached is not None:
        return cached
    cmd = ["rrdtool", "fetch", rrd_path, "AVERAGE", "-s", f"-{dur}"]
    env = {**os.environ, "TZ": TIMEZONE}
    try:
        with GRAPH_SEMAPHORE:
            r = subprocess.run(cmd, capture_output=True, timeout=12, text=True, env=env)
    except (OSError, subprocess.TimeoutExpired) as exc:
        LOG.warning("series fetch failed for %s: %s", rrd_path, exc)
        return None
    if r.returncode != 0:
        LOG.warning("series fetch rc=%d for %s: %s", r.returncode, rrd_path, r.stderr[:200])
        return None

    lines = [ln for ln in r.stdout.splitlines() if ln.strip()]
    if len(lines) < 2:
        return None
    header = lines[0].split()
    try:
        median_idx = header.index("median")
        loss_idx = header.index("loss")
    except ValueError:
        LOG.warning("series: %s missing median/loss columns", rrd_path)
        return None
    ping_idx = [i for i, name in enumerate(header) if name.startswith("ping")]
    ping_count = max(len(ping_idx), 1)

    timestamps, median, smin, smax, loss, coverage = [], [], [], [], [], []
    for ln in lines[1:]:
        head, _, rest = ln.partition(":")
        try:
            ts = int(head.strip())
        except ValueError:
            continue
        cols = rest.split()
        if len(cols) != len(header):
            continue
        med = _parse_rrd_value(cols[median_idx])
        loss_v = _parse_rrd_value(cols[loss_idx])
        samples = [_parse_rrd_value(cols[i]) for i in ping_idx]
        valid = [s for s in samples if s is not None]
        timestamps.append(ts)
        median.append(None if med is None else round(med * 1000, 3))
        smin.append(None if not valid else round(min(valid) * 1000, 3))
        smax.append(None if not valid else round(max(valid) * 1000, 3))
        loss.append(None if loss_v is None else round(loss_v * 5, 1))
        coverage.append(round(len(valid) / ping_count, 3))

    # ─ Trailing rolling stddev of median → jitter (ms), window 5 ────
    WINDOW = 5
    jitter = [None] * len(median)
    for i in range(WINDOW - 1, len(median)):
        win = [median[j] for j in range(i - WINDOW + 1, i + 1) if median[j] is not None]
        if len(win) >= 2:
            mu = sum(win) / len(win)
            var = sum((x - mu) ** 2 for x in win) / len(win)
            jitter[i] = round(math.sqrt(var), 3)

    # ─ Summary mirrors /api/stats so the two stay consistent ────────
    valid_med = [m for m in median if m is not None]
    valid_loss = [l for l in loss if l is not None]
    summary = {
        "current_ms": valid_med[-1] if valid_med else None,
        "average_ms": round(sum(valid_med) / len(valid_med), 2) if valid_med else None,
        "min_ms": round(min(valid_med), 2) if valid_med else None,
        "max_ms": round(max(valid_med), 2) if valid_med else None,
        "loss_pct": round(sum(valid_loss) / len(valid_loss), 1) if valid_loss else 0,
        "coverage": round(sum(coverage) / len(coverage), 3) if coverage else 0,
    }
    result = {
        "timestamps": timestamps,
        "median": median,
        "min": smin,
        "max": smax,
        "loss": loss,
        "jitter": jitter,
        "coverage": coverage,
        "summary": summary,
        "last_update": timestamps[-1] if timestamps else 0,
        "unit": "ms",
    }
    cache_put(STATS_CACHE, cache_key, result)
    return result


def handle_series(params):
    """Structured series for the Canvas chart engine."""
    try:
        source, target, typ, dur, _, _, _ = parse_request(params)
        rrd_path, _, _ = resolve_rrd(source, target, typ)
    except ValueError as exc:
        return json_error("invalid_parameter", str(exc), HTTPStatus.BAD_REQUEST)
    except LookupError as exc:
        return json_error("invalid_pair", str(exc), HTTPStatus.BAD_REQUEST)
    except FileNotFoundError:
        return json_error("no_data", "no RRD data is available", HTTPStatus.NOT_FOUND)

    series = rrd_fetch_series(rrd_path, dur)
    if series is None:
        return json_error("rrd_error", "could not read RRD data", HTTPStatus.BAD_GATEWAY)
    series = {**series, "source": source, "target": target, "type": typ}
    return json.dumps(series).encode(), 200


def handle_nodes():
    data = json.dumps(NODES)
    return data.encode()


def make_pairs(node_ids):
    selected = [n for n in NODES if n["id"] in node_ids]
    if len(selected) != len(set(node_ids)):
        raise ValueError("unknown node in selection")
    if len(selected) > MAX_SELECTED_NODES:
        raise ValueError(f"select no more than {MAX_SELECTED_NODES} nodes")
    pairs = []
    for index, first in enumerate(selected):
        for second in selected[index + 1:]:
            if first["group"] == "dns" and second["group"] == "dns":
                continue
            if first["group"] == "dns" or second["group"] == "dns":
                source, target = (second, first) if first["group"] == "dns" else (first, second)
                pairs.append({
                    "source": source["id"], "target": target["id"], "type": "v4",
                    "srcLabel": source["label"], "tgtLabel": target["label"], "ext": True,
                    "pairKey": f'{first["id"]}_{second["id"]}', "direction": 0,
                })
            else:
                pair_key = f'{first["id"]}_{second["id"]}'
                for direction, (source, target) in enumerate(((first, second), (second, first))):
                    pairs.append({
                        "source": source["id"], "target": target["id"], "type": "v4",
                        "srcLabel": source["label"], "tgtLabel": target["label"], "ext": False,
                        "pairKey": pair_key, "direction": direction,
                    })
                    if first["v6"] and second["v6"]:
                        pairs.append({
                            "source": source["id"], "target": target["id"], "type": "v6",
                            "srcLabel": source["label"], "tgtLabel": target["label"], "ext": False,
                            "pairKey": pair_key, "direction": direction,
                        })
    if len(pairs) > MAX_PAIRS:
        raise ValueError(f"selection produces more than {MAX_PAIRS} graphs")
    return pairs


def handle_pairs(params):
    raw_nodes = first_param(params, "nodes", "")
    node_ids = [node_id for node_id in raw_nodes.split(",") if node_id]
    if len(node_ids) < 2:
        return json_error("invalid_selection", "select at least two nodes", HTTPStatus.BAD_REQUEST)
    try:
        return json.dumps(make_pairs(node_ids)).encode(), HTTPStatus.OK
    except ValueError as exc:
        return json_error("invalid_selection", str(exc), HTTPStatus.BAD_REQUEST)

def handle_stats(params):
    """Return quick stats for a source->target pair."""
    try:
        source, target, typ, dur, _, _, _ = parse_request(params)
        w, h = parse_graph_size(params)
        rrd_path, _, _ = resolve_rrd(source, target, typ)
    except ValueError as exc:
        return json_error("invalid_parameter", str(exc), HTTPStatus.BAD_REQUEST)
    except LookupError as exc:
        return json_error("invalid_pair", str(exc), HTTPStatus.BAD_REQUEST)
    except FileNotFoundError:
        return json_error("no_data", "no RRD data is available", HTTPStatus.NOT_FOUND)

    stats = rrd_fetch_stats(rrd_path, dur, w, h)
    if stats:
        return json.dumps(stats).encode(), 200
    return json_error("rrd_error", "could not read RRD data", HTTPStatus.BAD_GATEWAY)


def _batch_stats_item(pair, dur, w, h):
    item = {
        "source": pair["source"],
        "target": pair["target"],
        "type": pair["type"],
    }
    try:
        rrd_path, _, _ = resolve_rrd(pair["source"], pair["target"], pair["type"])
    except (LookupError, ValueError):
        item["error"] = "invalid_pair"
        return item
    except FileNotFoundError:
        item["error"] = "no_data"
        return item

    stats = rrd_fetch_stats(rrd_path, dur, w, h)
    if stats is None:
        item["error"] = "rrd_error"
    else:
        item["stats"] = stats
    return item


def handle_stats_batch(params):
    """Return every statistic for a node selection in one network round-trip."""
    raw_nodes = first_param(params, "nodes", "")
    node_ids = [node_id for node_id in raw_nodes.split(",") if node_id]
    if len(node_ids) < 2:
        return json_error("invalid_selection", "select at least two nodes", HTTPStatus.BAD_REQUEST)

    try:
        pairs = make_pairs(node_ids)
        dur = int(first_param(params, "dur", "10800"))
        if dur not in ALLOWED_DURATIONS:
            raise ValueError("duration is not allowed")
        w, h = parse_graph_size(params)
    except (TypeError, ValueError) as exc:
        return json_error("invalid_parameter", str(exc), HTTPStatus.BAD_REQUEST)

    if not pairs:
        return json.dumps({"items": []}).encode(), HTTPStatus.OK

    workers = min(MAX_GRAPH_WORKERS, len(pairs))
    with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="stats-batch") as executor:
        items = list(executor.map(lambda pair: _batch_stats_item(pair, dur, w, h), pairs))
    return json.dumps({"items": items}).encode(), HTTPStatus.OK

def handle_graph(params):
    try:
        source, target, typ, dur, theme, forced_ymin, forced_ymax = parse_request(params)
    except ValueError as exc:
        return json_error("invalid_parameter", str(exc), HTTPStatus.BAD_REQUEST)

    try:
        w, h = parse_graph_size(params)
    except ValueError as exc:
        return json_error("invalid_parameter", str(exc), HTTPStatus.BAD_REQUEST)

    try:
        rrd_path, source_node, target_node = resolve_rrd(source, target, typ)
    except LookupError as exc:
        return json_error("invalid_pair", str(exc), HTTPStatus.BAD_REQUEST)
    except FileNotFoundError:
        return json_error("no_data", "no RRD data is available", HTTPStatus.NOT_FOUND)

    # Determine unit and multiplier
    if forced_ymax is not None:
        # Use the forced range to decide unit
        if forced_ymax < 1:
            mult = 1000000
        else:
            mult = 1000
    else:
        # Probe for data range
        probe_cmd = [
            "rrdtool", "graph", "/dev/null",
            "-s", f"-{dur}",
            "DEF:median_r={}:median:AVERAGE".format(rrd_path),
            "CDEF:median_ms=median_r,1000,*",
            "LINE2:median_ms#000000:x",
            "VDEF:vmax=median_ms,MAXIMUM",
            "VDEF:vmin=median_ms,MINIMUM",
            "PRINT:vmax:%5.2lf",
            "PRINT:vmin:%5.2lf",
        ]
        env_probe = {**os.environ, "TZ": TIMEZONE}
        try:
            with GRAPH_SEMAPHORE:
                probe = subprocess.run(probe_cmd, capture_output=True, timeout=15, text=True, env=env_probe)
        except subprocess.TimeoutExpired:
            LOG.warning("range probe timed out for %s", rrd_path)
            probe = None
        except OSError as exc:
            LOG.warning("range probe failed for %s: %s", rrd_path, exc)
            probe = None
        max_ms, min_ms = 0.0, 0.0
        if probe is not None and probe.returncode == 0:
            lines = [l.strip() for l in probe.stdout.strip().split('\n') if l.strip()]
            vals = []
            for l in lines:
                try:
                    vals.append(float(l))
                except ValueError:
                    pass
            if len(vals) >= 2:
                max_ms = vals[0]
                min_ms = vals[1]

        if max_ms < 1:
            mult = 1000000
        else:
            mult = 1000

    env = {**os.environ, "TZ": TIMEZONE}

    # Theme colors
    if theme == "dark":
        BACK   = "141414"
        CANVAS = "1a1a1a"
        FONT   = "a0a0a0"
        AXIS   = "333333"
        FRAME  = "252525"
        ARROW  = "555555"
        GRID   = "222222"
        MGRID  = "2a2a2a"
        LINE_C = "d4d4d4"
        LOSS_C = "ef4444"
        AREA_C = "d4d4d408"
    else:
        BACK   = "FFFFFF"
        CANVAS = "F8FAFC"
        FONT   = "1E293B"
        AXIS   = "64748B"
        FRAME  = "CBD5E1"
        ARROW  = "475569"
        GRID   = "E2E8F0"
        MGRID  = "CBD5E1"
        LINE_C = "0284C7"
        LOSS_C = "DC2626"
        AREA_C = "0284C715"

    # Mobile images are displayed at a smaller CSS scale, so keep their
    # embedded labels readable without changing the desktop composition.
    if w <= 600:
        default_font, axis_font, legend_font = 16, 16, 16
    else:
        default_font, axis_font, legend_font = 11, 11, 11

    cmd = [
        "rrdtool", "graph", "/dev/stdout",
        "-w", str(w), "-h", str(h),
        "-s", f"-{dur}",
        "--font", f"DEFAULT:{default_font}:DejaVu Sans Mono",
        "--font", f"AXIS:{axis_font}:",
        "--font", f"LEGEND:{legend_font}:",
        # RRDtool 1.7.x treats a zero watermark size as "keep the default".
        # One pixel keeps the built-in mark below the visible rendering threshold.
        "--font", "WATERMARK:1:",
        "--border", "0",
        "--zoom", "2.0",
        # Reserve only the space needed for the short numeric Y-axis labels.
        "--units-length", "3",
    ]

    # RRDtool's default 24h labels include the weekday, which overlaps at the
    # mobile graph width. Keep the grid cadence but use compact clock labels;
    # the narrowest cards need fewer labels still.
    if w <= 600 and dur == 86400:
        label_step = "HOUR:12" if w <= 320 else "HOUR:6"
        cmd += ["--x-grid", f"HOUR:1:HOUR:6:{label_step}:0:%H:%M"]

    # Apply forced Y-axis range if provided (from frontend for pairwise consistency)
    if forced_ymin is not None and forced_ymax is not None:
        # Convert ms to the display unit
        if mult == 1000000:
            y_lo = forced_ymin * 1000  # ms → μs
            y_hi = forced_ymax * 1000
        else:
            y_lo = forced_ymin
            y_hi = forced_ymax

        # Nice step from range (same algorithm as auto mode)
        total = y_hi - y_lo
        if total > 0:
            mag = 10 ** math.floor(math.log10(total + 1e-9))
            r = total / mag
            if r < 1.5:    step = mag * 0.2
            elif r < 3:    step = mag * 0.5
            elif r < 7:    step = mag * 1
            else:          step = mag * 2
            step = max(step, 1.0)
            ticks = total / step
            if ticks < 4:  step = step / 2; step = max(step, 1.0)
            elif ticks > 8: step = step * 2

            y_lo = round(max(0.0, math.floor(y_lo / step) * step), 6)
            y_hi = round(math.ceil(y_hi / step) * step, 6)
            if y_hi - y_lo < step * 3:
                y_hi = y_lo + step * 3

            cmd += ["--lower-limit", str(y_lo), "--upper-limit", str(y_hi), "--rigid",
                    "--y-grid", "{}:1".format(int(step) if step == int(step) else step)]
        else:
            cmd += ["--lower-limit", str(y_lo), "--upper-limit", str(y_hi), "--rigid"]

    cmd += [
        "--imgformat", "PNG",
        "-c", f"BACK#{BACK}",
        "-c", f"SHADEA#{BACK}",
        "-c", f"SHADEB#{BACK}",
        "-c", f"CANVAS#{CANVAS}",
        "-c", f"FONT#{FONT}",
        "-c", f"AXIS#{AXIS}",
        "-c", f"FRAME#{FRAME}",
        "-c", f"ARROW#{ARROW}",
        "-c", f"GRID#{GRID}",
        "-c", f"MGRID#{MGRID}",
        "DEF:median_r={}:median:AVERAGE".format(rrd_path),
        "DEF:loss_r={}:loss:AVERAGE".format(rrd_path),
        "CDEF:median_unit=median_r,{},*".format(mult),
        "CDEF:loss_pct=loss_r,5,*",
        "CDEF:loss_flag=loss_r,0,GT",
        f"AREA:median_unit#{AREA_C}",
        f"LINE1.5:median_unit#{LINE_C}",
        f"TICK:loss_flag#{LOSS_C}:0.04",
    ]

    # Compute y-axis limits with padding (unless forced range is provided)
    if forced_ymax is None and forced_ymin is None:
        if max_ms > 0:
            if mult == 1000000:
                d_max = max_ms * 1000
                d_min = min_ms * 1000
            else:
                d_max = max_ms
                d_min = min_ms

            span = d_max - d_min
            if span <= 0:
                span = max(d_max * 0.08, 1.0)

            # Padding: larger of relative (35% span) and absolute (15% max)
            pad = max(span * 0.35, d_max * 0.15)

            # Lower: drop to 0 if data starts close to origin
            if d_min < d_max * 0.15:
                y_lower = 0.0
            else:
                y_lower = max(0.0, d_min - pad)

            # Upper: pad above the max, ensure it exceeds lower
            y_upper = max(d_max + pad, d_max * 1.12, y_lower + d_max * 0.12)

            # Nice step from 1,2,5 × 10ⁿ, but minimum step = 1
            total = y_upper - y_lower
            mag = 10 ** math.floor(math.log10(total + 1e-9))
            r = total / mag
            if r < 1.5:
                step = mag * 0.2
            elif r < 3:
                step = mag * 0.5
            elif r < 7:
                step = mag * 1
            else:
                step = mag * 2

            # Clamp step ≥ 1 (no decimal ticks)
            step = max(step, 1.0)

            ticks = total / step
            if ticks < 4:
                step = step / 2
                step = max(step, 1.0)
            elif ticks > 8:
                step = step * 2

            y_lower = round(max(0.0, math.floor(y_lower / step) * step), 6)
            y_upper = round(math.ceil(y_upper / step) * step, 6)

            # Ensure at least 4 tick values (3 intervals)
            if y_upper - y_lower < step * 3:
                y_upper = y_lower + step * 3

            cmd += ["--lower-limit", str(y_lower), "--upper-limit", str(y_upper), "--rigid",
                    "--y-grid", "{}:1".format(int(step) if step == int(step) else step)]

    cache_key = (rrd_path, os.stat(rrd_path).st_mtime_ns, dur, theme, forced_ymin, forced_ymax, w, h)
    cached = cache_get(GRAPH_CACHE, cache_key, GRAPH_CACHE_TTL)
    if cached is not None:
        return cached, 200, "image/png"
    try:
        with GRAPH_SEMAPHORE:
            r = subprocess.run(cmd, capture_output=True, timeout=20, env=env)
        if r.returncode == 0:
            cache_put(GRAPH_CACHE, cache_key, r.stdout)
            return r.stdout, 200, "image/png"
        else:
            LOG.warning("graph failed for %s: %s", rrd_path, r.stderr[:300])
            return json_error("rrd_error", "rrdtool could not generate the graph", HTTPStatus.BAD_GATEWAY)
    except subprocess.TimeoutExpired:
        LOG.warning("graph timed out for %s", rrd_path)
        return json_error("timeout", "graph generation timed out", HTTPStatus.GATEWAY_TIMEOUT)
    except OSError as exc:
        LOG.exception("graph execution failed")
        return json_error("server_error", str(exc), HTTPStatus.INTERNAL_SERVER_ERROR)


class Handler(http.server.BaseHTTPRequestHandler):
    def send_security_headers(self):
        for key, value in SECURITY_HEADERS:
            self.send_header(key, value)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        params = urllib.parse.parse_qs(parsed.query)

        cors_headers = [("Access-Control-Allow-Methods", "GET, OPTIONS")]

        if path == "/api/nodes":
            data = handle_nodes()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_security_headers()
            for k, v in cors_headers: self.send_header(k, v)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        elif path == "/api/stats":
            data, status = handle_stats(params)
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_security_headers()
            for k, v in cors_headers: self.send_header(k, v)
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        elif path in ("/api/stats-batch", "/api/stats-batch.json"):
            data, status = handle_stats_batch(params)
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_security_headers()
            for k, v in cors_headers: self.send_header(k, v)
            if path.endswith(".json"):
                self.send_header("Cache-Control", "public, max-age=15, s-maxage=30, stale-while-revalidate=60")
            else:
                self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        elif path == "/api/pairs":
            data, status = handle_pairs(params)
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_security_headers()
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        elif path == "/api/series":
            data, status = handle_series(params)
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_security_headers()
            for k, v in cors_headers: self.send_header(k, v)
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        elif path in ("/api/graph", "/api/graph.png"):
            data, status, *mime = handle_graph(params)
            ct = mime[0] if mime else "application/json; charset=utf-8"
            self.send_response(status)
            self.send_header("Content-Type", ct)
            self.send_security_headers()
            for k, v in cors_headers: self.send_header(k, v)
            self.send_header("Cache-Control", "public, max-age=15, s-maxage=30, stale-while-revalidate=60")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        elif path == "/healthz":
            data = json.dumps({"status": "ok"}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_security_headers()
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        elif path in {
            "/static/fonts/SmileySans.woff2",
            "/static/fonts/JetBrainsMono-Regular.woff2",
            "/static/fonts/JetBrainsMono-Medium.woff2",
            "/static/fonts/JetBrainsMono-SemiBold.woff2",
            "/static/fonts/JetBrainsMono-Bold.woff2",
        }:
            filename = WEB_DIR / "fonts" / os.path.basename(path)
            try:
                body = filename.read_bytes()
            except OSError:
                self.send_response(HTTPStatus.NOT_FOUND)
                self.send_security_headers()
                self.end_headers()
                return
            self.send_response(200)
            self.send_header("Content-Type", "font/woff2")
            self.send_security_headers()
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        elif path == "/static/styles.css" or path == "/static/app.js":
            filename = "styles.css" if path.endswith(".css") else "app.js"
            content_type = "text/css; charset=utf-8" if filename.endswith(".css") else "text/javascript; charset=utf-8"
            try:
                body = (WEB_DIR / filename).read_bytes()
            except OSError:
                self.send_response(HTTPStatus.NOT_FOUND)
                self.send_security_headers()
                self.end_headers()
                return
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_security_headers()
            self.send_header("Cache-Control", "no-cache, must-revalidate")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        elif path == "/" or path == "/index.html":
            try:
                body = (WEB_DIR / "index.html").read_bytes()
            except OSError:
                data = json_error("frontend_unavailable", "frontend assets are not installed", HTTPStatus.SERVICE_UNAVAILABLE)[0]
                self.send_response(HTTPStatus.SERVICE_UNAVAILABLE)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_security_headers()
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_security_headers()
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        else:
            self.send_response(404)
            self.end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_security_headers()
        self.end_headers()

    def log_message(self, fmt, *args):
        LOG.info("%s %s", self.command, self.path)


class ThreadingHTTPServer(ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


INDEX_HTML = r"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=5,viewport-fit=cover">
<meta name="description" content="ipPping — Real-time network latency matrix between VPS nodes.">
<title>ipPping — Latency Matrix</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root {
  --bg:        #111111;
  --bg-panel:  #181818;
  --bg-card:   #1c1c1c;
  --bg-hover:  #242424;
  --border:    #2a2a2a;
  --border-hi: #3a3a3a;
  --accent:    #e0e0e0;
  --accent2:   #a78bfa;
  --accent3:   #4ade80;
  --danger:    #f87171;
  --text:      #d4d4d4;
  --text-sec:  #888888;
  --text-dim:  #555555;
  --radius:    8px;
  --ease:      0.18s ease;
  --sidebar-w: 260px;
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { scroll-behavior: smooth; height: 100%; }

body {
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  background: var(--bg);
  color: var(--text-sec);
  height: 100%; height: 100dvh;
  -webkit-font-smoothing: antialiased;
  overflow: hidden;
}

#app { display: flex; flex-direction: column; height: 100%; }

/* ── Topbar ─────────────────────────────────────── */
.topbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 20px; height: 46px; flex-shrink: 0;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
  z-index: 100;
}
.topbar-left { display: flex; align-items: center; gap: 12px; }
.toggle-btn {
  width: 30px; height: 30px; border: none; border-radius: 6px;
  background: transparent; color: var(--text-sec); cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: var(--ease);
}
.toggle-btn:hover { background: var(--bg-hover); color: var(--text); }
.toggle-btn svg { width: 16px; height: 16px; }
.brand {
  font-size: 15px; font-weight: 600; color: var(--text);
  letter-spacing: -0.3px;
}
.brand span { color: var(--text-sec); }
.topbar-right { display: flex; align-items: center; gap: 12px; }
.live-dot {
  width: 5px; height: 5px; background: var(--accent3);
  border-radius: 50%; animation: pulse 2s ease-in-out infinite;
}
@keyframes pulse { 0%,100%{opacity:1}50%{opacity:0.3} }
.clock {
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px; color: var(--text-dim);
}

/* ── Content ────────────────────────────────────── */
.content { display: flex; flex: 1; overflow: hidden; min-height: 0; }

/* ── Sidebar ────────────────────────────────────── */
.sidebar {
  width: var(--sidebar-w); flex-shrink: 0;
  background: var(--bg-panel);
  border-right: 1px solid var(--border);
  display: flex; flex-direction: column;
  transition: margin-left 0.25s ease, opacity 0.2s ease;
  overflow: hidden;
}
.sidebar.collapsed {
  margin-left: calc(-1 * var(--sidebar-w));
  opacity: 0; pointer-events: none;
}
.sidebar-inner {
  padding: 14px 10px; overflow-y: auto; flex: 1;
  scrollbar-width: thin; scrollbar-color: var(--border) transparent;
}
.sidebar-inner::-webkit-scrollbar { width: 3px; }
.sidebar-inner::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }

.section { margin-bottom: 16px; }
.section-head {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 5px; padding: 0 6px;
}
.section-label {
  font-size: 11px; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.8px; color: var(--text-dim);
}
.section-num {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px; color: var(--text-dim);
}
.section-actions {
  display: flex; gap: 8px; padding: 0 6px; margin-bottom: 5px;
}
.link-btn {
  font-size: 12px; color: var(--text-sec); background: none; border: none;
  cursor: pointer; opacity: 0.7; text-decoration: underline;
  text-underline-offset: 2px;
}
.link-btn:hover { opacity: 1; color: var(--text); }

/* ── Node items ─────────────────────────────────── */
.node {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 8px; border-radius: 5px;
  cursor: pointer; transition: background var(--ease);
}
.node:hover { background: var(--bg-hover); }
.node.on { background: rgba(255,255,255,0.04); }
.node-cb { display: none; }
.check {
  width: 16px; height: 16px; flex-shrink: 0;
  border: 1.5px solid var(--border-hi); border-radius: 3px;
  display: flex; align-items: center; justify-content: center;
  transition: var(--ease);
}
.node.on .check { background: var(--text-sec); border-color: var(--text-sec); }
.check svg { opacity: 0; transition: opacity var(--ease); }
.node.on .check svg { opacity: 1; }
.node-label {
  font-size: 13.5px; font-weight: 500; color: var(--text);
  flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.node-meta {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px; color: var(--text-dim); flex-shrink: 0;
}

/* ── Sidebar bottom ─────────────────────────────── */
.sidebar-foot {
  padding: 10px 12px; border-top: 1px solid var(--border);
}
.dur-row {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 8px;
}
.dur-label { font-size: 12px; color: var(--text-dim); }
.dur-select {
  background: var(--bg-card); border: 1px solid var(--border);
  color: var(--text); font-size: 12px; font-family: 'Inter', sans-serif;
  padding: 5px 10px; border-radius: 5px; outline: none; cursor: pointer;
}
.dur-select:focus { border-color: var(--text-dim); }
.dur-select option { background: var(--bg-panel); }

.go-btn {
  width: 100%; padding: 9px;
  background: var(--text); color: var(--bg);
  font-size: 13px; font-weight: 600; font-family: 'Inter', sans-serif;
  border: none; border-radius: 5px; cursor: pointer;
  transition: opacity var(--ease);
}
.go-btn:hover { opacity: 0.85; }
.go-btn:disabled { background: var(--border); color: var(--text-dim); cursor: default; opacity: 1; }

.sel-info {
  text-align: center; font-size: 11px; color: var(--text-dim); margin-top: 5px;
}
.sel-info b { color: var(--text-sec); font-weight: 600; }

/* ── Main ───────────────────────────────────────── */
.main {
  flex: 1; min-width: 0; min-height: 0;
  overflow-y: auto; -webkit-overflow-scrolling: touch;
  padding: 16px 20px 40px;
  display: flex; flex-direction: column; gap: 12px;
}
.main::-webkit-scrollbar { width: 4px; }
.main::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
.main { scrollbar-width: thin; scrollbar-color: var(--border) transparent; }

/* ── Toolbar ─────────────────────────────────────── */
.toolbar {
  display: flex; align-items: center; justify-content: space-between;
  flex-wrap: wrap; gap: 8px;
}
.toolbar-left { display: flex; align-items: center; gap: 8px; }
.toolbar-title { font-size: 14px; font-weight: 600; color: var(--text); }
.count-badge {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px; color: var(--text-sec);
  background: var(--bg-card); border: 1px solid var(--border);
  padding: 2px 7px; border-radius: 8px;
}
.pills { display: flex; gap: 3px; }
.pill {
  font-size: 12px; font-weight: 500;
  padding: 4px 10px; border-radius: 12px;
  border: 1px solid var(--border); background: transparent;
  color: var(--text-dim); cursor: pointer;
  transition: var(--ease); font-family: 'Inter', sans-serif;
}
.pill:hover { border-color: var(--border-hi); color: var(--text-sec); }
.pill.on { background: var(--bg-hover); border-color: var(--border-hi); color: var(--text); }

/* ── Loading bar ─────────────────────────────────── */
.load-bar {
  height: 2px; background: var(--border); border-radius: 1px; overflow: hidden;
}
.load-bar-inner {
  height: 100%; background: var(--text-sec); width: 0%;
  transition: width 0.3s ease;
}

/* ── Graph grid ──────────────────────────────────── */
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 780px), 1fr));
  gap: 10px;
}

.card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  transition: border-color var(--ease);
  animation: fadeIn 0.2s ease both;
}
.card:hover { border-color: var(--border-hi); }
@keyframes fadeIn { from{opacity:0}to{opacity:1} }

.card-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px 2px; gap: 6px; flex-wrap: wrap;
}
.route {
  display: flex; align-items: center; gap: 5px;
  font-size: 14px; font-weight: 500; color: var(--text);
}
.route-arrow { color: var(--text-dim); font-size: 13px; }
.card-right { display: flex; align-items: center; gap: 8px; }
.badge {
  font-size: 11px; font-weight: 600; padding: 1px 7px;
  border-radius: 6px; letter-spacing: 0.3px;
}
.badge-v4  { color: var(--text-sec); background: rgba(255,255,255,0.06); }
.badge-v6  { color: var(--accent2); background: rgba(167,139,250,0.08); }
.badge-ext { color: var(--accent3); background: rgba(74,222,128,0.08); }

.stats {
  display: flex; gap: 8px;
  font-family: 'JetBrains Mono', monospace; font-size: 11.5px; color: var(--text-dim);
}
.stats .v { color: var(--text-sec); }
.stats .loss-warn .v { color: #fb923c; }
.stats .loss-bad .v  { color: var(--danger); }

.card-img { padding: 4px 6px 6px; position: relative; }
.card-img { min-height: 180px; }
    .card-img img {
      width: 100%; height: auto; display: block;
      border-radius: 4px; opacity: 0; transition: opacity 0.3s ease;
    }
    .card-img img.ok { opacity: 1; }
    .card.failed .card-img img { display: none; }
    .card-status {
      display: none; min-height: 120px; padding: 34px 18px;
      align-items: center; justify-content: center; gap: 8px;
      flex-direction: column; text-align: center; color: var(--text-dim);
      font-size: 12px;
    }
    .card.failed .card-status { display: flex; }
.card-status strong { color: var(--text-sec); font-size: 13px; }
.card-status span { max-width: 280px; }
    .retry-btn {
      border: 1px solid var(--border-hi); background: transparent;
      color: var(--text-sec); border-radius: 4px; padding: 4px 9px;
      cursor: pointer; font-size: 11px;
    }
    .retry-btn:hover { color: var(--text); background: var(--bg-hover); }
.skel {
  position: absolute; inset: 4px 6px 6px;
  border-radius: 4px;
  background: linear-gradient(90deg, var(--bg-panel) 30%, var(--bg-hover) 50%, var(--bg-panel) 70%);
  background-size: 200% 100%; animation: shimmer 1.5s ease-in-out infinite;
}
.skel.gone { display: none; }
@keyframes shimmer { 0%{background-position:200% 0}100%{background-position:-200% 0} }

/* ── Empty state ──────────────────────────────────── */
.empty {
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  padding: 60px 20px; gap: 8px; text-align: center; color: var(--text-dim);
}
.empty-title { font-size: 16px; font-weight: 600; color: var(--text-sec); }
.empty-sub { font-size: 13px; max-width: 340px; line-height: 1.5; }

.spinner {
  width: 20px; height: 20px;
  border: 2px solid var(--border); border-top-color: var(--text-sec);
  border-radius: 50%; animation: spin 0.7s linear infinite;
}
@keyframes spin { to{transform:rotate(360deg)} }

/* ── Toast ─────────────────────────────────────── */
.toast-box { position: fixed; bottom: 16px; right: 16px; z-index: 999; }
.toast {
  background: var(--bg-panel); border: 1px solid var(--border);
  border-radius: 6px; padding: 8px 14px;
  font-size: 13px; color: var(--text); animation: tIn 0.2s ease;
}
.toast.err { border-color: rgba(248,113,113,0.3); color: var(--danger); }
@keyframes tIn { from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)} }

/* ── Mobile overlay ───────────────────────────────── */
.sidebar-overlay {
  display: none; position: fixed; inset: 0; z-index: 199;
  background: rgba(0,0,0,0.5);
}

/* ── Responsive ───────────────────────────────────── */
@media (max-width: 768px) {
  :root { --sidebar-w: 280px; }
  body { height: 100dvh; height: -webkit-fill-available; }
  .sidebar {
    position: fixed; top: 46px; left: 0; bottom: 0;
    z-index: 200;
    margin-left: calc(-1 * var(--sidebar-w));
    opacity: 0; pointer-events: none;
  }
  .sidebar.mobile-open {
    margin-left: 0; opacity: 1; pointer-events: auto;
  }
  .sidebar.collapsed { margin-left: calc(-1 * var(--sidebar-w)); opacity: 0; pointer-events: none; }
  .sidebar-overlay.show { display: block; }
  .main { padding: 10px 10px 60px; }
  .topbar { padding: 0 12px; height: 44px; }
  .card-head { padding: 8px 10px 2px; }
  .route { font-size: 13px; }
  .stats { gap: 5px; font-size: 10.5px; }
  .badge { font-size: 10px; }
  .grid { gap: 8px; }
  .toolbar-title { font-size: 13px; }
  .pill { font-size: 11px; padding: 3px 8px; }
}
</style>
</head>
<body>
<div id="app">

  <header class="topbar">
    <div class="topbar-left">
      <button class="toggle-btn" id="toggleSidebar" onclick="toggleSidebar()" title="Toggle sidebar">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
          <line x1="2" y1="4" x2="14" y2="4"/><line x1="2" y1="8" x2="14" y2="8"/><line x1="2" y1="12" x2="14" y2="12"/>
        </svg>
      </button>
      <div class="brand">ip<span>Pping</span></div>
    </div>
    <div class="topbar-right">
      <div class="live-dot"></div>
      <span class="clock" id="clock"></span>
    </div>
  </header>

  <div class="content">
    <div class="sidebar-overlay" id="overlay" onclick="toggleSidebar()"></div>
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-inner" id="sidebarInner">
        <div class="empty" style="padding:30px 10px">
          <div class="spinner"></div>
        </div>
      </div>
      <div class="sidebar-foot">
        <div class="dur-row">
          <span class="dur-label">Time range</span>
          <select class="dur-select" id="durSelect">
            <option value="3600">1 hour</option>
            <option value="10800" selected>3 hours</option>
            <option value="21600">6 hours</option>
            <option value="86400">24 hours</option>
          </select>
        </div>
        <button class="go-btn" id="goBtn" onclick="showGraphs()" disabled>Show Graphs</button>
        <div class="sel-info" id="selInfo">Select at least 2 nodes</div>
      </div>
    </aside>

    <main class="main" id="mainArea">
      <div class="empty" id="emptyState">
        <div class="empty-title">Latency Matrix</div>
        <div class="empty-sub">Select nodes and click "Show Graphs" to view real-time RTT across your infrastructure.</div>
      </div>
    </main>
  </div>

</div>
<div class="toast-box" id="toastBox"></div>

<script>
'use strict';

let nodes = [];
let currentPairs = [];
let statsCache = {};
let activeFilter = 'all';
let sidebarOpen = true;
let pairGroupRanges = {}; // groupKey -> {ymin, ymax} per node-pair+type
let renderGeneration = 0;
let activeController = null;
const isMobile = () => window.innerWidth <= 768;

function requestUrl(path, params) {
  const query = new URLSearchParams(params);
  return `${path}?${query}`;
}

async function fetchJson(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

// Sidebar toggle
function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  const ov = document.getElementById('overlay');
  if (isMobile()) {
    const open = sb.classList.toggle('mobile-open');
    sb.classList.remove('collapsed');
    ov.classList.toggle('show', open);
  } else {
    sidebarOpen = !sidebarOpen;
    sb.classList.toggle('collapsed', !sidebarOpen);
  }
}
if (isMobile()) {
  document.getElementById('sidebar').classList.remove('mobile-open');
}

// Clock
function tick() {
  const d = new Date();
  document.getElementById('clock').textContent =
    d.toLocaleTimeString('en-GB', { timeZone: 'Asia/Shanghai', hour12: false }) + ' CST';
}
tick(); setInterval(tick, 1000);

// Toast
function toast(msg, err) {
  const b = document.getElementById('toastBox');
  const t = document.createElement('div');
  t.className = 'toast' + (err ? ' err' : '');
  t.textContent = msg;
  b.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// Load nodes
fetchJson('/api/nodes').then(d => { nodes = d; renderSidebar(); })
  .catch(() => toast('Failed to load nodes', true));

const checkSvg = '<svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 3.5L3.5 6L9 1" stroke="#111" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function renderSidebar() {
  const vps = nodes.filter(n => n.group === 'vps');
  const dns = nodes.filter(n => n.group === 'dns');
  let h = '';
  h += `<div class="section">
    <div class="section-head">
      <span class="section-label">VPS Nodes</span>
      <span class="section-num">${vps.length}</span>
    </div>
    <div class="section-actions">
      <button class="link-btn" onclick="selGrp('vps',1)">All</button>
      <button class="link-btn" onclick="selGrp('vps',0)">None</button>
    </div>`;
  vps.forEach(n => { h += nodeRow(n); });
  h += '</div>';
  h += `<div class="section">
    <div class="section-head">
      <span class="section-label">External DNS</span>
      <span class="section-num">${dns.length}</span>
    </div>`;
  dns.forEach(n => { h += nodeRow(n); });
  h += '</div>';
  document.getElementById('sidebarInner').innerHTML = h;
}

function nodeRow(n) {
  let meta = '';
  if (n.group === 'vps') {
    meta = n.v6 ? 'v4 \u00b7 v6' : 'v4';
  }
  return `<div class="node" id="n_${n.id}" onclick="tog('${n.id}')">
    <input type="checkbox" class="node-cb" id="c_${n.id}" data-id="${n.id}">
    <div class="check">${checkSvg}</div>
    <span class="node-label">${n.label}</span>
    ${meta ? `<span class="node-meta">${meta}</span>` : ''}
  </div>`;
}

function tog(id) {
  const c = document.getElementById('c_' + id);
  c.checked = !c.checked;
  document.getElementById('n_' + id).classList.toggle('on', c.checked);
  updSel();
}

function selGrp(g, v) {
  nodes.filter(n => n.group === g).forEach(n => {
    const c = document.getElementById('c_' + n.id);
    if (c) { c.checked = !!v; document.getElementById('n_' + n.id).classList.toggle('on', !!v); }
  });
  updSel();
}

function getSel() {
  return Array.from(document.querySelectorAll('.node-cb:checked')).map(c => c.dataset.id);
}

function updSel() {
  const s = getSel();
  let pairs = 0;
  let message = '';
  try {
    pairs = makePairs(s).length;
  } catch (error) {
    message = error.message;
  }
  document.getElementById('goBtn').disabled = s.length < 2 || !!message;
  document.getElementById('selInfo').innerHTML = message
    ? `<span style="color:var(--danger)">${message}</span>`
    : s.length < 2
      ? 'Select at least 2 nodes'
      : `<b>${s.length}</b> nodes \u00b7 <b>${pairs}</b> graphs`;
}

function makePairs(sel) {
  if (sel.length > 20) throw new Error('Select no more than 20 nodes');
  const p = [];
  for (let i = 0; i < sel.length; i++) {
    for (let j = i + 1; j < sel.length; j++) {
      const a = sel[i], b = sel[j];
      const na = nodes.find(n => n.id === a), nb = nodes.find(n => n.id === b);
      if (!na || !nb) continue;
      if (na.group === 'dns' && nb.group === 'dns') continue;
      if (na.group === 'dns' || nb.group === 'dns') {
        const src = na.group === 'dns' ? b : a, tgt = na.group === 'dns' ? a : b;
        p.push({ source: src, target: tgt, type: 'v4',
          srcLabel: nodes.find(n=>n.id===src)?.label, tgtLabel: nodes.find(n=>n.id===tgt)?.label, ext: true });
      } else {
        [{s:a,t:b},{s:b,t:a}].forEach(x => {
          p.push({ source: x.s, target: x.t, type: 'v4',
            srcLabel: nodes.find(n=>n.id===x.s)?.label, tgtLabel: nodes.find(n=>n.id===x.t)?.label, ext: false });
          if (na.v6 && nb.v6)
            p.push({ source: x.s, target: x.t, type: 'v6',
              srcLabel: nodes.find(n=>n.id===x.s)?.label, tgtLabel: nodes.find(n=>n.id===x.t)?.label, ext: false });
        });
      }
    }
  }
  if (p.length > 500) throw new Error('Selection produces too many graphs');
  return p;
}

// Group key: sorted node pair + type (A<->B same group, v4/v6 separate)
function pairGroupKey(p) {
  const ids = [p.source, p.target].sort();
  return ids[0] + '_' + ids[1] + '_' + p.type + (p.ext ? '_ext' : '');
}

// ── Concurrency-limited image loader with retry ──
const MAX_CONCURRENT = 4;
let loadQueue = [];
let activeLoads = 0;

function queueImageLoad(img, url, skelId, retries, generation) {
  loadQueue.push({ img, url, skelId, retries: retries || 0, generation });
  drainQueue();
}

function drainQueue() {
  while (activeLoads < MAX_CONCURRENT && loadQueue.length > 0) {
    const job = loadQueue.shift();
    activeLoads++;
    loadOneImage(job);
  }
}

function loadOneImage(job) {
  if (job.generation !== renderGeneration) {
    activeLoads--;
    drainQueue();
    return;
  }
  const img = job.img;
  const skel = document.getElementById(job.skelId);
  img.onload = function() {
    if (job.generation !== renderGeneration) {
      activeLoads--;
      drainQueue();
      return;
    }
    img.classList.add('ok');
    if (skel) skel.classList.add('gone');
    activeLoads--;
    updateLoadProgress();
    drainQueue();
  };
  img.onerror = function() {
    if (job.generation !== renderGeneration) {
      activeLoads--;
      drainQueue();
      return;
    }
    if (job.retries < 2) {
      setTimeout(() => {
        job.retries++;
        activeLoads--;
        loadQueue.unshift(job);
        drainQueue();
      }, 1000 * (job.retries + 1));
    } else {
      const card = img.closest('.card');
      if (card) card.classList.add('failed');
      const status = card && card.querySelector('.card-status');
      if (status) status.querySelector('span').textContent = 'Graph unavailable. Check RRD data or retry.';
      if (skel) { skel.style.animation = 'none'; skel.style.background = 'rgba(248,113,113,0.05)'; }
      activeLoads--;
      updateLoadProgress();
      drainQueue();
    }
  };
  img.src = job.url;
}

function retryImage(index) {
  const img = document.getElementById(`img${index}`);
  if (!img || !img.dataset.url) return;
  const card = img.closest('.card');
  if (card) card.classList.remove('failed');
  const skel = document.getElementById(`sk${index}`);
  if (skel) { skel.classList.remove('gone'); skel.style.animation = ''; skel.style.background = ''; }
  queueImageLoad(img, img.dataset.url, `sk${index}`, 0, renderGeneration);
}

function observeImages() {
  const images = Array.from(document.querySelectorAll('#graphGrid img[data-url]'));
  const queue = img => {
    if (img.dataset.queued) return;
    img.dataset.queued = '1';
    queueImageLoad(img, img.dataset.url, img.dataset.skel, 0, renderGeneration);
  };
  if (!('IntersectionObserver' in window)) {
    images.forEach(queue);
    return;
  }
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        queue(entry.target);
        observer.unobserve(entry.target);
      }
    });
  }, { root: document.getElementById('mainArea'), rootMargin: '500px 0px' });
  images.forEach(img => observer.observe(img));
}

let totalGraphs = 0;
let loadedGraphs = 0;

function updateLoadProgress() {
  loadedGraphs++;
  const bar = document.getElementById('loadBarInner');
  if (bar) {
    const pct = Math.min(100, Math.round(loadedGraphs / totalGraphs * 100));
    bar.style.width = pct + '%';
    if (pct >= 100) setTimeout(() => { const lb = document.getElementById('loadBar'); if(lb) lb.style.display='none'; }, 500);
  }
}

// Compute per-group Y ranges from stats
function computeGroupRanges(pairs, dur) {
  const groups = {};
  pairs.forEach(p => {
    const gk = pairGroupKey(p);
    const key = `${p.source}_${p.target}_${p.type}_${dur}`;
    const st = statsCache[key];
    if (!st) return;
    if (!groups[gk]) groups[gk] = { min: Infinity, max: -Infinity };
    if (st.min_ms < groups[gk].min) groups[gk].min = st.min_ms;
    if (st.max_ms > groups[gk].max) groups[gk].max = st.max_ms;
  });
  const result = {};
  for (const gk in groups) {
    const g = groups[gk];
    if (g.min === Infinity || g.max === -Infinity) continue;
    const pad = (g.max - g.min) * 0.1 || g.max * 0.1;
    result[gk] = { ymin: Math.max(0, g.min - pad), ymax: g.max + pad };
  }
  return result;
}

// ── Show graphs: fetch stats per pair-group, compute per-group Y range ──
async function showGraphs() {
  const sel = getSel();
  if (sel.length < 2) return toast('Select at least 2 nodes', true);
  let serverPairs;
  try {
    serverPairs = await fetchJson(requestUrl('/api/pairs', { nodes: sel.join(',') }));
    if (!Array.isArray(serverPairs)) throw new Error('invalid pair response');
  } catch (error) {
    toast('Invalid node selection', true);
    return;
  }
  currentPairs = serverPairs;
  const generation = ++renderGeneration;
  if (activeController) activeController.abort();
  activeController = new AbortController();
  const signal = activeController.signal;
  statsCache = {};
  activeFilter = 'all';
  pairGroupRanges = {};

  if (isMobile()) {
    document.getElementById('sidebar').classList.remove('mobile-open');
    document.getElementById('overlay').classList.remove('show');
  }

  const m = document.getElementById('mainArea');
  m.innerHTML = `<div class="empty"><div class="spinner"></div><div class="empty-sub">Fetching stats for Y-axis calibration\u2026</div></div>`;

  const dur = document.getElementById('durSelect').value;

  const statsPromises = currentPairs.map(p =>
    fetchJson(requestUrl('/api/stats', { source: p.source, target: p.target, type: p.type, dur }), signal)
      .catch(() => null)
  );
  const allStats = await Promise.all(statsPromises);
  if (generation !== renderGeneration) return;
  allStats.forEach((d, i) => {
    if (d && !d.error) {
      const key = `${currentPairs[i].source}_${currentPairs[i].target}_${currentPairs[i].type}_${dur}`;
      statsCache[key] = d;
    }
  });

  pairGroupRanges = computeGroupRanges(currentPairs, dur);
  renderMain();
}

function setFilter(f) {
  activeFilter = f;
  document.querySelectorAll('.pill').forEach(p => p.classList.toggle('on', p.dataset.f === f));
  renderGrid();
}

function renderMain() {
  const m = document.getElementById('mainArea');
  m.innerHTML = `
    <div class="toolbar">
      <div class="toolbar-left">
        <span class="toolbar-title">Latency Graphs</span>
        <span class="count-badge" id="gCnt">${currentPairs.length}</span>
      </div>
      <div class="pills">
        <button class="pill on" data-f="all" onclick="setFilter('all')">All</button>
        <button class="pill" data-f="v4" onclick="setFilter('v4')">IPv4</button>
        <button class="pill" data-f="v6" onclick="setFilter('v6')">IPv6</button>
        <button class="pill" data-f="ext" onclick="setFilter('ext')">Ext</button>
      </div>
    </div>
    <div class="load-bar" id="loadBar"><div class="load-bar-inner" id="loadBarInner"></div></div>
    <div class="grid" id="graphGrid"></div>`;
  renderGrid();
}

function renderGrid() {
  renderGeneration++;
  const dur = document.getElementById('durSelect').value;
  let list = currentPairs;
  if (activeFilter === 'v4')  list = currentPairs.filter(p => !p.ext && p.type === 'v4');
  if (activeFilter === 'v6')  list = currentPairs.filter(p => p.type === 'v6');
  if (activeFilter === 'ext') list = currentPairs.filter(p => p.ext);

  document.getElementById('gCnt').textContent = list.length;
  const grid = document.getElementById('graphGrid');
  if (!list.length) {
    grid.innerHTML = '<div class="empty" style="grid-column:1/-1"><div class="empty-title">No matches</div></div>';
    return;
  }

  loadQueue = [];
  activeLoads = 0;
  totalGraphs = list.length;
  loadedGraphs = 0;
  const bar = document.getElementById('loadBarInner');
  if (bar) bar.style.width = '0%';
  const lb = document.getElementById('loadBar');
  if (lb) lb.style.display = '';

  let h = '';
  list.forEach((p, i) => {
    const gk = pairGroupKey(p);
    const range = pairGroupRanges[gk];
    const query = { source: p.source, target: p.target, type: p.type, dur, theme: 'dark' };
    if (range) {
      query.ymin = range.ymin.toFixed(4);
      query.ymax = range.ymax.toFixed(4);
    }
    const url = requestUrl('/api/graph', query);
    const bc = p.ext ? 'badge-ext' : p.type === 'v6' ? 'badge-v6' : 'badge-v4';
    const bl = p.ext ? 'Ext' : p.type === 'v6' ? 'v6' : 'v4';
    const sid = `st_${i}`;
    h += `<div class="card">
      <div class="card-head">
        <div class="route">
          <span>${p.srcLabel}</span>
          <span class="route-arrow">\u2192</span>
          <span>${p.tgtLabel}</span>
        </div>
        <div class="card-right">
          <span class="badge ${bc}">${bl}</span>
          <div class="stats" id="${sid}"></div>
        </div>
       </div>
       <div class="card-img">
         <div class="skel" id="sk${i}"></div>
         <img id="img${i}" data-url="${url.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" data-skel="sk${i}" alt="${p.srcLabel} \u2192 ${p.tgtLabel}">
         <div class="card-status"><strong>Unable to load graph</strong><span>Loading will start when visible.</span><button class="retry-btn" onclick="retryImage(${i})">Retry</button></div>
       </div>
    </div>`;
  });
  grid.innerHTML = h;

  list.forEach((p, i) => {
    const gk = pairGroupKey(p);
    const range = pairGroupRanges[gk];
    const query = { source: p.source, target: p.target, type: p.type, dur, theme: 'dark' };
    if (range) {
      query.ymin = range.ymin.toFixed(4);
      query.ymax = range.ymax.toFixed(4);
    }
    const url = requestUrl('/api/graph', query);
     const key = `${p.source}_${p.target}_${p.type}_${dur}`;
    const sid = `st_${i}`;
    if (statsCache[key]) {
      showStat(sid, statsCache[key]);
    } else {
      setTimeout(() => fetchStat(p, sid, dur, renderGeneration), i * 30 + 100);
    }
   });
   observeImages();
}

function fetchStat(pair, id, dur, generation) {
  const key = `${pair.source}_${pair.target}_${pair.type}_${dur}`;
  if (statsCache[key]) { showStat(id, statsCache[key]); return; }
  fetchJson(requestUrl('/api/stats', { source: pair.source, target: pair.target, type: pair.type, dur }))
    .then(d => {
      if (generation !== renderGeneration) return;
      if (d.error) return;
      statsCache[key] = d;
      showStat(id, d);
    }).catch(() => {
      if (generation === renderGeneration) showStatError(id);
    });
}

function showStatError(id) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = '<span class="loss-bad"><span class="v">N/A</span> stats</span>';
}

function showStat(id, d) {
  const el = document.getElementById(id);
  if (!el) return;
  const lc = d.loss_pct > 5 ? 'loss-bad' : d.loss_pct > 0 ? 'loss-warn' : '';
  const useUs = d.avg_ms < 1;
  const fmt = v => useUs ? (v * 1000).toFixed(0) + ' \u03bcs' : v.toFixed(1) + ' ms';
  el.innerHTML = `<span><span class="v">${fmt(d.avg_ms)}</span> avg</span>`
    + `<span><span class="v">${fmt(d.min_ms)}</span> min</span>`
    + `<span><span class="v">${fmt(d.max_ms)}</span> max</span>`
    + `<span class="${lc}"><span class="v">${d.loss_pct.toFixed(1)}%</span> loss</span>`;
}

document.getElementById('durSelect').addEventListener('change', async () => {
  if (currentPairs.length > 0) {
    statsCache = {};
    pairGroupRanges = {};
    const dur = document.getElementById('durSelect').value;
    const m = document.getElementById('mainArea');
    m.innerHTML = `<div class="empty"><div class="spinner"></div><div class="empty-sub">Recalculating\u2026</div></div>`;

    const generation = ++renderGeneration;
    if (activeController) activeController.abort();
    activeController = new AbortController();
    const signal = activeController.signal;
    const statsPromises = currentPairs.map(p =>
      fetchJson(requestUrl('/api/stats', { source: p.source, target: p.target, type: p.type, dur }), signal)
        .catch(() => null)
    );
    const allStats = await Promise.all(statsPromises);
    if (generation !== renderGeneration) return;
    allStats.forEach((d, i) => {
      if (d && !d.error) {
        const key = `${currentPairs[i].source}_${currentPairs[i].target}_${currentPairs[i].type}_${dur}`;
        statsCache[key] = d;
      }
    });
    pairGroupRanges = computeGroupRanges(currentPairs, dur);
    renderMain();
  }
});
</script>
</body>
</html>"""

if __name__ == "__main__":
    srv = ThreadingHTTPServer((HOST, PORT), Handler)
    LOG.info("ipPping server running on http://%s:%s", HOST, PORT)
    srv.serve_forever()
