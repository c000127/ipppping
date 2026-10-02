#!/usr/bin/env python3
"""Capture private deployment state over SSH into authenticated CMS encryption.

Requires OpenSSL 3 with CMS AES-GCM, SSH, and Python 3. Remote master needs
rrdtool. No server encryption key or additional installed daemon is needed.
"""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import tarfile
import tempfile


def members(archive):
    seen = set()
    folded = set()
    total = 0
    for member in archive.getmembers():
        path = PurePosixPath(member.name)
        if (not member.isfile() or member.name in seen or path.is_absolute()
                or '..' in path.parts or '\\' in member.name or ':' in member.name
                or str(path) != member.name or member.name.startswith('./')):
            raise ValueError('unsafe or duplicate archive entry')
        if (member.name.casefold() in folded or any(p.endswith((' ', '.')) or
                p.split('.')[0].upper() in {'CON', 'PRN', 'AUX', 'NUL',
                    *(f'COM{i}' for i in range(1, 10)), *(f'LPT{i}' for i in range(1, 10))}
                for p in path.parts)):
            raise ValueError('nonportable archive entry')
        total += member.size
        if member.size > 128 * 1024 * 1024 or total > 16 * 1024**3 or len(seen) >= 100000:
            raise ValueError('archive exceeds reviewed recovery limits')
        if member.name not in ('manifest.json', 'metadata.json') and not member.name.startswith(('files/', 'rrd/')):
            raise ValueError('unexpected archive namespace')
        seen.add(member.name)
        folded.add(member.name.casefold())
    return seen


def validate_archive(path):
    with tarfile.open(path, 'r:gz') as archive:
        names = members(archive)
        manifest = json.load(archive.extractfile('manifest.json'))
        if manifest['schema'] != 1 or names - {'manifest.json'} != set(manifest['entries']):
            raise ValueError('manifest member set mismatch')
        for name, record in manifest['entries'].items():
            info = archive.getmember(name)
            digest = hashlib.sha256()
            with archive.extractfile(info) as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                    digest.update(chunk)
            if info.size != record['size'] or digest.hexdigest() != record['sha256']:
                raise ValueError('archive integrity mismatch')
            if any(getattr(info, field) != record[field] for field in ('mode', 'uid', 'gid', 'mtime')):
                raise ValueError('file metadata mismatch')
        metadata = json.load(archive.extractfile('metadata.json'))
        if metadata['serviceIdentityBefore'] != metadata['serviceIdentityAfter']:
            raise ValueError('service identity changed')
        return {'role': manifest['role'], 'files': len(names),
                'rrds': len(metadata['rrds']), 'completedAt': metadata['completedAt']}


def capture(args):
    target = Path(args.output).resolve()
    partial = target.with_suffix(target.suffix + '.partial')
    if target.exists() or partial.exists():
        raise ValueError('refusing to overwrite existing backup or partial')
    remote = ['ssh', '-p', str(args.port), '-o', 'BatchMode=yes', '-o',
              'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=15', '-o',
              'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', args.host,
              ('sudo -n ' if args.sudo else '') + 'python3 - --role ' + args.role]
    # Exclusive creation; failures leave only an explicitly incomplete encrypted file.
    with partial.open('xb') as output, tempfile.TemporaryFile() as errors:
        source = subprocess.Popen(remote, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=errors)
        cipher = subprocess.Popen([args.openssl, 'cms', '-encrypt', '-binary', '-aes-256-gcm',
                                   '-stream', '-outform', 'DER', args.certificate],
                                  stdin=source.stdout, stdout=output, stderr=errors)
        source.stdout.close()
        try:
            try:
                source.stdin.write(Path(__file__).with_name('collect.py').read_bytes())
                source.stdin.close()
            except BrokenPipeError:
                source.wait(timeout=30)
                errors.seek(0)
                raise RuntimeError('SSH collector terminated before startup: ' +
                                   errors.read().decode(errors='replace')[-2000:]) from None
            remote_code = source.wait(timeout=3600)
            cipher_code = cipher.wait(timeout=60)
            if remote_code or cipher_code:
                # Collector emits only sanitized diagnostics, never container environments.
                errors.seek(0)
                raise RuntimeError('capture failed: ' + errors.read().decode(errors='replace')[-2000:])
        finally:
            for process in (source, cipher):
                if process.poll() is None:
                    process.kill()
                    process.wait()
    partial.rename(target)
    with target.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    print(json.dumps({'archive': str(target), 'bytes': target.stat().st_size, 'sha256': digest,
                      'receivedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()}))


def verify(args):
    archive = Path(args.archive).resolve()
    stage = Path(args.stage).resolve() if args.stage else None
    if stage and stage.exists():
        raise ValueError('restore stage must not exist')
    # The containing directory must be private on Windows (see runbook ACL setup).
    with tempfile.TemporaryDirectory(prefix='verify-', dir=archive.parent) as temp:
        plain = Path(temp) / 'archive.tar.gz'
        result = subprocess.run([args.openssl, 'cms', '-decrypt', '-binary', '-inform', 'DER',
                                 '-in', str(archive), '-recip', args.certificate,
                                 '-inkey', args.key, '-out', str(plain)], capture_output=True)
        if result.returncode:
            raise ValueError('decryption/authentication failed; nothing extracted')
        summary = validate_archive(plain)
        if stage:
            stage.mkdir(mode=0o700)
            with tarfile.open(plain, 'r:gz') as tar:
                for info in tar.getmembers():
                    dest = stage / info.name
                    dest.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                    with dest.open('xb') as output, tar.extractfile(info) as source:
                        shutil.copyfileobj(source, output)
                    # Keep staging private. Original ownership/modes are in manifest;
                    # no live paths or ownership changes are applied automatically.
                    dest.chmod(0o600)
        print(json.dumps({'verified': True, **summary, 'stage': str(stage) if stage else None,
                          'verifiedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()}))


if __name__ == '__main__':
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--openssl', default='openssl')
    sub = parser.add_subparsers(dest='command', required=True)
    cap = sub.add_parser('capture')
    cap.add_argument('--host', required=True)
    cap.add_argument('--port', type=int, default=22)
    cap.add_argument('--sudo', action='store_true')
    cap.add_argument('--role', choices=('master', 'slave'), required=True)
    cap.add_argument('--output', required=True)
    cap.add_argument('--certificate', required=True)
    check = sub.add_parser('verify')
    check.add_argument('--archive', required=True)
    check.add_argument('--key', required=True)
    check.add_argument('--certificate', required=True)
    check.add_argument('--stage')
    args = parser.parse_args()
    capture(args) if args.command == 'capture' else verify(args)
