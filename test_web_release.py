import importlib.util
import io
import re
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

    def test_renderer_switch_changes_only_main_html(self):
        candidate = self.base / 'canvas'
        changed = build_web.build(ROOT / 'web', candidate, default_renderer='canvas')
        self.assertEqual(self.manifest['assets'], changed['assets'])
        for page in ('chart-trial.html', 'chart-matrix-trial.html'):
            self.assertEqual(self.manifest['pages'][page], changed['pages'][page])
        self.assertNotEqual(self.manifest['pages']['index.html'], changed['pages']['index.html'])
        self.assertIn(b'data-chart-renderer="canvas"', (candidate / 'index.html').read_bytes())
        with self.assertRaisesRegex(ValueError, 'invalid default renderer'):
            build_web.build(ROOT / 'web', self.base / 'bad', default_renderer='unknown')

    def test_cli_explicit_canvas_matches_existing_build_bytes(self):
        output = self.base / 'cli output'
        with patch('sys.stdout', new_callable=io.StringIO) as stdout:
            self.assertEqual(build_web.main(['--default-renderer', 'canvas', '--output', str(output)]), 0)
        reference = self.base / 'reference'
        build_web.build(ROOT / 'web', reference, default_renderer='canvas')
        for path in reference.rglob('*'):
            if path.is_file():
                self.assertEqual(path.read_bytes(), (output / path.relative_to(reference)).read_bytes())
        self.assertIn('Main renderer: canvas', stdout.getvalue())
        self.assertIn(build_web.digest((output / 'manifest.json').read_bytes()), stdout.getvalue())

    def test_cli_default_remains_png(self):
        output = self.base / 'cli-default'
        with patch('sys.stdout', new_callable=io.StringIO) as stdout:
            build_web.main(['--output', str(output)])
        self.assertEqual((output / 'manifest.json').read_bytes(), (self.release / 'manifest.json').read_bytes())
        self.assertIn('Main renderer: png', stdout.getvalue())

    def test_cli_verify_only_never_builds_or_writes(self):
        before = {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.release.rglob('*') if p.is_file()}
        with patch.object(build_web, 'build', side_effect=AssertionError('must not rebuild')), \
                patch('sys.stdout', new_callable=io.StringIO):
            self.assertEqual(build_web.main(['--verify-only', '--output', str(self.release)]), 0)
        self.assertEqual(before, {p: (p.read_bytes(), p.stat().st_mtime_ns)
                                  for p in self.release.rglob('*') if p.is_file()})
        asset = next(iter(self.manifest['assets']))
        (self.release / 'assets' / asset).write_bytes(b'corrupt')
        with self.assertRaises(ValueError), patch('sys.stdout', new_callable=io.StringIO):
            build_web.main(['--verify-only', '--output', str(self.release)])

    def test_cli_invalid_or_conflicting_options_fail_before_build(self):
        output = self.base / 'invalid-cli'
        with patch.object(build_web, 'build', side_effect=AssertionError('must not build')), \
                patch('sys.stderr', new_callable=io.StringIO):
            for options in (['--default-renderer', 'unknown'],
                            ['--default-renderer', 'canvas', '--verify-only']):
                with self.assertRaises(SystemExit) as error:
                    build_web.main(options + ['--output', str(output)])
                self.assertEqual(error.exception.code, 2)
        self.assertFalse(output.exists())

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
        html = (self.target / 'web/index.html').read_bytes()
        self.assertIn(b'<template id="canvasDependencies">', html)
        active_html = re.sub(rb'<template\b[^>]*>.*?</template>', b'', html, flags=re.S)
        self.assertNotIn(b'uplot', active_html)
        self.assertNotIn(b'matrix-renderer', active_html)

    def test_failed_activation_rolls_back_runtime_and_html(self):
        def probe(path, expected):
            if path == '/':
                raise OSError('simulated failed activation')
        with self.assertRaises(OSError):
            self.run_install(probe)
        self.assertEqual((self.target / 'web/index.html').read_bytes(), b'old HTML')
        self.assertEqual((self.target / 'server.py').read_bytes(), b'old runtime')
        self.assertEqual((self.target / 'web/app.js').read_bytes(), b'legacy JS')
        self.assertFalse((self.target / 'web/chart-matrix-trial.html').exists())

    def test_immutable_collision_rejected(self):
        dest = self.target / 'web/assets'
        dest.mkdir()
        (dest / next(iter(self.manifest['assets']))).write_bytes(b'collision')
        with self.assertRaises(ValueError):
            self.run_install()

    def test_frontend_only_requires_identical_runtime_before_mutation(self):
        with self.assertRaisesRegex(ValueError, 'frontend-only runtime mismatch'):
            installer.install(self.source, self.target, self.base / 'backup',
                              lambda: self.fail('unexpected restart'), lambda *args: None,
                              frontend_only=True)
        self.assertFalse((self.base / 'backup').exists())
        self.assertEqual((self.target / 'web/index.html').read_bytes(), b'old HTML')

    def test_frontend_only_keeps_runtime_and_does_not_restart(self):
        for name in installer.RUNTIME:
            (self.source / name).write_bytes(b'old runtime')
        stamps = {name: (self.target / name).stat().st_mtime_ns for name in installer.RUNTIME}
        installer.install(self.source, self.target, self.base / 'backup',
                          lambda: self.fail('unexpected restart'), lambda *args: None,
                          frontend_only=True)
        self.assertEqual((self.target / 'web/index.html').read_bytes(), (self.release / 'index.html').read_bytes())
        for name in installer.RUNTIME:
            self.assertEqual((self.target / name).stat().st_mtime_ns, stamps[name])
            self.assertFalse((self.base / 'backup' / name).exists())

    def test_frontend_only_failed_activation_rolls_back_without_restart(self):
        for name in installer.RUNTIME:
            (self.source / name).write_bytes(b'old runtime')
        def probe(path, expected):
            if path == '/chart-matrix-trial':
                raise OSError('simulated trial activation failure')
        with self.assertRaises(OSError):
            installer.install(self.source, self.target, self.base / 'backup',
                              lambda: self.fail('unexpected restart'), probe, frontend_only=True)
        self.assertEqual((self.target / 'web/index.html').read_bytes(), b'old HTML')
        self.assertEqual((self.target / 'server.py').read_bytes(), b'old runtime')
        self.assertFalse((self.target / 'web/chart-matrix-trial.html').exists())
        self.assertEqual((self.target / 'web/app.js').read_bytes(), b'legacy JS')

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
                for path in ('/', '/static/app.js', '/chart-trial', '/chart-matrix-trial'):
                    with urllib.request.urlopen(base + path) as response:
                        self.assertIn('no-cache', response.headers['Cache-Control'])
                        if path == '/chart-trial':
                            self.assertEqual(response.read(), (self.release / 'chart-trial.html').read_bytes())
                        if path == '/chart-matrix-trial':
                            self.assertEqual(response.read(), (self.release / 'chart-matrix-trial.html').read_bytes())
            finally:
                httpd.shutdown()
                httpd.server_close()
                worker.join(timeout=3)


if __name__ == '__main__':
    unittest.main()
