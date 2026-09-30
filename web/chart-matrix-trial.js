'use strict';

// Isolated integration trial: the production app and its PNG renderer are untouched.
const ChartMatrixTrial = (() => {
  const $ = id => document.getElementById(id);
  const selected = new Set(), fixed = new Set();
  const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
  const timeFormat = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai', hour12: false, hour: '2-digit', minute: '2-digit'
  });
  let nodes = [], pairs = [], items = [], matrix = null, controller = null, generation = 0;
  let draftMode = 'stats', appliedMode = 'stats', pairMode = 'all', appliedPairMode = 'all';
  let draftDur = 10800, appliedDur = 10800, filter = 'all', unified = false, visibleMax = 1;
  let renderedFilter = 'all';
  let appliedSelection = [], appliedFixed = [];
  let cards = [], queryLoading = false, lastMetrics = new Map();
  const renderer = MatrixRenderer.create({ nodes: () => nodes, json });
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

  function clearWork(preserveCards = false, keepCharts = false) {
    renderer.reset(keepCharts);
    controller?.abort();
    if (!preserveCards) cards = [];
    matrix = null; pairs = []; items = [];
    if (!preserveCards) $('graphGrid').replaceChildren();
    $('chart-key').hidden = true;
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
    const handoff = !message && count > 0 ? QueryHandoff.encode({ nodes: selection,
      fixed: fixedIds, dur: draftDur, mode: draftMode, filter, unified }) : '';
    $('pngBackLink').href = '/' + (handoff ? '?' + handoff : '');
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
  function restoreHandoff() {
    const state = QueryHandoff.decode(window.location.search, nodes.map(node => node.id));
    if (!state) return false;
    state.nodes.forEach(id => selected.add(id));
    state.fixed.forEach(id => fixed.add(id));
    pairMode = state.fixed.length ? 'fixed' : 'all';
    draftMode = state.mode;
    draftDur = state.dur;
    filter = state.filter;
    unified = state.unified;
    $('durSelect').value = String(state.dur);
    $('unifiedAxisToggle').checked = state.unified;
    document.querySelectorAll('[data-filter]').forEach(button => {
      const on = button.dataset.filter === filter;
      button.classList.toggle('on', on); button.setAttribute('aria-pressed', String(on));
    });
    renderNodes();
    syncSegment($('filterPills'));
    return true;
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
    renderer.suspend(appliedMode === 'charts');
    const grid = $('graphGrid');
    grid.classList.toggle('stats-only', appliedMode === 'stats');
    const list = orderedIndexes(pairs.map((pair, index) => matches(pair) ? index : -1).filter(index => index >= 0));
    visibleMax = Math.max(1, ...list.map(index => items[index]?.summary?.max_median_ms || 0)) * 1.1;
    const previous = cards;
    const stableOrder = list.length > 0 && grid.childElementCount === list.length &&
      list.every((index, position) => grid.children[position] === previous[index]);
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
          (appliedMode === 'charts' ? '<div class="card-img trial-plot" role="button" tabindex="0" title="Open interval data" aria-haspopup="dialog" aria-label="View RTT and loss interval data: ' +
            escapeHtml((pair.srcLabel || label(pair.source)) + ' to ' + (pair.tgtLabel || label(pair.target)) +
              ' ' + pair.type + (pair.ext ? ' external' : '')) + '"></div>' : '') +
          '</div>';
      }
      const stats = statsFor(index);
      UIComponents.updateStats(card.querySelector('.stats'), stats);
      const before = pulse && lastMetrics.get(identity(pair) + '|' + appliedMode);
      if (before && stats) pulseByIndex.set(index, {
        current: Number.isFinite(stats.current_ms) && stats.current_ms !== before.current_ms,
        loss: Number.isFinite(stats.loss_pct) && stats.loss_pct > 0 && stats.loss_pct !== before.loss_pct
      });
      const lossItem = card.querySelector('[data-metric="4"]');
      if (lossItem) lossItem.style.setProperty('--trial-loss-current', lossColor(stats?.loss_pct, palette) || 'var(--text-sec)');
      const error = items[index]?.error;
      card.classList.toggle('is-error', !!error);
      if (appliedMode === 'charts') {
        const plot = card.querySelector('.trial-plot');
        plot.setAttribute('aria-disabled', String(!!error));
        plot.removeAttribute('aria-busy');
        plot.classList.toggle('problem', !!error);
        if (error) plot.textContent = 'No chart: ' + error + '. Submit again to retry.';
        else if (plot.textContent) plot.replaceChildren();
      }
      cards[index] = card;
      if (!stableOrder) fragment.append(card);
    }
    if (!list.length) {
      const empty = document.createElement('div'); empty.className = 'empty no-matches';
      empty.innerHTML = '<div class="empty-title">No matches</div>';
      fragment.append(empty);
    }
    if (!stableOrder) grid.replaceChildren(fragment);
    renderedFilter = filter;
    $('emptyState').hidden = true;
    $('chart-key').hidden = appliedMode !== 'charts' || !list.length;
    if (appliedMode === 'charts') renderer.mount(matrix, cards, { unified, enter, pulse: pulseByIndex });
    updateFreshness();
    if (appliedMode !== 'charts') renderer.animateVisibleCards(enter, pulseByIndex);
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
    renderer.closeIntervalData();
    // Keep the previous matrix visible while the next query is in flight.
    controller?.abort();
    renderer.pause();
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
      const preserveCards = appliedMode === mode && pairs.length === loaded.pairs.length &&
        pairs.every((pair, index) => identity(pair) === identity(loaded.pairs[index]));
      clearWork(preserveCards, mode === 'charts'); queryLoading = false;
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
        else if (matrix) renderer.resume();
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
    updateControls();
    if (pairs.length && !queryLoading) renderCards({ enter: true });
  });
  $('unifiedAxisToggle').addEventListener('change', () => {
    unified = $('unifiedAxisToggle').checked;
    updateControls();
    if (matrix) renderer.setUnified(unified);
  });
  $('goBtn').addEventListener('click', submit);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    if (queryLoading) status('Query paused while hidden. Previous results remain visible; submit again.');
    controller?.abort(); generation++; queryLoading = false;
    if (pairs.length && renderedFilter !== filter) renderCards();
  });
  window.addEventListener('pagehide', () => {
    queryLoading = false; controller?.abort(); generation++;
  });
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
    if (restoreHandoff()) status('Selection restored; click Show Charts or Show Results. No query has run yet.');
    else { renderNodes(); status('Select nodes and submit. No matrix has been requested.'); }
  }).catch(error => {
    $('sidebarInner').innerHTML = '<div class="empty"><div class="empty-title">Node list unavailable</div></div>';
    status('Node list failed: ' + error.message);
  });
  return { get instanceCount() { return renderer.instanceCount; }, get pooledCount() { return renderer.pooledCount; },
    get chartAllocations() { return renderer.chartAllocations; }, get backingPixels() { return renderer.backingPixels; },
    get cacheCount() { return renderer.cacheCount; }, get cacheBytes() { return renderer.cacheBytes; },
    get pendingCount() { return renderer.pendingCount; }, get queryLoading() { return queryLoading; },
    get matrix() { return matrix; }, get mode() { return appliedMode; }, get pairs() { return pairs; },
    get gridColor() { return renderer.gridColor; } };
})();
