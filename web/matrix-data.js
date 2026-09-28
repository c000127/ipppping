'use strict';

// A complete, frozen summary selection is required before any unified-axis chart is drawn.
const MatrixData = (() => {
  const PAGE_LIMIT = 32;
  const MAX_PAIRS = 500;
  const DURATIONS = new Set([3600, 10800, 21600, 86400]);
  const identity = pair => [pair.source, pair.target, pair.type || pair.protocol].join('\u0000');
  const fail = message => { throw new Error('Matrix contract: ' + message); };
  function selection(selected, anchors, dur, end) {
    if (!Array.isArray(selected) || selected.length < 2 || selected.length > 20 ||
        selected.some(id => typeof id !== 'string' || !id || id.includes(',')) ||
        new Set(selected).size !== selected.length) fail('invalid node selection');
    if (!Array.isArray(anchors) || new Set(anchors).size !== anchors.length ||
        anchors.some(id => !selected.includes(id))) fail('invalid Fixed selection');
    if (!DURATIONS.has(dur) || (end !== null && (!Number.isSafeInteger(end) || end % 60))) fail('invalid window');
    return { nodes: selected.join(','), anchor: anchors.join(','), dur: String(dur) };
  }
  function validItem(item, pair, end, dur) {
    if (!item || identity(item) !== identity(pair)) fail('pair order changed');
    if (item.error) {
      if (!['no_data', 'snapshot_changed', 'rrd_error'].includes(item.error)) fail('unknown route error');
      return;
    }
    const s = item.summary;
    if (item.schema !== 'ipppping.series.v2' || item.window?.start !== end - dur ||
        item.window?.end !== end || typeof item.snapshot_id !== 'string' ||
        !s || (s.max_median_ms !== null && (!Number.isFinite(s.max_median_ms) || s.max_median_ms < 0))) {
      fail('invalid v2 summary');
    }
  }
  async function load(selected, anchors, dur, end, fetchJson, signal, onProgress = () => {}) {
    const query = selection(selected, anchors, dur, end);
    const pairs = await fetchJson('/api/pairs?' + new URLSearchParams({ nodes: query.nodes, anchor: query.anchor }), signal);
    if (!Array.isArray(pairs) || pairs.length > MAX_PAIRS || pairs.some(pair =>
      !pair || typeof pair.source !== 'string' || typeof pair.target !== 'string' ||
      !['v4', 'v6'].includes(pair.type))) fail('invalid pair list');
    const items = [];
    let selectionId = null, maxMedian = 0, frozenEnd = end;
    while (items.length < pairs.length || !selectionId) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      const offset = items.length;
      const pageQuery = { ...query, offset: String(offset), limit: String(PAGE_LIMIT) };
      if (frozenEnd !== null) pageQuery.end = String(frozenEnd);
      const page = await fetchJson('/api/v2/summary-batch?' + new URLSearchParams(pageQuery), signal);
      if (!page || page.schema !== 'ipppping.summary-batch.v2' ||
          !/^[0-9a-f]{64}$/.test(page.selection_id || '') ||
          (selectionId && page.selection_id !== selectionId) ||
          !Number.isSafeInteger(page.end) || page.end % 60 ||
          (frozenEnd !== null && page.end !== frozenEnd) ||
          page.dur !== dur || page.total !== pairs.length ||
          page.offset !== offset || page.limit !== PAGE_LIMIT ||
          !Array.isArray(page.items) || page.items.length !== Math.min(PAGE_LIMIT, pairs.length - offset) ||
          page.next_offset !== (offset + page.items.length < pairs.length ? offset + page.items.length : null)) {
        fail('inconsistent summary page');
      }
      frozenEnd = page.end;
      selectionId = page.selection_id;
      page.items.forEach((item, index) => {
        validItem(item, pairs[offset + index], frozenEnd, dur);
        if (!item.error) maxMedian = Math.max(maxMedian, item.summary.max_median_ms || 0);
      });
      items.push(...page.items);
      onProgress(items.length, pairs.length);
    }
    return { pairs, items, selectionId, end: frozenEnd, dur, unifiedMax: Math.max(1, maxMedian) * 1.1 };
  }
  return { load, identity, PAGE_LIMIT, MAX_PAIRS };
})();
if (typeof module !== 'undefined') module.exports = MatrixData;
