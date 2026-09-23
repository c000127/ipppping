'use strict';

let nodes = [];
const nodeLabelCollator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
function sortNodesByLabel(items) {
  return [...items].sort((a, b) => {
    const byLabel = nodeLabelCollator.compare(String(a.label), String(b.label));
    return byLabel || String(a.id).localeCompare(String(b.id), 'en', { sensitivity: 'base', numeric: true });
  });
}
let currentPairs = [];
let draftSelection = [];
let appliedSelection = [];
let statsCache = {};
let statsCacheTimes = {};
let activeFilter = 'all';
let selectedDuration = '10800';
let draftDuration = '10800';
let draftPairMode = 'all';
let appliedPairMode = 'all';
const draftAnchors = new Set();
let appliedAnchors = [];
let appliedViewMode = 'stats';
let draftViewMode = 'stats';
let pairGroupRanges = {}; // groupKey -> {ymin, ymax} per node-pair+type
let unifiedYAxisEnabled = false;
let unifiedChartRange = null;
let renderGeneration = 0;
let activeController = null;
let batchLoadingGeneration = -1;
let suppressStatsAnimationGeneration = -1;
let chartRefreshToken = 'initial';
const isMobile = () => window.innerWidth <= 768;
const REQUEST_TIMEOUT_MS = 15000;
const requestPool = new RequestState.Pool(4);
const jsonRequests = new Map();
const statsFailures = new Map();
let individualFallbackGeneration = -1;
let blockedChartsGeneration = -1;
const statsLRU = new Map();
const MAX_STATS_CACHE_BYTES = 2 * 1024 * 1024;
let statsCacheBytes = 0;
const CLIENT_STATS_TTL_MS = 60000;
const STORED_STATS_TTL_MS = 300000;
const measurementTimeFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour12: false,
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

function requestUrl(path, params) {
  const query = new URLSearchParams(params);
  return `${path}?${query}`;
}

function fetchJson(url, signal, timeoutMs = REQUEST_TIMEOUT_MS) {
  const pending = jsonRequests.get(url);
  if (pending && pending.signal === signal && !signal?.aborted) return pending.promise;
  const promise = requestPool.run(() => fetchJsonAttempt(url, signal, timeoutMs), signal);
  const entry = { signal, promise };
  jsonRequests.set(url, entry);
  const cleanup = () => { if (jsonRequests.get(url) === entry) jsonRequests.delete(url); };
  promise.then(cleanup, cleanup);
  return promise;
}

async function fetchJsonAttempt(url, signal, timeoutMs) {
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
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
      if (response.ok) return await response.json();
      const error = Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
      await response.body?.cancel();
      if (![429, 503].includes(response.status) || attempt >= 2) throw error;
      // The timeout covers retries and body consumption. A long Retry-After
      // expires this request instead of retrying earlier than the server asked.
      await RequestState.delay(RequestState.retryDelay(response.headers.get('Retry-After'), attempt), controller.signal);
    }
  } catch (error) {
    if (timedOut) throw new Error('Request timed out');
    throw error;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', abort);
  }
}

const sidebarUI = UIComponents.sidebarController();

// Clock
function tick() {
  const d = new Date();
  document.getElementById('clock').textContent =
    d.toLocaleTimeString('en-GB', { timeZone: 'Asia/Shanghai', hour12: false }) + ' UTC+08:00';
  if (d.getSeconds() % 15 === 0) refreshVisibleDataStates();
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
  if (event.target.matches('.node-cb')) syncNodeSelection(event.target.dataset.id);
  if (event.target.id === 'durSelect') changeDuration(event.target.value);
  if (event.target.id === 'unifiedAxisToggle') setUnifiedYAxis(event.target.checked);
});

document.addEventListener('click', event => {
  const pairing = event.target.closest('.pairing-mode-btn[data-pair-mode]');
  if (pairing) return setPairMode(pairing.dataset.pairMode);
  const anchor = event.target.closest('.node-anchor[data-anchor-node]');
  if (anchor) {
    event.preventDefault();
    event.stopPropagation();
    setAnchor(anchor.dataset.anchorNode);
    return;
  }
  if (event.target.closest('[data-retry-nodes]')) return loadNodes();
  const group = event.target.closest('[data-select-group]');
  if (group) return selGrp(group.dataset.selectGroup, Number(group.dataset.selectValue));
  const filter = event.target.closest('.pill[data-filter]');
  if (filter) return setFilter(filter.dataset.filter);
  const retry = event.target.closest('.retry-btn[data-retry-id]');
  if (retry) return retryImage(retry.dataset.retryId);
});

// Native checkboxes/buttons own their keyboard behavior; no delegated toggle.

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
    nodes = sortNodesByLabel(data);
    renderSidebar();
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
  updatePairingControls();
}

function nodeRow(n) {
  let meta = '';
  const protocols = [];
  if (n.v4) protocols.push('<span class="node-meta badge badge-v4">v4</span>');
  if (n.v6) protocols.push('<span class="node-meta badge badge-v6">v6</span>');
  if (protocols.length) meta = `<span class="node-protocols">${protocols.join('')}</span>`;
  const id = escapeHtml(n.id);
  const label = escapeHtml(n.label);
  return `<div class="node" id="n_${id}" data-node-id="${id}">
    <label class="node-select" for="c_${id}">
      <input type="checkbox" class="node-cb" id="c_${id}" data-id="${id}">
      <span class="node-label">${label}</span>
      ${meta}
    </label>
    <button class="node-anchor" type="button" data-anchor-node="${id}" aria-label="Use ${label} as fixed node" title="Use this node as a fixed node">Fix</button>
  </div>`;
}

function updatePairingControls() {
  const sidebar = document.getElementById('sidebar');
  sidebar?.classList.toggle('pairing-fixed-mode', draftPairMode === 'fixed');
  document.querySelectorAll('.pairing-mode-btn[data-pair-mode]').forEach(button => {
    const active = button.dataset.pairMode === draftPairMode;
    button.classList.toggle('on', active);
    button.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('.node[data-node-id]').forEach(row => {
    const id = row.dataset.nodeId;
    const selected = document.getElementById('c_' + id)?.checked === true;
    const anchor = draftPairMode === 'fixed' && draftAnchors.has(id) && selected;
    const button = row.querySelector('.node-anchor');
    row.classList.toggle('selection-anchorable', selected);
    row.classList.toggle('anchor-on', anchor);
    row.setAttribute('data-anchor', String(anchor));
    if (button) {
      button.disabled = !selected;
      button.textContent = anchor ? 'Fixed' : 'Fix';
      button.setAttribute('aria-pressed', String(anchor));
      button.setAttribute('aria-label', `${anchor ? 'Remove' : 'Use'} ${row.querySelector('.node-label').textContent} ${anchor ? 'from' : 'as'} fixed nodes`);
      button.title = anchor ? 'Remove from fixed nodes' : 'Use as a fixed node';
    }
  });
}

function setPairMode(mode) {
  draftPairMode = mode === 'fixed' ? 'fixed' : 'all';
  if (draftPairMode === 'all') draftAnchors.clear();
  updatePairingControls();
  updSel();
}

function setAnchor(id) {
  if (draftPairMode !== 'fixed') return;
  const selected = document.getElementById('c_' + id)?.checked === true;
  if (!selected) return;
  if (draftAnchors.has(id)) draftAnchors.delete(id);
  else draftAnchors.add(id);
  updatePairingControls();
  updSel();
}

function tog(id) {
  const c = document.getElementById('c_' + id);
  c.checked = !c.checked;
  syncNodeSelection(id);
}

function syncNodeSelection(id) {
  const c = document.getElementById('c_' + id);
  const row = document.getElementById('n_' + id);
  row.classList.toggle('on', c.checked);
  if (!c.checked) draftAnchors.delete(id);
  updatePairingControls();
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
    }
  });
  const selected = new Set(readSidebarSelection());
  for (const id of draftAnchors) if (!selected.has(id)) draftAnchors.delete(id);
  updatePairingControls();
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

function selectedFixedIds(selection) {
  return selection.filter(id => draftAnchors.has(id));
}

function updSel() {
  const s = getSel();
  const anchors = draftPairMode === 'fixed' ? selectedFixedIds(s) : [];
  let pairs = 0;
  let message = '';
  if (draftPairMode === 'fixed' && anchors.length === 0) {
    message = 'Choose a fixed node';
  } else if (draftPairMode === 'fixed' && anchors.length === s.length) {
    message = 'Select a non-fixed node';
  } else {
    try {
      pairs = makePairs(s, anchors).length;
    } catch (error) {
      message = error.message;
    }
  }
  document.getElementById('goBtn').disabled = s.length < 2 || !!message;
  const pending = !selectionEquals(s, appliedSelection)
    || draftDuration !== selectedDuration
    || draftViewMode !== appliedViewMode
    || draftPairMode !== appliedPairMode
    || !selectionEquals(anchors, appliedAnchors);
  const submit = document.getElementById('goBtn');
  submit.classList.toggle('pending', pending);
  submit.setAttribute('data-pending', String(pending));
  submit.textContent = `Show ${draftViewMode === 'charts' ? 'Charts' : 'Results'}`;
  const axisOption = document.querySelector('.axis-option');
  const axisHidden = draftViewMode !== 'charts';
  axisOption.classList.toggle('is-hidden', axisHidden);
  axisOption.inert = axisHidden;
  axisOption.setAttribute('aria-hidden', String(axisHidden));
  const info = document.getElementById('selInfo');
  const nextInfo = message
    ? `<span class="selection-error">${message}</span>`
    : s.length < 2
      ? 'Select at least 2 nodes'
      : `<b>${s.length}</b> nodes${anchors.length ? ` · <b>${anchors.length}</b> fixed` : ''} \u00b7 <b>${pairs}</b> results${pending ? ' · Unapplied changes' : ''}`;
  if (info.innerHTML !== nextInfo) {
    info.innerHTML = nextInfo;
    UIComponents.flash(info);
  }
}

function makePairs(sel, anchors = []) {
  if (sel.length > 20) throw new Error('Select no more than 20 nodes');
  const fixedIds = !anchors ? [] : typeof anchors === 'string' ? anchors.split(',') : [...anchors];
  if (fixedIds.some(id => !id || !sel.includes(id)) || new Set(fixedIds).size !== fixedIds.length)
    throw new Error('Fixed nodes must be unique and part of the selection');
  const fixed = new Set(fixedIds);
  const p = [];
  const combinations = fixed.size
    ? sel.filter(id => fixed.has(id)).flatMap(anchor => sel.filter(id => !fixed.has(id)).map(id => [anchor, id]))
    : sel.flatMap((a, i) => sel.slice(i + 1).map(b => [a, b]));
  for (const [a, b] of combinations) {
    const na = nodes.find(n => n.id === a), nb = nodes.find(n => n.id === b);
    if (!na || !nb) continue;
    if (na.group === 'dns' && nb.group === 'dns') continue;
    if (na.group === 'dns' || nb.group === 'dns') {
      const src = na.group === 'dns' ? b : a, tgt = na.group === 'dns' ? a : b;
      const srcLabel = nodes.find(n => n.id === src)?.label;
      const tgtLabel = nodes.find(n => n.id === tgt)?.label;
      const pairMeta = { srcLabel, tgtLabel, ext: true, pairKey: [a, b].join('_'), direction: 0 };
      if (na.v4 && nb.v4)
        p.push({ source: src, target: tgt, type: 'v4', ...pairMeta });
      if (na.v6 && nb.v6)
        p.push({ source: src, target: tgt, type: 'v6', ...pairMeta });
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
  img.dataset.queued = '1';
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
    requestPool.run(() => new Promise(resolve => loadOneImage(job, resolve)), activeController?.signal)
      .catch(() => { activeLoads = Math.max(0, activeLoads - 1); drainQueue(); });
  }
}

function loadOneImage(job, finish) {
  const img = job.img;
  const isCurrent = () => job.generation === renderGeneration
    && img.isConnected
    && img.dataset.url === job.sourceUrl;
  if (!isCurrent()) {
    activeLoads = Math.max(0, activeLoads - 1);
    finish();
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
    finish();
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
    img.removeAttribute('src');
    if (!release() || !isCurrent()) return;
    // Native img cannot inspect Retry-After. Never automatically amplify a
    // busy backend with PNG retries; the explicit Retry button remains.
    {
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
  if (blockedChartsGeneration === renderGeneration) return;
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
  return `ipppping.stats.p1.${dur}`;
}

function rememberStats(key, data, cachedAt = Date.now()) {
  const bytes = JSON.stringify(data).length * 2 + key.length * 2;
  if (statsLRU.has(key)) statsCacheBytes -= statsLRU.get(key);
  statsLRU.delete(key);
  statsCache[key] = data;
  statsCacheTimes[key] = cachedAt;
  statsLRU.set(key, bytes);
  statsCacheBytes += bytes;
  while (statsLRU.size > 1024 || statsCacheBytes > MAX_STATS_CACHE_BYTES) {
    const oldest = statsLRU.keys().next().value;
    statsCacheBytes -= statsLRU.get(oldest);
    statsLRU.delete(oldest);
    delete statsCache[oldest];
    delete statsCacheTimes[oldest];
  }
}

function showCachedStat(pair, dur, animate = true) {
  const key = statsCacheKey(pair, dur);
  if (!statsCache[key]) return false;
  if (statsLRU.has(key)) { const size = statsLRU.get(key); statsLRU.delete(key); statsLRU.set(key, size); }
  showStat(statsIdFor(pair), statsCache[key], animate);
  paintDataState(statsIdFor(pair), statsCache[key], statsCacheTimes[key], statsFailures.get(key));
  return true;
}

function paintDataState(id, data, cachedAt, error) {
  const card = document.getElementById(id)?.closest('.card');
  const status = card?.querySelector('.data-state');
  if (!status) return;
  const state = RequestState.dataStatus(data, cachedAt, Date.now(), error);
  status.dataset.state = state.state;
  const text = state.label + (state.timestamp
    ? ` · ${measurementTimeFormat.format(new Date(state.timestamp * 1000))} UTC+08:00` : '');
  if (status.textContent !== text) status.textContent = text;
}

function refreshVisibleDataStates() {
  currentPairs.forEach(pair => {
    const key = statsCacheKey(pair);
    if (statsCache[key]) paintDataState(statsIdFor(pair), statsCache[key], statsCacheTimes[key], statsFailures.get(key));
  });
}

function cacheBatchItems(items, dur, cachedAt = Date.now()) {
  const outcomes = new Map();
  items.forEach(item => {
    const itemKey = statsItemKey(item);
    outcomes.set(itemKey, item.error || null);
    if (!item.stats) return;
    const key = `${item.source}_${item.target}_${item.type}_${dur}`;
    rememberStats(key, item.stats, cachedAt);
  });
  return outcomes;
}

function restoreStoredStats(dur) {
  try {
    const raw = sessionStorage.getItem(storedStatsKey(dur));
    if (!raw) return;
    const stored = JSON.parse(raw);
    if (raw.length > 500000 || !stored || !Array.isArray(stored.items) || stored.items.length > 500
      || !Number.isFinite(stored.cachedAt) || stored.cachedAt > Date.now()
      || Date.now() - stored.cachedAt > STORED_STATS_TTL_MS) return;
    cacheBatchItems(stored.items, dur, stored.cachedAt);
  } catch (_) {
    // Storage can be unavailable in hardened browsing modes; memory cache remains.
  }
}

function primeCardsFromCache(pairs, dur, animate = true) {
  const now = Date.now();
  let allFresh = true;
  pairs.forEach(pair => {
    const key = statsCacheKey(pair, dur);
    const cached = statsCache[key];
    if (cached) showCachedStat(pair, dur, animate);
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
      const error = outcomes.get(statsItemKey(pair));
      if (error) statsFailures.set(key, error);
      else if (outcomes.has(statsItemKey(pair))) statsFailures.delete(key);
      if (!showCachedStat(pair, dur, animate) && outcomes.has(statsItemKey(pair))) showStatError(statsIdFor(pair), error);
    }
    if (index < pairs.length) requestAnimationFrame(paint);
  };
  requestAnimationFrame(paint);
}

async function refreshStatsBatch(nodeIds, pairs, dur, generation, signal, anchors = []) {
  const animateStats = generation !== suppressStatsAnimationGeneration;
  // An explicit Show Results is a refresh even when cached values are young.
  primeCardsFromCache(pairs, dur, animateStats);

  const graphSize = graphSizeParams();
  let data;
  try {
    data = await fetchJson(requestUrl('/api/stats-batch.json', {
      nodes: nodeIds.join(','), dur, w: graphSize.w, h: graphSize.h, state: 'p1',
      ...(anchors.length ? { anchor: anchors.join(',') } : {})
    }), signal, 30000);
    if (!data || !Array.isArray(data.items)) throw new Error('invalid batch response');
  } catch (error) {
    if (error.name === 'AbortError') return;
    if (generation !== renderGeneration) return;
    batchLoadingGeneration = -1;
    pairGroupRanges = computeGroupRanges(pairs, dur);
    // Only a missing/unsupported endpoint is a compatibility fallback.
    // Overload, timeouts, malformed JSON and network failures never fan out.
    if ([404, 501].includes(error.status)) {
      individualFallbackGeneration = generation;
      renderGrid({
        animate: animateStats,
        animateLayout: false,
        preserveRequest: true,
        hydrate: true,
        loadCharts: chartsEnabled()
      });
    } else {
      blockedChartsGeneration = generation;
      const failures = new Map(pairs.map(pair => [statsItemKey(pair), 'refresh_failed']));
      paintStatsCards(pairs, dur, generation, failures, false);
    }
    return;
  }

  if (generation !== renderGeneration) return;
  const outcomes = cacheBatchItems(data.items, dur);
  pairs.forEach(pair => { if (!outcomes.has(statsItemKey(pair))) outcomes.set(statsItemKey(pair), 'missing_response'); });
  try {
    // Persist only the user's requested selection, never an all-node snapshot.
    const stored = JSON.stringify({ cachedAt: Date.now(), items: data.items });
    if (stored.length <= 500000) sessionStorage.setItem(storedStatsKey(dur), stored);
  } catch (_) { /* Optional cache; live results remain available. */ }

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
  const nextAnchors = draftPairMode === 'fixed' ? selectedFixedIds(sel) : [];
  const pairingChanged = draftPairMode !== appliedPairMode || !selectionEquals(nextAnchors, appliedAnchors);
  const generation = ++renderGeneration;
  if (activeController) activeController.abort();
  imageObserver?.disconnect();
  imageObserver = null;
  loadQueue = [];
  for (const cancel of [...activeImageCancels.values()]) cancel();
  statsFailures.clear();
  individualFallbackGeneration = -1;
  blockedChartsGeneration = -1;
  activeController = new AbortController();
  const signal = activeController.signal;
  sidebarUI.closeMobile();
  let nextPairs;
  try {
    // The node list already contains every field needed to derive routes.
    // Avoid a redundant network round-trip before the first card can render.
    nextPairs = makePairs(sel, nextAnchors);
  } catch (error) {
    toast('Invalid node selection', true);
    return;
  }
  if (generation !== renderGeneration) return;
  selectedDuration = draftDuration;
  appliedViewMode = draftViewMode;
  appliedPairMode = draftPairMode;
  appliedAnchors = nextAnchors.slice();
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
    selectionChange: (selectionChanged || pairingChanged) && !modeChanged
  });
  await refreshStatsBatch(appliedSelection, currentPairs, selectedDuration, generation, signal, appliedAnchors);
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
  document.querySelectorAll('.pill[data-filter]').forEach(p => {
    const selected = p.dataset.filter === activeFilter;
    p.classList.toggle('on', selected);
    p.setAttribute('aria-pressed', String(selected));
  });
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

// CSS wraps long routes instead of measuring and shrinking each label.
let layoutColumns = 0;
let layoutFrame = 0;
if ('ResizeObserver' in window) {
  new ResizeObserver(() => {
    cancelAnimationFrame(layoutFrame);
    layoutFrame = requestAnimationFrame(() => {
      const grid = document.getElementById('graphGrid');
      if (!grid) return;
      const columns = getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length;
      if (columns !== layoutColumns) {
        layoutColumns = columns;
        renderGrid({ animate: false, preserveRequest: true, hydrate: false });
      }
    });
  }).observe(document.getElementById('mainArea'));
}
updateFilterButtons();

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
  if (UIComponents.reducedMotion()) return;
  requestAnimationFrame(() => {
    const cards = [...grid.querySelectorAll('.card[data-card-key]:not(.card-removing)')];
    const rects = cards.map(card => card.getBoundingClientRect());
    cards.forEach((card, i) => {
      const old = before.get(card.dataset.cardKey);
      if (!old) return;
      const dx = old.left - rects[i].left, dy = old.top - rects[i].top;
      if (Math.abs(dx) + Math.abs(dy) < 1) return;
      card._layoutAnimation?.cancel();
      card._layoutAnimation = card.animate([
        { transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }
      ], { duration: 180, easing: 'ease-out' });
    });
  });
}

function animateNewCard(card) {
  if (UIComponents.reducedMotion()) { card.classList.remove('card-enter'); return; }
  requestAnimationFrame(() => {
    if (!card.isConnected) return;
    card.classList.add('card-enter-active');
    setTimeout(() => card.classList.remove('card-enter', 'card-enter-active'), 260);
  });
}



function removeCardAfterFade(card, grid, animate) {
  if (card._removeAnimation) return;
  if (!animate || UIComponents.reducedMotion()) {
    card.querySelectorAll('img[data-skel]').forEach(cancelImageLoad);
    card.remove();
    return;
  }
  card.classList.add('card-removing');
  const animation = card.animate([
    { opacity: 1 },
    { opacity: 0 }
  ], { duration: 220, easing: 'ease-in' });
  card._removeAnimation = animation;
  animation.finished.then(() => {
    if (card._removeAnimation !== animation) return;
    card.querySelectorAll('img[data-skel]').forEach(cancelImageLoad);
    card.remove();
    card._removeAnimation = null;
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
  const typeBadgeClass = pair.type === 'v6' ? 'badge-v6' : 'badge-v4';
  const typeBadgeLabel = pair.type === 'v6' ? 'v6' : 'v4';
  const badges = [
    ...(pair.ext ? ['<span class="badge badge-ext">Ext</span>'] : []),
    `<span class="badge ${typeBadgeClass}">${typeBadgeLabel}</span>`,
  ].join('');
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
          <span class="route-badges">${badges}</span>
          <span class="route-node route-source">${srcLabel}</span>
          <span class="route-arrow" aria-hidden="true"><span class="route-arrow-inline">\u2192</span><span class="route-arrow-down">\u2193</span></span>
          <span class="route-node route-target">${tgtLabel}</span>
        </div>
        <div class="card-right">
          <div class="stats" id="${statsIdFor(pair)}"></div>
        </div>
       </div>
       <div class="data-state" aria-label="Measurement status">Waiting for measurements…</div>
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
  content.querySelectorAll('img[data-skel]').forEach(cancelImageLoad);
  content.innerHTML = cardContentMarkup(pair, charts);
  const nextStats = content.querySelector('.stats');
  if (previousStats && nextStats) nextStats.replaceWith(previousStats);
  if (animate && changed) {
    UIComponents.flash(content);
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
  const cached = showCachedStat(pair, selectedDuration, generation !== suppressStatsAnimationGeneration);
  if (batchLoadingGeneration === generation && !cached) {
    card.querySelector('.stats')?.classList.add('stats-pending');
  } else if (individualFallbackGeneration === generation
    && (!cached || Date.now() - statsCacheTimes[key] > CLIENT_STATS_TTL_MS)
    && card.dataset.fetchGeneration !== String(generation)) {
    card.querySelector('.stats')?.classList.add('stats-pending');
    card.dataset.fetchGeneration = String(generation);
    fetchStat(pair, statsId, selectedDuration, generation, signal);
  } else if (!cached && statsFailures.has(key)) {
    showStatError(statsId, statsFailures.get(key));
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
  animate = animate && !UIComponents.reducedMotion();
  animateLayout = animateLayout && !UIComponents.reducedMotion();
  const before = animateLayout ? captureCardRects(grid) : new Map();
  grid.classList.toggle('stats-only', !charts);
  let list = currentPairs;
  if (activeFilter === 'v4')  list = currentPairs.filter(p => p.type === 'v4');
  if (activeFilter === 'v6')  list = currentPairs.filter(p => p.type === 'v6');
  if (activeFilter === 'ext') list = currentPairs.filter(p => p.ext);

  const columns = getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).filter(Boolean);
  layoutColumns = columns.length;
  list = orderPairsForLayout(list, columns.length < 2);
  // This is intentionally the final axis calculation: it runs only after the
  // current view's filter and layout ordering have produced the visible list.
  unifiedChartRange = charts && unifiedYAxisEnabled ? computeUnifiedRange(list, dur) : null;
  const desired = new Set(list.map(pairIdentity));
  const retained = new Set();
  const index = UIComponents.cardIndex(grid, desired);

  list.forEach((pair, position) => {
    const key = pairIdentity(pair);
    const slotKey = pairSlotIdentity(pair);
    let card = index.take(key, slotKey, selectionChange);
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
    if (grid.children[position] !== card) grid.insertBefore(card, grid.children[position] || null);
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
  if (animateLayout) animateGridLayout(grid, before);
  if (charts && (hydrate || loadCharts) && batchLoadingGeneration !== generation) {
    observeImages();
    requestAnimationFrame(() => {
      if (chartsEnabled()) observeImages();
    });
  }
}

function fetchStat(pair, id, dur, generation, signal) {
  if (signal?.aborted || generation !== renderGeneration) return;
  const key = `${pair.source}_${pair.target}_${pair.type}_${dur}`;
  if (statsCache[key] && Date.now() - statsCacheTimes[key] <= CLIENT_STATS_TTL_MS) {
    showCachedStat(pair, dur, generation !== suppressStatsAnimationGeneration);
    return;
  }
  const graphSize = graphSizeParams();
  fetchJson(requestUrl('/api/stats', {
    source: pair.source, target: pair.target, type: pair.type, dur, state: 'p1',
    w: graphSize.w, h: graphSize.h
  }), signal)
    .then(d => {
      if (generation !== renderGeneration) return;
      if (d.error) throw new Error('Invalid statistic response');
      rememberStats(key, d);
      statsFailures.delete(key);
      showCachedStat(pair, dur, generation !== suppressStatsAnimationGeneration);
    }).catch(error => {
      if (error.name === 'AbortError') return;
      if (generation === renderGeneration) {
        statsFailures.set(key, error.status === 404 ? 'no_data' : 'refresh_failed');
        if (!showCachedStat(pair, dur, false)) showStatError(id, statsFailures.get(key));
      }
    });
}

function showStatError(id, error = 'refresh_failed') {
  const el = document.getElementById(id);
  if (!el) return;
  UIComponents.updateStats(el, null);
  releaseCardFrame(el.closest('.card'));
  paintDataState(id, null, null, error);
}

function showStat(id, data, animate = true) {
  const el = document.getElementById(id);
  if (!el) return;
  UIComponents.updateStats(el, data, animate);
  releaseCardFrame(el.closest('.card'));
}

function changeDuration(value) {
  draftDuration = value;
  updSel();
}
