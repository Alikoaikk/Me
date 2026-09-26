/* ============================================================
   THE PROFILE — the name screen's links, and who Ali is below it
   ------------------------------------------------------------
   Fills, from portfolioData:
     • the contact links under the star-written name (GitHub,
       LinkedIn, Email), which scroll with it;
     • the profile section below the name: who Ali is, the status,
       the numbers (projects, 42 level, languages, universities), the
       schools, and the line above the launch button.
   Reveals the profile's parts in order as they come into view, and
   counts the numbers up the first time they do. The cue at the foot
   of the name screen smooth-scrolls to it.

   galaxy.js owns the sky, the name and the button's action; this
   file only writes text into the page. It needs the DOM and data.js.
   ============================================================ */
(function () {
  'use strict';

  const data = window.portfolioData;
  if (!data) return;
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pp = data.personal || {}, st = data.stats || {}, so = data.socials || {};
  const projects = data.projects || [];

  /* ── The links under the name ── */
  const ICONS = {
    github: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.42-2.7 5.39-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z"/></svg>',
    linkedin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.36V9h3.41v1.56h.05c.47-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12ZM7.12 20.45H3.56V9h3.56v11.45ZM22.22 0H1.77C.8 0 0 .77 0 1.72v20.56C0 23.23.8 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0Z"/></svg>',
    email: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M3.5 5.5h17a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-17a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1Zm0 .5 8.5 7 8.5-7"/></svg>',
  };
  const links = [
    so.github && { key: 'github', label: 'GitHub', href: so.github, ext: true },
    so.linkedin && { key: 'linkedin', label: 'LinkedIn', href: so.linkedin, ext: true },
    (so.email || pp.email) && { key: 'email', label: 'Email', href: 'mailto:' + (so.email || pp.email), ext: false },
  ].filter(Boolean);
  const linksEl = $('gnameLinks');
  if (linksEl) linksEl.innerHTML = links.map(l =>
    `<a class="gname-link" href="${esc(l.href)}"${l.ext ? ' target="_blank" rel="noopener"' : ''}>${ICONS[l.key]}<span>${esc(l.label)}</span></a>`).join('');

  /* ── The cue: to the profile ── */
  const cue = $('gnameCue');
  if (cue) cue.addEventListener('click', e => {
    const target = $('profile');
    if (!target || !document.documentElement.classList.contains('is-written')) return;
    e.preventDefault();
    window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.12, behavior: reduce ? 'auto' : 'smooth' });
  });

  /* ── The profile ── */
  const set = (id, v) => { const el = $(id); if (el) el.textContent = v || ''; };
  set('profileTitle', pp.brief || (pp.bio && pp.bio[0]) || pp.name);
  set('profileStatus', [pp.status, pp.location].filter(Boolean).join(' · '));
  const bio = $('profileBio');
  // The brief already leads; the bio's own first paragraph restates it.
  if (bio) bio.innerHTML = (pp.bio || []).slice(pp.brief ? 1 : 0).map(p => `<p>${esc(p)}</p>`).join('');
  const STATS = [
    ['Projects', projects.length || st.projects],
    ['42 level', st.level42],
    ['Languages', st.languages],
    ['Universities', st.universities],
  ].filter(([, v]) => v !== undefined && v !== null && v !== '');
  const stats = $('profileStats');
  if (stats) stats.innerHTML = STATS.map(([k, v]) => {
    const m = String(v).match(/^(\d+)(.*)$/);
    return `<div class="profile-stat"><dt>${esc(k)}</dt><dd><span class="profile-num" data-value="${m ? esc(m[1]) : ''}">${esc(m ? m[1] : v)}</span>${esc(m ? m[2] : '')}</dd></div>`;
  }).join('');
  const schools = $('profileSchools');
  if (schools) schools.innerHTML = (data.education || []).map(e => `
    <div class="profile-school">
      <span class="profile-school-period">${esc(e.period || '')}</span>
      <span class="profile-school-name">${esc(e.institution || '')}</span>
      <span class="profile-school-program">${esc(e.level ? e.level + ' · ' + (e.badge || '') : (e.program || ''))}</span>
    </div>`).join('');
  set('profileLead', projects.length
    ? `${projects.length} projects, one system. Come and see them.`
    : 'Come and see the projects.');

  /* ── Reveal and count-up ──
     Each part lifts in as it enters the view, in order; the numbers
     run 0 → value the first time they are seen. Class-driven, so the
     CSS can transition it; scrolling back up leaves them in place. */
  const parts = document.querySelectorAll('.profile-inner > *');
  const easeOut = t => 1 - Math.pow(1 - t, 3);
  let counted = false;
  function countUp() {
    if (counted) return; counted = true;
    if (reduce) return;
    document.querySelectorAll('.profile-num[data-value]').forEach((el, i) => {
      const target = parseInt(el.dataset.value, 10);
      if (!Number.isFinite(target)) return;
      const t0 = performance.now() + 250 + i * 110, dur = 1000;
      el.textContent = '0';
      const tick = now => {
        const p = Math.min(1, Math.max(0, (now - t0) / dur));
        el.textContent = String(Math.round(target * easeOut(p)));
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }
  if ('IntersectionObserver' in window && !reduce) {
    const io = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('is-in');
        if (e.target.id === 'profileStats') countUp();
        io.unobserve(e.target);
      }
    }, { threshold: 0.2, rootMargin: '0px 0px -8% 0px' });
    parts.forEach(el => io.observe(el));
  } else {
    parts.forEach(el => el.classList.add('is-in'));
  }
})();
