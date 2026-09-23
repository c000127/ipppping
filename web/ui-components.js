'use strict';

// DOM-only components; query/measurement state remains owned by app.js.
const UIComponents = (() => {
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function flash(element) {
    element._feedback?.cancel();
    if (!reducedMotion() && element.animate) {
      element._feedback = element.animate([{ opacity: .55 }, { opacity: 1 }], { duration: 160 });
    }
  }
  function updateStats(element, data, animate = false) {
    const values = [data?.current_ms, data?.avg_ms, data?.min_ms, data?.max_ms, data?.loss_pct];
    const latencies = values.slice(0, 4).filter(Number.isFinite);
    const microseconds = latencies.length > 0 && Math.max(...latencies) < 1;
    if (!element.querySelector('[data-metric]')) {
      const labels = ['current', 'avg', 'min', 'max', 'loss'];
      element.innerHTML = labels.map((label, i) => `${i === 1 ? '<div class="stat-support">' : ''}`
        + `<span class="stat-item ${i ? 'stat-secondary' : 'stat-primary'}" data-metric="${i}">`
        + `<span class="stat-label">${label}</span><span class="stat-value">`
        + '<span class="stat-number">—</span><span class="stat-unit"></span></span></span>'
        + (i === 4 ? '</div>' : '')).join('');
    }
    let changed = false;
    element.querySelectorAll('[data-metric]').forEach((item, i) => {
      const value = values[i], valid = Number.isFinite(value);
      const number = !valid ? '—' : i === 4 ? value.toFixed(1) : microseconds ? (value * 1000).toFixed(0) : value.toFixed(1);
      const unit = !valid ? '' : i === 4 ? '%' : microseconds ? 'μs' : 'ms';
      for (const [selector, text] of [['.stat-number', number], ['.stat-unit', unit]]) {
        const target = item.querySelector(selector);
        if (target.textContent !== text) { target.textContent = text; changed = true; }
      }
      if (i === 4) {
        item.classList.toggle('loss-ok', valid && value === 0);
        item.classList.toggle('loss-warn', valid && value > 0 && value <= 5);
        item.classList.toggle('loss-bad', valid && value > 5);
      }
    });
    element.classList.remove('stats-pending', 'stat-updated');
    if (animate && changed) flash(element);
  }

  // Index once per reconciliation, never scan the grid for every result.
  function cardIndex(grid, desired) {
    const cards = [...grid.querySelectorAll('.card[data-card-key]')];
    const keyed = new Map(cards.map(card => [card.dataset.cardKey, card]));
    const slots = new Map();
    const spare = [];
    for (const card of cards) {
      if (desired.has(card.dataset.cardKey)) continue; // reserve future exact matches
      spare.push(card);
      const key = card.dataset.slotKey;
      if (!slots.has(key)) slots.set(key, []);
      slots.get(key).push(card);
    }
    const used = new Set();
    let nextSpare = 0;
    return {
      cards,
      take(key, slot, reusePosition) {
        let card = keyed.get(key);
        if (card && used.has(card)) card = null;
        const candidates = slots.get(slot) || [];
        while (!card && candidates.length) {
          const candidate = candidates.pop();
          if (!used.has(candidate) && !candidate.classList.contains('card-removing')) card = candidate;
        }
        while (!card && reusePosition && nextSpare < spare.length) {
          const candidate = spare[nextSpare++];
          if (!used.has(candidate)) card = candidate;
        }
        if (card) used.add(card);
        return card || null;
      }
    };
  }

  function sidebarController() {
    const sidebar = document.getElementById('sidebar');
    const toggle = document.getElementById('toggleSidebar');
    const overlay = document.getElementById('overlay');
    const main = document.getElementById('mainArea');
    const media = window.matchMedia('(max-width: 768px)');
    let desktopOpen = true, mobileOpen = false;
    function apply(focus = false) {
      const open = media.matches ? mobileOpen : desktopOpen;
      if (!open && sidebar.contains(document.activeElement)) toggle.focus({ preventScroll: true });
      sidebar.inert = !open;
      sidebar.setAttribute('aria-hidden', String(!open));
      sidebar.classList.toggle('mobile-open', media.matches && open);
      sidebar.classList.toggle('collapsed', !media.matches && !open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close node controls' : 'Open node controls');
      overlay.classList.toggle('show', media.matches && open);
      main.inert = media.matches && open;
      if (focus && open) sidebar.querySelector('input:not(:disabled),button:not(:disabled),select')?.focus({ preventScroll: true });
    }
    function setOpen(open, focus = false) {
      if (media.matches) mobileOpen = open; else desktopOpen = open;
      apply(focus);
    }
    toggle.addEventListener('click', () => setOpen(!(media.matches ? mobileOpen : desktopOpen), true));
    overlay.addEventListener('click', () => setOpen(false));
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && (media.matches ? mobileOpen : desktopOpen)) {
        setOpen(false); toggle.focus(); event.preventDefault();
      }
      if (event.key !== 'Tab' || !media.matches || !mobileOpen) return;
      const controls = [toggle, ...sidebar.querySelectorAll('input:not(:disabled),button:not(:disabled),select')]
        .filter(el => el.getClientRects().length);
      const index = controls.indexOf(document.activeElement);
      if (event.shiftKey && index <= 0) { controls.at(-1)?.focus(); event.preventDefault(); }
      else if (!event.shiftKey && (index < 0 || index === controls.length - 1)) { toggle.focus(); event.preventDefault(); }
    });
    media.addEventListener('change', () => { mobileOpen = false; apply(); });
    apply();
    return { closeMobile: () => { if (media.matches) setOpen(false); } };
  }
  return { reducedMotion, flash, updateStats, cardIndex, sidebarController };
})();
