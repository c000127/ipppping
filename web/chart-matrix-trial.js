'use strict';

// Isolated integration trial: the production app and its PNG renderer are untouched.
const ChartMatrixTrial = (() => {
  const $ = id => document.getElementById(id);
  const selected = new Set(), fixed = new Set();
  const seriesPool = new RequestState.Pool(2);
  const MAX_ACTIVE = 4, MAX_CACHE_COUNT = 8, MAX_CACHE_BYTES = 2 * 1024 * 1024;
  const MAX_PIXELS_PER_CHART = 1280 * 220 * 4;
  const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
  const timeFormat = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai', hour12: false, hour: '2-digit', minute: '2-digit'
  });
  let nodes = [], pairs = [], items = [], matrix = null, controller = null, generation = 0, frame = 0, observer;
  let draftMode = 'stats', appliedMode = 'stats', pairMode = 'all', appliedPairMode = 'all';
  let draftDur = 10800, appliedDur = 10800, filter = 'all', unified = false, visibleMax = 1;
  let renderedFilter = 'all';
  let appliedSelection = [], appliedFixed = [];
  let cards = [], active = new Map(), pending = new Map(), near = new Set(), wanted = new Set();
  let seriesCache = new Map(), cacheBytes = 0;
  let chartGridColor = null;
  let motionFrame = 0, queryLoading = false, lastMetrics = new Map();
  const motionAnimations = new Set(), revealedRoutes = new Set();
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
  const lossPalette = () => {
    const theme = getComputedStyle(document.body);
    return ['low', 'mid', 'high'].map(step => theme.getPropertyValue('--trial-loss-' + step).trim());
  };
  function lossColor(value, palette) {
    if (!Number.isFinite(value) || value <= 0) return '';
    const amount = Math.min(value, 100) / 50;
    const [start, end, fraction] = amount <= 1
      ? [palette[0], palette[1], amount] : [palette[1], palette[2], amount - 1];
    const channel = offset => Math.round(parseInt(start.slice(offset, offset + 2), 16) * (1 - fraction) +
      parseInt(end.slice(offset, offset + 2), 16) * fraction);
    return `rgb(${channel(1)}, ${channel(3)}, ${channel(5)})`;
  }
  const label = id => nodes.find(node => node.id === id)?.label || id;
  const identity = MatrixData.identity;
  const timestamp = stamp => new Date(stamp * 1000).toLocaleString('en-GB', {
    timeZone: 'Asia/Shanghai', hour12: false
  });
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
    const done = () => motionAnimations.delete(animation);
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
    const main = $('mainArea'), bounds = main.getBoundingClientRect(), found = new Set();
    const xs = [bounds.left + bounds.width * .25, bounds.left + bounds.width * .75];
    for (let y = bounds.top + 24; y < bounds.bottom - 12 && found.size < 6; y += 85) {
      for (const x of xs) {
        const card = document.elementFromPoint(x, y)?.closest('.card');
        if (card && $('graphGrid').contains(card)) found.add(card);
      }
    }
    return [...found];
  }
  function animateVisibleCards(enter, pulseByIndex) {
    if (UIComponents.reducedMotion() || (!enter && !pulseByIndex.size)) return;
    motionFrame = requestAnimationFrame(() => {
      motionFrame = 0;
      if (document.hidden || $('mainArea').inert) return;
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
    cards[index]?.querySelectorAll('.trial-reveal').forEach(cover => {
      cover.getAnimations().forEach(animation => animation.cancel());
    });
    active.get(index)?.destroy();
    active.delete(index);
    cards[index]?.querySelector('.trial-plot')?.replaceChildren();
  }
  function clearWork() {
    stopMotion(); revealedRoutes.clear();
    controller?.abort();
    for (const item of pending.values()) item.abort();
    pending.clear();
    for (const index of [...active.keys()]) dispose(index);
    observer?.disconnect(); near.clear(); wanted.clear();
    seriesCache.clear(); cacheBytes = 0;
    cards = []; matrix = null; pairs = []; items = [];
    $('graphGrid').replaceChildren(); $('chart-key').hidden = true;
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
      ctx.fillStyle = markColor;
      ctx.globalAlpha = .65;
      for (const run of lossRuns) {
        const left = xStart(run.start), right = xEnd(run.end), y = yLoss(run.mean);
        if (right > left && y < bottom) ctx.fillRect(left, y, right - left, bottom - y);
      }
      for (const event of lossPeaks) {
        const left = xStart(event.start), right = xEnd(event.end);
        const high = yLoss(event.peak), low = yLoss(event.from);
        if (right <= left || high >= low) continue;
        const width = Math.min(Math.ceil(3 * px), right - left);
        const x = Math.floor((left + right - width) / 2);
        ctx.fillRect(x, high, width, low - high);
      }
      ctx.restore();
    };
    plot.replaceChildren();
    const chart = new uPlot({ width, height: 220, legend: { show: false }, select: { show: false },
      cursor: { show: false }, dom: { over: false, under: false },
      scales: { x: { time: false, range: () => [matrix.end - matrix.dur, matrix.end] },
        y: { range: () => [0, maximum] }, loss: { range: () => [0, 100] } },
      series: [{}, { label: 'Mean median ms', stroke: color('--trial-rtt'), width: 2, spanGaps: false, points: { show: false } },
        { label: 'Max loss %', scale: 'loss', stroke: markColor, paths: () => null, points: { show: false } }],
      axes: [{ ...axis, size: 28, space: 76, grid: { show: false },
        values: (u, ticks) => ticks.map(t => new Date(t * 1000).toLocaleTimeString('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false })) },
        { ...axis, size: 48, labelSize: 18, label: 'RTT ms', labelFont: font,
          grid: { stroke: chartGridColor, width: 1 } },
        { ...axis, scale: 'loss', side: 1, size: 34, labelSize: 18, label: 'Loss %',
          labelFont: font, stroke: markColor, grid: { show: false } }],
      hooks: { draw: [marks] }
    }, [c.end.map((stamp, i) => (c.start[i] + stamp) / 2), c.median_mean_ms,
      c.loss_max_pct.map(value => value > 0 ? value : null)], plot);
    chart.root.setAttribute('aria-hidden', 'true');
    active.set(index, chart);
    revealPlot(chart, index);
  }
  async function loadVisible(index) {
    if (active.has(index) || pending.has(index) || matrix?.items[index].error || !matrix) return;
    const available = cached(index);
    if (available) {
      try { draw(index, available); }
      catch (error) { cards[index].querySelector('.trial-plot').textContent = error.message; }
      return;
    }
    const local = new AbortController(), token = generation;
    pending.set(index, local);
    const plot = cards[index].querySelector('.trial-plot');
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
    if (queryLoading) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!matrix || document.hidden) return;
      const viewport = $('mainArea').getBoundingClientRect();
      const center = (viewport.top + viewport.bottom) / 2;
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
    }, { root: $('mainArea'), rootMargin: '300px 0px' });
    cards.forEach(card => { if (card) observer.observe(card); });
  }
  function status(message) { $('trialStatus').textContent = message; }
  function chosen() { return nodes.filter(node => selected.has(node.id)).map(node => node.id); }
  function anchors(selection = chosen()) {
    return pairMode === 'fixed' ? selection.filter(id => fixed.has(id)) : [];
  }
  function selectionEqual(a, b) {
    return a.length === b.length && a.every((id, index) => id === b[index]);
  }
  function preview(selection, fixedIds) {
    if (selection.length > 20) throw new Error('Select no more than 20 nodes');
    const marked = new Set(fixedIds);
    let count = 0;
    for (let i = 0; i < selection.length; i++) for (let j = i + 1; j < selection.length; j++) {
      const a = nodes.find(node => node.id === selection[i]);
      const b = nodes.find(node => node.id === selection[j]);
      if (fixedIds.length && marked.has(a.id) === marked.has(b.id)) continue;
      if (a.group === 'dns' && b.group === 'dns') continue;
      const directions = a.group === 'dns' || b.group === 'dns' ? 1 : 2;
      count += directions * (Number(!!a.v4 && !!b.v4) + Number(!!a.v6 && !!b.v6));
    }
    if (count > 500) throw new Error('Selection produces too many graphs');
    return count;
  }
  function updateFreshness() {
    const pending = $('goBtn').dataset.pending === 'true';
    if (pending) { $('selFreshness').textContent = 'Unapplied changes'; return; }
    let latest = 0;
    pairs.forEach((pair, index) => {
      if (!matches(pair)) return;
      const stamp = appliedMode === 'charts'
        ? items[index]?.current?.measurement_updated_at
        : items[index]?.stats?.measurement_updated_at;
      if (Number.isFinite(stamp) && stamp > latest && stamp <= Date.now() / 1000 + 60) latest = stamp;
    });
    $('selFreshness').textContent = latest ? 'Updated ' + timeFormat.format(new Date(latest * 1000)) : 'No update yet';
  }
  function updateControls() {
    const selection = chosen(), fixedIds = anchors(selection);
    $('sidebar').classList.toggle('pairing-fixed-mode', pairMode === 'fixed');
    document.querySelectorAll('.node[data-node-id]').forEach(row => {
      const id = row.dataset.nodeId, on = selected.has(id), isFixed = on && pairMode === 'fixed' && fixed.has(id);
      const button = row.querySelector('.node-anchor');
      const previous = row.getAttribute('data-anchor');
      row.classList.toggle('on', on);
      row.classList.toggle('selection-anchorable', on);
      row.classList.toggle('anchor-on', isFixed);
      row.querySelector('.node-cb').checked = on;
      button.disabled = !on;
      button.textContent = isFixed ? 'Fixed' : 'Fix';
      button.setAttribute('aria-pressed', String(isFixed));
      button.setAttribute('aria-label', (isFixed ? 'Remove ' : 'Use ') + label(id) + (isFixed ? ' from fixed nodes' : ' as a fixed node'));
      if (previous !== null && previous !== String(isFixed) && on && pairMode === 'fixed' && !UIComponents.reducedMotion()) {
        const motion = isFixed ? 'fixed-node-selecting' : 'fixed-node-deselecting';
        button.classList.remove('fixed-node-selecting', 'fixed-node-deselecting');
        void button.offsetWidth;
        button.classList.add(motion);
        button.addEventListener('animationend', () => button.classList.remove(motion), { once: true });
      }
      row.setAttribute('data-anchor', String(isFixed));
    });
    document.querySelectorAll('[data-pair-mode]').forEach(button => {
      const on = button.dataset.pairMode === pairMode;
      button.classList.toggle('on', on); button.setAttribute('aria-pressed', String(on));
    });
    document.querySelectorAll('[data-mode]').forEach(button => {
      const on = button.dataset.mode === draftMode;
      button.classList.toggle('on', on); button.setAttribute('aria-pressed', String(on));
    });
    syncSegment($('pairMode')); syncSegment($('viewMode'));
    const axis = document.querySelector('.axis-option'), axisHidden = draftMode !== 'charts';
    axis.classList.toggle('is-hidden', axisHidden);
    axis.inert = axisHidden; axis.setAttribute('aria-hidden', String(axisHidden));
    let message = '', count = 0;
    if (selection.length < 2) message = 'Select at least 2 nodes';
    else if (pairMode === 'fixed' && !fixedIds.length) message = 'Choose a fixed node';
    else if (pairMode === 'fixed' && fixedIds.length === selection.length) message = 'Select a non-fixed node';
    else {
      try { count = preview(selection, fixedIds); }
      catch (error) { message = error.message; }
    }
    const go = $('goBtn');
    go.disabled = !!message;
    const pending = !selectionEqual(selection, appliedSelection) || !selectionEqual(fixedIds, appliedFixed) ||
      pairMode !== appliedPairMode || draftMode !== appliedMode || draftDur !== appliedDur;
    go.dataset.pending = String(pending); go.classList.toggle('pending', pending);
    go.textContent = 'Show ' + (draftMode === 'charts' ? 'Charts' : 'Results');
    const summary = '<b>' + selection.length + '</b> nodes' +
      (fixedIds.length ? ' · <b>' + fixedIds.length + '</b> fixed' : '') +
      (message ? ' · <span class="selection-error">' + escapeHtml(message) + '</span>' : ' · <b>' + count + '</b> results');
    if ($('selSummary').innerHTML !== summary) {
      $('selSummary').innerHTML = summary; UIComponents.flash($('selSummary'));
    }
    updateFreshness();
  }
  function renderNodes() {
    const container = $('sidebarInner');
    container.replaceChildren();
    for (const [group, heading] of [['vps', 'VPS Nodes'], ['dns', 'External Targets']]) {
      const list = nodes.filter(node => node.group === group);
      const section = document.createElement('div'); section.className = 'section';
      section.innerHTML = '<div class="section-head"><span class="section-label">' + heading +
        '</span><span class="section-num">' + list.length + '</span></div>';
      for (const node of list) {
        const row = document.createElement('div'); row.className = 'node';
        row.dataset.nodeId = node.id;
        const pick = document.createElement('label'); pick.className = 'node-select';
        const box = document.createElement('input'); box.type = 'checkbox'; box.className = 'node-cb';
        box.dataset.id = node.id; box.setAttribute('aria-label', 'Select ' + node.label);
        const name = document.createElement('span'); name.className = 'node-label'; name.textContent = node.label;
        const badges = document.createElement('span'); badges.className = 'node-protocols';
        for (const type of ['v4', 'v6']) if (node[type]) {
          const badge = document.createElement('span'); badge.className = 'node-meta badge badge-' + type;
          badge.textContent = type; badges.append(badge);
        }
        pick.append(box, name, badges);
        const anchor = document.createElement('button'); anchor.type = 'button'; anchor.className = 'node-anchor';
        anchor.dataset.anchorNode = node.id; anchor.textContent = 'Fix';
        row.append(pick, anchor); section.append(row);
      }
      container.append(section);
    }
    updateControls();
  }
  function matches(pair) {
    return filter === 'all' || filter === 'ext' && pair.ext || filter === pair.type;
  }
  function orderedIndexes(list) {
    const columns = getComputedStyle($('graphGrid')).gridTemplateColumns.trim().split(/\s+/).filter(Boolean).length;
    if (columns >= 2) return list;
    const groups = new Map();
    list.forEach(index => {
      const key = pairs[index].pairKey || 'single_' + index;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(index);
    });
    return [...groups.values()].flatMap(group => {
      if (group.length !== 4 || group.some(index => pairs[index].ext)) return group;
      return ['v4_0', 'v4_1', 'v6_0', 'v6_1'].map(key =>
        group.find(index => pairs[index].type + '_' + pairs[index].direction === key)).filter(index => index !== undefined);
    });
  }
  function statsFor(index) {
    if (appliedMode === 'stats') return items[index]?.stats || null;
    const item = items[index];
    if (!item || item.error) return null;
    return { current_ms: item.current?.current_ms, avg_ms: item.summary.average_ms,
      min_ms: item.summary.min_median_ms, max_ms: item.summary.max_median_ms,
      loss_pct: item.summary.loss_pct };
  }
  function renderCards({ enter = false, pulse = false } = {}) {
    stopMotion();
    for (const index of [...active.keys()]) dispose(index);
    for (const item of pending.values()) item.abort();
    pending.clear(); observer?.disconnect(); near.clear(); wanted.clear();
    cancelAnimationFrame(frame); frame = 0;
    const grid = $('graphGrid');
    grid.classList.toggle('stats-only', appliedMode === 'stats');
    const list = orderedIndexes(pairs.map((pair, index) => matches(pair) ? index : -1).filter(index => index >= 0));
    visibleMax = Math.max(1, ...list.map(index => items[index]?.summary?.max_median_ms || 0)) * 1.1;
    const previous = cards;
    const palette = lossPalette();
    const pulseByIndex = new Map();
    cards = [];
    const fragment = document.createDocumentFragment();
    for (const index of list) {
      const pair = pairs[index];
      let card = previous[index];
      if (!card) {
        card = document.createElement('article');
        card.className = 'card'; card.dataset.index = String(index);
        card.dataset.cardKey = identity(pair);
        const badges = (pair.ext ? '<span class="badge badge-ext">Ext</span>' : '') +
          '<span class="badge badge-' + pair.type + '">' + pair.type + '</span>';
        card.innerHTML = '<div class="card-content"><div class="card-head"><div class="route">' +
          '<span class="route-badges">' + badges + '</span>' +
          '<span class="route-node route-source">' + escapeHtml(pair.srcLabel || label(pair.source)) + '</span>' +
          '<span class="route-arrow" aria-hidden="true"><span class="route-arrow-inline">→</span><span class="route-arrow-down">↓</span></span>' +
          '<span class="route-node route-target">' + escapeHtml(pair.tgtLabel || label(pair.target)) + '</span>' +
          '</div><div class="card-right"><div class="stats"></div></div></div>' +
          (appliedMode === 'charts' ? '<div class="card-img trial-plot" role="img" aria-label="Latency line, intervals with loss in every bucket, and peak-loss marks"></div>' : '') +
          '</div>';
        const stats = statsFor(index);
        UIComponents.updateStats(card.querySelector('.stats'), stats);
        const before = pulse && lastMetrics.get(identity(pair) + '|' + appliedMode);
        if (before && stats) pulseByIndex.set(index, {
          current: Number.isFinite(stats.current_ms) && stats.current_ms !== before.current_ms,
          loss: Number.isFinite(stats.loss_pct) && stats.loss_pct > 0 && stats.loss_pct !== before.loss_pct
        });
        const loss = stats?.loss_pct;
        const lossItem = card.querySelector('[data-metric="4"]');
        if (lossItem) lossItem.style.setProperty('--trial-loss-current', lossColor(loss, palette) || 'var(--text-sec)');
        if (items[index]?.error) card.classList.add('is-error');
        if (appliedMode === 'charts' && items[index]?.error) {
          const plot = card.querySelector('.trial-plot');
          plot.classList.add('problem'); plot.textContent = 'No chart: ' + items[index].error + '. Submit again to retry.';
        }
      }
      cards[index] = card; fragment.append(card);
    }
    if (!list.length) {
      const empty = document.createElement('div'); empty.className = 'empty no-matches';
      empty.innerHTML = '<div class="empty-title">No matches</div>';
      fragment.append(empty);
    }
    grid.replaceChildren(fragment);
    renderedFilter = filter;
    $('emptyState').hidden = true;
    $('chart-key').hidden = appliedMode !== 'charts' || !list.length;
    if (appliedMode === 'charts') observe();
    updateFreshness();
    animateVisibleCards(enter, pulseByIndex);
  }
  async function loadResults(selection, fixedIds, dur, signal) {
    const params = new URLSearchParams({ nodes: selection.join(','), anchor: fixedIds.join(',') });
    const routeList = await json('/api/pairs?' + params, signal);
    if (!Array.isArray(routeList) || routeList.length > 500) throw new Error('Invalid pair list');
    const batch = await json('/api/stats-batch.json?' + new URLSearchParams({
      nodes: selection.join(','), anchor: fixedIds.join(','), dur: String(dur),
      w: '900', h: '320', state: 'p1'
    }), signal);
    if (!Array.isArray(batch?.items) || batch.items.length !== routeList.length ||
        batch.items.some((item, index) => identity(item) !== identity(routeList[index])))
      throw new Error('Results batch and pair list disagree');
    return { pairs: routeList, items: batch.items };
  }
  async function submit() {
    if ($('goBtn').disabled) return;
    // Keep the previous matrix visible while the next query is in flight.
    controller?.abort();
    for (const item of pending.values()) item.abort();
    pending.clear(); observer?.disconnect(); near.clear(); wanted.clear();
    queryLoading = true;
    controller = new AbortController();
    const token = ++generation, selection = chosen(), fixedIds = anchors(selection);
    const mode = draftMode, dur = draftDur, pairing = pairMode;
    status(mode === 'charts' ? 'Building frozen summary…' : 'Loading Results…');
    updateControls();
    try {
      const loaded = mode === 'charts'
        ? await MatrixData.load(selection, fixedIds, dur, null, json, controller.signal,
          (done, total) => { if (token === generation) status('Summaries ' + done + '/' + total + '; charts wait for all pages.'); })
        : await loadResults(selection, fixedIds, dur, controller.signal);
      if (token !== generation) return;
      clearWork(); queryLoading = false;
      pairs = loaded.pairs; items = loaded.items;
      appliedSelection = selection; appliedFixed = fixedIds; appliedPairMode = pairing;
      appliedMode = mode; appliedDur = dur; matrix = mode === 'charts' ? loaded : null;
      renderCards({ enter: true, pulse: true });
      lastMetrics = new Map(pairs.map((pair, index) =>
        [identity(pair) + '|' + appliedMode, statsFor(index)]));
      updateControls();
      const scope = mode === 'charts'
        ? 'Frozen window ' + timestamp(loaded.end - dur) + ' – ' + timestamp(loaded.end) + ' UTC+08:00.'
        : 'Live statistics from the production Results API.';
      status('Ready: ' + pairs.length + ' routes. ' + scope +
        (mode === 'charts' ? ' At most 4 visible charts and 2 series requests.' : ''));
      sidebarUI.closeMobile();
    } catch (error) {
      if (token === generation) {
        queryLoading = false;
        if (error.name !== 'AbortError') status('Query failed: ' + error.message +
          (pairs.length ? ' Previous results remain visible.' : ''));
        if (pairs.length && renderedFilter !== filter) renderCards();
        else if (matrix) observe();
      }
    }
  }
  const sidebarUI = UIComponents.sidebarController();
  $('sidebarInner').addEventListener('change', event => {
    const box = event.target.closest('.node-cb');
    if (!box) return;
    box.checked ? selected.add(box.dataset.id) : selected.delete(box.dataset.id);
    if (!box.checked) fixed.delete(box.dataset.id);
    updateControls();
  });
  $('sidebarInner').addEventListener('click', event => {
    const button = event.target.closest('[data-anchor-node]');
    if (!button || pairMode !== 'fixed' || !selected.has(button.dataset.anchorNode)) return;
    fixed.has(button.dataset.anchorNode) ? fixed.delete(button.dataset.anchorNode) : fixed.add(button.dataset.anchorNode);
    updateControls();
  });
  $('pairMode').addEventListener('click', event => {
    const mode = event.target.closest('[data-pair-mode]')?.dataset.pairMode;
    if (!mode) return;
    pairMode = mode;
    if (mode === 'all') fixed.clear();
    updateControls();
  });
  $('viewMode').addEventListener('click', event => {
    const mode = event.target.closest('[data-mode]')?.dataset.mode;
    if (!mode) return;
    draftMode = mode; updateControls();
  });
  $('durSelect').addEventListener('change', () => { draftDur = Number($('durSelect').value); updateControls(); });
  $('filterPills').addEventListener('click', event => {
    const value = event.target.closest('[data-filter]')?.dataset.filter;
    if (!value) return;
    filter = value;
    document.querySelectorAll('[data-filter]').forEach(button => {
      const on = button.dataset.filter === filter;
      button.classList.toggle('on', on); button.setAttribute('aria-pressed', String(on));
    });
    syncSegment($('filterPills'));
    if (pairs.length && !queryLoading) renderCards({ enter: true });
    else updateFreshness();
  });
  $('unifiedAxisToggle').addEventListener('change', () => {
    unified = $('unifiedAxisToggle').checked;
    if (matrix) {
      for (const index of [...active.keys()]) dispose(index);
      scheduleVisible();
    }
  });
  $('goBtn').addEventListener('click', submit);
  $('mainArea').addEventListener('scroll', scheduleVisible, { passive: true });
  const resize = new ResizeObserver(() => {
    if (queryLoading || !matrix || !active.size) return;
    for (const index of [...active.keys()]) dispose(index);
    scheduleVisible();
  });
  resize.observe($('mainArea'));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (queryLoading) status('Query paused while hidden. Previous results remain visible; submit again.');
      controller?.abort(); generation++; queryLoading = false;
      for (const item of pending.values()) item.abort();
      for (const index of [...active.keys()]) dispose(index);
      if (pairs.length && renderedFilter !== filter) renderCards();
      if (!matrix && !pairs.length) status('Paused while hidden. Submit again to load measurements.');
    } else if (matrix) observe();
  });
  window.addEventListener('pagehide', () => {
    stopMotion();
    queryLoading = false;
    controller?.abort(); generation++;
    for (const item of pending.values()) item.abort();
    for (const index of [...active.keys()]) dispose(index);
    observer?.disconnect(); near.clear(); wanted.clear(); cancelAnimationFrame(frame);
  });
  window.addEventListener('pageshow', event => { if (event.persisted && matrix) observe(); });
  const tick = () => {
    $('clock').textContent = timeFormat.format(new Date());
    setTimeout(tick, 30000);
  };
  tick();
  for (const group of [$('filterPills'), $('pairMode'), $('viewMode')]) {
    const indicator = document.createElement('span');
    indicator.className = 'segment-indicator'; indicator.setAttribute('aria-hidden', 'true');
    group.prepend(indicator);
  }
  const segmentResize = new ResizeObserver(entries => entries.forEach(entry => syncSegment(entry.target)));
  for (const group of [$('filterPills'), $('pairMode'), $('viewMode')]) segmentResize.observe(group);
  updateControls();
  syncSegment($('filterPills'));
  json('/api/nodes').then(data => {
    if (!Array.isArray(data)) throw new Error('Invalid node list');
    nodes = [...data].sort((a, b) => collator.compare(a.label, b.label));
    renderNodes(); status('Select nodes and submit. No matrix has been requested.');
  }).catch(error => {
    $('sidebarInner').innerHTML = '<div class="empty"><div class="empty-title">Node list unavailable</div></div>';
    status('Node list failed: ' + error.message);
  });
  return { get instanceCount() { return active.size; }, get cacheCount() { return seriesCache.size; },
    get cacheBytes() { return cacheBytes; }, get pendingCount() { return pending.size; },
    get queryLoading() { return queryLoading; },
    get matrix() { return matrix; }, get mode() { return appliedMode; }, get pairs() { return pairs; },
    get gridColor() { return chartGridColor; } };
})();
