'use strict';

// Shared by JSON and native PNG requests. No production dependency/build step.
const RequestState = (() => {
  const abortError = () => new DOMException('Request cancelled', 'AbortError');
  class Pool {
    constructor(limit = 4) { this.limit = limit; this.active = 0; this.queue = []; }
    run(work, signal) {
      return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(abortError());
        const job = { work, signal, resolve, reject };
        job.cancel = () => {
          const index = this.queue.indexOf(job);
          if (index >= 0) { this.queue.splice(index, 1); reject(abortError()); }
        };
        signal?.addEventListener('abort', job.cancel, { once: true });
        this.queue.push(job);
        this.drain();
      });
    }
    drain() {
      while (this.active < this.limit && this.queue.length) {
        const job = this.queue.shift();
        job.signal?.removeEventListener('abort', job.cancel);
        if (job.signal?.aborted) { job.reject(abortError()); continue; }
        this.active++;
        Promise.resolve().then(() => {
          if (job.signal?.aborted) throw abortError();
          return job.work();
        }).then(job.resolve, job.reject).finally(() => { this.active--; this.drain(); });
      }
    }
  }
  function delay(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(abortError());
      const done = () => { signal?.removeEventListener('abort', cancel); resolve(); };
      const timer = setTimeout(done, ms);
      const cancel = () => { clearTimeout(timer); reject(abortError()); };
      signal?.addEventListener('abort', cancel, { once: true });
    });
  }
  function retryDelay(header, attempt, now = Date.now()) {
    const seconds = Number(header);
    const until = header && !Number.isFinite(seconds) ? Date.parse(header) - now : seconds * 1000;
    return Math.max(0, Number.isFinite(until) ? until : 0,
      500 * 2 ** attempt + Math.random() * 250);
  }
  function dataStatus(data, cachedAt, now = Date.now(), error = null) {
    const stamp = data?.measurement_updated_at;
    const measured = Number.isFinite(stamp) && stamp > 0;
    const age = measured ? now / 1000 - stamp : null;
    const expired = !Number.isFinite(cachedAt) || now - cachedAt > 60000 || cachedAt > now + 60000;
    const stale = measured && age > (data.stale_after_seconds || 600);
    let state = 'unknown';
    let label = 'Measurement time unknown';
    if (data?.measurement_state === 'missing') { state = 'missing'; label = 'No measurement'; }
    else if (measured && age < -60) { state = 'unknown'; label = 'Clock mismatch'; }
    else if (stale) { state = 'stale'; label = 'Stale measurement'; }
    else if (measured) {
      state = 'measured';
      label = data.current_loss_pct === 100 ? 'Latest probe: 100% loss' : 'Last measurement';
    }
    if (expired && data) { state = 'stale'; label += ' · cached / refresh needed'; }
    if (error) { state = 'error'; label += error === 'no_data' ? ' · no RRD data' : ' · refresh failed'; }
    return { state, label, timestamp: measured ? stamp : null };
  }
  return { Pool, delay, retryDelay, dataStatus };
})();
if (typeof module !== 'undefined') module.exports = RequestState;
