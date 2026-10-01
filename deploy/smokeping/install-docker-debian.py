#!/usr/bin/env python3
"""New Debian host only: Docker's official apt repository; no distro-wide upgrade.

Canonical procedure: https://docs.docker.com/engine/install/debian/
Never removes conflicting packages or overwrites an existing Docker repository.
"""
import os
from pathlib import Path
import subprocess


def run(*args):
    subprocess.run(args, check=True, env={**os.environ, 'DEBIAN_FRONTEND': 'noninteractive'})


def main():
    if os.geteuid() != 0:
        raise SystemExit('root required')
    release = dict(line.split('=', 1) for line in Path('/etc/os-release').read_text().splitlines() if '=' in line)
    codename = release.get('VERSION_CODENAME', '').strip('"')
    if release.get('ID', '').strip('"') != 'debian' or codename not in ('bookworm', 'trixie'):
        raise SystemExit('review the current official supported Debian releases first')
    arch = subprocess.check_output(['dpkg', '--print-architecture'], text=True).strip()
    if arch not in ('amd64', 'arm64', 'armhf', 'ppc64el'):
        raise SystemExit('unsupported architecture')
    for package in ('docker.io', 'docker-compose', 'docker-doc', 'docker-buildx',
                    'podman-docker', 'containerd', 'runc', 'docker-ce',
                    'docker-ce-cli', 'containerd.io', 'docker-buildx-plugin', 'docker-compose-plugin'):
        result = subprocess.run(['dpkg-query', '-W', '-f=${Status}', package], capture_output=True, text=True)
        if result.returncode == 0 and result.stdout.strip() == 'install ok installed':
            raise SystemExit('existing/conflicting package requires explicit review: ' + package)
    sources = Path('/etc/apt/sources.list.d/docker.sources')
    key = Path('/etc/apt/keyrings/docker.asc')
    if sources.exists() or key.exists():
        raise SystemExit('existing Docker repository/key: inspect before retrying')
    apt_sources = [Path('/etc/apt/sources.list')]
    apt_sources += list(Path('/etc/apt/sources.list.d').glob('*.list'))
    apt_sources += list(Path('/etc/apt/sources.list.d').glob('*.sources'))
    if any(path.is_file() and 'download.docker.com' in path.read_text() for path in apt_sources):
        raise SystemExit('existing Docker repository in alternate apt source: inspect before retrying')
    run('apt-get', 'update')
    run('apt-get', 'install', '-y', '--no-install-recommends', 'ca-certificates', 'curl')
    run('install', '-m', '0755', '-d', '/etc/apt/keyrings')
    run('curl', '-fsSL', 'https://download.docker.com/linux/debian/gpg', '-o', str(key))
    key.chmod(0o644)
    sources.write_text('Types: deb\nURIs: https://download.docker.com/linux/debian\n'
                       f'Suites: {codename}\nComponents: stable\nArchitectures: {arch}\n'
                       'Signed-By: /etc/apt/keyrings/docker.asc\n')
    sources.chmod(0o644)
    run('apt-get', 'update')
    run('apt-get', 'install', '-y', '--no-install-recommends', 'docker-ce', 'docker-ce-cli',
        'containerd.io', 'docker-buildx-plugin', 'docker-compose-plugin')
    run('systemctl', 'enable', '--now', 'docker')
    run('docker', 'version')
    run('docker', 'compose', 'version')
    run('docker', 'run', '--rm', 'hello-world')


if __name__ == '__main__':
    main()
