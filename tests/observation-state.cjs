'use strict';
// Observation is evidence over time, not two passing endpoint snapshots.
const REQUIRED_HOURS = 12;
function complete(samples, startedAt, requiredHours = REQUIRED_HOURS) {
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start) || requiredHours !== REQUIRED_HOURS || samples.length < requiredHours + 1) return false;
  if (samples.some(row => !row.passed)) return false;
  const times = samples.map(row => Date.parse(row.checkedAt)).sort((a, b) => a - b);
  if (times.some(time => !Number.isFinite(time) || time < start) || times[0] - start > 15 * 60000) return false;
  if (times.at(-1) - times[0] < requiredHours * 3600000) return false;
  const hours = new Set(times.map(time => Math.floor((time - times[0]) / 3600000)));
  if (hours.size < requiredHours + 1) return false;
  return times.every((time, index) => !index || time - times[index - 1] <= 2 * 3600000);
}
module.exports = { complete, REQUIRED_HOURS };
