"""Run a synthetic RRD experiment in an automatically removed remote temp dir.

Uses existing python3/rrdtool only. Does not import production code/config,
read production RRDs, restart services, deploy files, or use node credentials.
Usage: python tests/run-rrd-lab.py root@HOST PORT
"""
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
FILES = ["server.py", "config.py", "runtime.py", "nodes.py", "rrd.py"]
payload = {
    "baseline": {name: subprocess.check_output(["git", "show", f"0b33aa6:{name}"], cwd=ROOT).decode() for name in FILES},
    "p1": {name: (ROOT / name).read_text(encoding="utf-8") for name in FILES},
}
REMOTE = r'''
import importlib, json, pathlib, subprocess, sys, tempfile, time, platform
with tempfile.TemporaryDirectory(prefix="ipppping-p1-lab-") as temp:
    root = pathlib.Path(temp)
    end = int(time.time()) // 60 * 60 - 60
    start = end - 4 * 3600
    rrd = root / "synthetic.rrd"
    names = ["uptime", "loss", "median"] + [f"ping{i}" for i in range(1, 21)]
    subprocess.run(["rrdtool", "create", str(rrd), "--start", str(start), "--step", "60"]
        + [f"DS:{name}:GAUGE:120:0:U" for name in names]
        + ["RRA:AVERAGE:0.5:1:1440"], check=True)
    updates = []
    for i in range(1, 241):
        med = .010 if i != 100 else .250
        updates.append(f"{start+i*60}:U:0:{med}:" + ":".join([str(med)] * 20))
    subprocess.run(["rrdtool", "update", str(rrd)] + updates, check=True)
    report = {"synthetic": True, "platform": platform.platform(), "samples_per_case": 30, "versions": {}}
    for version, files in payload.items():
        folder = root / version
        folder.mkdir()
        for name, text in files.items():
            (folder / name).write_text(text)
        for name in ["server", "config", "runtime", "nodes", "rrd"]:
            sys.modules.pop(name, None)
        sys.path.insert(0, str(folder))
        module = importlib.import_module("server")
        result = {}
        for name in ["stats", "series"]:
            fn = getattr(module, "rrd_fetch_" + name)
            for cache in ["cold", "warm"]:
                fn(str(rrd), 10800)
                elapsed = []
                for _ in range(30):
                    if cache == "cold": module.STATS_CACHE.clear()
                    before = time.perf_counter()
                    value = fn(str(rrd), 10800)
                    assert value is not None
                    elapsed.append((time.perf_counter()-before)*1000)
                elapsed.sort()
                result[name + "_" + cache] = {"median_ms": elapsed[14], "p95_ms": elapsed[28], "bytes": len(json.dumps(value))}
        if version == "p1":
            assert value["summary"]["current_ms"] == 10
            subprocess.run(["rrdtool", "update", str(rrd), f"{end+60}:U:20:U:" + ":".join(["U"]*20)], check=True)
            module.STATS_CACHE.clear()
            lost = module.rrd_fetch_stats(str(rrd), 10800)
            assert lost["current_ms"] is None and lost["current_loss_pct"] == 100
            assert lost["measurement_updated_at"] == end+60
            subprocess.run(["rrdtool", "update", str(rrd), f"{end+120}:" + ":".join(["U"]*23)], check=True)
            module.STATS_CACHE.clear()
            missing = module.rrd_fetch_stats(str(rrd), 10800)
            assert missing["current_ms"] is None and missing["measurement_updated_at"] is None
            assert missing["measurement_state"] == "missing"
            result["golden_cases"] = ["normal", "spike", "100_percent_loss", "unknown_latest"]
        report["versions"][version] = result
        module.BATCH_EXECUTOR.shutdown()
        sys.path.pop(0)
    print(json.dumps(report, indent=2))
'''

if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    script = "payload = " + repr(payload) + "\n" + REMOTE
    result = subprocess.run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-p", sys.argv[2], sys.argv[1], "python3", "-"],
                            input=script.encode(), capture_output=True, timeout=120)
    if result.returncode:
        raise SystemExit(result.stderr.decode(errors="replace"))
    report = json.loads(result.stdout)
    target = ROOT / "test-results" / "rrd-lab.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
