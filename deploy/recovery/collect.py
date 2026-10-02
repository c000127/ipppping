#!/usr/bin/env python3
"""Read-only Linux collector. PRIVATE gzip tar on stdout; use capture.py over SSH.

No login keys, old generation scripts, logs or cache are collected. Online RRD
exports are validated individually, not a globally atomic matrix snapshot.
"""
import argparse
import datetime
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import tarfile
import tempfile


def run(*args):
    return subprocess.check_output(args, stderr=subprocess.PIPE, timeout=120)


def stamp():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def stable_bytes(path):
    for _ in range(3):
        before = path.stat()
        data = path.read_bytes()
        after = path.stat()
        if (before.st_mtime_ns, before.st_size, before.st_ino) == (
                after.st_mtime_ns, after.st_size, after.st_ino):
            return data, after
    raise RuntimeError('file changed during collection: ' + str(path))


def identity(container):
    result = json.loads(run('docker', 'inspect', container))[0]
    return {'containerId': result['Id'], 'startedAt': result['State']['StartedAt'],
            'restarts': result['RestartCount'],
            'api': run('systemctl', 'show', 'ipppping.service',
                       '-p', 'MainPID', '-p', 'NRestarts').decode().strip()
                   if container == 'smokeping' else None}


def collect(role, data_dir):
    os.umask(0o077)
    os.nice(19)
    started = stamp()
    container = 'smokeping' if role == 'master' else 'smokeping-slave'
    before = identity(container)
    root = Path('/root/smokeping' if role == 'master' else '/root/smokeping-slave')
    required = [root / 'docker-compose.yml']
    paths = list(required)
    if role == 'master':
        required += [root / 'config/Targets', root / 'config/Slaves',
                     root / 'config/smokeping_secrets', Path('/opt/ipppping/server.py'),
                     Path('/opt/ipppping/config/nodes.json'), Path('/etc/caddy/Caddyfile')]
        paths += [root / 'config', Path('/opt/ipppping'), Path('/etc/caddy'),
                  root / 'slave-inventory.csv', Path('/root/smokeping.csv')]
    else:
        paths += [root]
    for path in required:
        if not path.is_file():
            raise RuntimeError('required path missing: ' + str(path))
    paths += list(Path('/etc/systemd/system').glob('ipppping*'))
    paths += [Path('/etc/systemd/system/caddy.service.d'),
              Path('/etc/systemd/system/docker.service.d'), Path('/etc/docker/daemon.json'),
              Path('/usr/local/sbin/ipppping-slave-recover')]
    # Only regular deployment files. Never silently dereference secret-bearing links.
    selected = {}
    for source in paths:
        if not source.exists():
            continue
        candidates = sorted(source.rglob('*')) if source.is_dir() else [source]
        for path in candidates:
            rel = path.relative_to(source) if source.is_dir() else Path(path.name)
            if any(p in ('.git', '__pycache__', 'data', 'logs', 'cache', 'backups',
                         'test-results', 'node_modules') or p.startswith('backup-') for p in rel.parts):
                continue
            if '.bak' in path.name or path.suffix in ('.log', '.pyc', '.rrd') or path.name.endswith('.candidate'):
                continue
            if path.is_symlink():
                raise RuntimeError('review symlink before backup: ' + str(path))
            if path.is_file():
                selected[str(path)] = path
    entries = {}
    with gzip.GzipFile(fileobj=sys.stdout.buffer, mode='wb', compresslevel=1) as zipped, \
            tarfile.open(fileobj=zipped, mode='w|') as archive:
        def add(name, data, mode=0o600, uid=0, gid=0, mtime=0):
            if name in entries:
                raise ValueError('duplicate archive member')
            info = tarfile.TarInfo(name)
            info.size, info.mode, info.uid, info.gid, info.mtime = len(data), mode, uid, gid, mtime
            archive.addfile(info, io.BytesIO(data))
            entries[name] = {'sha256': hashlib.sha256(data).hexdigest(), 'size': len(data),
                             'mode': mode, 'uid': uid, 'gid': gid, 'mtime': mtime}

        for path in selected.values():
            data, stat = stable_bytes(path)
            add('files/' + str(path).lstrip('/'), data, stat.st_mode & 0o777,
                stat.st_uid, stat.st_gid, int(stat.st_mtime))
        inspection = json.loads(run('docker', 'inspect', container))[0]
        image = json.loads(run('docker', 'image', 'inspect', inspection['Image']))[0]
        metadata = {'schema': 1, 'role': role, 'startedAt': started,
                    'platform': platform.platform(), 'architecture': platform.machine(),
                    'osRelease': Path('/etc/os-release').read_text(),
                    'container': inspection, 'image': image,
                    'packages': run('dpkg-query', '-W').decode(),
                    'units': run('systemctl', 'list-unit-files', '--no-pager').decode(),
                    'serviceIdentityBefore': before, 'dataDir': str(data_dir),
                    'rrdConsistency': 'per-file stable export; not global point-in-time',
                    'excluded': ['SSH keys', 'logs/caches', 'old root generation scripts',
                                 'Docker image layers', 'DNS/provider control-plane configuration']}
        rrds = []
        if role == 'master':
            sources = sorted(data_dir.rglob('*.rrd'))
            if not sources:
                raise RuntimeError('no RRD files found')
            with tempfile.TemporaryDirectory(prefix='ipppping-rrd-verify-') as temp:
                xml, restored = Path(temp) / 'sample.xml', Path(temp) / 'sample.rrd'
                for index, source in enumerate(sources):
                    if source.is_symlink():
                        raise RuntimeError('RRD symlink needs review')
                    for attempt in range(3):
                        stat = source.stat()
                        last = run('rrdtool', 'last', str(source)).strip()
                        dumped = run('rrdtool', 'dump', str(source), '--no-header')
                        if source.stat().st_mtime_ns == stat.st_mtime_ns and run(
                                'rrdtool', 'last', str(source)).strip() == last:
                            break
                    else:
                        raise RuntimeError('RRD changed repeatedly during export')
                    xml.write_bytes(dumped)
                    if restored.exists():
                        restored.unlink()
                    run('rrdtool', 'restore', str(xml), str(restored))
                    if run('rrdtool', 'last', str(restored)).strip() != last:
                        raise RuntimeError('restored last timestamp mismatch')
                    # Compare the entire canonical XML, not merely rrdtool exit status.
                    if run('rrdtool', 'dump', str(restored), '--no-header') != dumped:
                        raise RuntimeError('RRD round-trip content mismatch')
                    name = 'rrd/' + source.relative_to(data_dir).as_posix() + '.xml'
                    add(name, dumped, stat.st_mode & 0o777, stat.st_uid, stat.st_gid, int(stat.st_mtime))
                    rrds.append({'name': name, 'lastUpdate': int(last)})
                    if (index + 1) % 100 == 0:
                        print('RRD round-trip verified:', index + 1, file=sys.stderr, flush=True)
        after = identity(container)
        if before != after:
            raise RuntimeError('service identity changed during backup')
        # Static configuration must remain unchanged for the whole capture.
        for path in selected.values():
            if hashlib.sha256(path.read_bytes()).hexdigest() != entries['files/' + str(path).lstrip('/')]['sha256']:
                raise RuntimeError('deployment changed during backup')
        metadata.update(completedAt=stamp(), serviceIdentityAfter=after, rrds=rrds)
        add('metadata.json', json.dumps(metadata, indent=2).encode())
        manifest = json.dumps({'schema': 1, 'role': role, 'entries': entries}, indent=2).encode()
        info = tarfile.TarInfo('manifest.json')
        info.size, info.mode = len(manifest), 0o600
        archive.addfile(info, io.BytesIO(manifest))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--role', choices=('master', 'slave'), required=True)
    parser.add_argument('--data-dir', type=Path, default=Path('/home/smokeping/data'))
    args = parser.parse_args()
    try:
        collect(args.role, args.data_dir)
    except subprocess.CalledProcessError:
        # Never expose command output: docker/compose/environment can contain secrets.
        print('Backup failed: required command failed; no complete backup produced.', file=sys.stderr)
        sys.exit(1)
