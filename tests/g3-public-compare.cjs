/* Low-rate, read-only public transport comparison for one production route.
 * Measures wire bytes and client-observed request time, not rendering or CPU.
 * The refreshed PNG URL matches the main page's manual-submit cache token.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const zlib = require('node:zlib');

const root = path.resolve(__dirname, '..');
const origin = 'https://ipppping.hachimihaqile.top';
const samplesPerMethod = 30;
const pauseMs = 1000;
const width = Number(process.env.G3_PNG_WIDTH || 900);
const height = Number(process.env.G3_PNG_HEIGHT || 320);
assert.ok(Number.isInteger(width) && width >= 280 && width <= 1280);
assert.ok(Number.isInteger(height) && height >= 100 && height <= 500);
const agent = new https.Agent({ keepAlive: true, maxSockets: 1 });
const base = { source: 'akari_jp', target: 'google_dns', type: 'v4', dur: '10800' };
const methods = ['v2-gzip', 'png-refresh', 'png-edge'];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * fraction) - 1];
}

function request(url) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const req = https.request(url, {
      agent,
      headers: { 'Accept-Encoding': 'gzip' },
      timeout: 15000,
    }, response => {
      const firstByteMs = performance.now() - started;
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks),
        firstByteMs,
        totalMs: performance.now() - started,
      }));
      response.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('request timed out')));
    req.on('error', reject);
    req.end();
  });
}

function urlFor(method, sample) {
  const query = new URLSearchParams(base);
  if (method === 'v2-gzip') {
    query.set('points', '720');
    query.set('encoding', 'columns');
    return new URL('/api/v2/series?' + query, origin);
  }
  query.set('w', String(width));
  query.set('h', String(height));
  query.set('theme', 'dark');
  if (method === 'png-refresh') query.set('refresh', `${Date.now()}-${sample}`);
  return new URL('/api/graph.png?' + query, origin);
}

async function take(method, sample) {
  const result = await request(urlFor(method, sample));
  assert.equal(result.status, 200, `${method} returned HTTP ${result.status}`);
  let snapshotId = null;
  let measurementUpdatedAt = null;
  if (method === 'v2-gzip') {
    const decoded = result.headers['content-encoding'] === 'gzip'
      ? zlib.gunzipSync(result.body) : result.body;
    const data = JSON.parse(decoded);
    assert.equal(data.schema, 'ipppping.series.v2');
    assert.equal(data.source, base.source);
    assert.equal(data.target, base.target);
    assert.equal(data.protocol, base.type);
    snapshotId = data.snapshot_id;
    measurementUpdatedAt = data.current?.measurement_updated_at ?? null;
  } else {
    assert.equal(result.body.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  }
  return {
    method, sample, firstByteMs: result.firstByteMs, totalMs: result.totalMs,
    wireBytes: result.body.length,
    contentLength: Number(result.headers['content-length']) || null,
    encoding: result.headers['content-encoding'] || 'identity',
    cacheControl: result.headers['cache-control'] || null,
    cfCacheStatus: result.headers['cf-cache-status'] || null,
    age: result.headers.age || null,
    snapshotId, measurementUpdatedAt,
  };
}

(async () => {
  const report = {
    origin, route: base, width, height, points: 720,
    startedAt: new Date().toISOString(), samplesPerMethod, pauseMs,
    boundaries: ['public HTTPS from this Windows host', 'PNG edge behavior is separate from browser cache',
      'RRD may update during the run; this does not compare frozen snapshots',
      'no browser render, main-thread CPU or origin CPU measured'],
    samples: [],
  };
  try {
    await request(new URL('/healthz', origin)); // Exclude connection setup from paired samples.
    for (let i = 0; i < samplesPerMethod; i++) {
      const order = methods.slice(i % methods.length).concat(methods.slice(0, i % methods.length));
      for (const method of order) {
        const value = await take(method, i + 1);
        report.samples.push(value);
        console.log(`${method} ${i + 1}/${samplesPerMethod}: ${Math.round(value.totalMs)} ms, ${value.wireBytes} B, ${value.cfCacheStatus || 'none'}`);
        await pause(pauseMs);
      }
    }
    report.finishedAt = new Date().toISOString();
    report.summary = Object.fromEntries(methods.map(method => {
      const values = report.samples.filter(item => item.method === method);
      return [method, {
        count: values.length,
        totalMedianMs: percentile(values.map(item => item.totalMs), 0.5),
        totalP95Ms: percentile(values.map(item => item.totalMs), 0.95),
        firstByteMedianMs: percentile(values.map(item => item.firstByteMs), 0.5),
        firstByteP95Ms: percentile(values.map(item => item.firstByteMs), 0.95),
        wireBytesMedian: percentile(values.map(item => item.wireBytes), 0.5),
        cacheStatuses: Object.fromEntries([...new Set(values.map(item => item.cfCacheStatus))]
          .map(status => [status || 'none', values.filter(item => item.cfCacheStatus === status).length])),
      }];
    }));
    const target = path.join(root, 'test-results/g3', width === 900 && height === 320
      ? 'public-compare.json' : `public-compare-${width}x${height}.json`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ report: target, summary: report.summary }, null, 2));
  } finally {
    agent.destroy();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
