#!/usr/bin/env python3
"""Keep the existing private TLS/vhost config; restrict only the 8080 upstream."""
from pathlib import Path
import shutil
import subprocess
import sys
import time

path = Path(sys.argv[1])
original = path.read_text()
old = '    reverse_proxy 127.0.0.1:8080'
new = '''    @slave_upload {
        method POST
        path /smokeping/ /smokeping/smokeping.cgi
    }
    handle @slave_upload {
        reverse_proxy 127.0.0.1:8080
    }
    handle {
        respond "Not Found" 404
    }'''
if original.count(old) != 1:
    raise SystemExit('Expected exactly one legacy upstream; inspect manually')
candidate = path.with_name(path.name + '.candidate')
candidate.write_text(original.replace(old, new))
subprocess.run(['caddy', 'validate', '--config', str(candidate), '--adapter', 'caddyfile'], check=True)
backup = path.with_name(path.name + '.before-upload-only-' + str(int(time.time())))
shutil.copy2(path, backup)
shutil.copy2(candidate, path)
try:
    subprocess.run(['caddy', 'reload', '--config', str(path), '--adapter', 'caddyfile'], check=True)
except BaseException:
    shutil.copy2(backup, path)
    subprocess.run(['caddy', 'reload', '--config', str(path), '--adapter', 'caddyfile'], check=True)
    raise
print('Legacy pages disabled; slave POST retained. Backup:', backup)
