import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location('docker_debian', Path(__file__).parent / 'deploy/smokeping/install-docker-debian.py')
INSTALL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(INSTALL)


class DockerDebianInstallTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.commands = []
        self.conflict = None
        for directory in ('etc/apt/keyrings', 'etc/apt/sources.list.d'):
            (self.root / directory).mkdir(parents=True)
        (self.root / 'etc/os-release').write_text('ID=debian\nVERSION_CODENAME=bookworm\n')
        self.paths = patch.object(INSTALL, 'Path', side_effect=lambda path: self.root / str(path).lstrip('/'))
        self.paths.start()
        self.addCleanup(self.paths.stop)

    def fake_run(self, arguments, **kwargs):
        self.commands.append(tuple(arguments))
        if arguments[0] == 'dpkg-query':
            installed = arguments[-1] == self.conflict
            return subprocess.CompletedProcess(arguments, 0 if installed else 1, 'install ok installed' if installed else '', '')
        self.assertTrue(kwargs['check'])
        self.assertEqual(kwargs['env']['DEBIAN_FRONTEND'], 'noninteractive')
        if arguments[0] == 'curl':
            Path(arguments[-1]).write_text('test-public-key')
        return subprocess.CompletedProcess(arguments, 0)

    def execute(self, uid=0, arch='amd64'):
        with patch.object(INSTALL.os, 'geteuid', return_value=uid, create=True), patch.object(INSTALL.subprocess, 'check_output', return_value=arch), patch.object(INSTALL.subprocess, 'run', side_effect=self.fake_run):
            INSTALL.main()

    def test_nonroot_is_read_only(self):
        with self.assertRaisesRegex(SystemExit, 'root required'):
            self.execute(uid=1000)
        self.assertEqual(self.commands, [])

    def test_unsupported_release_arch_are_read_only(self):
        with self.assertRaisesRegex(SystemExit, 'architecture'):
            self.execute(arch='mips')
        (self.root/'etc/os-release').write_text('ID=ubuntu\nVERSION_CODENAME=noble\n')
        with self.assertRaisesRegex(SystemExit, 'supported Debian'):
            self.execute()
        self.assertEqual(self.commands, [])

    def test_conflict_is_not_uninstalled(self):
        self.conflict = 'containerd'
        with self.assertRaisesRegex(SystemExit, 'containerd'):
            self.execute()
        self.assertTrue(all(command[0] == 'dpkg-query' for command in self.commands))

    def test_partial_vendor_install_is_not_adopted(self):
        self.conflict = 'docker-ce-cli'
        with self.assertRaisesRegex(SystemExit, 'docker-ce-cli'):
            self.execute()
        self.assertFalse(any(command[0] == 'apt-get' for command in self.commands))

    def test_existing_repo_and_key_are_preserved(self):
        for relative in ('etc/apt/keyrings/docker.asc', 'etc/apt/sources.list.d/docker.sources'):
            path = self.root/relative
            path.write_text('original')
            with self.assertRaisesRegex(SystemExit, 'existing Docker'):
                self.execute()
            self.assertEqual(path.read_text(), 'original')
            path.unlink()
        self.assertFalse(any(command[0] == 'apt-get' for command in self.commands))

    def test_official_repository_exact_packages_no_upgrade_remove(self):
        self.execute()
        source = (self.root/'etc/apt/sources.list.d/docker.sources').read_text()
        self.assertIn('URIs: https://download.docker.com/linux/debian\n', source)
        self.assertIn('Suites: bookworm\n', source)
        self.assertIn('Signed-By: /etc/apt/keyrings/docker.asc\n', source)
        self.assertIn(('apt-get','install','-y','--no-install-recommends','docker-ce','docker-ce-cli','containerd.io','docker-buildx-plugin','docker-compose-plugin'), self.commands)
        self.assertFalse(any('upgrade' in c or 'remove' in c for c in self.commands))
        self.assertEqual(self.commands[-1], ('docker','run','--rm','hello-world'))

    def test_alternate_repository_is_not_duplicated(self):
        source = self.root/'etc/apt/sources.list.d/old-docker.list'
        source.write_text('deb https://download.docker.com/linux/debian bookworm stable')
        with self.assertRaisesRegex(SystemExit, 'alternate apt source'):
            self.execute()
        self.assertFalse(any(command[0] == 'apt-get' for command in self.commands))


if __name__ == '__main__':
    unittest.main()
