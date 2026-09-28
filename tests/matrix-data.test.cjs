const assert = require('node:assert/strict');
const MatrixData = require('../web/matrix-data.js');

const end = 1800000000;
const pair = i => ({ source: 's' + i, target: 't' + i, type: i % 2 ? 'v6' : 'v4' });
const item = (p, maximum) => ({ source: p.source, target: p.target, protocol: p.type,
  schema: 'ipppping.series.v2', snapshot_id: 's'.repeat(24),
  window: { start: end - 10800, end }, summary: { max_median_ms: maximum } });
function transport(pairs, mutate = x => x) {
  const calls = [];
  const fetchJson = async url => {
    calls.push(url);
    if (url.startsWith('/api/pairs?')) return pairs;
    const q = new URL(url, 'http://local').searchParams;
    const offset = Number(q.get('offset')), limit = Number(q.get('limit'));
    return mutate({ schema: 'ipppping.summary-batch.v2', selection_id: 'a'.repeat(64),
      end, dur: 10800, total: pairs.length, offset, limit,
      next_offset: offset + limit < pairs.length ? offset + limit : null,
      items: pairs.slice(offset, offset + limit).map((p, i) => item(p, offset + i + 1)) }, offset);
  };
  return { calls, fetchJson };
}

(async () => {
  const pairs = Array.from({ length: 500 }, (_, i) => pair(i));
  const { calls, fetchJson } = transport(pairs);
  const progress = [];
  const result = await MatrixData.load(['one', 'two'], ['one'], 10800, end, fetchJson, null,
    (done, total) => progress.push([done, total]));
  assert.equal(result.items.length, 500);
  assert.equal(result.unifiedMax, 550);
  assert.equal(calls.length, 17);
  assert.deepEqual(progress.at(-1), [500, 500]);
  assert.ok(calls.slice(1).every(url => new URL(url, 'http://local').searchParams.get('limit') === '32'));
  assert.deepEqual(calls.slice(1).map(url => Number(new URL(url, 'http://local').searchParams.get('offset'))),
    Array.from({ length: 16 }, (_, i) => i * 32));
  assert.match(calls[0], /anchor=one/);
  const inferred = transport(pairs);
  assert.equal((await MatrixData.load(['one', 'two'], [], 10800, null, inferred.fetchJson)).end, end);
  assert.equal(new URL(inferred.calls[1], 'http://local').searchParams.has('end'), false);
  assert.equal(new URL(inferred.calls[2], 'http://local').searchParams.get('end'), String(end));
  assert.equal((await MatrixData.load(['one', 'two'], [], 10800, end,
    transport([]).fetchJson)).items.length, 0);
  for (const mutate of [
    (page, offset) => offset ? { ...page, selection_id: 'b'.repeat(64) } : page,
    (page, offset) => offset ? { ...page, total: 499 } : page,
    page => ({ ...page, items: page.items.slice(1) }),
    page => ({ ...page, items: [{ ...page.items[0], source: 'wrong' }, ...page.items.slice(1)] }),
    page => ({ ...page, items: [{ ...page.items[0], summary: { max_median_ms: -1 } }, ...page.items.slice(1)] })
  ]) {
    await assert.rejects(MatrixData.load(['one', 'two'], [], 10800, end,
      transport(pairs, mutate).fetchJson), /Matrix contract/);
  }
  await assert.rejects(MatrixData.load(['one', 'one'], [], 10800, end, fetchJson), /invalid node selection/);
  await assert.rejects(MatrixData.load(['one', 'two'], ['three'], 10800, end, fetchJson), /invalid Fixed selection/);
  const cancelled = new AbortController(), stopped = transport(pairs);
  await assert.rejects(MatrixData.load(['one', 'two'], [], 10800, end, stopped.fetchJson,
    cancelled.signal, () => cancelled.abort()), error => error.name === 'AbortError');
  assert.equal(stopped.calls.length, 2, 'a hidden/cancelled matrix must not request a second page');
  console.log('Matrix summary pagination and contract tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
