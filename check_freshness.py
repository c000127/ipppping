#!/usr/bin/env python3
"""Read-only, end-to-end per-probe RRD freshness (loss is still valid data)."""
import argparse
import csv
import json
import os
from pathlib import Path
import subprocess
import time

from nodes import load_nodes


def check(data_dir, inventory, max_age, active_slaves=None):
    now = int(time.time())
    inventory = list(inventory)
    records = []
    if active_slaves is not None:
        active_slaves = set(active_slaves)
        aliases = {node['alias'] for node in inventory}
        for alias in sorted(active_slaves - aliases):
            records.append({'node': alias, 'probe': 'inventory', 'age_seconds': None, 'ok': False})
        inventory = [node for node in inventory if node['alias'] in active_slaves]
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
    parser.add_argument('--nodes-config', type=Path, default=Path(os.environ.get(
        'IPPPING_NODES_CONFIG', Path(__file__).resolve().parent / 'config' / 'nodes.json')))
    parser.add_argument('--max-age', type=int, default=600)
    args = parser.parse_args()
    active_slaves = {node['id'] for node in load_nodes(args.nodes_config)
                     if node['group'] == 'vps' and node['id'] != 'vps_town_a1'}
    with args.inventory.open() as stream:
        inventory = list(csv.DictReader(stream))
    records = check(args.data_dir, inventory, args.max_age, active_slaves)
    print(json.dumps({'ok': all(row['ok'] for row in records) and bool(records), 'results': records}, indent=2))
    raise SystemExit(0 if records and all(row['ok'] for row in records) else 1)
