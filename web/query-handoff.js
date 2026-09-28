'use strict';

// A small, explicit draft-control handoff. Navigating never starts a query.
const QueryHandoff = (() => {
  const durations = new Set([3600, 10800, 21600, 86400]);
  const modes = new Set(['stats', 'charts']);
  const filters = new Set(['all', 'v4', 'v6', 'ext']);
  const validId = value => /^[a-z0-9_-]{1,64}$/i.test(value);
  function valid(state, known) {
    if (!state || !Array.isArray(state.nodes) || !Array.isArray(state.fixed) ||
        state.nodes.length < 2 || state.nodes.length > 20 ||
        new Set(state.nodes).size !== state.nodes.length ||
        state.nodes.some(id => !validId(id) || known && !known.has(id)) ||
        new Set(state.fixed).size !== state.fixed.length ||
        state.fixed.some(id => !state.nodes.includes(id)) ||
        (state.fixed.length && state.fixed.length === state.nodes.length) ||
        !durations.has(Number(state.dur)) || !modes.has(state.mode) ||
        !filters.has(state.filter) || typeof state.unified !== 'boolean') return false;
    return true;
  }
  function encode(state) {
    if (!valid(state)) return '';
    const query = new URLSearchParams({ nodes: state.nodes.join(','),
      dur: String(state.dur), mode: state.mode, filter: state.filter,
      unified: state.unified ? '1' : '0' });
    if (state.fixed.length) query.set('anchor', state.fixed.join(','));
    return query.toString();
  }
  function decode(search, knownIds) {
    if (!search || search.length > 2048) return null;
    const query = new URLSearchParams(search);
    if (!query.has('nodes')) return null;
    const fields = ['nodes', 'anchor', 'dur', 'mode', 'filter', 'unified'];
    if (fields.some(key => query.getAll(key).length > 1)) return null;
    const nodes = query.get('nodes').split(',');
    const fixed = query.has('anchor') ? query.get('anchor').split(',') : [];
    const state = { nodes, fixed, dur: Number(query.get('dur')),
      mode: query.get('mode'), filter: query.get('filter'),
      unified: query.get('unified') === '1' };
    if (!['0', '1'].includes(query.get('unified'))) return null;
    return valid(state, new Set(knownIds)) ? state : null;
  }
  return { encode, decode };
})();

if (typeof module !== 'undefined') module.exports = QueryHandoff;
