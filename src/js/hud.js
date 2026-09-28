/* ============================================================
   THE HUD — what the reader reads while moving through the system
   ------------------------------------------------------------
   Everything in #planet that is text: the arrival caption, the pilot
   chip in the corner, the hint, and the panel that opens when a body
   is selected — the project's card, or the pilot's card for Koaik.
   Listens to the events system.js dispatches on the section
   (system:ready, system:select, system:fallback) and calls
   window.system.overview() to back out. Also the no-WebGL fallback:
   a plain list of the same content.

   galaxy.js owns the sky and the name, system.js the scene; this file
   never touches either. It only needs the DOM and data.js.
   ============================================================ */
(function () {
  'use strict';

  const data = window.portfolioData;
  const section = document.getElementById('planet');
  if (!data || !section) return;

  const esc = s => String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v || ''; };
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pp = data.personal || {}, ss = data.stats || {}, projects = data.projects || [];
  const initials = String(pp.name || '').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();

  /* The arrival caption. */
  if (data.planet) {
    set('planetName', data.planet.name);
    set('planetSub', data.planet.caption);
    set('planetHint', data.planet.hint);
  }

  /* The pilot chip: name and status, top corner, always there once
     the system is live; clicking it flies to Koaik and opens the pilot's
     card (clicking Koaik itself collapses the system). */
  set('chipName', pp.name);
  set('chipStatus', pp.status);
  set('chipInitials', initials);
  const chipPhoto = document.getElementById('chipPhoto');
  if (chipPhoto && pp.photo) {
    chipPhoto.addEventListener('load', () => { chipPhoto.hidden = false; });
    chipPhoto.alt = pp.name || '';
    chipPhoto.src = pp.photo;
  }
  const chip = document.getElementById('sysChip');
  if (chip) chip.addEventListener('click', () => { if (window.system) window.system.select('pilot'); });
  const home = document.getElementById('sysHome'), map = document.getElementById('sysMap');
  const goHome = () => { if (window.system) window.system.overview(); };
  if (home) home.addEventListener('click', goHome);
  if (map) map.addEventListener('click', goHome);

  /* The hint under the map. */
  const hint = document.getElementById('sysHint');
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  if (hint) hint.textContent = coarse
    ? 'Drag to orbit · Pinch to zoom · Tap a project · Tap the black hole to collapse it'
    : 'Drag to orbit · Scroll to zoom · Right-drag to slide · W A S D to fly, Shift to boost · Click a project · Click the black hole to collapse it';

  /* ── The panel ── */
  const panel = document.getElementById('sysPanel');
  const readouts = [['Missions', projects.length ? String(projects.length) : ss.projects], ['42 level', ss.level42], ['Languages', ss.languages], ['Universities', ss.universities]]
    .filter(([, v]) => v !== undefined && v !== null && v !== '');

  function pilotHtml() {
    const dl = readouts.map(([k, v]) => {
      const m = String(v).match(/^(\d+)(.*)$/);
      const num = m ? m[1] : '', suffix = m ? m[2] : String(v);
      return `<div class="probe-readout"><dt>${esc(k)}</dt><dd><span class="probe-num" data-value="${esc(num)}">${esc(num || v)}</span>${esc(suffix)}</dd></div>`;
    }).join('');
    return `
      <p class="probe-label">Pilot <span class="sep">—</span> ${esc(data.planet ? data.planet.name : '')}</p>
      <div class="probe-head">
        <div class="probe-portrait">
          ${pp.photo ? `<img src="${esc(pp.photo)}" alt="" onerror="this.remove()">` : ''}
          <span class="probe-initials" aria-hidden="true">${esc(initials)}</span>
        </div>
        <div class="probe-id">
          <h2 class="probe-title">${esc(pp.name || '')}</h2>
          <p class="probe-meta">${esc([pp.degree, pp.location].filter(Boolean).join(' · '))}</p>
          <p class="probe-status"><span class="dash-dot" aria-hidden="true"></span>${esc(pp.status || '')}</p>
        </div>
      </div>
      <p class="probe-desc">${esc(pp.brief || (pp.bio && pp.bio[0]) || '')}</p>
      <dl class="probe-readouts">${dl}</dl>
      <div class="probe-links">
        ${data.socials && data.socials.email ? `<a href="mailto:${esc(data.socials.email)}">Email</a>` : ''}
        ${data.socials && data.socials.github ? `<a href="${esc(data.socials.github)}" target="_blank" rel="noopener">GitHub ↗</a>` : ''}
        ${data.socials && data.socials.linkedin ? `<a href="${esc(data.socials.linkedin)}" target="_blank" rel="noopener">LinkedIn ↗</a>` : ''}
      </div>
      <button class="probe-back" type="button">← Back to the system</button>`;
  }
  function projectHtml(i, pr) {
    return `
      <p class="probe-label">Mission ${String(i + 1).padStart(2, '0')} <span class="sep">—</span> orbit ${i + 1}</p>
      <div class="probe-head">
        <span class="probe-icon" aria-hidden="true">${pr.icon || ''}</span>
        <div class="probe-id"><h2 class="probe-title">${esc(pr.name)}</h2></div>
      </div>
      <p class="probe-desc">${esc(pr.description || '')}</p>
      <ul class="probe-tags">${(pr.tech || []).map(t => `<li>${esc(t)}</li>`).join('')}</ul>
      <div class="probe-links">
        ${pr.demo ? `<a href="${esc(pr.demo)}" target="_blank" rel="noopener">▶ Demo</a>` : ''}
        ${pr.github ? `<a href="${esc(pr.github)}" target="_blank" rel="noopener">↗ Source</a>` : ''}
      </div>
      <button class="probe-back" type="button">← Back to the system</button>`;
  }

  let closeTimer = 0;
  function openPanel(html) {
    if (!panel) return;
    clearTimeout(closeTimer);
    panel.innerHTML = `<div class="probe-frame">${html}</div>`;
    panel.hidden = false;
    // Two frames so the transition runs from the closed state.
    requestAnimationFrame(() => requestAnimationFrame(() => panel.classList.add('is-open')));
    const back = panel.querySelector('.probe-back');
    if (back) back.addEventListener('click', () => { if (window.system) window.system.overview(); });
    countUp();
  }
  function closePanel() {
    if (!panel) return;
    panel.classList.remove('is-open');
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => { panel.hidden = true; }, 500);
  }
  /* The pilot's numbers count up from zero as the card lands. */
  const easeOut = t => 1 - Math.pow(1 - t, 3);
  function countUp() {
    if (reduce) return;
    panel.querySelectorAll('.probe-num[data-value]').forEach((el, i) => {
      const target = parseInt(el.dataset.value, 10);
      if (!Number.isFinite(target)) return;
      const t0 = performance.now() + 350 + i * 90, dur = 900;
      el.textContent = '0';
      const tick = now => {
        const p = Math.min(1, Math.max(0, (now - t0) / dur));
        el.textContent = String(Math.round(target * easeOut(p)));
        if (p < 1 && el.isConnected) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  section.addEventListener('system:select', e => {
    const d = e.detail || {};
    if (d.kind === 'pilot') openPanel(pilotHtml());
    else if (d.kind === 'project' && d.project) openPanel(projectHtml(d.index, d.project));
    else closePanel();
  });

  /* ── No WebGL, or the module never ran (file://): the same content
     as a plain list. ── */
  function fallback() {
    section.classList.add('planet--css');
    const box = document.getElementById('sysFallback');
    if (!box || box.childElementCount) return;
    box.hidden = false;
    box.innerHTML = `<div class="probe-frame">${pilotHtml().replace(/<button class="probe-back"[^]*?<\/button>/, '')}</div>` +
      projects.map((pr, i) => `<div class="probe-frame">${projectHtml(i, pr).replace(/<button class="probe-back"[^]*?<\/button>/, '')}</div>`).join('');
  }
  section.addEventListener('system:fallback', fallback);
  window.addEventListener('load', () => { setTimeout(() => { if (!window.koaik) fallback(); }, 1500); });
})();
