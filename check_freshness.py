#!/usr/bin/env python3
"""Read-only, end-to-end per-probe RRD freshness (loss is still valid data)."""
import argparse
import csv
import json
from pathlib import Path
import subprocess
import time


def check(data_dir, inventory, max_age):
    now = int(time.time())
    records = []
    for node in inventory:
        alias = node['alias']
        probes = [('FPing', 'ICMPv4/vps_town_a1')]
        probes.append(('TCPPing', 'External/gd_telecom_tcp80'))
        if node.get('monitor_ipv6'):
            probes.append(('FPing6', 'ICMPv6/vps_town_a1_v6'))
        for probe, target in probes:
            path = data_dir / (target + '~' + alias + '.rrd')
            try:
                result = subprocess.run(['rrdtool', 'last', str(path)], capture_output=True, text=True, timeout=5, check=True)
                age = now - int(result.stdout.strip())
                records.append({'node': alias, 'probe': probe, 'age_seconds': age, 'ok': 0 <= age <= max_age})
            except (OSError, ValueError, subprocess.SubprocessError):
                records.append({'node': alias, 'probe': probe, 'age_seconds': None, 'ok': False})
    return records


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-dir', type=Path, default=Path('/home/smokeping/data'))
    parser.add_argument('--inventory', type=Path, default=Path('/root/smokeping/slave-inventory.csv'))
    parser.add_argument('--max-age', type=int, default=600)
    args = parser.parse_args()
    with args.inventory.open() as stream:
        records = check(args.data_dir, list(csv.DictReader(stream)), args.max_age)
    print(json.dumps({'ok': all(row['ok'] for row in records) and bool(records), 'results': records}, indent=2))
    raise SystemExit(0 if records and all(row['ok'] for row in records) else 1)
