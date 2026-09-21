#!/usr/bin/env python3
"""Install tested API files from a staging directory, with service rollback."""
import datetime
from pathlib import Path
import shutil
import subprocess
import sys
import time
import urllib.request

source = Path(sys.argv[1]).resolve()
target = Path('/opt/ipppping')
files = ['config.py', 'server.py', 'runtime.py', 'web/app.js']
stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
backup = Path('/root/ipppping-backup-' + stamp)
backup.mkdir(mode=0o700)
existed = set()
for name in files:
    if not (source / name).is_file():
        raise SystemExit('missing staged file: ' + name)
    if (target / name).exists():
        existed.add(name)
        (backup / name).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(target / name, backup / name)
try:
    for name in files:
        staged = (target / name).with_suffix('.installing')
        shutil.copyfile(source / name, staged)
        staged.chmod(0o644)
        staged.replace(target / name)
    subprocess.run(['systemctl', 'restart', 'ipppping'], check=True)
    for attempt in range(20):
        try:
            with urllib.request.urlopen('http://127.0.0.1:8082/api/nodes', timeout=3) as response:
                assert response.status == 200
            break
        except (OSError, AssertionError):
            if attempt == 19:
                raise
            time.sleep(0.5)
except BaseException:
    for name in existed:
        shutil.copy2(backup / name, target / name)
    # New runtime.py is harmless and deliberately retained on rollback.
    subprocess.run(['systemctl', 'restart', 'ipppping'], check=True)
    raise
print('API/frontend installed and healthy. Backup:', backup)
