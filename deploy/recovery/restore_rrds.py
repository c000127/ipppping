#!/usr/bin/env python3
"""Restore verified XML into a NEW directory; never activate or overwrite live data."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import subprocess


def restore(stage, output):
    stage, output = Path(stage).resolve(), Path(output).resolve()
    if output.exists():
        raise ValueError('output must be a new directory, never the production data tree')
    metadata = json.loads((stage / 'metadata.json').read_text(encoding='utf-8'))
    manifest = json.loads((stage / 'manifest.json').read_text(encoding='utf-8'))
    if metadata['role'] != 'master' or manifest['schema'] != 1 or not metadata['rrds']:
        raise ValueError('expected verified master stage with RRD exports')
    plans, seen = [], set()
    for item in metadata['rrds']:
        name = item['name']
        rel = PurePosixPath(name)
        if (not name.startswith('rrd/') or not name.endswith('.rrd.xml') or '..' in rel.parts
                or '\\' in name or ':' in name or str(rel) != name or name in seen):
            raise ValueError('unsafe or duplicate RRD member')
        seen.add(name)
        source = stage / name
        if source.is_symlink() or not source.resolve().is_relative_to(stage):
            raise ValueError('linked RRD export is not allowed')
        record = manifest['entries'][name]
        with source.open('rb') as stream:
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        if source.stat().st_size != record['size'] or digest != record['sha256']:
            raise ValueError('RRD export changed since verification')
        target = output / str(rel.relative_to('rrd'))[:-4]
        plans.append((source, target, item['lastUpdate']))
    if seen != {n for n in manifest['entries'] if n.startswith('rrd/')}:
        raise ValueError('RRD inventory mismatch')
    output.mkdir(mode=0o700, parents=False)
    marker = output / '.restore-incomplete'
    marker.write_text('Restore is not complete. Do not activate this directory.\n')
    for source, target, expected in plans:
        target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        subprocess.run(['rrdtool', 'restore', str(source), str(target)], check=True, timeout=60)
        actual = int(subprocess.check_output(['rrdtool', 'last', str(target)], timeout=30))
        dump = subprocess.check_output(['rrdtool', 'dump', str(target), '--no-header'], timeout=60)
        if actual != expected or dump != source.read_bytes():
            raise ValueError('restored RRD content differs; keep isolated and investigate')
    marker.unlink()
    print(json.dumps({'restored': len(plans), 'directory': str(output),
                      'activated': False, 'ownershipApplied': False}))


if __name__ == '__main__':
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stage', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    restore(args.stage, args.output)
