const assert = require('node:assert/strict');
const Handoff = require('../web/query-handoff.js');

const ids = ['akari_jp', 'legendsg', 'google_dns'];
const state = { nodes: ids, fixed: ['akari_jp', 'legendsg'],
  dur: 10800, mode: 'charts', filter: 'ext', unified: true };
const query = Handoff.encode(state);
assert.deepEqual(Handoff.decode('?' + query, ids), state);
assert.deepEqual(Handoff.decode('?' + Handoff.encode({ ...state, fixed: [], mode: 'stats' }), ids),
  { ...state, fixed: [], mode: 'stats' });
for (const bad of [
  { ...state, nodes: ['akari_jp', 'akari_jp'] },
  { ...state, nodes: ['akari_jp'] },
  { ...state, fixed: ['missing'] },
  { ...state, fixed: ids },
  { ...state, dur: 123 },
  { ...state, mode: 'secret' },
  { ...state, filter: 'unknown' },
  { ...state, unified: 'yes' }
]) assert.equal(Handoff.encode(bad), '');
for (const bad of [
  '', '?nodes=akari_jp,missing&dur=10800&mode=charts&filter=all&unified=0',
  '?' + query + '&nodes=akari_jp,legendsg',
  '?' + query.replace('unified=1', 'unified=2'),
  '?' + query.replace('dur=10800', 'dur=123'),
  '?' + query.replace('anchor=akari_jp%2Clegendsg', 'anchor=google_dns%2Cgoogle_dns'),
  '?' + 'x'.repeat(2049)
]) assert.equal(Handoff.decode(bad, ids), null);
console.log('Query handoff validation passed');
