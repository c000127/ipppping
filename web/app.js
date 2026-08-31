'use strict';

let nodes = [];
let currentPairs = [];
let draftSelection = [];
let appliedSelection = [];
let statsCache = {};
let statsCacheTimes = {};
let activeFilter = 'all';
let sidebarOpen = true;
let selectedDuration = '10800';
let draftDuration = '10800';
let appliedViewMode = 'stats';
let draftViewMode = 'stats';
let pairGroupRanges = {}; // groupKey -> {ymin, ymax} per node-pair+type
let unifiedYAxisEnabled = false;
let unifiedChartRange = null;
let renderGeneration = 0;
let activeController = null;
let batchLoadingGeneration = -1;
let statsSnapshotPromise = null;
let statsSnapshotDuration = null;
let statsSnapshotController = null;
let routeFitFrame = 0;
let routeFitObservedWidth = 0;
let suppressStatsAnimationGeneration = -1;
let chartRefreshToken = 'initial';
const isMobile = () => window.innerWidth <= 768;
const REQUEST_TIMEOUT_MS = 15000;
const MAX_STATS_CONCURRENT = 6;
const CLIENT_STATS_TTL_MS = 60000;
const STORED_STATS_TTL_MS = 300000;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

function requestUrl(path, params) {
  const query = new URLSearchParams(params);
  return `${path}?${query}`;
}

async function fetchJson(url, signal, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const abort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', abort, { once: true });
  }
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  } catch (error) {
    if (timedOut) throw new Error('Request timed out');
    throw error;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', abort);
  }
}

async function mapWithConcurrency(items, worker, signal, limit = MAX_STATS_CONCURRENT) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (!signal?.aborted) {
      const index = next++;
      if (index >= items.length) return;
      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        if (error.name !== 'AbortError') results[index] = null;
      }
    }
  }
  const workers = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workers }, run));
  return results;
}

// Sidebar toggle
function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  const ov = document.getElementById('overlay');
  if (isMobile()) {
    const open = sb.classList.toggle('mobile-open');
    sb.classList.remove('collapsed');
    ov.classList.toggle('show', open);
  } else {
    sidebarOpen = !sidebarOpen;
    sb.classList.toggle('collapsed', !sidebarOpen);
  }
}
if (isMobile()) {
  document.getElementById('sidebar').classList.remove('mobile-open');
}

// Clock
function tick() {
  const d = new Date();
  document.getElementById('clock').textContent =
    d.toLocaleTimeString('en-GB', { timeZone: 'Asia/Shanghai', hour12: false }) + ' CST';
}
tick(); setInterval(tick, 1000);

// Toast
function toast(msg, err) {
  const b = document.getElementById('toastBox');
  const t = document.createElement('div');
  t.className = 'toast' + (err ? ' err' : '');
  t.textContent = msg;
  b.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// Load nodes
document.getElementById('toggleSidebar').addEventListener('click', toggleSidebar);
document.getElementById('overlay').addEventListener('click', toggleSidebar);
document.getElementById('goBtn').addEventListener('click', showGraphs);
document.getElementById('viewMode').addEventListener('click', event => {
  const button = event.target.closest('[data-mode]');
  if (!button) return;
  setViewMode(button.dataset.mode);
});

function setViewMode(mode) {
  draftViewMode = mode;
  document.querySelectorAll('.view-mode-btn').forEach(button => {
    const active = button.dataset.mode === mode;
    button.classList.toggle('on', active);
    button.setAttribute('aria-pressed', String(active));
  });
  updSel();
}

function chartsEnabled() {
  return appliedViewMode === 'charts';
}

const DURATION_OPTIONS = [
  { value: '3600', short: '1h' },
  { value: '10800', short: '3h' },
  { value: '21600', short: '6h' },
  { value: '86400', short: '24h' },
];

function durationLabel() {
  return DURATION_OPTIONS.find(option => option.value === selectedDuration)?.short || '3h';
}

function durationOptionsMarkup() {
  return DURATION_OPTIONS.map(option =>
    `<option value="${option.value}"${option.value === selectedDuration ? ' selected' : ''}>${option.short}</option>`
  ).join('');
}

document.addEventListener('change', event => {
  if (event.target.id === 'durSelect') changeDuration(event.target.value);
  if (event.target.id === 'unifiedAxisToggle') setUnifiedYAxis(event.target.checked);
});

document.addEventListener('click', event => {
  const node = event.target.closest('.node[data-node-id]');
  if (node) return tog(node.dataset.nodeId);
  if (event.target.closest('[data-retry-nodes]')) return loadNodes();
  const group = event.target.closest('[data-select-group]');
  if (group) return selGrp(group.dataset.selectGroup, Number(group.dataset.selectValue));
  const filter = event.target.closest('.pill[data-filter]');
  if (filter) return setFilter(filter.dataset.filter);
  const retry = event.target.closest('.retry-btn[data-retry-id]');
  if (retry) return retryImage(retry.dataset.retryId);
});

document.addEventListener('keydown', event => {
  const node = event.target.closest('.node[data-node-id]');
  if (node && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault();
    tog(node.dataset.nodeId);
  }
});

function renderNodesLoading() {
  document.getElementById('sidebarInner').innerHTML = `
    <div class="empty nodes-loading" role="status">
      <div class="spinner"></div>
      <div class="empty-sub">Loading nodes…</div>
    </div>`;
}

function renderNodesError() {
  document.getElementById('sidebarInner').innerHTML = `
    <div class="empty nodes-error" role="alert">
      <div class="empty-title">Unable to load nodes</div>
      <div class="empty-sub">The node list could not be retrieved.</div>
      <button class="retry-btn" data-retry-nodes>Retry</button>
    </div>`;
}

async function loadNodes() {
  renderNodesLoading();
  try {
    const data = await fetchJson('/api/nodes');
    if (!Array.isArray(data)) throw new Error('invalid node response');
    nodes = data;
    renderSidebar();
    scheduleStatsSnapshot();
  } catch (error) {
    renderNodesError();
    toast('Failed to load nodes', true);
  }
}

restoreStoredStats(selectedDuration);
loadNodes();

function renderSidebar() {
  const vps = nodes.filter(n => n.group === 'vps');
  const dns = nodes.filter(n => n.group === 'dns');
  let h = '';
  h += `<div class="section">
    <div class="section-head">
      <span class="section-label">VPS Nodes</span>
      <span class="section-num">${vps.length}</span>
    </div>`;
  vps.forEach(n => { h += nodeRow(n); });
  h += '</div>';
  h += `<div class="section">
    <div class="section-head">
      <span class="section-label">External Targets</span>
      <span class="section-num">${dns.length}</span>
    </div>`;
  dns.forEach(n => { h += nodeRow(n); });
  h += '</div>';
  document.getElementById('sidebarInner').innerHTML = h;
}

function nodeRow(n) {
  let meta = '';
  if (n.group === 'vps') {
    const protocols = ['<span class="node-meta badge badge-v4">v4</span>'];
    if (n.v6) protocols.push('<span class="node-meta badge badge-v6">v6</span>');
    meta = `<span class="node-protocols">${protocols.join('')}</span>`;
  }
  const id = escapeHtml(n.id);
  const label = escapeHtml(n.label);
  return `<div class="node" id="n_${id}" data-node-id="${id}" tabindex="0" role="checkbox" aria-checked="false">
    <input type="checkbox" class="node-cb" id="c_${id}" data-id="${id}">
    <span class="node-label">${label}</span>
    ${meta}
  </div>`;
}

function tog(id) {
  const c = document.getElementById('c_' + id);
  c.checked = !c.checked;
  const row = document.getElementById('n_' + id);
  row.classList.toggle('on', c.checked);
  row.setAttribute('aria-checked', String(c.checked));
  draftSelection = readSidebarSelection();
  updSel();
}

function selGrp(g, v) {
  nodes.filter(n => n.group === g).forEach(n => {
    const c = document.getElementById('c_' + n.id);
    if (c) {
      c.checked = !!v;
      const row = document.getElementById('n_' + n.id);
      row.classList.toggle('on', !!v);
      row.setAttribute('aria-checked', String(!!v));
    }
  });
  draftSelection = readSidebarSelection();
  updSel();
}

function readSidebarSelection() {
  return Array.from(document.querySelectorAll('.node-cb:checked')).map(c => c.dataset.id);
}

function getSel() {
  return draftSelection.slice();
}

function selectionEquals(left, right) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function updSel() {
  const s = getSel();
  let pairs = 0;
  let message = '';
  try {
    pairs = makePairs(s).length;
  } catch (error) {
    message = error.message;
  }
  document.getElementById('goBtn').disabled = s.length < 2 || !!message;
  const pending = !selectionEquals(s, appliedSelection)
    || draftDuration !== selectedDuration
    || draftViewMode !== appliedViewMode;
  const submit = document.getElementById('goBtn');
  submit.classList.toggle('pending', pending);
  submit.setAttribute('data-pending', String(pending));
  document.getElementById('selInfo').innerHTML = message
    ? `<span class="selection-error">${message}</span>`
    : s.length < 2
      ? 'Select at least 2 nodes'
      : `<b>${s.length}</b> nodes \u00b7 <b>${pairs}</b> results`;
}

function makePairs(sel) {
  if (sel.length > 20) throw new Error('Select no more than 20 nodes');
  const p = [];
  for (let i = 0; i < sel.length; i++) {
    for (let j = i + 1; j < sel.length; j++) {
      const a = sel[i], b = sel[j];
      const na = nodes.find(n => n.id === a), nb = nodes.find(n => n.id === b);
      if (!na || !nb) continue;
      if (na.group === 'dns' && nb.group === 'dns') continue;
      if (na.group === 'dns' || nb.group === 'dns') {
        const src = na.group === 'dns' ? b : a, tgt = na.group === 'dns' ? a : b;
        p.push({ source: src, target: tgt, type: 'v4',
          srcLabel: nodes.find(n=>n.id===src)?.label, tgtLabel: nodes.find(n=>n.id===tgt)?.label,
          ext: true, pairKey: [a, b].join('_'), direction: 0 });
      } else {
        [{s:a,t:b},{s:b,t:a}].forEach(x => {
          p.push({ source: x.s, target: x.t, type: 'v4',
            srcLabel: nodes.find(n=>n.id===x.s)?.label, tgtLabel: nodes.find(n=>n.id===x.t)?.label,
            ext: false, pairKey: [a, b].join('_'), direction: x.s === a ? 0 : 1 });
          if (na.v6 && nb.v6)
            p.push({ source: x.s, target: x.t, type: 'v6',
              srcLabel: nodes.find(n=>n.id===x.s)?.label, tgtLabel: nodes.find(n=>n.id===x.t)?.label,
              ext: false, pairKey: [a, b].join('_'), direction: x.s === a ? 0 : 1 });
        });
      }
    }
  }
  if (p.length > 500) throw new Error('Selection produces too many graphs');
  return p;
}

// Group key: sorted node pair + type (A<->B same group, v4/v6 separate)
function pairGroupKey(p) {
  const ids = [p.source, p.target].sort();
  return ids[0] + '_' + ids[1] + '_' + p.type + (p.ext ? '_ext' : '');
}

function orderPairsForLayout(list, singleColumn) {
  if (!singleColumn) return list;

  const groups = new Map();
  const groupOrder = [];
  list.forEach((pair, index) => {
    const key = pair.pairKey || `single_${index}`;
    if (!groups.has(key)) {
      groups.set(key, []);
      groupOrder.push(key);
    }
    groups.get(key).push(pair);
  });

  return groupOrder.flatMap(key => {
    const group = groups.get(key);
    if (group.length !== 4 || group.some(pair => pair.ext)) return group;
    const byOrder = new Map(group.map(pair => [`${pair.type}_${pair.direction}`, pair]));
    return ['v4_0', 'v4_1', 'v6_0', 'v6_1'].map(orderKey => byOrder.get(orderKey));
  });
}

// ── Concurrency-limited image loader with retry ──
const MAX_CONCURRENT = 4;
const IMAGE_LOAD_TIMEOUT_MS = 30000;
let loadQueue = [];
let activeLoads = 0;
let imageObserver = null;
const activeImageCancels = new Map();

function queueImageLoad(img, url, skelId, retries, generation) {
  loadQueue.push({
    img, url, skelId, retries: retries || 0, generation,
    sourceUrl: img.dataset.url
  });
  drainQueue();
}

function drainQueue() {
  while (activeLoads < MAX_CONCURRENT && loadQueue.length > 0) {
    const job = loadQueue.shift();
    activeLoads++;
    loadOneImage(job);
  }
}

function loadOneImage(job) {
  const img = job.img;
  const isCurrent = () => job.generation === renderGeneration
    && img.isConnected
    && img.dataset.url === job.sourceUrl;
  if (!isCurrent()) {
    activeLoads = Math.max(0, activeLoads - 1);
    drainQueue();
    return;
  }
  const skel = document.getElementById(job.skelId);
  const card = img.closest('.card');
  const retryButton = card && card.querySelector('.retry-btn[data-retry-id]');
  let settled = false;
  let timeoutId = 0;
  const release = () => {
    if (settled) return false;
    settled = true;
    clearTimeout(timeoutId);
    img.onload = null;
    img.onerror = null;
    if (activeImageCancels.get(img) === cancel) activeImageCancels.delete(img);
    activeLoads = Math.max(0, activeLoads - 1);
    drainQueue();
    return true;
  };
  const cancel = () => {
    if (settled) return;
    img.onload = null;
    img.onerror = null;
    img.removeAttribute('src');
    release();
  };
  activeImageCancels.set(img, cancel);
  img.onload = function() {
    if (!release() || !isCurrent()) return;
    img.classList.add('ok');
    if (card) card.classList.remove('failed', 'retrying');
    if (retryButton) {
      retryButton.disabled = false;
      retryButton.textContent = 'Retry';
    }
    if (skel) skel.classList.add('gone');
  };
  const retryOrFail = function() {
    if (!release() || !isCurrent()) return;
    if (job.retries < 2) {
      job.retries++;
      const retryUrl = new URL(job.sourceUrl, window.location.origin);
      retryUrl.searchParams.set('_retry', `${Date.now()}-${job.retries}`);
      job.url = `${retryUrl.pathname}${retryUrl.search}`;
      setTimeout(() => {
        if (!isCurrent()) return;
        loadQueue.unshift(job);
        drainQueue();
      }, 1000 * job.retries);
    } else {
      if (card) {
        card.classList.remove('retrying');
        card.classList.add('failed');
      }
      const status = card && card.querySelector('.card-status');
      if (status) status.querySelector('span').textContent = 'Graph unavailable. Check RRD data or retry.';
      if (retryButton) {
        retryButton.disabled = false;
        retryButton.textContent = 'Retry';
      }
      if (skel) { skel.style.animation = 'none'; skel.style.background = 'rgba(248,113,113,0.05)'; }
    }
  };
  img.onerror = retryOrFail;
  timeoutId = setTimeout(retryOrFail, IMAGE_LOAD_TIMEOUT_MS);
  img.src = job.url;
}

function cancelImageLoad(img) {
  activeImageCancels.get(img)?.();
  img.onload = null;
  img.onerror = null;
  img.removeAttribute('src');
}

function retryImage(imageId) {
  const img = document.getElementById(imageId);
  if (!img || !img.dataset.url) return;
  const card = img.closest('.card');
  if (!card || card.classList.contains('retrying')) return;
  card.classList.remove('failed');
  card.classList.add('retrying');
  const status = card.querySelector('.card-status');
  if (status) status.querySelector('span').textContent = 'Requesting a fresh graph...';
  const retryButton = card.querySelector('.retry-btn[data-retry-id]');
  if (retryButton) {
    retryButton.disabled = true;
    retryButton.textContent = 'Retrying...';
  }
  const skel = document.getElementById(img.dataset.skel);
  if (skel) { skel.classList.remove('gone'); skel.style.animation = ''; skel.style.background = ''; }
  img.classList.remove('ok');
  img.dataset.queued = '';
  const retryUrl = new URL(img.dataset.url, window.location.origin);
  retryUrl.searchParams.set('_retry', Date.now().toString());
  queueImageLoad(img, `${retryUrl.pathname}${retryUrl.search}`, img.dataset.skel, 0, renderGeneration);
}

function observeImages() {
  const images = Array.from(document.querySelectorAll('#graphGrid img[data-url]'));
  if (imageObserver) {
    imageObserver.disconnect();
    imageObserver = null;
  }
  const queue = img => {
    if (img.dataset.queued) return;
    img.dataset.queued = '1';
    queueImageLoad(img, img.dataset.url, img.dataset.skel, 0, renderGeneration);
  };
  if (!('IntersectionObserver' in window)) {
    images.forEach(queue);
    return;
  }
  imageObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        queue(entry.target);
        imageObserver?.unobserve(entry.target);
      }
    });
  }, { root: document.getElementById('mainArea'), rootMargin: '500px 0px' });
  images.forEach(img => imageObserver.observe(img));

  // Load the first visible batch immediately when switching from Results.
  images.slice(0, 8).forEach(queue);

  // Queue the visible range immediately; some embedded browsers delay the
  // first IntersectionObserver callback for a scrollable flex container.
  const root = document.getElementById('mainArea');
  const rootRect = root?.getBoundingClientRect();
  if (rootRect && rootRect.height > 0) {
    const preloadTop = rootRect.top - 500;
    const preloadBottom = rootRect.bottom + 500;
    images.forEach(img => {
      const rect = img.getBoundingClientRect();
      if (rect.bottom >= preloadTop && rect.top <= preloadBottom) queue(img);
    });
  }
}

// Compute per-group Y ranges from stats
function computeGroupRanges(pairs, dur) {
  const groups = {};
  pairs.forEach(p => {
    const gk = pairGroupKey(p);
    const key = `${p.source}_${p.target}_${p.type}_${dur}`;
    const st = statsCache[key];
    if (!st || !Number.isFinite(st.min_ms) || !Number.isFinite(st.max_ms)) return;
    if (!groups[gk]) groups[gk] = { min: Infinity, max: -Infinity };
    if (st.min_ms < groups[gk].min) groups[gk].min = st.min_ms;
    if (st.max_ms > groups[gk].max) groups[gk].max = st.max_ms;
  });
  const result = {};
  for (const gk in groups) {
    const g = groups[gk];
    if (g.min === Infinity || g.max === -Infinity) continue;
    const pad = (g.max - g.min) * 0.1 || g.max * 0.1;
    result[gk] = { ymin: Math.max(0, g.min - pad), ymax: g.max + pad };
  }
  return result;
}

function computeUnifiedRange(pairs, dur) {
  let min = Infinity;
  let max = -Infinity;
  pairs.forEach(pair => {
    const stats = statsCache[statsCacheKey(pair, dur)];
    if (!stats || !Number.isFinite(stats.min_ms) || !Number.isFinite(stats.max_ms)) return;
    min = Math.min(min, stats.min_ms);
    max = Math.max(max, stats.max_ms);
  });
  if (min === Infinity || max === -Infinity) return null;
  const pad = (max - min) * 0.1 || max * 0.1;
  return { ymin: Math.max(0, min - pad), ymax: max + pad };
}

function graphSizeParams() {
  if (!isMobile()) return { w: 900, h: 320 };
  return {
    w: Math.max(280, Math.min(900, window.innerWidth - 44)),
    h: 260
  };
}

function graphQueryFor(pair) {
  const graphSize = graphSizeParams();
  const query = {
    source: pair.source,
    target: pair.target,
    type: pair.type,
    dur: selectedDuration,
    theme: 'dark',
    w: graphSize.w,
    h: graphSize.h,
    refresh: chartRefreshToken
  };
  const range = unifiedYAxisEnabled ? unifiedChartRange : pairGroupRanges[pairGroupKey(pair)];
  if (range) {
    query.ymin = range.ymin.toFixed(4);
    query.ymax = range.ymax.toFixed(4);
  }
  return query;
}

function statsCacheKey(pair, dur = selectedDuration) {
  return `${pair.source}_${pair.target}_${pair.type}_${dur}`;
}

function statsItemKey(item) {
  return `${item.source}|${item.target}|${item.type}`;
}

function storedStatsKey(dur) {
  return `ipppping.stats.v2.${dur}`;
}

function cacheBatchItems(items, dur, cachedAt = Date.now()) {
  const outcomes = new Map();
  items.forEach(item => {
    const itemKey = statsItemKey(item);
    outcomes.set(itemKey, item.error || null);
    if (!item.stats) return;
    const key = `${item.source}_${item.target}_${item.type}_${dur}`;
    statsCache[key] = item.stats;
    statsCacheTimes[key] = cachedAt;
  });
  return outcomes;
}

function restoreStoredStats(dur) {
  try {
    const raw = sessionStorage.getItem(storedStatsKey(dur));
    if (!raw) return;
    const stored = JSON.parse(raw);
    if (!stored || !Array.isArray(stored.items) || Date.now() - stored.cachedAt > STORED_STATS_TTL_MS) return;
    cacheBatchItems(stored.items, dur, stored.cachedAt);
  } catch (_) {
    // Storage can be unavailable in hardened browsing modes; memory cache remains.
  }
}

function scheduleStatsSnapshot() {
  const run = () => { void prefetchStatsSnapshot(selectedDuration); };
  if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 800 });
  else setTimeout(run, 150);
}

function prefetchStatsSnapshot(dur) {
  if (nodes.length < 2) return Promise.resolve(null);
  if (statsSnapshotPromise && statsSnapshotDuration === dur) return statsSnapshotPromise;
  if (statsSnapshotController) statsSnapshotController.abort();
  statsSnapshotController = new AbortController();
  statsSnapshotDuration = dur;
  const controller = statsSnapshotController;
  const graphSize = graphSizeParams();
  const run = (async () => {
    try {
      const data = await fetchJson(requestUrl('/api/stats-batch.json', {
        nodes: nodes.map(node => node.id).join(','), dur, w: graphSize.w, h: graphSize.h
      }), controller.signal, 30000);
      if (!data || !Array.isArray(data.items)) return null;
      const cachedAt = Date.now();
      cacheBatchItems(data.items, dur, cachedAt);
      try {
        sessionStorage.setItem(storedStatsKey(dur), JSON.stringify({ cachedAt, items: data.items }));
      } catch (_) {
        // A full or disabled session store must not affect live monitoring.
      }
      return data;
    } catch (error) {
      if (error.name !== 'AbortError') return null;
      return null;
    } finally {
      if (statsSnapshotPromise === run) statsSnapshotPromise = null;
      if (statsSnapshotController === controller) statsSnapshotController = null;
    }
  })();
  statsSnapshotPromise = run;
  return run;
}

function primeCardsFromCache(pairs, dur, animate = true) {
  const now = Date.now();
  let allFresh = true;
  pairs.forEach(pair => {
    const key = statsCacheKey(pair, dur);
    const cached = statsCache[key];
    if (cached) showStat(statsIdFor(pair), cached, animate);
    else document.getElementById(statsIdFor(pair))?.classList.add('stats-pending');
    if (!cached || now - (statsCacheTimes[key] || 0) > CLIENT_STATS_TTL_MS) allFresh = false;
  });
  return allFresh;
}

function paintStatsCards(pairs, dur, generation, outcomes = new Map(), animate = true) {
  let index = 0;
  const paint = () => {
    if (generation !== renderGeneration) return;
    const end = Math.min(index + 12, pairs.length);
    for (; index < end; index++) {
      const pair = pairs[index];
      const key = statsCacheKey(pair, dur);
      if (statsCache[key]) showStat(statsIdFor(pair), statsCache[key], animate);
      else if (outcomes.has(statsItemKey(pair))) showStatError(statsIdFor(pair));
    }
    if (index < pairs.length) requestAnimationFrame(paint);
  };
  requestAnimationFrame(paint);
}

async function refreshStatsBatch(nodeIds, pairs, dur, generation, signal) {
  const animateStats = generation !== suppressStatsAnimationGeneration;
  if (primeCardsFromCache(pairs, dur, animateStats)) {
    batchLoadingGeneration = -1;
    pairGroupRanges = computeGroupRanges(pairs, dur);
    if (chartsEnabled()) {
      renderGrid({ animate: animateStats, animateLayout: false, preserveRequest: true, hydrate: false, loadCharts: true });
    }
    return;
  }

  if (statsSnapshotPromise && statsSnapshotDuration === dur) {
    await statsSnapshotPromise;
    if (generation !== renderGeneration) return;
    if (primeCardsFromCache(pairs, dur, animateStats)) {
      batchLoadingGeneration = -1;
      pairGroupRanges = computeGroupRanges(pairs, dur);
      if (chartsEnabled()) {
        renderGrid({ animate: animateStats, animateLayout: false, preserveRequest: true, hydrate: false, loadCharts: true });
      }
      return;
    }
  }

  const graphSize = graphSizeParams();
  let data;
  try {
    data = await fetchJson(requestUrl('/api/stats-batch.json', {
      nodes: nodeIds.join(','), dur, w: graphSize.w, h: graphSize.h
    }), signal, 30000);
    if (!data || !Array.isArray(data.items)) throw new Error('invalid batch response');
  } catch (error) {
    if (error.name === 'AbortError') return;
    if (generation !== renderGeneration) return;
    batchLoadingGeneration = -1;
    pairGroupRanges = computeGroupRanges(pairs, dur);
    // Compatibility fallback for an older or temporarily unavailable backend.
    renderGrid({
      animate: animateStats,
      animateLayout: false,
      preserveRequest: true,
      hydrate: true,
      loadCharts: chartsEnabled()
    });
    return;
  }

  if (generation !== renderGeneration) return;
  const outcomes = cacheBatchItems(data.items, dur);

  pairGroupRanges = computeGroupRanges(pairs, dur);
  batchLoadingGeneration = -1;
  if (chartsEnabled()) {
    renderGrid({ animate: animateStats, animateLayout: false, preserveRequest: true, hydrate: false, loadCharts: true });
  }
  paintStatsCards(pairs, dur, generation, outcomes, animateStats);
}

// ── Commit the pending controls, then refresh the displayed result set ──
async function showGraphs() {
  const sel = getSel();
  if (sel.length < 2) return toast('Select at least 2 nodes', true);
  const firstResults = currentPairs.length === 0;
  const selectionChanged = !selectionEquals(sel, appliedSelection);
  const modeChanged = draftViewMode !== appliedViewMode;
  const generation = ++renderGeneration;
  if (activeController) activeController.abort();
  activeController = new AbortController();
  const signal = activeController.signal;
  if (isMobile()) {
    document.getElementById('sidebar').classList.remove('mobile-open');
    document.getElementById('overlay').classList.remove('show');
  }
  let nextPairs;
  try {
    // The node list already contains every field needed to derive routes.
    // Avoid a redundant network round-trip before the first card can render.
    nextPairs = makePairs(sel);
  } catch (error) {
    toast('Invalid node selection', true);
    return;
  }
  if (generation !== renderGeneration) return;
  selectedDuration = draftDuration;
  appliedViewMode = draftViewMode;
  if (appliedViewMode === 'charts') {
    chartRefreshToken = `${Date.now()}-${generation}`;
  }
  suppressStatsAnimationGeneration = firstResults ? generation : -1;
  appliedSelection = sel.slice();
  updSel();
  currentPairs = nextPairs;
  pairGroupRanges = {};
  batchLoadingGeneration = generation;

  ensureMainShell();
  renderGrid({
    animate: true,
    preserveRequest: true,
    hydrate: false,
    selectionChange: selectionChanged && !modeChanged
  });
  await refreshStatsBatch(appliedSelection, currentPairs, selectedDuration, generation, signal);
}

function setFilter(f) {
  activeFilter = f;
  updateFilterButtons();
  if (currentPairs.length === 0) return;
  renderGrid({ filterChange: true, preserveRequest: true });
}

function setUnifiedYAxis(enabled) {
  unifiedYAxisEnabled = Boolean(enabled);
  const toggle = document.getElementById('unifiedAxisToggle');
  if (toggle && toggle.checked !== unifiedYAxisEnabled) toggle.checked = unifiedYAxisEnabled;
  if (!chartsEnabled() || currentPairs.length === 0) return;
  renderGrid({
    animate: false,
    animateLayout: false,
    preserveRequest: true,
    hydrate: false,
    loadCharts: true
  });
}

function updateFilterButtons() {
  document.querySelectorAll('.pill[data-filter]').forEach(p => p.classList.toggle('on', p.dataset.filter === activeFilter));
}

function ensureMainShell() {
  const m = document.getElementById('mainArea');
  if (document.getElementById('graphGrid')) return document.getElementById('graphGrid');
  const charts = chartsEnabled();
  m.innerHTML = `<div class="grid${charts ? '' : ' stats-only'}" id="graphGrid"></div>`;
  return document.getElementById('graphGrid');
}

function renderMain(options = {}) {
  ensureMainShell();
  renderGrid(options);
}

function fitNarrowRouteLabels() {
  routeFitFrame = 0;
  const main = document.getElementById('mainArea');
  const routes = Array.from(document.querySelectorAll('#graphGrid .route'));
  routes.forEach(route => route.style.removeProperty('--route-fit-size'));
  if (!main) return;

  const measurements = routes.map(route => {
    const resultsMode = route.closest('.grid')?.classList.contains('stats-only');
    if (!resultsMode && main.clientWidth > 768) return null;

    const labels = Array.from(route.querySelectorAll('.route-node'));
    if (labels.length !== 2) return null;
    const style = getComputedStyle(route);
    const baseSize = parseFloat(style.fontSize) || 16;
    const overflowRatio = labels.reduce((ratio, label) => {
      if (!label.clientWidth || !label.scrollWidth) return ratio;
      return Math.max(ratio, label.scrollWidth / label.clientWidth);
    }, 1);
    if (overflowRatio <= 1.005) return null;

    const minSize = resultsMode && main.clientWidth > 768 ? 14 : 10.5;
    const fittedSize = Math.max(
      minSize,
      Math.floor((baseSize / overflowRatio - 0.15) * 10) / 10
    );
    return { route, fittedSize };
  }).filter(Boolean);

  measurements.forEach(({ route, fittedSize }) => {
    route.style.setProperty('--route-fit-size', `${fittedSize}px`);
  });
}

function scheduleRouteFit() {
  if (routeFitFrame) cancelAnimationFrame(routeFitFrame);
  routeFitFrame = requestAnimationFrame(fitNarrowRouteLabels);
}

window.addEventListener('resize', scheduleRouteFit, { passive: true });
if ('ResizeObserver' in window) {
  const main = document.getElementById('mainArea');
  if (main) {
    routeFitObservedWidth = main.clientWidth;
    new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width || 0;
      if (Math.abs(width - routeFitObservedWidth) < 0.5) return;
      routeFitObservedWidth = width;
      scheduleRouteFit();
    }).observe(main);
  }
}
if (document.fonts?.ready) document.fonts.ready.then(scheduleRouteFit);

function pairIdentity(pair) {
  return `${pair.source}|${pair.target}|${pair.type}|${pair.ext ? 'ext' : 'net'}`;
}

function pairSlotIdentity(pair) {
  return `${pair.source}|${pair.target}|${pair.ext ? 'ext' : 'net'}`;
}

function cardToken(key) {
  return key.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function statsIdFor(pair) {
  return `st_${cardToken(pairIdentity(pair))}`;
}

function imageIdFor(pair) {
  return `img_${cardToken(pairIdentity(pair))}`;
}

function skeletonIdFor(pair) {
  return `sk_${cardToken(pairIdentity(pair))}`;
}

function captureCardRects(grid) {
  const rects = new Map();
  grid.querySelectorAll('.card[data-card-key]').forEach(card => {
    rects.set(card.dataset.cardKey, card.getBoundingClientRect());
  });
  return rects;
}

function lockCardFrame(card, rect) {
  if (!card || !rect) return;
  clearTimeout(card._layoutTimer);
  card.classList.add('frame-locked');
  card.dataset.frameLocked = '1';
  card.style.height = `${rect.height}px`;
}

function releaseCardFrame(card) {
  if (!card || card.dataset.frameLocked !== '1') return;
  card.style.height = '';
  requestAnimationFrame(() => {
    if (!card.isConnected) return;
    card.classList.remove('frame-locked');
    delete card.dataset.frameLocked;
  });
}

function animateGridLayout(grid, before) {
  requestAnimationFrame(() => {
    const cards = [...grid.querySelectorAll('.card[data-card-key]:not(.card-removing)')];
    const finalRects = new Map(cards.map(card => [card.dataset.cardKey, card.getBoundingClientRect()]));
    cards.forEach(card => {
      const oldRect = before.get(card.dataset.cardKey);
      const finalRect = finalRects.get(card.dataset.cardKey);
      if (oldRect && finalRect && Math.abs(oldRect.height - finalRect.height) > 1) {
        clearTimeout(card._layoutTimer);
        card.style.height = `${oldRect.height}px`;
      }
    });
    void grid.offsetHeight;
    const startRects = new Map(cards.map(card => [card.dataset.cardKey, card.getBoundingClientRect()]));
    requestAnimationFrame(() => {
      cards.forEach(card => {
        const oldRect = before.get(card.dataset.cardKey);
        const startRect = startRects.get(card.dataset.cardKey);
        const finalRect = finalRects.get(card.dataset.cardKey);
        if (!oldRect || !startRect || !finalRect) return;
        const sizeChanged = Math.abs(oldRect.height - finalRect.height) > 1;
        const dx = startRect.left - finalRect.left;
        const dy = sizeChanged ? 0 : startRect.top - finalRect.top;
        if (Math.abs(dx) >= 1 || Math.abs(dy) >= 1) {
          const animation = card.animate([
            { transform: `translate(${dx}px, ${dy}px)` },
            { transform: 'translate(0, 0)' }
          ], { duration: 240, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
          animation.finished.then(() => { card.style.transform = ''; }, () => {});
        }
        if (sizeChanged) {
          card.style.height = `${finalRect.height}px`;
          card._layoutTimer = setTimeout(() => {
            card.style.height = '';
          }, 260);
        }
      });
    });
  });
}

function animateNewCard(card) {
  requestAnimationFrame(() => {
    if (!card.isConnected) return;
    card.classList.add('card-enter-active');
    setTimeout(() => card.classList.remove('card-enter', 'card-enter-active'), 260);
  });
}

function findCard(grid, key) {
  return Array.from(grid.querySelectorAll('.card[data-card-key]'))
    .find(card => card.dataset.cardKey === key) || null;
}

function findSlotCard(grid, slotKey, retained) {
  return Array.from(grid.querySelectorAll('.card[data-card-key]'))
    .find(card => !retained.has(card) && !card.classList.contains('card-removing') && card.dataset.slotKey === slotKey) || null;
}

function findPositionalCard(grid, retained) {
  return Array.from(grid.querySelectorAll('.card[data-card-key]'))
    .find(card => !retained.has(card)) || null;
}

function removeCardAfterFade(card, grid, animate) {
  if (card._removeAnimation) return;
  if (!animate) {
    card.querySelectorAll('img[data-skel]').forEach(cancelImageLoad);
    card.remove();
    return;
  }
  card.classList.add('card-removing');
  const height = Math.max(1, card.getBoundingClientRect().height);
  const animation = card.animate([
    { opacity: 1, transform: 'translateY(0)', maxHeight: `${height}px` },
    { opacity: 0, transform: 'translateY(-6px)', maxHeight: '0px' }
  ], { duration: 220, easing: 'ease-in' });
  card._removeAnimation = animation;
  animation.finished.then(() => {
    if (card._removeAnimation !== animation) return;
    const before = captureCardRects(grid);
    card.querySelectorAll('img[data-skel]').forEach(cancelImageLoad);
    card.remove();
    card._removeAnimation = null;
    animateGridLayout(grid, before);
  }, () => {});
}

function cancelCardRemoval(card) {
  if (!card._removeAnimation) return;
  card._removeAnimation.cancel();
  card._removeAnimation = null;
  card.classList.remove('card-removing');
}

function cardContentMarkup(pair, charts) {
  const srcLabel = escapeHtml(pair.srcLabel);
  const tgtLabel = escapeHtml(pair.tgtLabel);
  const bc = pair.ext ? 'badge-ext' : pair.type === 'v6' ? 'badge-v6' : 'badge-v4';
  const bl = pair.ext ? 'Ext' : pair.type === 'v6' ? 'v6' : 'v4';
  let chartMarkup = '';
  if (charts) {
    const safeUrl = escapeHtml(requestUrl('/api/graph.png', graphQueryFor(pair)));
    const imgId = imageIdFor(pair);
    const skelId = skeletonIdFor(pair);
    chartMarkup = `<div class="card-img">
         <div class="skel" id="${skelId}"></div>
         <img id="${imgId}" data-url="${safeUrl}" data-skel="${skelId}" alt="${srcLabel} \u2192 ${tgtLabel}">
         <div class="card-status"><strong>Unable to load graph</strong><span>Loading will start when visible.</span><button class="retry-btn" data-retry-id="${imgId}">Retry</button></div>
       </div>`;
  }
  return `<div class="card-head">
        <div class="route">
          <span class="badge ${bc}">${bl}</span>
          <span class="route-node route-source">${srcLabel}</span>
          <span class="route-arrow" aria-hidden="true"><span class="route-arrow-inline">\u2192</span><span class="route-arrow-down">\u2193</span></span>
          <span class="route-node route-target">${tgtLabel}</span>
        </div>
        <div class="card-right">
          <div class="stats" id="${statsIdFor(pair)}"></div>
        </div>
       </div>
       ${chartMarkup}`;
}

function createCard(pair, charts) {
  const card = document.createElement('div');
  card.className = 'card card-enter';
  card.dataset.cardKey = pairIdentity(pair);
  card.dataset.slotKey = pairSlotIdentity(pair);
  card.dataset.contentKey = pairIdentity(pair);
  card.dataset.mode = charts ? 'charts' : 'stats';
  card.innerHTML = `<div class="card-content">${cardContentMarkup(pair, charts)}</div>`;
  return card;
}

function updateCardContent(card, pair, charts, animate) {
  const mode = charts ? 'charts' : 'stats';
  const contentKey = pairIdentity(pair);
  const previousMode = card.dataset.mode;
  const previousKey = card.dataset.contentKey;
  const changed = previousMode !== mode || previousKey !== contentKey;
  const content = card.querySelector('.card-content');
  card.dataset.mode = mode;
  card.dataset.contentKey = contentKey;
  if (!content) return;
  if (!changed) return;

  // Results and Charts share the same KPI block. Keep it in place while only
  // the chart region changes, so a mode switch never flashes an empty header.
  const preserveStats = previousKey === contentKey && previousMode !== mode;
  const previousStats = preserveStats ? content.querySelector('.stats') : null;
  const previousStatsMarkup = previousStats?.innerHTML || '';
  const previousStatsClass = previousStats?.className || '';
  content.querySelectorAll('img[data-skel]').forEach(cancelImageLoad);
  content.innerHTML = cardContentMarkup(pair, charts);
  const nextStats = content.querySelector('.stats');
  if (preserveStats && nextStats && previousStatsMarkup) {
    nextStats.innerHTML = previousStatsMarkup;
    nextStats.className = previousStatsClass;
  }
  if (animate && changed) {
    content.classList.remove('content-switching');
    void content.offsetWidth;
    content.classList.add('content-switching');
    setTimeout(() => content.classList.remove('content-switching'), 260);
  }
}

function syncChartSource(card, pair) {
  const img = card.querySelector('img[data-skel]');
  if (!img) return;
  const url = requestUrl('/api/graph.png', graphQueryFor(pair));
  if (img.dataset.url === url) return;
  img.dataset.url = url;
  img.dataset.queued = '';
  cancelImageLoad(img);
  img.classList.remove('ok');
  const skel = document.getElementById(img.dataset.skel);
  if (skel) {
    skel.classList.remove('gone');
    skel.style.animation = '';
    skel.style.background = '';
  }
}

function hydrateCard(card, pair, charts, generation, signal) {
  const key = `${pair.source}_${pair.target}_${pair.type}_${selectedDuration}`;
  const statsId = statsIdFor(pair);
  if (statsCache[key]) {
    showStat(statsId, statsCache[key], generation !== suppressStatsAnimationGeneration);
  } else if (batchLoadingGeneration === generation) {
    card.querySelector('.stats')?.classList.add('stats-pending');
  } else if (card.dataset.fetchGeneration !== String(generation)) {
    card.querySelector('.stats')?.classList.add('stats-pending');
    card.dataset.fetchGeneration = String(generation);
    setTimeout(() => fetchStat(pair, statsId, selectedDuration, generation, signal), 40);
  }
  if (charts && batchLoadingGeneration !== generation) syncChartSource(card, pair);
}

function renderGrid({ animate = true, animateLayout = animate, preserveRequest = false, hydrate = true, loadCharts = false, filterChange = false, selectionChange = false } = {}) {
  const grid = ensureMainShell();
  let generation = renderGeneration;
  let signal = activeController?.signal;
  if (!preserveRequest) {
    if (activeController) activeController.abort();
    activeController = new AbortController();
    signal = activeController.signal;
    generation = ++renderGeneration;
  }
  const charts = chartsEnabled();
  const dur = selectedDuration;
  const before = animateLayout ? captureCardRects(grid) : new Map();
  grid.classList.toggle('stats-only', !charts);
  let list = currentPairs;
  if (activeFilter === 'v4')  list = currentPairs.filter(p => !p.ext && p.type === 'v4');
  if (activeFilter === 'v6')  list = currentPairs.filter(p => p.type === 'v6');
  if (activeFilter === 'ext') list = currentPairs.filter(p => p.ext);

  const columns = getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).filter(Boolean);
  list = orderPairsForLayout(list, columns.length < 2);
  // This is intentionally the final axis calculation: it runs only after the
  // current view's filter and layout ordering have produced the visible list.
  unifiedChartRange = charts && unifiedYAxisEnabled ? computeUnifiedRange(list, dur) : null;
  const desired = new Set(list.map(pairIdentity));
  const retained = new Set();

  list.forEach(pair => {
    const key = pairIdentity(pair);
    const slotKey = pairSlotIdentity(pair);
    let card = findCard(grid, key);
    if (!card) card = findSlotCard(grid, slotKey, retained);
    if (!card && selectionChange) card = findPositionalCard(grid, retained);
    const previousKey = card?.dataset.cardKey;
    if (!card) {
      card = createCard(pair, charts);
      grid.appendChild(card);
      if (animate) animateNewCard(card);
      else card.classList.remove('card-enter');
    } else {
      cancelCardRemoval(card);
      updateCardContent(card, pair, charts, animate);
      if (selectionChange && previousKey && before.has(previousKey)) {
        lockCardFrame(card, before.get(previousKey));
      }
    }
    card.dataset.cardKey = key;
    card.dataset.slotKey = slotKey;
    retained.add(card);
    if (hydrate) hydrateCard(card, pair, charts, generation, signal);
    else if (charts && loadCharts) syncChartSource(card, pair);
  });

  grid.querySelectorAll('.card[data-card-key]').forEach(card => {
    if (!retained.has(card) && !desired.has(card.dataset.cardKey)) {
      removeCardAfterFade(card, grid, filterChange ? false : animate);
    }
  });

  const noMatches = grid.querySelector('.no-matches');
  if (!list.length && !noMatches) {
    grid.insertAdjacentHTML('beforeend', '<div class="empty no-matches"><div class="empty-title">No matches</div></div>');
  } else if (list.length && noMatches) {
    noMatches.remove();
  }
  fitNarrowRouteLabels();
  if (animateLayout) animateGridLayout(grid, before);
  if (charts && (hydrate || loadCharts) && batchLoadingGeneration !== generation) {
    observeImages();
    requestAnimationFrame(() => {
      if (chartsEnabled()) observeImages();
    });
  }
}

function fetchStat(pair, id, dur, generation, signal) {
  const key = `${pair.source}_${pair.target}_${pair.type}_${dur}`;
  if (statsCache[key]) {
    showStat(id, statsCache[key], generation !== suppressStatsAnimationGeneration);
    return;
  }
  const graphSize = graphSizeParams();
  fetchJson(requestUrl('/api/stats', {
    source: pair.source, target: pair.target, type: pair.type, dur,
    w: graphSize.w, h: graphSize.h
  }), signal)
    .then(d => {
      if (generation !== renderGeneration) return;
      if (d.error) return;
      statsCache[key] = d;
      statsCacheTimes[key] = Date.now();
      showStat(id, d, generation !== suppressStatsAnimationGeneration);
    }).catch(error => {
      if (error.name === 'AbortError') return;
      if (generation === renderGeneration) showStatError(id);
    });
}

function showStatError(id) {
  const el = document.getElementById(id);
  if (el) {
    const items = ['current', 'avg', 'min', 'max', 'loss'].map((label, i) =>
      `<span class="stat-item ${i === 0 ? 'stat-primary' : 'stat-secondary'}${i === 4 ? ' loss-bad' : ''}">` +
      `<span class="stat-label">${label}</span>` +
      `<span class="stat-value">${i === 0 ? 'N/A' : '-'}</span></span>`
    );
    el.innerHTML = items[0] + `<div class="stat-support">${items.slice(1).join('')}</div>`;
    el.classList.remove('stats-pending');
    releaseCardFrame(el.closest('.card'));
  }
}

function showStat(id, d, animate = true) {
  const el = document.getElementById(id);
  if (!el) return;
  const lc = d.loss_pct > 5 ? 'loss-bad' : d.loss_pct > 0 ? 'loss-warn' : 'loss-ok';
  const latencyValues = [d.current_ms, d.avg_ms, d.min_ms, d.max_ms].filter(Number.isFinite);
  const currentMs = Number.isFinite(d.current_ms)
    ? d.current_ms
    : (Number.isFinite(d.avg_ms) ? d.avg_ms : null);
  const useUs = latencyValues.length > 0 && Math.max(...latencyValues) < 1;
  const fmt = v => {
    if (!Number.isFinite(v)) return '<span class="stat-number">-</span>';
    return useUs
      ? `<span class="stat-number">${(v * 1000).toFixed(0)}</span><span class="stat-unit">\u03bcs</span>`
      : `<span class="stat-number">${v.toFixed(1)}</span><span class="stat-unit">ms</span>`;
  };
  const item = (label, value, className = '') =>
    `<span class="stat-item ${className}">` +
    `<span class="stat-label">${label}</span>` +
    `<span class="stat-value">${value}</span></span>`;
  el.innerHTML = item('current', fmt(currentMs), 'stat-primary')
    + `<div class="stat-support">`
    + item('avg', fmt(d.avg_ms), 'stat-secondary')
    + item('min', fmt(d.min_ms), 'stat-secondary')
    + item('max', fmt(d.max_ms), 'stat-secondary')
    + item('loss', `<span class="stat-number">${d.loss_pct.toFixed(1)}</span><span class="stat-unit">%</span>`, `stat-secondary ${lc}`)
    + `</div>`;
  el.classList.remove('stat-updated', 'stats-pending');
  if (animate) {
    void el.offsetWidth;
    el.classList.add('stat-updated');
    setTimeout(() => el.classList.remove('stat-updated'), 260);
  }
  releaseCardFrame(el.closest('.card'));
}

function changeDuration(value) {
  draftDuration = value;
  updSel();
}
