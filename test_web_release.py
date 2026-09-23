import importlib.util
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.request
from unittest.mock import patch

import build_web
import server

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('installer', ROOT / 'deploy/install-api.py')
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class WebReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.source = self.base / 'source'
        self.release = self.source / 'build/web-release'
        self.manifest = build_web.build(ROOT / 'web', self.release)
        self.target = self.base / 'target'
        (self.target / 'web/fonts').mkdir(parents=True)
        for name in ('JetBrainsMono-Regular.woff2', 'JetBrainsMono-Bold.woff2'):
            (self.target / 'web/fonts' / name).write_bytes(b'font fixture')
        for name in installer.RUNTIME:
            (self.source / name).write_bytes(b'new runtime')
            (self.target / name).write_bytes(b'old runtime')
        (self.target / 'web/index.html').write_bytes(b'old HTML')
        (self.target / 'web/app.js').write_bytes(b'legacy JS')

    def run_install(self, probe=lambda *args: None):
        installer.install(self.source, self.target, self.base / 'backup', lambda: None, probe)

    def test_deterministic_build(self):
        other = self.base / 'other'
        self.assertEqual(self.manifest, build_web.build(ROOT / 'web', other))
        self.assertEqual((other / 'index.html').read_bytes(), (self.release / 'index.html').read_bytes())

    def test_corruption_rejected_before_mutation(self):
        asset = next(iter(self.manifest['assets']))
        (self.release / 'assets' / asset).write_bytes(b'corrupt')
        with self.assertRaises(ValueError):
            self.run_install()
        self.assertFalse((self.base / 'backup').exists())
        self.assertEqual((self.target / 'server.py').read_bytes(), b'old runtime')

    def test_install_preserves_legacy_and_activates_html_last(self):
        paths = []
        def probe(path, expected):
            paths.append(path)
            if path != '/':
                self.assertEqual((self.target / 'web/index.html').read_bytes(), b'old HTML')
        self.run_install(probe)
        self.assertEqual(paths[-1], '/')
        self.assertEqual((self.target / 'web/app.js').read_bytes(), b'legacy JS')
        self.assertEqual((self.target / 'web/index.html').read_bytes(), (self.release / 'index.html').read_bytes())
        self.assertIn(b'MIT', (self.target / 'web/vendor/UPLOT-LICENSE').read_bytes())
        self.assertNotIn(b'uplot', (self.target / 'web/index.html').read_bytes())

    def test_failed_activation_rolls_back_runtime_and_html(self):
        def probe(path, expected):
            if path == '/':
                raise OSError('simulated failed activation')
        with self.assertRaises(OSError):
            self.run_install(probe)
        self.assertEqual((self.target / 'web/index.html').read_bytes(), b'old HTML')
        self.assertEqual((self.target / 'server.py').read_bytes(), b'old runtime')
        self.assertEqual((self.target / 'web/app.js').read_bytes(), b'legacy JS')

    def test_immutable_collision_rejected(self):
        dest = self.target / 'web/assets'
        dest.mkdir()
        (dest / next(iter(self.manifest['assets']))).write_bytes(b'collision')
        with self.assertRaises(ValueError):
            self.run_install()

    def test_missing_dependency_rejected(self):
        (self.source / 'runtime.py').unlink()
        with self.assertRaises(ValueError):
            self.run_install()

    def test_http_cache_headers_and_asset_bytes(self):
        self.run_install()
        with patch.object(server, 'WEB_DIR', self.target / 'web'):
            httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
            worker = threading.Thread(target=httpd.serve_forever, daemon=True)
            worker.start()
            try:
                base = f'http://127.0.0.1:{httpd.server_address[1]}'
                for name in self.manifest['assets']:
                    with urllib.request.urlopen(base + '/static/assets/' + name) as response:
                        self.assertIn('immutable', response.headers['Cache-Control'])
                        self.assertEqual(response.read(), (self.release / 'assets' / name).read_bytes())
                for path in ('/', '/static/app.js', '/chart-trial'):
                    with urllib.request.urlopen(base + path) as response:
                        self.assertIn('no-cache', response.headers['Cache-Control'])
                        if path == '/chart-trial':
                            self.assertEqual(response.read(), (self.release / 'chart-trial.html').read_bytes())
            finally:
                httpd.shutdown()
                httpd.server_close()
                worker.join(timeout=3)


if __name__ == '__main__':
    unittest.main()
