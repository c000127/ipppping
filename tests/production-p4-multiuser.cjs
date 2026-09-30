/* Two bounded read-only production passes; not a sustained capacity benchmark. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
if (process.env.P4_MULTIUSER_PASS !== '1') throw new Error('Set P4_MULTIUSER_PASS=1 explicitly');
const origin = 'https://ipppping.hachimihaqile.top';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const controller = new AbortController();
const report = { observedAt: new Date().toISOString(), origin, clients: [], hostSamples: [],
  method: 'two-concurrent-one-pass-clients', pauseMs: 2000, pageLimit: 32,
  stopPageMs: 5000, maxSeconds: 120, maxRetries: 2, completed: false };
const timer = setTimeout(() => controller.abort(new Error('120-second safety limit')), 120000);
const read = async url => {
  const started = performance.now();
  const response = await fetch(url, { cache: 'no-store', headers: { 'Accept-Encoding': 'gzip' },
    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) });
  const bytes = Buffer.from(await response.arrayBuffer());
  return { response, bytes: bytes.length, data: JSON.parse(bytes.toString('utf8')),
    elapsedMs: Math.round(performance.now() - started) };
};
const health = async () => {
  const result = await read(origin + '/api/stats?source=akari_jp&target=google_dns&type=v4&dur=10800&state=p1');
  assert.equal(result.response.status, 200);
  assert.ok(Date.now() / 1000 - result.data.measurement_updated_at < 600, 'sampling must remain fresh');
  return result.data;
};
let sampler;
(async () => {
  try {
    report.before = await health();
    const nodeReply = await read(origin + '/api/nodes');
    assert.equal(nodeReply.response.status, 200);
    const nodes = nodeReply.data;
    const external = nodes.filter(node => node.group === 'dns' && node.v4 && node.v6).slice(0, 5);
    const selection = [...nodes.filter(node => node.group === 'vps'), ...external].map(node => node.id);
    assert.ok(selection.length >= 18 && selection.length <= 20 && external.length === 5);
    report.selection = selection;
    // One SSH connection samples only this service cgroup and host MemAvailable.
    // The Python process has its own finite deadline even if the connection drops.
    const code = "import json,time,pathlib\nstop=time.monotonic()+125\n" +
      "while time.monotonic()<stop:\n" +
      " m=dict((line.split(':')[0],int(line.split()[1])) for line in pathlib.Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:'))\n" +
      " print(json.dumps({'at':time.time(),'serviceBytes':int(pathlib.Path('/sys/fs/cgroup/system.slice/ipppping.service/memory.current').read_text()),'availableKiB':m['MemAvailable']}),flush=True)\n time.sleep(2)";
    sampler = spawn('ssh', ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-p', '13922',
      'root@84.54.3.65', "python3 -u -c '" + code.replaceAll("'", "'\"'\"'") + "'"], { windowsHide: true });
    let buffer = '', sampleError = '';
    sampler.stderr.on('data', bytes => { sampleError = (sampleError + bytes).slice(-2048); });
    sampler.stdout.on('data', bytes => {
      buffer += bytes;
      const lines = buffer.split(/\r?\n/); buffer = lines.pop();
      for (const line of lines) {
        try {
          const sample = JSON.parse(line); report.hostSamples.push(sample);
          if (sample.serviceBytes > 128 * 1048576 || sample.availableKiB < 256 * 1024)
            controller.abort(new Error('host memory safety threshold'));
        } catch (error) { controller.abort(error); }
      }
    });
    sampler.on('error', error => controller.abort(error));
    await Promise.race([new Promise(resolve => sampler.stdout.once('data', resolve)), pause(10000)]);
    assert.ok(report.hostSamples.length, 'host sampler failed: ' + sampleError);
    const baseEnd = Math.floor(Date.now() / 60000) * 60 - 60;
    const run = async id => {
      const client = { id, end: baseEnd - id * 60, pages: [], attempts: [], total: null, completed: false };
      report.clients.push(client);
      let offset = 0, selectionId;
      for (let page = 0; page < 16; page++) {
        const query = new URLSearchParams({ nodes: selection.join(','), dur: '10800',
          end: String(client.end), offset: String(offset), limit: '32' });
        let result;
        for (let attempt = 0; attempt <= report.maxRetries; attempt++) {
          result = await read(origin + '/api/v2/summary-batch?' + query);
          client.attempts.push({ offset, status: result.response.status, elapsedMs: result.elapsedMs });
          if (result.response.status !== 503) break;
          const retry = Number(result.response.headers.get('retry-after'));
          assert.ok(retry >= 2 && retry <= 4, 'unexpected Retry-After');
          if (attempt < report.maxRetries) await pause(retry * 1000);
        }
        assert.equal(result.response.status, 200, 'bounded retries exhausted');
        assert.ok(result.elapsedMs <= report.stopPageMs, 'slow page safety limit');
        const data = result.data;
        assert.equal(data.schema, 'ipppping.summary-batch.v2');
        assert.equal(data.end, client.end); assert.equal(data.offset, offset);
        if (page === 0) { client.total = data.total; selectionId = data.selection_id; }
        assert.ok(client.total >= 400 && client.total <= 500);
        assert.equal(data.total, client.total); assert.equal(data.selection_id, selectionId);
        assert.ok(data.items.length > 0 && data.items.length <= 32);
        const errors = data.items.filter(item => item.error).length;
        client.pages.push({ offset, items: data.items.length, errors, bytes: result.bytes,
          elapsedMs: result.elapsedMs, contentEncoding: result.response.headers.get('content-encoding') });
        offset += data.items.length;
        if (data.next_offset === null) { assert.equal(offset, data.total); client.completed = true; break; }
        assert.equal(data.next_offset, offset);
        await pause(report.pauseMs);
      }
      assert.ok(client.completed, 'more than 16 pages');
    };
    const outcomes = await Promise.allSettled([0, 1].map(id => run(id).catch(error => {
      controller.abort(error); throw error;
    })));
    const failed = outcomes.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
    report.after = await health(); report.completed = true;
  } finally {
    clearTimeout(timer); if (sampler) sampler.kill();
    report.finishedAt = new Date().toISOString();
    const target = path.join(__dirname, '../test-results/p4-real-multiuser.json');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ completed: report.completed, clients: report.clients.map(client => ({
      id: client.id, completed: client.completed, total: client.total, pages: client.pages.length,
      busy: client.attempts.filter(attempt => attempt.status === 503).length,
      slowestMs: Math.max(...client.pages.map(page => page.elapsedMs)),
      itemErrors: client.pages.reduce((sum, page) => sum + page.errors, 0) })),
      hostSamples: report.hostSamples.length,
      peakServiceMiB: Math.max(...report.hostSamples.map(sample => sample.serviceBytes)) / 1048576,
      minAvailableMiB: Math.min(...report.hostSamples.map(sample => sample.availableKiB)) / 1024 }, null, 2));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
