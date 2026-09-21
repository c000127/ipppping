#!/usr/bin/env python3
"""Run as root beside these templates. Preserve private base Compose settings."""
import argparse
import datetime
import json
from pathlib import Path
import shutil
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--probes', required=True, choices=['FPing,TCPPing', 'FPing,FPing6,TCPPing'])
parser.add_argument('--upload-family', choices=['auto', 'ipv4'], default=None)
args = parser.parse_args()
base = Path('/root/smokeping-slave')
source = Path(__file__).resolve().parent
compose = base / 'docker-compose.yml'
if not compose.is_file():
    raise SystemExit('expected base Compose file missing; no changes applied')
inspect = json.loads(subprocess.check_output(['docker', 'inspect', 'smokeping-slave']))[0]
existing_env = dict(item.split('=', 1) for item in inspect['Config'].get('Env', []) if '=' in item)
upload_family = args.upload_family or existing_env.get('IPPPING_UPLOAD_FAMILY', 'auto')
image = inspect['Image']
digests = json.loads(subprocess.check_output(['docker', 'image', 'inspect', image]))[0].get('RepoDigests')
image = digests[0] if digests else image
stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
backup = base / ('backup-runtime-' + stamp)
backup.mkdir(mode=0o700)
override = base / 'ipppping.override.yml'
if override.exists():
    shutil.copy2(override, backup / override.name)
config = base / 'config'
for name in ['svc-smokeping-slave.run', 'slave-healthcheck.pl', 'svc-apache-disabled.run']:
    target = config / name
    if target.exists():
        shutil.copy2(target, backup / name)
    target.write_text((source / name).read_text())
    target.chmod(0o755)
spec = {'services': {'smokeping-slave': {
    'image': image,
    'environment': {'IPPPING_REQUIRED_PROBES': args.probes},
    'volumes': [
        './config/svc-apache-disabled.run:/etc/s6-overlay/s6-rc.d/svc-apache/run:ro',
        './config/svc-smokeping-slave.run:/etc/s6-overlay/s6-rc.d/svc-smokeping/run:ro',
        './config/slave-healthcheck.pl:/usr/local/bin/slave-healthcheck:ro',
    ],
    'healthcheck': {'test': ['CMD', '/usr/local/bin/slave-healthcheck'],
                    'interval': '60s', 'timeout': '10s', 'retries': 5, 'start_period': '300s'},
    'logging': {'driver': 'json-file', 'options': {'max-size': '5m', 'max-file': '2'}},
}}}
environment = spec['services']['smokeping-slave']['environment']
environment['IPPPING_UPLOAD_FAMILY'] = upload_family
if upload_family == 'ipv4':
    # Supported IO::Socket::SSL import option, scoped to this collector process.
    # Keep HTTPS DNS/SNI, certificate validation and HMAC; no fixed CDN IP.
    options = existing_env.get('PERL5OPT', '').split()
    if '-MIO::Socket::SSL=inet4' not in options:
        options.append('-MIO::Socket::SSL=inet4')
    environment['PERL5OPT'] = ' '.join(options)
elif args.upload_family == 'auto':
    environment['PERL5OPT'] = ' '.join(option for option in existing_env.get('PERL5OPT', '').split()
                                      if option != '-MIO::Socket::SSL=inet4')
override.write_text(json.dumps(spec, indent=2) + '\n')
command = ['docker', 'compose', '-f', str(compose), '-f', str(override)]
# Quiet validation must not print merged environment / shared secret.
subprocess.run(command + ['config', '--quiet'], check=True)
subprocess.run(command + ['up', '-d', '--pull', 'never', 'smokeping-slave'], check=True)
shutil.copy2(source / 'slave-recover.sh', '/usr/local/sbin/ipppping-slave-recover')
Path('/usr/local/sbin/ipppping-slave-recover').chmod(0o755)
for name in ['ipppping-slave-recover.service', 'ipppping-slave-recover.timer']:
    shutil.copy2(source / name, Path('/etc/systemd/system') / name)
subprocess.run(['systemctl', 'daemon-reload'], check=True)
subprocess.run(['systemctl', 'enable', '--now', 'ipppping-slave-recover.timer'], check=True)
print('Runtime installed; image pinned; base credentials unchanged. Backup:', backup)
