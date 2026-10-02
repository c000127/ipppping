'use strict';

// Shared bounded Canvas host. Query selection and submission belong to the caller.
const MatrixRenderer = (() => {
 function create({ nodes: getNodes, json, controls = false, main = document.getElementById('mainArea'),
   grid = document.getElementById('graphGrid') }) {
  const $ = id => document.getElementById(id);
  const MAX_ACTIVE = 4, MAX_CACHE_COUNT = 16, MAX_CACHE_BYTES = 2 * 1024 * 1024;
  const MAX_PIXELS_PER_CHART = 1280 * 220 * 4;
  const seriesPool = new RequestState.Pool(2);
  const intervalTimeFormat = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const intervalDateFormat = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const label = id => getNodes().find(node => node.id === id)?.label || id;
  const timestamp = stamp => new Date(stamp * 1000).toLocaleString('en-GB', { timeZone: 'Asia/Shanghai', hour12: false });
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
  let matrix = null, pairs = [], items = [], cards = [], generation = 0, frame = 0, observer;
  let active = new Map(), idle = [], chartAllocs = 0, pending = new Map(), near = new Set(), wanted = new Set();
  const chartStates = new WeakMap();
  // Retain the rendered picture, not a live Canvas, when a route leaves view.
  // Scoped to one frozen matrix; never used as data for a different query/axis.
  const previews = new Map();
  let previewBytes = 0;
  let seriesCache = new Map(), cacheBytes = 0, chartGridColor = null;
  let queryLoading = false, appliedMode = 'charts', unified = false, visibleMax = 1;
  let motionFrame = 0, detailsIndex = null, detailsTrigger = null;
  const motionAnimations = new Set(), revealedRoutes = new Set();
  function motionSettings() {
    const style = getComputedStyle(document.body);
    return { ease: style.getPropertyValue('--trial-motion-ease').trim(),
      enter: parseFloat(style.getPropertyValue('--trial-motion-enter')),
      pulse: parseFloat(style.getPropertyValue('--trial-motion-pulse')),
      reveal: parseFloat(style.getPropertyValue('--trial-motion-reveal')) };
  }
  function trackMotion(element, keyframes, options) {
    const animation = element.animate(keyframes, options);
    motionAnimations.add(animation);
    const done = () => {
      motionAnimations.delete(animation);
      animation.removeEventListener('finish', done);
      animation.removeEventListener('cancel', done);
      // All terminal values match CSS. Release the finished timeline/effect too,
      // especially the detached Canvas reveal cover with forwards fill.
      if (animation.playState === 'finished') animation.cancel();
    };
    animation.addEventListener('finish', done, { once: true });
    animation.addEventListener('cancel', done, { once: true });
    return animation;
  }
  function stopMotion() {
    cancelAnimationFrame(motionFrame); motionFrame = 0;
    for (const animation of motionAnimations) animation.cancel();
    motionAnimations.clear();
  }
  function syncSegment(group) {
    const button = group.querySelector('button.on'), indicator = group.querySelector('.segment-indicator');
    if (!button || !indicator || !button.offsetWidth) return;
    indicator.style.width = button.offsetWidth + 'px';
    indicator.style.transform = 'translateX(' + button.offsetLeft + 'px)';
    if (!group.dataset.motionReady) {
      group.dataset.motionReady = 'pending';
      requestAnimationFrame(() => { group.dataset.motionReady = 'true'; });
    }
  }
  function visibleCards() {
    const bounds = main.getBoundingClientRect(), found = new Set();
    const xs = [bounds.left + bounds.width * .25, bounds.left + bounds.width * .75];
    for (let y = bounds.top + 24; y < bounds.bottom - 12 && found.size < 6; y += 85) {
      for (const x of xs) {
        const card = document.elementFromPoint(x, y)?.closest('.card');
        if (card && grid.contains(card)) found.add(card);
      }
    }
    return [...found];
  }
  function animateVisibleCards(enter, pulseByIndex) {
    if (UIComponents.reducedMotion() || (!enter && !pulseByIndex.size)) return;
    motionFrame = requestAnimationFrame(() => {
      motionFrame = 0;
      if (document.hidden || main.inert) return;
      const settings = motionSettings();
      visibleCards().forEach((card, order) => {
        if (enter) trackMotion(card,
          [{ opacity: .82, transform: 'translateY(4px)' }, { opacity: 1, transform: 'translateY(0)' }],
          { duration: settings.enter, delay: order * 14, easing: settings.ease, fill: 'backwards' });
        const changed = pulseByIndex.get(Number(card.dataset.index));
        if (changed?.current) trackMotion(card.querySelector('[data-metric="0"] .stat-value'),
          [{ backgroundColor: 'rgba(255,255,255,.09)' }, { backgroundColor: 'rgba(255,255,255,0)' }],
          { duration: settings.pulse, easing: settings.ease });
        if (changed?.loss) trackMotion(card.querySelector('[data-metric="4"] .stat-value'),
          [{ backgroundColor: 'rgba(239,68,68,.18)' }, { backgroundColor: 'rgba(239,68,68,0)' }],
          { duration: settings.pulse, easing: settings.ease });
      });
    });
  }
  function revealPlot(chart, index) {
    if (revealedRoutes.has(index) || UIComponents.reducedMotion() || document.hidden) return;
    revealedRoutes.add(index);
    const layer = chart.root.querySelector('.u-wrap'), ratio = uPlot.pxRatio || window.devicePixelRatio || 1;
    if (!layer) return;
    const cover = document.createElement('div'); cover.className = 'trial-reveal';
    for (const [side, value] of Object.entries({ left: chart.bbox.left, top: chart.bbox.top,
      width: chart.bbox.width, height: chart.bbox.height })) cover.style[side] = value / ratio + 'px';
    layer.append(cover);
    const animation = trackMotion(cover, [{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }],
      { duration: motionSettings().reveal, easing: 'linear', fill: 'forwards' });
    const remove = () => cover.remove();
    animation.addEventListener('finish', remove, { once: true });
    animation.addEventListener('cancel', remove, { once: true });
  }

  function destroyChart(chart) {
    chart.destroy();
    // Drop native backing stores when leaving Charts or hiding the document.
    chart.root.querySelectorAll('canvas').forEach(canvas => { canvas.width = 0; canvas.height = 0; });
  }
  function destroyIdle() {
    for (const chart of idle) destroyChart(chart);
    idle = [];
  }
  function dispose(index, reuse = true, preservePreview = false) {
    cards[index]?.querySelectorAll('.trial-reveal').forEach(cover => {
      cover.getAnimations().forEach(animation => animation.cancel());
    });
    const chart = active.get(index);
    if (chart) {
      if (preservePreview) rememberPreview(index, chart);
      if (reuse && idle.length < MAX_ACTIVE) idle.push(chart);
      else destroyChart(chart);
    }
    active.delete(index);
    const preview = preservePreview && previews.get(index);
    cards[index]?.querySelector('.trial-plot')?.replaceChildren(...(preview ? [preview.image] : []));
  }
  function rememberPreview(index, chart) {
    // uPlot can defer its first/reassigned draw. Never preserve the default
    // empty bitmap or a recycled Canvas still showing its preceding route.
    if (!chartStates.get(chart)?.rendered) return;
    // Lossless local encoding includes axes and loss marks. No PNG API request,
    // extra Canvas allocation, animation, or retained series payload is needed.
    const src = chart.ctx.canvas.toDataURL('image/png');
    const image = new Image(chart.width, chart.height);
    image.className = 'trial-preview'; image.alt = ''; image.draggable = false;
    image.setAttribute('aria-hidden', 'true');
    image.loading = 'lazy'; image.decoding = 'async'; image.src = src;
    previewBytes -= previews.get(index)?.bytes || 0;
    const bytes = src.length * 2;
    previews.set(index, { image, bytes }); previewBytes += bytes;
  }
  function clearPreviews() {
    previews.clear(); previewBytes = 0;
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
          !Number.isInteger(columns.loss_event_count[i]) ||
          columns.loss_event_count[i] < 0 || columns.loss_event_count[i] > columns.count[i] ||
          !Number.isInteger(columns.full_loss_count[i]) ||
          columns.full_loss_count[i] < 0 || columns.full_loss_count[i] > columns.loss_event_count[i] ||
          !Number.isInteger(columns.missing_latency_count[i]) ||
          columns.missing_latency_count[i] < 0 || columns.missing_latency_count[i] > columns.count[i] ||
          !Number.isInteger(columns.missing_measurement_count[i]) ||
          columns.missing_measurement_count[i] < 0 ||
          columns.missing_measurement_count[i] > columns.count[i] - columns.loss_event_count[i] ||
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
    if (!wanted.has(index) || document.hidden || active.has(index) || appliedMode !== 'charts' || !cards[index]) return;
    const plot = cards[index].querySelector('.trial-plot'), width = plotWidth(plot);
    if (width < 200) { plot.textContent = 'Zoom exceeds the pixel budget; inspect the summary or reduce zoom.'; return; }
    const item = matrix.items[index], c = data.columns;
    if (!c.end.length) { plot.textContent = 'No consolidated intervals in this window.'; return; }
    const theme = getComputedStyle(document.body);
    const color = name => theme.getPropertyValue(name).trim();
    const markColor = color('--trial-loss-mark');
    chartGridColor = color('--trial-rule');
    const font = '11px ' + color('--font-ui');
    const maximum = unified ? visibleMax : Math.max(1, item.summary.max_median_ms || 0) * 1.1;
    const axis = { stroke: color('--text-sec'), font,
      ticks: { show: false }, border: { show: false } };
    const lossRuns = [], lossPeaks = [];
    for (let i = 0; i < c.end.length; i++) {
      const mean = c.loss_mean_pct[i], peak = c.loss_max_pct[i];
      if (!Number.isFinite(peak) || peak <= 0) continue;
      // A filled interval requires loss in every consolidated source bucket.
      // Otherwise its peak is known, but the event's exact time is not.
      const sustained = c.loss_event_count[i] === c.count[i] &&
        c.missing_measurement_count[i] === 0 && Number.isFinite(mean) && mean > 0;
      if (sustained) {
        const previous = lossRuns.at(-1);
        if (previous && previous.end === c.start[i] && previous.mean === mean) previous.end = c.end[i];
        else lossRuns.push({ start: c.start[i], end: c.end[i], mean });
        if (peak > mean) lossPeaks.push({ start: c.start[i], end: c.end[i], from: mean, peak });
      } else lossPeaks.push({ start: c.start[i], end: c.end[i], from: 0, peak });
    }
    const state = { maximum, markColor, lossRuns, lossPeaks, rendered: false };
    const marks = u => {
      const ctx = u.ctx, px = uPlot.pxRatio || window.devicePixelRatio || 1;
      ctx.save(); ctx.beginPath(); ctx.rect(u.bbox.left, u.bbox.top, u.bbox.width, u.bbox.height); ctx.clip();
      const top = Math.floor(u.bbox.top), bottom = Math.ceil(u.bbox.top + u.bbox.height);
      const xStart = value => value === matrix.end - matrix.dur
        ? Math.floor(u.bbox.left) : Math.round(u.valToPos(value, 'x', true));
      const xEnd = value => value === matrix.end
        ? Math.ceil(u.bbox.left + u.bbox.width) : Math.round(u.valToPos(value, 'x', true));
      const yLoss = value => value <= 0 ? bottom : value >= 100 ? top :
        Math.max(top, Math.min(bottom - 1, Math.round(u.valToPos(value, 'loss', true))));
      ctx.fillStyle = state.markColor;
      ctx.globalAlpha = .65;
      for (const run of state.lossRuns) {
        const left = xStart(run.start), right = xEnd(run.end), y = yLoss(run.mean);
        if (right > left && y < bottom) ctx.fillRect(left, y, right - left, bottom - y);
      }
      for (const event of state.lossPeaks) {
        const left = xStart(event.start), right = xEnd(event.end);
        const high = yLoss(event.peak), low = yLoss(event.from);
        if (right <= left || high >= low) continue;
        const width = Math.min(Math.ceil(3 * px), right - left);
        const x = Math.floor((left + right - width) / 2);
        ctx.fillRect(x, high, width, low - high);
      }
      ctx.restore();
      state.rendered = true;
    };
    const chartData = [c.end.map((stamp, i) => (c.start[i] + stamp) / 2), c.median_mean_ms,
      c.loss_max_pct.map(value => value > 0 ? value : null)];
    plot.replaceChildren();
    let chart = idle.pop();
    if (chart) {
      // Keep at most four native Canvas/uPlot allocations across viewport changes.
      Object.assign(chartStates.get(chart), state);
      plot.append(chart.root);
      try {
        if (chart.width !== width) chart.setSize({ width, height: 220 });
        chart.setData(chartData);
      } catch (error) { destroyChart(chart); throw error; }
    } else {
      chart = new uPlot({ width, height: 220, legend: { show: false }, select: { show: false },
      cursor: { show: false }, dom: { over: false, under: false },
      scales: { x: { time: false, range: () => [matrix.end - matrix.dur, matrix.end] },
        y: { range: () => [0, state.maximum] }, loss: { range: () => [0, 100] } },
      series: [{}, { label: 'Mean median ms', stroke: color('--trial-rtt'), width: 2, spanGaps: false, points: { show: false } },
        { label: 'Max loss %', scale: 'loss', stroke: markColor, paths: () => null, points: { show: false } }],
      axes: [{ ...axis, size: 28, space: 76, grid: { show: false },
        values: (u, ticks) => ticks.map(t => new Date(t * 1000).toLocaleTimeString('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false })) },
        { ...axis, size: 48, labelSize: 18, label: 'RTT ms', labelFont: font,
          grid: { stroke: chartGridColor, width: 1 } },
        { ...axis, scale: 'loss', side: 1, size: 34, labelSize: 18, label: 'Loss %',
          labelFont: font, stroke: markColor, grid: { show: false } }],
      hooks: { draw: [marks] }
      }, chartData, plot);
      chartStates.set(chart, state);
      chartAllocs++;
    }
    chart.root.setAttribute('aria-hidden', 'true');
    active.set(index, chart);
    revealPlot(chart, index);
  }
  async function requestSeries(index) {
    const available = cached(index);
    if (available) return available;
    const existing = pending.get(index);
    if (existing && !existing.signal.aborted) return existing.result;
    const local = new AbortController(), token = generation;
    pending.set(index, local);
    const plot = cards[index].querySelector('.trial-plot');
    plot.setAttribute('aria-busy', 'true');
    const pair = matrix.pairs[index];
    local.result = (async () => { try {
      const data = await seriesPool.run(() => json('/api/v2/series?' + new URLSearchParams({
        source: pair.source, target: pair.target, type: pair.type, dur: String(matrix.dur),
        end: String(matrix.end), points: '120', encoding: 'columns'
      }), local.signal), local.signal);
      if (token !== generation) throw new DOMException('Query replaced', 'AbortError');
      validSeries(data, matrix.items[index], pair);
      remember(index, data);
      return data;
    } finally {
      // A cancelled generation must not clear the loading state of its replacement.
      if (pending.get(index) === local) {
        pending.delete(index);
        plot.removeAttribute('aria-busy');
      }
    } })();
    return local.result;
  }
  async function loadVisible(index) {
    if (active.has(index) || pending.has(index) || matrix?.items[index].error || !matrix) return;
    const token = generation, plot = cards[index].querySelector('.trial-plot');
    try {
      const data = await requestSeries(index);
      if (token === generation && wanted.has(index)) draw(index, data);
    } catch (error) {
      if (token === generation && wanted.has(index) && error.name !== 'AbortError') {
        plot.textContent = error.message + '. No automatic PNG fallback.';
        plot.classList.add('problem');
      }
    }
  }
  function closeIntervalData() {
    if ($('intervalDialog').open) $('intervalDialog').close();
    detailsIndex = null;
    $('intervalTable').replaceChildren();
    $('intervalStatus').textContent = '';
  }
  async function showIntervalData(plot) {
    const index = Number(plot.closest('.card').dataset.index), token = generation;
    if (!matrix || queryLoading || items[index]?.error || $('intervalDialog').open) return;
    detailsIndex = index; detailsTrigger = plot;
    const pair = pairs[index];
    $('intervalTitle').textContent = (pair.srcLabel || label(pair.source)) + ' → ' +
      (pair.tgtLabel || label(pair.target)) + ' · ' + pair.type + (pair.ext ? ' · Ext' : '');
    $('intervalStatus').textContent = 'Loading interval data…';
    $('intervalTable').replaceChildren();
    $('intervalDialog').showModal();
    scheduleVisible();
    try {
      // Include the inspected route in the same four-route work budget.
      await new Promise(resolve => requestAnimationFrame(resolve));
      await Promise.allSettled([...pending.values()].filter(job => job.signal.aborted).map(job => job.result));
      if (detailsIndex !== index || token !== generation || !$('intervalDialog').open) return;
      const data = await requestSeries(index);
      if (detailsIndex !== index || token !== generation || !$('intervalDialog').open) return;
      const c = data.columns;
      const number = value => Number.isFinite(value) ? value.toFixed(2) : 'Missing';
      const intervalTime = stamp => {
        const date = new Date(stamp * 1000);
        return '<time datetime="' + date.toISOString() + '" aria-label="' +
          escapeHtml(intervalDateFormat.format(date) + ' UTC+08:00') + '">' + intervalTimeFormat.format(date) + '</time>';
      };
      const rows = c.end.map((end, i) => '<tr><th scope="row">' +
        intervalTime(c.start[i]) + '–' + intervalTime(end) +
        '</th>' + [number(c.median_mean_ms[i]), number(c.loss_mean_pct[i]), number(c.loss_max_pct[i]),
          c.loss_event_count[i] + '/' + c.count[i], c.full_loss_count[i],
          c.missing_measurement_count[i], c.missing_latency_count[i]]
          .map(value => '<td>' + value + '</td>').join('') + '</tr>').join('');
      $('intervalTable').innerHTML = '<table><caption>RTT and packet loss · ' + c.end.length + ' intervals</caption>' +
        '<thead><tr>' + ['Interval', 'Mean median RTT (ms)', 'Mean loss (%)', 'Peak loss (%)',
          'Loss / buckets', '100% loss buckets', 'Missing measurements', 'Missing latency']
          .map(text => '<th scope="col">' + text + '</th>').join('') + '</tr></thead><tbody>' + rows + '</tbody></table>';
      $('intervalStatus').textContent = timestamp(data.window.start) + ' – ' + timestamp(data.window.end) +
        ' UTC+08:00' + (c.end.length ? '' : ' · No consolidated intervals in this window.');
    } catch (error) {
      if (detailsIndex === index && token === generation && $('intervalDialog').open)
        $('intervalStatus').textContent = error.name === 'AbortError' ? 'Load cancelled. Close and retry.' : error.message;
    }
  }
  function scheduleVisible() {
    if (queryLoading) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!matrix || document.hidden) return;
      const viewport = main.getBoundingClientRect();
      const center = (viewport.top + viewport.bottom) / 2;
      const ranked = [...near].filter(index => !matrix.items[index].error).map(index => {
        const rect = cards[index].getBoundingClientRect();
        return { index, distance: Math.abs((rect.top + rect.bottom) / 2 - center) };
      }).sort((a, b) => a.distance - b.distance);
      const indexes = ranked.map(value => value.index);
      if (detailsIndex !== null) indexes.unshift(detailsIndex);
      wanted = new Set([...new Set(indexes)].slice(0, MAX_ACTIVE));
      for (const index of [...active.keys()]) if (!wanted.has(index)) dispose(index, true, true);
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
    }, { root: main, rootMargin: '300px 0px' });
    cards.forEach(card => { if (card) observer.observe(card); });
  }
  if (!$('intervalDialog')) document.body.insertAdjacentHTML('beforeend', "<dialog class=\"trial-data-dialog\" id=\"intervalDialog\" aria-labelledby=\"intervalTitle\" aria-describedby=\"intervalExplanation\">\n  <header class=\"trial-data-head\">\n    <h2 id=\"intervalTitle\">Interval data</h2>\n    <button type=\"button\" id=\"closeIntervalData\" autofocus aria-label=\"Close interval data\">Close</button>\n  </header>\n  <p id=\"intervalExplanation\">Each row aggregates measured buckets. A peak is somewhere within its interval; missing latency is not zero latency.</p>\n  <p id=\"intervalStatus\" role=\"status\"></p>\n  <div id=\"intervalTable\" class=\"trial-data-scroll\" tabindex=\"0\" role=\"region\" aria-label=\"Interval measurements\"></div>\n</dialog>");
  function suspend(keepCharts = true) {
    queryLoading = true; generation++;
    closeIntervalData(); stopMotion();
    for (const [index, job] of pending) {
      job.abort();
      cards[index]?.querySelector('.trial-plot')?.removeAttribute('aria-busy');
    }
    pending.clear();
    for (const index of [...active.keys()]) dispose(index, keepCharts);
    if (!keepCharts) destroyIdle();
    cards.forEach(card => card?.querySelector('.trial-preview')?.remove());
    clearPreviews();
    observer?.disconnect(); near.clear(); wanted.clear();
    cancelAnimationFrame(frame); frame = 0;
  }
  function pause() {
    // Preserve the displayed snapshot until the caller commits its replacement.
    queryLoading = true; generation++; closeIntervalData(); stopMotion();
    for (const [index, job] of pending) {
      job.abort();
      cards[index]?.querySelector('.trial-plot')?.removeAttribute('aria-busy');
    }
    pending.clear(); observer?.disconnect(); near.clear(); wanted.clear();
    cancelAnimationFrame(frame); frame = 0;
  }
  function reset(keepCharts = false) {
    suspend(keepCharts);
    seriesCache.clear(); cacheBytes = 0; revealedRoutes.clear();
    matrix = null; pairs = []; items = []; cards = [];
  }
  function mount(snapshot, nextCards, options = {}) {
    if (snapshot !== matrix) reset(true);
    else suspend(true);
    matrix = snapshot; pairs = snapshot.pairs; items = snapshot.items; cards = nextCards;
    unified = !!options.unified;
    // One frozen range from the full legal selection; viewport/filter cannot redefine it.
    visibleMax = Math.max(1, ...items.map(item => item.summary?.max_median_ms || 0)) * 1.1;
    queryLoading = false; observe();
    animateVisibleCards(!!options.enter, options.pulse || new Map());
  }
  function resume() { queryLoading = false; if (matrix) observe(); }
  function setUnified(value) {
    unified = !!value;
    // Offscreen previews must not advertise the previous axis configuration.
    cards.forEach(card => card?.querySelector('.trial-preview')?.remove());
    clearPreviews();
    for (const index of [...active.keys()]) dispose(index);
    scheduleVisible();
  }
  grid.addEventListener('click', event => {
    const plot = event.target.closest('.trial-plot');
    if (plot) showIntervalData(plot);
  });
  grid.addEventListener('keydown', event => {
    if (!['Enter', ' '].includes(event.key) || !event.target.matches('.trial-plot')) return;
    event.preventDefault(); showIntervalData(event.target);
  });
  $('closeIntervalData').addEventListener('click', closeIntervalData);
  $('intervalDialog').addEventListener('keydown', event => {
    // Let the native dialog handle Escape before the sidebar shortcut sees it.
    if (event.key === 'Escape') event.stopPropagation();
  });
  $('intervalDialog').addEventListener('cancel', event => {
    event.preventDefault(); closeIntervalData();
  });
  $('intervalDialog').addEventListener('close', () => {
    if ($('intervalDialog').open) return;
    detailsIndex = null;
    $('intervalTable').replaceChildren(); $('intervalStatus').textContent = '';
    if (detailsTrigger?.isConnected) detailsTrigger.focus({ preventScroll: true });
    detailsTrigger = null;
    if (!queryLoading) scheduleVisible();
  });
  main.addEventListener('scroll', scheduleVisible, { passive: true });
  const resize = new ResizeObserver(() => {
    if (queryLoading || !matrix || !active.size) return;
    for (const index of [...active.keys()]) dispose(index);
    scheduleVisible();
  });
  resize.observe(main);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) suspend(false);
    else resume();
  });
  window.addEventListener('pagehide', () => suspend(false));
  window.addEventListener('pageshow', event => { if (event.persisted) resume(); });
  const segments = controls ? ['filterPills', 'pairMode', 'viewMode'].map($) : [];
  function syncControls(enabled = true) {
    for (const group of segments) {
      let indicator = group.querySelector('.segment-indicator');
      if (!indicator) {
        indicator = document.createElement('span'); indicator.className = 'segment-indicator';
        indicator.setAttribute('aria-hidden', 'true'); group.prepend(indicator);
      }
      indicator.hidden = !enabled;
      const button = group.querySelector('button.on');
      if (!enabled || !button?.offsetWidth) continue;
      indicator.style.width = button.offsetWidth + 'px';
      indicator.style.transform = 'translateX(' + button.offsetLeft + 'px)';
      if (!group.dataset.motionReady) {
        group.dataset.motionReady = 'pending';
        requestAnimationFrame(() => { group.dataset.motionReady = 'true'; });
      }
    }
  }
  if (segments.length) {
    const segmentResize = new ResizeObserver(() => syncControls(document.body.classList.contains('matrix-integrated-trial')));
    segments.forEach(group => segmentResize.observe(group));
  }
  function colorLoss(card, value) {
    const target = card.querySelector('[data-metric="4"]');
    if (!target) return;
    let color = 'var(--text-sec)';
    if (Number.isFinite(value) && value > 0) {
      const theme = getComputedStyle(document.body);
      const palette = ['low', 'mid', 'high'].map(step => theme.getPropertyValue('--trial-loss-' + step).trim());
      const amount = Math.min(value, 100) / 50;
      const [start, end, fraction] = amount <= 1 ? [palette[0], palette[1], amount] : [palette[1], palette[2], amount - 1];
      const channel = offset => Math.round(parseInt(start.slice(offset, offset + 2), 16) * (1 - fraction) +
        parseInt(end.slice(offset, offset + 2), 16) * fraction);
      color = `rgb(${channel(1)}, ${channel(3)}, ${channel(5)})`;
    }
    target.style.setProperty('--trial-loss-current', color);
  }
  return { mount, suspend, pause, reset, resume, setUnified, closeIntervalData, stopMotion, animateVisibleCards, colorLoss, syncControls,
    get instanceCount() { return active.size; }, get pooledCount() { return idle.length; },
    get chartAllocations() { return chartAllocs; },
    get previewCount() { return previews.size; }, get previewBytes() { return previewBytes; },
    get backingPixels() {
      return [...active.values(), ...idle].reduce((total, chart) =>
        total + [...chart.root.querySelectorAll('canvas')].reduce((sum, canvas) =>
          sum + canvas.width * canvas.height, 0), 0);
    },
    get cacheCount() { return seriesCache.size; }, get cacheBytes() { return cacheBytes; },
    get pendingCount() { return pending.size; }, get queryLoading() { return queryLoading; },
    get matrix() { return matrix; }, get mode() { return appliedMode; }, get pairs() { return pairs; },
    get gridColor() { return chartGridColor; } };
 }
 return { create };
})();
