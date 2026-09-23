'use strict';
// Isolated single-route trial. No matrix renderer changes, background polling or prefetch.
const ChartTrial = (() => {
  const $ = id => document.getElementById(id);
  const pool = new RequestState.Pool(4);
  let generation = 0, controller = null, chart = null, snapshot = null, applied = null;
  let mode = 'canvas', page = 0, frame = 0;
  const time = stamp => new Date(stamp * 1000).toLocaleString('en-GB', { timeZone: 'Asia/Shanghai', hour12: false });
  const value = number => Number.isFinite(number) ? number.toFixed(2) : '—';
  function dispose() {
    chart?.destroy(); chart = null;
    $('plot').replaceChildren();
  }
  async function json(url, signal) {
    return pool.run(async () => {
      const timeout = new AbortController();
      const cancel = () => timeout.abort();
      signal.addEventListener('abort', cancel, { once: true });
      const timer = setTimeout(cancel, 15000);
      try {
        const response = await fetch(url, { signal: timeout.signal, cache: 'no-cache' });
        if (!response.ok) throw Error(`HTTP ${response.status}; retry manually${response.headers.get('Retry-After') ? ' after ' + response.headers.get('Retry-After') + ' seconds' : ''}. No automatic PNG fallback.`);
        return await response.json();
      } finally { clearTimeout(timer); signal.removeEventListener('abort', cancel); }
    }, signal);
  }
  function validate(data) {
    if (data.encoding === 'columns-v1') {
      const fields = ['start', 'end', 'count', 'median_mean_ms', 'min_median_ms', 'max_median_ms', 'loss_mean_pct', 'loss_max_pct', 'loss_event_count', 'full_loss_count', 'missing_latency_count', 'missing_measurement_count'];
      const columns = data.columns, count = columns?.end?.length;
      if (!Number.isInteger(count) || count > 1440 || fields.some(k => !Array.isArray(columns[k]) || columns[k].length !== count)) throw Error('Invalid column lengths');
      data.bins = Array.from({ length: count }, (_, i) => Object.fromEntries(fields.map(k => [k, columns[k][i]])));
      delete data.columns;
    }
    if (data.schema !== 'ipppping.series.v2' || !Array.isArray(data.bins) || data.bins.length > 1440) throw Error('Unsupported or oversized series');
    let previous = -Infinity;
    for (const bin of data.bins) {
      if (!Number.isFinite(bin.start) || !Number.isFinite(bin.end) || bin.start >= bin.end || bin.start < previous) throw Error('Invalid interval ordering');
      for (const key of ['median_mean_ms', 'min_median_ms', 'max_median_ms', 'loss_max_pct']) {
        if (bin[key] !== null && (!Number.isFinite(bin[key]) || bin[key] < 0)) throw Error('Invalid sample value');
      }
      if (bin.missing_latency_count > 0 && bin.median_mean_ms !== null) throw Error('Gap would be bridged');
      previous = bin.end;
    }
    return data;
  }
  function inspect(index) {
    const bin = snapshot?.bins[index];
    if (!bin) return;
    $('cursor').value = index;
    $('point-readout').textContent = `${time(bin.start)} – ${time(bin.end)} UTC+08:00 · ${bin.count} consolidated bucket(s) · mean ${value(bin.median_mean_ms)} ms · min–max ${value(bin.min_median_ms)}–${value(bin.max_median_ms)} ms · max loss ${value(bin.loss_max_pct)}% · loss events ${bin.loss_event_count} · missing RTT ${bin.missing_latency_count}; missing measurement ${bin.missing_measurement_count}`;
  }
  function table() {
    if (!$('details').open || !snapshot) { $('rows').replaceChildren(); return; }
    const pages = Math.max(1, Math.ceil(snapshot.bins.length / 50));
    page = Math.min(pages - 1, Math.max(0, page));
    $('page-label').textContent = `${page + 1} / ${pages}`;
    $('prev').disabled = page === 0; $('next').disabled = page === pages - 1;
    const fragment = document.createDocumentFragment();
    for (const bin of snapshot.bins.slice(page * 50, page * 50 + 50)) {
      const row = document.createElement('tr');
      for (const text of [`${time(bin.start)} – ${time(bin.end)}`, value(bin.median_mean_ms), `${value(bin.min_median_ms)}–${value(bin.max_median_ms)}`, value(bin.loss_max_pct), bin.loss_event_count, `${bin.missing_latency_count} / ${bin.count}`]) {
        const cell = document.createElement('td'); cell.textContent = text; row.append(cell);
      }
      fragment.append(row);
    }
    $('rows').replaceChildren(fragment);
  }
  function summary() {
    const s = snapshot.summary, c = snapshot.current;
    const fragment = document.createDocumentFragment();
    for (const [label, text] of [['Current (raw input, in window)', value(c.current_ms) + ' ms'], ['Average bucket median', value(s.average_ms) + ' ms'], ['Min median', value(s.min_median_ms) + ' ms'], ['Max median', value(s.max_median_ms) + ' ms'], ['Mean loss', value(s.loss_pct) + '%'], ['Measurement coverage', value(s.measurement_coverage * 100) + '%']]) {
      const group = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd');
      dt.textContent = label; dd.textContent = text; group.append(dt, dd); fragment.append(group);
    }
    $('summary').replaceChildren(fragment);
    const status = RequestState.dataStatus({ ...c, measurement_state: c.state, stale_after_seconds: 600 }, Date.now());
    $('status').textContent = `${status.label}${status.timestamp ? ' · ' + time(status.timestamp) : ''} · raw input ${c.rrd_updated_at ? time(c.rrd_updated_at) : 'unknown'} · ${snapshot.aggregation.input_points} → ${snapshot.bins.length} intervals · snapshot ${snapshot.snapshot_id}`;
    if (c.state === 'outside_window') $('status').textContent += ' · raw latest is outside this window; Current is unknown';
    $('cursor').disabled = !snapshot.bins.length;
    $('cursor').max = Math.max(0, snapshot.bins.length - 1);
    inspect(snapshot.bins.length - 1); table();
  }
  const MAX_PIXELS = 1280 * 280 * 4;
  function plotWidth() {
    // Native DPR keeps glyphs crisp. Bound total pixels rather than rejecting
    // common high-DPR phones; large high-DPR screens get a narrower graph.
    const ratio = window.devicePixelRatio || 1;
    // Round the backing dimensions conservatively: fractional DPR must not
    // exceed the budget by a partially rounded canvas row or column.
    const maxBackingWidth = Math.floor(MAX_PIXELS / Math.ceil(280 * ratio));
    return Math.min(1280, Math.floor($('plot').clientWidth), Math.floor(maxBackingWidth / ratio));
  }
  function drawCanvas() {
    if (!snapshot || document.hidden) return;
    const width = plotWidth();
    if (width < 240) { $('plot').textContent = 'The current zoom exceeds the canvas pixel budget. Use PNG or the interval table, or reduce zoom.'; return; }
    const bins = snapshot.bins;
    const axis = { stroke: '#b8b8b8', font: '12px monospace', grid: { stroke: '#363636' }, ticks: { stroke: '#777' } };
    const max = Math.max(1, snapshot.summary.max_median_ms || 0) * 1.1;
    const envelope = u => {
      const ctx = u.ctx;
      ctx.save(); ctx.beginPath(); ctx.rect(u.bbox.left, u.bbox.top, u.bbox.width, u.bbox.height); ctx.clip();
      ctx.strokeStyle = '#bba3ff'; ctx.lineWidth = Math.min(2, devicePixelRatio);
      for (const bin of bins) {
        if (!Number.isFinite(bin.min_median_ms) || !Number.isFinite(bin.max_median_ms)) continue;
        const x = u.valToPos((bin.start + bin.end) / 2, 'x', true);
        const low = u.valToPos(bin.min_median_ms, 'y', true), high = u.valToPos(bin.max_median_ms, 'y', true);
        ctx.beginPath(); ctx.moveTo(x, low); ctx.lineTo(x, high);
        // A one-sample spike can have min === max, including next to a gap.
        // Caps keep that exact extremum visible instead of drawing a zero-length line.
        ctx.moveTo(x - 2, low); ctx.lineTo(x + 2, low);
        ctx.moveTo(x - 2, high); ctx.lineTo(x + 2, high); ctx.stroke();
      }
      ctx.restore();
    };
    chart = new uPlot({ width, height: 280, legend: { show: false }, select: { show: false },
      cursor: { drag: { x: false, y: false }, points: { show: false } },
      scales: { x: { time: false, range: () => [snapshot.window.start, snapshot.window.end] }, y: { range: () => [0, max] }, loss: { range: () => [0, 100] } },
      series: [{}, { label: 'Mean median ms', stroke: '#dedede', fill: '#dedede12', width: 1.5, spanGaps: false, points: { show: false } },
        { label: 'Max loss %', scale: 'loss', stroke: '#ff9999', paths: () => null, points: { show: true, size: 4, fill: '#ff9999' } }],
      axes: [{ ...axis, space: 100, values: (u, ticks) => ticks.map(t => new Date(t * 1000).toLocaleTimeString('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false })) },
        { ...axis, size: 60, label: 'RTT ms', labelFont: '12px monospace' },
        { ...axis, scale: 'loss', side: 1, size: 45, label: 'Loss %', labelFont: '12px monospace', grid: { show: false } }],
      hooks: { draw: [envelope], setCursor: [u => { if (Number.isInteger(u.cursor.idx)) inspect(u.cursor.idx); }] }
    }, [bins.map(b => (b.start + b.end) / 2), bins.map(b => b.median_mean_ms), bins.map(b => b.loss_max_pct > 0 ? b.loss_max_pct : null)], $('plot'));
    chart.root.setAttribute('aria-hidden', 'true'); // Exact data is accessible in DOM controls/table.
  }
  async function render() {
    dispose();
    if (!snapshot || document.hidden) return;
    if (mode === 'canvas') {
      try { drawCanvas(); } catch (error) { dispose(); $('status').textContent = 'Canvas failed: ' + error.message + '. Choose PNG explicitly or use the data table.'; }
      return;
    }
    const token = generation, signal = controller.signal;
    $('status').textContent += ' · PNG uses legacy rolling-window graph statistics, not the frozen v2 snapshot';
    try {
      await pool.run(() => new Promise((resolve, reject) => {
        const img = new Image();
        const finish = error => { clearTimeout(timer); signal.removeEventListener('abort', abort); img.onload = img.onerror = null; error ? reject(error) : resolve(); };
        const abort = () => { img.removeAttribute('src'); finish(new DOMException('Cancelled', 'AbortError')); };
        const timer = setTimeout(() => { img.removeAttribute('src'); finish(Error('PNG timed out; retry manually')); }, 15000);
        img.onload = () => { if (token === generation && mode === 'png') $('plot').replaceChildren(img); finish(); };
        img.onerror = () => finish(Error('PNG failed; retry manually'));
        signal.addEventListener('abort', abort, { once: true });
        img.alt = 'Legacy PNG comparison; v2 interval values are provided below';
        const params = new URLSearchParams({ ...applied, w: String(Math.max(280, Math.min(1280, $('plot').clientWidth))), h: '280', theme: 'dark' });
        params.delete('points'); params.delete('end');
        img.src = '/api/graph.png?' + params;
      }), signal);
    } catch (error) { if (token === generation && error.name !== 'AbortError') $('status').textContent = error.message; }
  }
  async function submit(event) {
    event.preventDefault();
    controller?.abort(); controller = new AbortController(); const token = ++generation;
    dispose(); snapshot = null; $('summary').replaceChildren(); $('rows').replaceChildren(); $('cursor').disabled = true;
    $('status').textContent = 'Loading a new snapshot…';
    applied = { source: $('source').value, target: $('target').value, type: $('protocol').value, dur: $('duration').value, points: $('points').value, encoding: 'columns' };
    $('route').textContent = `${$('source').selectedOptions[0].textContent} → ${$('target').selectedOptions[0].textContent} · ${applied.type}`;
    try {
      const data = validate(await json('/api/v2/series?' + new URLSearchParams(applied), controller.signal));
      if (token !== generation) return;
      snapshot = data; page = 0; summary(); await render();
    } catch (error) { if (token === generation) $('status').textContent = error.name === 'AbortError' ? 'Request cancelled; submit to retry.' : error.message; }
  }
  $('query').addEventListener('submit', submit);
  $('cursor').addEventListener('input', () => inspect(Number($('cursor').value)));
  $('details').addEventListener('toggle', table);
  $('prev').addEventListener('click', () => { page--; table(); });
  $('next').addEventListener('click', () => { page++; table(); });
  for (const next of ['canvas', 'png']) $(next + '-mode').addEventListener('click', () => {
    mode = next; controller?.abort(); controller = new AbortController(); generation++;
    for (const name of ['canvas', 'png']) $(name + '-mode').setAttribute('aria-pressed', String(name === mode));
    if (snapshot) summary(); render();
  });
  const resize = new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (mode !== 'canvas' || !snapshot || document.hidden) return;
      const width = plotWidth();
      if (width < 240) { dispose(); drawCanvas(); return; }
      if (chart) { if (chart.width !== width) chart.setSize({ width, height: 280 }); }
      else drawCanvas();
    });
  });
  resize.observe($('plot'));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { controller?.abort(); generation++; dispose(); $('status').textContent = 'Paused while hidden. Submit to refresh.'; }
    else if (snapshot && mode === 'canvas') { summary(); drawCanvas(); }
  });
  window.addEventListener('pagehide', () => { init.abort(); controller?.abort(); dispose(); resize.disconnect(); cancelAnimationFrame(frame); });
  window.addEventListener('pageshow', event => { if (event.persisted) { resize.observe($('plot')); if (snapshot && mode === 'canvas') render(); } });
  const init = new AbortController();
  json('/api/nodes', init.signal).then(nodes => {
    for (const node of nodes) for (const id of ['source', 'target']) {
      if (id === 'source' && node.group !== 'vps') continue;
      const option = document.createElement('option'); option.value = node.id;
      option.textContent = `${node.label} ${node.group === 'vps' ? '' : 'Ext '}[${[node.v4 && 'v4', node.v6 && 'v6'].filter(Boolean).join('/')}]`;
      $(id).append(option);
    }
    if ($('target').options.length > 1) $('target').selectedIndex = 1;
    $('load').disabled = false; $('status').textContent = 'Choose one route and submit. No measurement has been requested.';
  }).catch(error => { $('status').textContent = 'Node list failed: ' + error.message; });
  return { validate, get snapshot() { return snapshot; }, get instanceCount() { return chart ? 1 : 0; } };
})();
