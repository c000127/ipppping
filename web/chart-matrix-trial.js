'use strict';

// Opt-in matrix lab only. The production app and its PNG renderer are untouched.
const ChartMatrixTrial = (() => {
  const $ = id => document.getElementById(id);
  const selected = new Set(), fixed = new Set();
  const seriesPool = new RequestState.Pool(2);
  const MAX_ACTIVE = 4, MAX_CACHE_COUNT = 8, MAX_CACHE_BYTES = 2 * 1024 * 1024;
  const MAX_PIXELS_PER_CHART = 1280 * 220 * 4;
  let nodes = [], matrix = null, controller = null, generation = 0, frame = 0, observer;
  let cards = [], active = new Map(), pending = new Map(), near = new Set(), wanted = new Set();
  let seriesCache = new Map(), cacheBytes = 0;
  const number = n => Number.isFinite(n) ? n.toFixed(2) : '—';
  const label = id => nodes.find(node => node.id === id)?.label || id;
  const timestamp = stamp => new Date(stamp * 1000).toLocaleString('en-GB', {
    timeZone: 'Asia/Shanghai', hour12: false
  });

  async function json(url, signal) {
    const request = new AbortController();
    let timedOut = false;
    const cancel = () => request.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => { timedOut = true; request.abort(); }, 30000);
    try {
      for (let attempt = 0; ; attempt++) {
        const response = await fetch(url, { signal: request.signal, cache: 'no-store' });
        if (response.ok) return await response.json();
        const error = new Error(`HTTP ${response.status}`);
        await response.body?.cancel();
        if (response.status !== 503 || attempt >= 2) throw error;
        await RequestState.delay(RequestState.retryDelay(response.headers.get('Retry-After'), attempt), request.signal);
      }
    } catch (error) {
      if (timedOut) throw new Error('Request timed out');
      throw error;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
  }

  function dispose(index) {
    active.get(index)?.destroy();
    active.delete(index);
    cards[index]?.querySelector('.plot')?.replaceChildren();
  }
  function clearWork() {
    controller?.abort();
    for (const item of pending.values()) item.abort();
    pending.clear();
    for (const index of [...active.keys()]) dispose(index);
    observer?.disconnect(); near.clear(); wanted.clear();
    seriesCache.clear(); cacheBytes = 0;
    cards = []; matrix = null; $('grid').replaceChildren();
  }
  function remember(index, value) {
    const bytes = JSON.stringify(value).length * 2;
    if (bytes > MAX_CACHE_BYTES) return;
    const old = seriesCache.get(index);
    if (old) cacheBytes -= old.bytes;
    seriesCache.delete(index);
    seriesCache.set(index, { value, bytes }); cacheBytes += bytes;
    while (seriesCache.size > MAX_CACHE_COUNT || cacheBytes > MAX_CACHE_BYTES) {
      const first = seriesCache.keys().next().value;
      cacheBytes -= seriesCache.get(first).bytes; seriesCache.delete(first);
    }
  }
  function cached(index) {
    const entry = seriesCache.get(index);
    if (!entry) return null;
    seriesCache.delete(index); seriesCache.set(index, entry);
    return entry.value;
  }
  function validSeries(data, expected, pair) {
    const fields = ['start', 'end', 'count', 'median_mean_ms', 'min_median_ms', 'max_median_ms',
      'loss_mean_pct', 'loss_max_pct', 'loss_event_count', 'full_loss_count',
      'missing_latency_count', 'missing_measurement_count'];
    const columns = data?.columns, count = columns?.end?.length;
    if (data?.schema !== 'ipppping.series.v2' || data.encoding !== 'columns-v1' ||
        data.source !== pair.source || data.target !== pair.target || data.protocol !== pair.type ||
        !data.summary || Object.keys(expected.summary).some(key => data.summary[key] !== expected.summary[key]) ||
        !Number.isInteger(count) || count > 120 ||
        fields.some(key => !Array.isArray(columns[key]) || columns[key].length !== count) ||
        data.window?.start !== matrix.end - matrix.dur || data.window?.end !== matrix.end) {
      throw new Error('Series changed or invalid; rebuild the matrix to preserve the frozen axis');
    }
    let previous = -Infinity;
    for (let i = 0; i < count; i++) {
      if (!Number.isFinite(columns.start[i]) || !Number.isFinite(columns.end[i]) ||
          columns.start[i] >= columns.end[i] || columns.start[i] < previous ||
          columns.start[i] < matrix.end - matrix.dur || columns.end[i] > matrix.end ||
          !Number.isInteger(columns.count[i]) || columns.count[i] < 1 ||
          !Number.isInteger(columns.missing_latency_count[i]) ||
          columns.missing_latency_count[i] < 0 || columns.missing_latency_count[i] > columns.count[i] ||
          columns.missing_latency_count[i] > 0 && columns.median_mean_ms[i] !== null) {
        throw new Error('Invalid series intervals or gap');
      }
      for (const key of ['median_mean_ms', 'min_median_ms', 'max_median_ms', 'loss_mean_pct', 'loss_max_pct']) {
        const value = columns[key][i];
        if (value !== null && (!Number.isFinite(value) || value < 0 ||
            (key.includes('loss') && value > 100))) throw new Error('Invalid series value');
      }
      if (['max_median_ms', 'median_mean_ms'].some(key => Number.isFinite(columns[key][i]) &&
          columns[key][i] > expected.summary.max_median_ms + 1e-6)) {
        throw new Error('Series exceeds the frozen unified axis; rebuild the matrix');
      }
      previous = columns.end[i];
    }
    return data;
  }
  function plotWidth(element) {
    const ratio = window.devicePixelRatio || 1;
    const backing = Math.floor(MAX_PIXELS_PER_CHART / Math.ceil(220 * ratio));
    return Math.min(1280, Math.floor(element.clientWidth), Math.floor(backing / ratio));
  }
  function draw(index, data) {
    if (!wanted.has(index) || document.hidden || active.has(index)) return;
    const plot = cards[index].querySelector('.plot'), width = plotWidth(plot);
    if (width < 200) { plot.textContent = 'Zoom exceeds the pixel budget; inspect the summary or reduce zoom.'; return; }
    const item = matrix.items[index], c = data.columns;
    if (!c.end.length) { plot.textContent = 'No consolidated intervals in this window.'; return; }
    const maximum = $('axis').value === 'unified' ? matrix.unifiedMax : Math.max(1, item.summary.max_median_ms || 0) * 1.1;
    const axis = { stroke: '#b8b8b8', font: '11px monospace', grid: { stroke: '#363636' }, ticks: { stroke: '#777' } };
    const envelope = u => {
      const ctx = u.ctx;
      ctx.save(); ctx.beginPath(); ctx.rect(u.bbox.left, u.bbox.top, u.bbox.width, u.bbox.height); ctx.clip();
      ctx.strokeStyle = '#bba3ff'; ctx.lineWidth = Math.min(2, devicePixelRatio);
      for (let i = 0; i < c.end.length; i++) {
        if (!Number.isFinite(c.min_median_ms[i]) || !Number.isFinite(c.max_median_ms[i])) continue;
        const x = u.valToPos((c.start[i] + c.end[i]) / 2, 'x', true);
        const low = u.valToPos(c.min_median_ms[i], 'y', true), high = u.valToPos(c.max_median_ms[i], 'y', true);
        ctx.beginPath(); ctx.moveTo(x, low); ctx.lineTo(x, high);
        ctx.moveTo(x - 2, low); ctx.lineTo(x + 2, low);
        ctx.moveTo(x - 2, high); ctx.lineTo(x + 2, high); ctx.stroke();
      }
      ctx.restore();
    };
    plot.replaceChildren();
    const chart = new uPlot({ width, height: 220, legend: { show: false }, select: { show: false },
      cursor: { drag: { x: false, y: false }, points: { show: false } },
      scales: { x: { time: false, range: () => [matrix.end - matrix.dur, matrix.end] },
        y: { range: () => [0, maximum] }, loss: { range: () => [0, 100] } },
      series: [{}, { label: 'Mean median ms', stroke: '#dedede', width: 1.5, spanGaps: false, points: { show: false } },
        { label: 'Max loss %', scale: 'loss', stroke: '#ff9999', paths: () => null, points: { show: true, size: 3, fill: '#ff9999' } }],
      axes: [{ ...axis, space: 80, values: (u, ticks) => ticks.map(t => new Date(t * 1000).toLocaleTimeString('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false })) },
        { ...axis, size: 55, label: 'RTT ms', labelFont: '11px monospace' },
        { ...axis, scale: 'loss', side: 1, size: 42, label: 'Loss %', labelFont: '11px monospace', grid: { show: false } }],
      hooks: { draw: [envelope] }
    }, [c.end.map((stamp, i) => (c.start[i] + stamp) / 2), c.median_mean_ms,
      c.loss_max_pct.map(value => value > 0 ? value : null)], plot);
    chart.root.setAttribute('aria-hidden', 'true');
    active.set(index, chart);
  }
  async function loadVisible(index) {
    if (active.has(index) || pending.has(index) || matrix.items[index].error) return;
    const available = cached(index);
    if (available) {
      try { draw(index, available); }
      catch (error) { cards[index].querySelector('.plot').textContent = error.message; }
      return;
    }
    const local = new AbortController(), token = generation;
    pending.set(index, local);
    const plot = cards[index].querySelector('.plot');
    plot.setAttribute('aria-busy', 'true');
    const pair = matrix.pairs[index];
    try {
      const data = await seriesPool.run(() => json('/api/v2/series?' + new URLSearchParams({
        source: pair.source, target: pair.target, type: pair.type, dur: String(matrix.dur),
        end: String(matrix.end), points: '120', encoding: 'columns'
      }), local.signal), local.signal);
      if (token !== generation) return;
      validSeries(data, matrix.items[index], pair);
      remember(index, data);
      if (wanted.has(index)) draw(index, data);
    } catch (error) {
      if (token === generation && wanted.has(index) && error.name !== 'AbortError') {
        plot.textContent = error.message + '. No automatic PNG fallback.';
        plot.classList.add('problem');
      }
    } finally {
      if (pending.get(index) === local) pending.delete(index);
      plot.removeAttribute('aria-busy');
    }
  }
  function scheduleVisible() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!matrix || document.hidden) return;
      const center = innerHeight / 2;
      const ranked = [...near].filter(index => !matrix.items[index].error).map(index => {
        const rect = cards[index].getBoundingClientRect();
        return { index, distance: Math.abs((rect.top + rect.bottom) / 2 - center) };
      }).sort((a, b) => a.distance - b.distance);
      wanted = new Set(ranked.slice(0, MAX_ACTIVE).map(value => value.index));
      for (const index of [...active.keys()]) if (!wanted.has(index)) dispose(index);
      for (const [index, item] of pending) if (!wanted.has(index)) item.abort();
      for (const index of wanted) loadVisible(index);
    });
  }
  function observe() {
    observer?.disconnect(); near.clear();
    observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const index = Number(entry.target.dataset.index);
        if (entry.isIntersecting) near.add(index);
        else near.delete(index);
      }
      scheduleVisible();
    }, { rootMargin: '300px 0px' });
    cards.forEach(card => observer.observe(card));
  }
  function renderCards() {
    const fragment = document.createDocumentFragment();
    cards = matrix.pairs.map((pair, index) => {
      const item = matrix.items[index];
      const card = document.createElement('article'); card.className = 'matrix-card'; card.dataset.index = String(index);
      const title = document.createElement('h2'); title.textContent = `${label(pair.source)} → ${label(pair.target)}`;
      const badges = document.createElement('div'); badges.className = 'badges';
      for (const text of [...(pair.ext ? ['Ext'] : []), pair.type]) {
        const badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = text; badges.append(badge);
      }
      const stats = document.createElement('dl');
      for (const [name, value] of item.error ? [['Status', item.error]] : [
        ['Current', number(item.current?.current_ms) + ' ms'],
        ['Average', number(item.summary.average_ms) + ' ms'],
        ['Max median', number(item.summary.max_median_ms) + ' ms'],
        ['Loss', number(item.summary.loss_pct) + '%'],
        ['Coverage', number(item.summary.measurement_coverage * 100) + '%']
      ]) {
        const group = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd');
        dt.textContent = name; dd.textContent = value; group.append(dt, dd); stats.append(group);
      }
      const plot = document.createElement('div'); plot.className = 'plot'; plot.setAttribute('aria-hidden', 'true');
      if (item.error) { plot.classList.add('problem'); plot.textContent = `No chart: ${item.error}. Submit again to retry.`; }
      card.append(title, badges, stats, plot); fragment.append(card); return card;
    });
    $('grid').replaceChildren(fragment);
    observe();
  }
  function updateButtons() {
    $('nodes').querySelectorAll('.node-choice').forEach(group => {
      const id = group.dataset.id, choose = group.querySelector('.choose'), anchor = group.querySelector('.fixed');
      choose.setAttribute('aria-pressed', String(selected.has(id)));
      anchor.disabled = !selected.has(id) || nodes.find(node => node.id === id)?.group !== 'vps';
      anchor.setAttribute('aria-pressed', String(fixed.has(id)));
    });
    if (matrix) $('status').textContent = 'Unapplied selection/window change. Submit to rebuild; displayed matrix is the previous snapshot.';
  }
  async function submit(event) {
    event.preventDefault();
    clearWork();
    controller = new AbortController(); const token = ++generation;
    const chosen = [...selected], anchors = [...fixed];
    const dur = Number($('duration').value);
    $('status').textContent = 'Building frozen summary…'; $('scope').textContent = 'No complete matrix loaded.';
    try {
      const loaded = await MatrixData.load(chosen, anchors, dur, null, json, controller.signal,
        (done, total) => { if (token === generation) $('status').textContent = `Summaries ${done}/${total}; charts wait for all pages.`; });
      if (token !== generation) return;
      matrix = loaded;
      renderCards();
      $('status').textContent = `Ready: ${loaded.pairs.length} routes. At most ${MAX_ACTIVE} charts and 2 series requests; hidden routes have no series request.`;
      $('scope').textContent = `Frozen window ${timestamp(loaded.end - dur)} – ${timestamp(loaded.end)} UTC+08:00 · ${$('axis').value} Y axis · ${loaded.pairs.length} routes. Chart lines are consolidated-bucket medians; vertical marks show median extrema and red dots show maximum loss. Summary values remain in the document when charts are discarded.`;
    } catch (error) {
      if (token === generation) $('status').textContent = error.name === 'AbortError' ? 'Cancelled.' : `Matrix not drawn: ${error.message}`;
    }
  }
  $('query').addEventListener('submit', submit);
  $('nodes').addEventListener('click', event => {
    const button = event.target.closest('button'), id = button?.parentElement?.dataset.id;
    if (!id) return;
    if (button.classList.contains('choose')) {
      selected.has(id) ? selected.delete(id) : selected.add(id);
      if (!selected.has(id)) fixed.delete(id);
    } else if (button.classList.contains('fixed')) fixed.has(id) ? fixed.delete(id) : fixed.add(id);
    updateButtons();
  });
  $('axis').addEventListener('change', () => {
    if (!matrix) return;
    for (const index of [...active.keys()]) dispose(index);
    $('scope').textContent = $('scope').textContent.replace(/ · (unified|independent) Y axis/, ` · ${$('axis').value} Y axis`);
    scheduleVisible();
  });
  $('duration').addEventListener('change', updateButtons);
  window.addEventListener('scroll', scheduleVisible, { passive: true });
  window.addEventListener('resize', () => { for (const index of [...active.keys()]) dispose(index); scheduleVisible(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      controller?.abort(); generation++;
      for (const item of pending.values()) item.abort();
      for (const index of [...active.keys()]) dispose(index);
      if (!matrix) $('status').textContent = 'Paused while hidden. Submit again to build the matrix.';
    } else scheduleVisible();
  });
  window.addEventListener('pagehide', () => {
    controller?.abort();
    for (const item of pending.values()) item.abort();
    for (const index of [...active.keys()]) dispose(index);
    observer?.disconnect(); near.clear(); wanted.clear(); cancelAnimationFrame(frame);
  });
  window.addEventListener('pageshow', event => { if (event.persisted && matrix) observe(); });
  const init = new AbortController();
  json('/api/nodes', init.signal).then(data => {
    nodes = [...data].sort((a, b) => String(a.label).localeCompare(String(b.label), 'en', { sensitivity: 'base', numeric: true }));
    const fragment = document.createDocumentFragment();
    for (const node of nodes) {
      const group = document.createElement('div'); group.className = 'node-choice'; group.dataset.id = node.id;
      const choose = document.createElement('button'); choose.type = 'button'; choose.className = 'choose';
      choose.textContent = `${node.label}${node.group === 'dns' ? ' Ext' : ''} [${[node.v4 && 'v4', node.v6 && 'v6'].filter(Boolean).join('/')}]`;
      choose.setAttribute('aria-pressed', 'false');
      const anchor = document.createElement('button'); anchor.type = 'button'; anchor.className = 'fixed';
      anchor.textContent = 'Fixed'; anchor.setAttribute('aria-label', `${node.label} Fixed node`);
      anchor.setAttribute('aria-pressed', 'false'); anchor.disabled = true;
      group.append(choose, anchor); fragment.append(group);
    }
    $('nodes').replaceChildren(fragment); $('load').disabled = false; $('status').textContent = 'Choose at least two nodes and submit. No matrix has been requested.';
  }).catch(error => { $('status').textContent = 'Node list failed: ' + error.message; });
  return { get instanceCount() { return active.size; }, get cacheCount() { return seriesCache.size; },
    get cacheBytes() { return cacheBytes; }, get pendingCount() { return pending.size; },
    get matrix() { return matrix; } };
})();
