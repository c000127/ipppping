import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
from types import SimpleNamespace
import unittest

spec = importlib.util.spec_from_file_location('capture', Path(__file__).parent / 'deploy/recovery/capture.py')
capture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(capture)


class RecoveryTests(unittest.TestCase):
    def archive(self, directory, *, extra=None, corrupt=False, missing=False, identity=False):
        path = Path(directory) / 'test.tar.gz'
        data = json.dumps({'rrds': [], 'completedAt': 'test', 'serviceIdentityBefore': {'pid': 1},
                           'serviceIdentityAfter': {'pid': 2 if identity else 1}}).encode()
        record = {'sha256': hashlib.sha256(data).hexdigest(), 'size': len(data),
                  'mode': 0o600, 'uid': 0, 'gid': 0, 'mtime': 0}
        if corrupt:
            record['sha256'] = '0' * 64
        manifest = {'schema': 1, 'role': 'slave', 'entries': {} if missing else {'metadata.json': record}}
        with tarfile.open(path, 'w:gz') as tar:
            for name, contents in [('metadata.json', data), ('manifest.json', json.dumps(manifest).encode())]:
                info = tarfile.TarInfo(name)
                info.mode, info.size = 0o600, len(contents)
                tar.addfile(info, io.BytesIO(contents))
            if extra:
                tar.addfile(extra, io.BytesIO(b''))
        return path

    def test_valid(self):
        with tempfile.TemporaryDirectory() as temp:
            self.assertEqual(capture.validate_archive(self.archive(temp))['files'], 2)

    def test_corruption(self):
        for kwargs in ({'corrupt': True}, {'missing': True}, {'identity': True}):
            with self.subTest(kwargs=kwargs), tempfile.TemporaryDirectory() as temp:
                with self.assertRaises(ValueError):
                    capture.validate_archive(self.archive(temp, **kwargs))

    def test_unsafe_paths(self):
        for name in ('../escape', '/etc/passwd', 'files/../escape', 'files/x\\y',
                     'files/C:evil', './files/a', 'files//a', 'metadata.json', 'unknown',
                     'files/NUL.txt', 'files/a.', 'files/a ', 'METADATA.JSON'):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temp:
                with self.assertRaises(ValueError):
                    capture.validate_archive(self.archive(temp, extra=tarfile.TarInfo(name)))

    def test_links_and_devices_rejected(self):
        for kind in (tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.CHRTYPE, tarfile.DIRTYPE):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as temp:
                member = tarfile.TarInfo('files/link')
                member.type, member.linkname = kind, '/etc/passwd'
                with self.assertRaises(ValueError):
                    capture.validate_archive(self.archive(temp, extra=member))

    def test_authenticated_encryption_and_stage(self):
        openssl = os.environ.get('IPPPING_TEST_OPENSSL') or shutil.which('openssl')
        if not openssl:
            self.skipTest('OpenSSL unavailable; set IPPPING_TEST_OPENSSL for crypto integration')
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            key, cert, encrypted = root / 'test.key', root / 'test.crt', root / 'test.cms'
            subprocess.run([openssl, 'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
                            '-keyout', str(key), '-out', str(cert), '-days', '1',
                            '-subj', '/CN=recovery-selftest'], check=True, capture_output=True)
            plain = self.archive(temp)
            subprocess.run([openssl, 'cms', '-encrypt', '-binary', '-aes-256-gcm', '-stream',
                            '-outform', 'DER', '-in', str(plain), '-out', str(encrypted), str(cert)],
                           check=True, capture_output=True)
            args = SimpleNamespace(archive=str(encrypted), key=str(key), certificate=str(cert),
                                   openssl=openssl, stage=str(root / 'stage'))
            capture.verify(args)
            self.assertTrue((root / 'stage/manifest.json').is_file())
            with self.assertRaises(ValueError):
                capture.verify(args)  # Never overwrite a previous stage.
            data = bytearray(encrypted.read_bytes())
            data[len(data) // 2] ^= 1
            encrypted.write_bytes(data)
            args.stage = str(root / 'tampered-stage')
            with self.assertRaises(ValueError):
                capture.verify(args)
            self.assertFalse(Path(args.stage).exists())
            self.assertEqual(list(root.glob('verify-*')), [])


if __name__ == '__main__':
    unittest.main()
