# Vendored dependency

uPlot **1.6.32**, MIT, unmodified upstream distribution (text newline normalized).
License: [UPLOT-LICENSE](UPLOT-LICENSE).

Source: https://github.com/leeoniya/uPlot/tree/1.6.32

| Local file | Upstream file | SHA-256 (LF text) |
| --- | --- | --- |
| uplot.js | dist/uPlot.iife.min.js | 19c8d4c6ad88929a79f4ae49d6f7161566dfd0ba3d15cc495e974f787eb78f1f |
| uplot.css | dist/uPlot.min.css | 0cf09be05fa0760ca9a3330ea374f6655f08766c7b2b370e462afe98852147ce |
| UPLOT-LICENSE | LICENSE | 3421f0033bae76860e165efab33d4bbbcc2d8fc1a4a708ef4f6742eef434ab47 |

Loaded only by `/chart-trial`, never the default matrix. All production assets
are self-hosted; there is no runtime npm/CDN request or production Node process.
Development build fingerprints these JS/CSS files. Keep this license with any release.

Version 1.6.32 reads device DPR internally, without a documented per-instance
DPR cap. The isolated trial keeps native DPR for crisp labels but constrains the
CSS graph width to a 1280×280×4 backing-pixel budget. DPR 1.5, 2, 3 and 4 pass
touch-emulated browser checks. Extremely high zoom that leaves fewer than 240
CSS pixels switches to an explicit PNG/table prompt. This is not evidence of
acceptable performance on a real low-end handset; G3 still requires that check.
Do not patch browser globals or silently modify the vendored library.
