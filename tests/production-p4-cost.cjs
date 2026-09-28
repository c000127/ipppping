/* Bounded, sequential production sampling: never request the full matrix. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
if (process.env.P4_COST !== '1') throw new Error('Set P4_COST=1 for bounded production sampling');
const origin = process.env.IPPPPING_SITE || 'https://ipppping.hachimihaqile.top';
const sample = async (label, pathname, params, expectedItems) => {
  const url = origin + pathname + '?' + new URLSearchParams(params);
  const started = performance.now();
  const response = await fetch(url, { cache: 'no-store', headers: { 'Accept-Encoding': 'gzip' },
    signal: AbortSignal.timeout(30000) });
  const buffer = Buffer.from(await response.arrayBuffer());
  const elapsedMs = Math.round((performance.now() - started) * 10) / 10;
  assert.equal(response.status, 200, `${label}: HTTP ${response.status}`);
  const data = JSON.parse(buffer.toString('utf8'));
  if (expectedItems !== undefined) {
    assert.equal(data.schema, 'ipppping.summary-batch.v2');
    assert.equal(data.items.length, expectedItems);
  } else assert.equal(data.schema, 'ipppping.series.v2');
  return { label, elapsedMs, status: response.status,
    responseBytes: buffer.length, wireContentLength: Number(response.headers.get('content-length')) || null,
    contentEncoding: response.headers.get('content-encoding'), age: response.headers.get('age'),
    cacheControl: response.headers.get('cache-control'),
    totalRoutes: data.total ?? null, returnedItems: data.items?.length ?? null,
    itemErrors: data.items?.filter(item => item.error).length ?? null,
    end: data.end ?? data.window?.end ?? null };
};
(async () => {
  const report = { observedAt: new Date().toISOString(), origin, method: 'sequential-read-only',
    maxSummaryPage: 32, requestCount: 5, samples: [] };
  const small = { nodes: 'akari_jp,google_dns', dur: '10800', offset: '0', limit: '2' };
  const medium = { nodes: 'akari_jp,akari_sg,legendsg', dur: '10800', offset: '0', limit: '8' };
  const large = { nodes: 'akari_jp,akari_sg,legendsg,dmit_jp,dmit_hk',
    dur: '10800', offset: '0', limit: '32' };
  for (const [label, query, count] of [['two-route', small, 2], ['eight-route', medium, 8],
    ['thirty-two-route', large, 32], ['thirty-two-route-repeat', large, 32]]) {
    report.samples.push(await sample(label, '/api/v2/summary-batch', query, count));
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  report.samples.push(await sample('one-visible-series', '/api/v2/series', {
    source: 'akari_jp', target: 'google_dns', type: 'v4', dur: '10800',
    end: String(report.samples[0].end), points: '120', encoding: 'columns'
  }));
  const target = path.join(__dirname, '../test-results/p4-real-route-cost.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
