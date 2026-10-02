#!/usr/bin/env python3
"""Real rrdtool restore smoke test in a private temp dir, no live data or API."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile

spec = importlib.util.spec_from_file_location('restore_rrds', Path(__file__).resolve().parents[1] / 'deploy/recovery/restore_rrds.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
with tempfile.TemporaryDirectory(prefix='ipppping-restore-lab-') as temp:
    root = Path(temp)
    original = root / 'original.rrd'
    subprocess.run(['rrdtool', 'create', str(original), '--start', '1600000020', '--step', '60',
                    'DS:median:GAUGE:120:0:U', 'DS:loss:GAUGE:120:0:20', 'RRA:AVERAGE:0.5:1:20'], check=True)
    subprocess.run(['rrdtool', 'update', str(original), '1600000080:0.02:0',
                    '1600000140:0.03:1', '1600000200:U:20'], check=True)
    xml = subprocess.check_output(['rrdtool', 'dump', str(original), '--no-header'])
    stage = root / 'stage'
    name = 'rrd/ICMPv4/example.rrd.xml'
    source = stage / name
    source.parent.mkdir(parents=True)
    source.write_bytes(xml)
    (stage / 'metadata.json').write_text(json.dumps({'role': 'master', 'rrds': [{'name': name, 'lastUpdate': 1600000200}]}))
    (stage / 'manifest.json').write_text(json.dumps({'schema': 1, 'entries': {
        name: {'size': len(xml), 'sha256': hashlib.sha256(xml).hexdigest()}}}))
    output = root / 'restored'
    module.restore(stage, output)
    assert not (output / '.restore-incomplete').exists()
    try:
        module.restore(stage, output)
        raise AssertionError('existing destination must be refused')
    except ValueError:
        pass
    source.write_bytes(xml + b'corruption')
    try:
        module.restore(stage, root / 'corrupt-output')
        raise AssertionError('corrupt input must be refused')
    except ValueError:
        assert not (root / 'corrupt-output').exists()
print('RRD restore lab passed: real data round-trip, overwrite and corruption guards.')
