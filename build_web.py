"""Deterministic, stdlib-only frontend release builder (development machine)."""
import argparse
import hashlib
import json
from pathlib import Path
import re

ASSETS = ('styles.css', 'request-state.js', 'ui-components.js', 'query-handoff.js', 'app.js',
          'chart-trial.css', 'chart-trial.js', 'chart-matrix-trial.css',
          'matrix-data.js', 'matrix-renderer.js', 'chart-matrix-trial.js', 'vendor/uplot.js', 'vendor/uplot.css')
PAGES = ('index.html', 'chart-trial.html', 'chart-matrix-trial.html')
VENDOR_HASHES = {
    'vendor/uplot.js': '19c8d4c6ad88929a79f4ae49d6f7161566dfd0ba3d15cc495e974f787eb78f1f',
    'vendor/uplot.css': '0cf09be05fa0760ca9a3330ea374f6655f08766c7b2b370e462afe98852147ce',
    'vendor/UPLOT-LICENSE': '3421f0033bae76860e165efab33d4bbbcc2d8fc1a4a708ef4f6742eef434ab47',
}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def build(source, output, *, default_renderer='png'):
    source, output = Path(source), Path(output)
    for name, checksum in VENDOR_HASHES.items():
        if digest((source / name).read_text(encoding='utf-8').encode('utf-8')) != checksum:
            raise ValueError('pinned vendor checksum mismatch: ' + name)
    (output / 'assets').mkdir(parents=True, exist_ok=True)
    pages = {name: (source / name).read_text(encoding='utf-8') for name in PAGES}
    if default_renderer not in ('png', 'canvas'):
        raise ValueError('invalid default renderer')
    if pages['index.html'].count('data-chart-renderer="png"') != 1:
        raise ValueError('missing explicit main renderer configuration')
    pages['index.html'] = pages['index.html'].replace('data-chart-renderer="png"',
                                                    f'data-chart-renderer="{default_renderer}"')
    manifest = {'assets': {}, 'pages': {}, 'licenses': {}}
    license_name = 'UPLOT-LICENSE'
    license_data = (source / 'vendor' / license_name).read_text(encoding='utf-8').encode('utf-8')
    (output / license_name).write_bytes(license_data)
    manifest['licenses'][license_name] = digest(license_data)
    for name in ASSETS:
        data = (source / name).read_text(encoding='utf-8').encode('utf-8')
        stem, ext = Path(name).name.rsplit('.', 1)
        filename = f'{stem}.{digest(data)[:16]}.{ext}'
        (output / 'assets' / filename).write_bytes(data)
        manifest['assets'][filename] = digest(data)
        reference = '/static/' + name
        if not any(reference in html for html in pages.values()):
            raise ValueError('unreferenced asset: ' + name)
        pages = {page: html.replace(reference, '/static/assets/' + filename) for page, html in pages.items()}
    for page, html in pages.items():
        data = html.encode('utf-8')
        (output / page).write_bytes(data)
        manifest['pages'][page] = digest(data)
    manifest['html_sha256'] = manifest['pages']['index.html']
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    validate(output)
    return manifest


def validate(output):
    output = Path(output)
    manifest = json.loads((output / 'manifest.json').read_text(encoding='utf-8'))
    if manifest.get('licenses') != {'UPLOT-LICENSE': VENDOR_HASHES['vendor/UPLOT-LICENSE']}:
        raise ValueError('invalid vendor license')
    if digest((output / 'UPLOT-LICENSE').read_bytes()) != manifest['licenses']['UPLOT-LICENSE']:
        raise ValueError('vendor license checksum mismatch')
    if set(manifest['pages']) != set(PAGES):
        raise ValueError('invalid page set')
    references = set()
    for page, checksum in manifest['pages'].items():
        html = (output / page).read_bytes()
        if digest(html) != checksum:
            raise ValueError('HTML checksum mismatch')
        references.update(x.decode() for x in re.findall(rb'/static/assets/([^"\s]+)', html))
    if references != set(manifest['assets']) or len(references) != len(ASSETS):
        raise ValueError('HTML asset set mismatch')
    for name, checksum in manifest['assets'].items():
        if not re.fullmatch(r'[a-z-]+\.[0-9a-f]{16}\.(?:js|css)', name):
            raise ValueError('unsafe asset name')
        if checksum[:16] != name.split('.')[-2] or digest((output / 'assets' / name).read_bytes()) != checksum:
            raise ValueError('asset checksum mismatch: ' + name)
    return manifest


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    root = Path(__file__).resolve().parent
    parser.add_argument('--output', type=Path, default=root / 'build/web-release',
                        help='release directory; use a separate candidate directory for new work')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--default-renderer', choices=('png', 'canvas'), default='png',
                      help='main-page default, PNG unless explicitly selected; does not change Results')
    mode.add_argument('--verify-only', action='store_true',
                      help='verify existing release bytes without rebuilding or writing files')
    args = parser.parse_args(argv)
    result = validate(args.output) if args.verify_only else build(
        root / 'web', args.output, default_renderer=args.default_renderer)
    html = (args.output / 'index.html').read_bytes()
    renderer = re.search(rb'data-chart-renderer="(png|canvas)"', html)
    print('Verified' if args.verify_only else 'Built and verified', len(result['assets']),
          'assets in', args.output)
    print('Main renderer:', renderer[1].decode() if renderer else 'unspecified')
    print('Manifest SHA-256:', digest((args.output / 'manifest.json').read_bytes()))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
