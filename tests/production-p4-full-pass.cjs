/* One bounded, sequential real-RRD pass. Explicit P4_FULL_PASS=1 required. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
if (process.env.P4_FULL_PASS !== '1') throw new Error('Set P4_FULL_PASS=1 for one production pass');
const origin = process.env.IPPPPING_SITE || 'https://ipppping.hachimihaqile.top';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const read = async url => {
  const started = performance.now();
  const response = await fetch(url, { cache: 'no-store', headers: { 'Accept-Encoding': 'gzip' },
    signal: AbortSignal.timeout(15000) });
  const body = Buffer.from(await response.arrayBuffer());
  return { response, data: JSON.parse(body.toString('utf8')), bytes: body.length,
    elapsedMs: Math.round(performance.now() - started),
    wireBytes: Number(response.headers.get('content-length')) || null };
};
(async () => {
  const nodesReply = await read(origin + '/api/nodes');
  assert.equal(nodesReply.response.status, 200);
  const nodes = nodesReply.data;
  const vps = nodes.filter(node => node.group === 'vps');
  const external = nodes.filter(node => node.group === 'dns' && node.v4 && node.v6).slice(0, 5);
  const selection = [...vps, ...external].map(node => node.id);
  assert.ok(selection.length <= 20 && selection.length >= 18 && external.length === 5);
  const report = { observedAt: new Date().toISOString(), origin, selection,
    method: 'one-sequential-pass', pageLimit: 32, pauseMs: 3000, stopPageMs: 5000,
    pages: [], totalRoutes: null, itemErrors: 0, completed: false };
  let end = null, selectionId = null, offset = 0;
  try {
    for (let page = 0; page < 16; page++) {
      const query = new URLSearchParams({ nodes: selection.join(','), dur: '10800',
        offset: String(offset), limit: '32', ...(end ? { end: String(end) } : {}) });
      const result = await read(origin + '/api/v2/summary-batch?' + query);
      assert.equal(result.response.status, 200, `page ${page} HTTP ${result.response.status}`);
      const data = result.data;
      assert.equal(data.schema, 'ipppping.summary-batch.v2');
      if (page === 0) {
        assert.ok(data.total >= 400 && data.total <= 500, `unexpected route count ${data.total}`);
        report.totalRoutes = data.total;
        end = data.end; selectionId = data.selection_id;
      }
      assert.equal(data.end, end);
      assert.equal(data.selection_id, selectionId);
      assert.equal(data.total, report.totalRoutes);
      assert.equal(data.offset, offset);
      assert.ok(data.items.length > 0 && data.items.length <= 32);
      const errors = data.items.filter(item => item.error).length;
      report.itemErrors += errors;
      report.pages.push({ offset, items: data.items.length, errors, elapsedMs: result.elapsedMs,
        responseBytes: result.bytes, wireBytes: result.wireBytes,
        contentEncoding: result.response.headers.get('content-encoding') });
      if (result.elapsedMs > report.stopPageMs) throw new Error(`slow page ${page}: ${result.elapsedMs} ms`);
      offset += data.items.length;
      if (data.next_offset === null) {
        assert.equal(offset, data.total);
        report.completed = true;
        break;
      }
      assert.equal(data.next_offset, offset);
      await pause(report.pauseMs);
    }
    assert.equal(report.completed, true, 'matrix needed more than 16 pages');
  } finally {
    report.finishedAt = new Date().toISOString();
    const target = path.join(__dirname, '../test-results/p4-real-full-pass.json');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
