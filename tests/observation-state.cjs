'use strict';
// Observation is evidence over time, not two passing endpoint snapshots.
const REQUIRED_HOURS = 1;
const SAMPLE_INTERVAL_MINUTES = 15;
function complete(samples, startedAt, requiredHours = REQUIRED_HOURS) {
  const start = Date.parse(startedAt);
  const requiredSamples = requiredHours * 60 / SAMPLE_INTERVAL_MINUTES + 1;
  if (!Number.isFinite(start) || requiredHours !== REQUIRED_HOURS || samples.length < requiredSamples) return false;
  if (samples.some(row => !row.passed)) return false;
  const times = samples.map(row => Date.parse(row.checkedAt)).sort((a, b) => a - b);
  if (times.some(time => !Number.isFinite(time) || time < start) || times[0] - start > 15 * 60000) return false;
  if (times.at(-1) - times[0] < requiredHours * 3600000) return false;
  const slots = new Set(times.map(time => Math.floor((time - times[0]) / (SAMPLE_INTERVAL_MINUTES * 60000))));
  if (slots.size < requiredSamples) return false;
  return times.every((time, index) => !index || time - times[index - 1] <= 2 * SAMPLE_INTERVAL_MINUTES * 60000);
}
module.exports = { complete, REQUIRED_HOURS, SAMPLE_INTERVAL_MINUTES };
