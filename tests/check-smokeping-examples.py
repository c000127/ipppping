#!/usr/bin/env python3
"""Validate sanitized config against a LOCAL pinned image, without networking.

Run on a Linux Docker test host. No pull, no daemon/service changes, no live
configuration mounts. Temporary files and the one-off container are removed.
"""
import argparse
from pathlib import Path
import subprocess
import tempfile
import uuid


def check(image, source):
    if '@sha256:' not in image:
        raise ValueError('supply an explicit locally available image digest')
    with tempfile.TemporaryDirectory(prefix='ipppping-example-check-') as temp:
        directory = Path(temp)
        sections = ('General', 'Alerts', 'Database', 'Presentation', 'Probes', 'Slaves', 'Targets')
        for section in (*sections, 'pathnames'):
            (directory / section).write_bytes((source / (section + '.example')).read_bytes())
        (directory / 'smokeping_secrets').write_text('probe_sg:example-test-only\nprobe_jp:example-test-only\n')
        (directory / 'smokeping_secrets').chmod(0o600)
        (directory / 'master.conf').write_text(''.join('@include /config/' + s + '\n' for s in sections))
        name = 'ipppping-example-check-' + uuid.uuid4().hex
        try:
            # Normal LinuxServer init installs this image-provided probe. Avoid
            # starting s6/Apache/collectors just to reproduce that prerequisite.
            subprocess.run(['docker', 'run', '--name', name, '--rm', '--pull=never', '--network=none',
                            '--memory=128m', '--cpus=0.5', '--entrypoint=/bin/sh',
                            '-v', str(directory) + ':/config:ro', '--tmpfs', '/data',
                            '--tmpfs', '/var/cache/smokeping', '--tmpfs', '/var/run/smokeping',
                            image, '-ec', 'install -m755 /defaults/tcpping /usr/bin/tcpping; '
                            'exec /usr/sbin/smokeping --config=/config/master.conf --check'],
                           check=True, timeout=90)
        finally:
            # Only this random test container; never a production container.
            subprocess.run(['docker', 'rm', '-f', name], stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, timeout=30)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', required=True)
    parser.add_argument('--source', type=Path, default=Path(__file__).resolve().parents[1] / 'deploy/smokeping')
    args = parser.parse_args()
    check(args.image, args.source)
