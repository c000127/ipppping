#!/usr/bin/env python3
"""Install a validated fingerprinted release; retain all legacy client assets."""
import datetime
from pathlib import Path
import shutil
import subprocess
import sys
import time
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from build_web import validate

RUNTIME = ('config.py', 'server.py', 'runtime.py', 'series_contract.py', 'series_v2.py')


def replace(source, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    staged = destination.with_name(destination.name + '.installing')
    shutil.copyfile(source, staged)
    staged.chmod(0o644)
    staged.replace(destination)


def install(source, target, backup, restart, probe):
    source, target, backup = map(Path, (source, target, backup))
    release = source / 'build/web-release'
    manifest = validate(release)
    for name in RUNTIME:
        if not (source / name).is_file():
            raise ValueError('missing staged file: ' + name)
    for name in manifest['assets']:
        dest = target / 'web/assets' / name
        if dest.exists() and dest.read_bytes() != (release / 'assets' / name).read_bytes():
            raise ValueError('immutable asset collision: ' + name)
    # Fonts keep their existing stable URLs. This is an upgrade, not bootstrap.
    for name in ('JetBrainsMono-Regular.woff2', 'JetBrainsMono-Bold.woff2'):
        if not (target / 'web/fonts' / name).is_file():
            raise ValueError('missing installed font: ' + name)
    files = (*RUNTIME, *(f'web/{page}' for page in manifest['pages']), 'web/vendor/UPLOT-LICENSE')
    backup.mkdir(mode=0o700, parents=True, exist_ok=False)
    existed = set()
    for name in files:
        if (target / name).is_file():
            existed.add(name)
            (backup / name).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(target / name, backup / name)
    try:
        replace(release / 'UPLOT-LICENSE', target / 'web/vendor/UPLOT-LICENSE')
        for name in manifest['assets']:
            replace(release / 'assets' / name, target / 'web/assets' / name)
        for name in RUNTIME:
            replace(source / name, target / name)
        restart()
        probe('/api/nodes', None)
        for name in manifest['assets']:
            probe('/static/assets/' + name, (release / 'assets' / name).read_bytes())
        # Switch HTML only after the new server can serve every dependency.
        replace(release / 'chart-trial.html', target / 'web/chart-trial.html')
        probe('/chart-trial', (release / 'chart-trial.html').read_bytes())
        replace(release / 'index.html', target / 'web/index.html')
        probe('/', (release / 'index.html').read_bytes())
    except BaseException:
        for name in files:
            if name in existed:
                replace(backup / name, target / name)
            elif (target / name).exists():
                (target / name).unlink()
        restart()
        raise
    # Legacy unhashed files and earlier fingerprinted releases are not removed.
    return backup


def restart_service():
    subprocess.run(['systemctl', 'restart', 'ipppping'], check=True)


def probe_http(path, expected):
    for attempt in range(20):
        try:
            with urllib.request.urlopen('http://127.0.0.1:8082' + path, timeout=3) as response:
                body = response.read()
                if response.status != 200 or (expected is not None and body != expected):
                    raise ValueError('release health check failed: ' + path)
            return
        except (OSError, ValueError):
            if attempt == 19:
                raise
            time.sleep(0.5)


if __name__ == '__main__':
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup = install(Path(sys.argv[1]).resolve(), Path('/opt/ipppping'),
                     Path('/root/ipppping-backup-' + stamp), restart_service, probe_http)
    print('API/frontend installed and healthy. Backup:', backup)
