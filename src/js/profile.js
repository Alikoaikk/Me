/* ============================================================
   THE PROFILE — the name screen's links, and the page below it
   ------------------------------------------------------------
   Fills, from portfolioData:
     • the block under the star-written name — what Ali is and
       works on, place and status, and the text links (to his work,
       GitHub, LinkedIn, Email) — which scrolls with it;
     • the profile below the name, which reads like a normal site:
         #about      the brief, the bio, status and links, beside the
                     portrait — Ali in a floating circle with the
                     numbers (projects, 42 level, languages,
                     universities) as bodies in orbit around him;
         #stack      languages → tools & IDEs → technologies;
         #education  one card per school, its story on hover;
         #build      the line above the launch button.
   And runs the top bar: it appears once the reader is into the
   profile (:root.nav-on), marks the section in view, and scrolls to
   a section when a link is pressed (Posts and Activities are plain
   links to their own pages). When TARS comes into view the system
   page's files are prefetched. And with a section's hash in the URL
   the page is scrolled straight to it.

   Each section comes in once, when it enters the view (.is-in); the
   numbers count up then. The cue at the foot of the name screen
   smooth-scrolls to the first section.

   galaxy.js owns the sky, the name and the button's action; this
   file only writes the page. It needs the DOM and data.js.
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
  /* The name screen: type only. The headline in data.js is "what he
     is · what he works on"; the first part is set in small capitals
     and the rest as one light line under it (a headline without the
     dot is all light line). Then place and status as plain words,
     and the outside links as text — no icons, no pills. */
  const setText = (id, v) => { const el = $(id); if (el) { el.textContent = v || ''; el.hidden = !v; } return el; };
  const head = String(pp.headline || pp.degree || '').split(/\s+·\s+/);
  setText('gnameRole', head.length > 1 ? head[0] : '');
  setText('gnameFocus', head.length > 1 ? head.slice(1).join(' · ') : head[0]);
  const meta = $('gnameMeta');
  if (meta) {
    const bits = [pp.location, pp.status].filter(Boolean);
    meta.innerHTML = bits.map(b => `<span>${esc(b)}</span>`).join('');
    meta.hidden = !bits.length;
  }
  const linksEl = $('gnameLinks');
  if (linksEl) linksEl.innerHTML = links.map(l =>
    `<a class="gname-link" href="${esc(l.href)}"${l.ext ? ' target="_blank" rel="noopener"' : ''}>${esc(l.label)}</a>`).join('');

  /* ── Going to a section ──
     One function for the cue, the top bar and the orbit's bodies.
     Sections carry their own top padding, so top-to-top is right. */
  const profile = $('profile');
  function goTo(el) {
    if (!el || !document.documentElement.classList.contains('is-written')) return false;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY, behavior: reduce ? 'auto' : 'smooth' });
    return true;
  }
  const cue = $('gnameCue');
  if (cue) cue.addEventListener('click', e => { if (goTo(profile)) e.preventDefault(); });
  const work = $('gnameWork');
  if (work) work.addEventListener('click', e => { if (goTo($('build'))) e.preventDefault(); });

  /* ── About ──
     The copy is the bio, its first paragraph larger; names worth the
     eye (schools, the degree, C) are set bold, the way the reference
     page does it. Beside it a 2x2 grid of numbers that count up, and
     the portrait in a frame (initials until a photo really loads). */
  const set = (id, v) => { const el = $(id); if (el) el.textContent = v || ''; };
  const education = data.education || [], skills = data.skills || {};
  const KEY = /(42 Beirut|University of Science and Arts in Lebanon|Computer Science|low-level programming|systems design|memory management in C|multithreading|shell pipelines)/g;
  const bio = $('profileBio');
  if (bio) bio.innerHTML = (pp.bio || [pp.brief]).filter(Boolean).map(p => `<p>${esc(p).replace(KEY, '<strong>$1</strong>')}</p>`).join('');
  set('aboutStatus', [pp.location, pp.status].filter(Boolean).join(' — '));
  const pfLinks = $('profileLinks');
  if (pfLinks) pfLinks.innerHTML = links.map(l =>
    `<a class="gname-link" href="${esc(l.href)}"${l.ext ? ' target="_blank" rel="noopener"' : ''}>${esc(l.label)}</a>`).join('');
  const STATS = [
    { label: 'Projects', value: projects.length || st.projects },
    { label: '42 level', value: st.level42 },
    { label: 'Languages', value: st.languages },
    { label: 'Universities', value: st.universities },
  ].filter(b => b.value !== undefined && b.value !== null && b.value !== '');
  const statsEl = $('aboutStats');
  if (statsEl) statsEl.innerHTML = STATS.map(b => {
    const m = String(b.value).match(/^(\d+)(.*)$/);
    return `<div class="ab-stat"><div class="ab-num"><span class="pf-num" data-value="${m ? esc(m[1]) : ''}">${esc(m ? m[1] : b.value)}</span>${m && m[2] ? esc(m[2]) : ''}</div><div class="ab-stat-label">${esc(b.label)}</div></div>`;
  }).join('');
  set('pfInitials', (pp.name || '').split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase());
  const photo = $('pfPhoto');
  if (photo && pp.photo) {
    photo.addEventListener('load', () => { photo.hidden = false; });
    photo.src = pp.photo;
  }
  const orbit = null;

  /* ── The stack: three stages, in the order they are reached for ── */
  const STAGES = [
    { label: 'Languages', items: skills.languages, tone: 'accent',
      icon: '<path d="m8.5 8-4 4 4 4M15.5 8l4 4-4 4M13.2 5.5l-2.4 13"/>' },
    { label: 'Tools & IDEs', items: skills.tools, tone: 'plain',
      icon: '<path d="M14.6 6.4a4 4 0 0 0-5.2 5.2L4 17l3 3 5.4-5.4a4 4 0 0 0 5.2-5.2l-2.6 2.6-2.2-.6-.6-2.2 2.4-2.8Z"/>' },
    { label: 'Technologies', items: skills.technologies, tone: 'blue',
      icon: '<path d="m12 4 8 4-8 4-8-4 8-4Zm-8 8 8 4 8-4M4 16l8 4 8-4"/>' },
  ].filter(g => g.items && g.items.length);
  const stack = $('profileStack');
  if (stack) stack.innerHTML = STAGES.map((g, i) => `
    <li class="pf-stage pf-rise" data-tone="${g.tone}" style="--d:${i}">
      <span class="pf-stage-node" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${g.icon}</svg></span>
      <h3 class="pf-stage-title">${esc(g.label)}</h3>
      <ul class="pf-chips">${g.items.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
    </li>`).join('');

  /* ── Career: a timeline ──
     One row per entry of data.education, newest first as written:
     the period, then what and where. */
  const edu = $('profileEdu');
  if (edu) edu.innerHTML = education.map((e, i) => `
    <li class="tl-item pf-rise" style="--d:${i + 2}">
      <span class="tl-dot" aria-hidden="true"></span>
      <span class="tl-date">${esc(e.period || '')}</span>
      <div class="tl-body">
        <h3>${esc(e.institution || '')}</h3>
        <p>${esc(e.program || '')}${e.level ? ` · ${esc(e.level)}` : ''}</p>
      </div>
    </li>`).join('');

  /* ── What I build ── */
  set('profileLead', projects.length
    ? `${projects.length} projects, one system. Each is a living model you can fly around.`
    : 'Come and see the projects.');

  /* ── The top bar ──
     On once the reader is half a screen from the profile's top, off
     again above that — and whenever the profile itself is not there
     (before the name is written, after the launch). The scroll read
     is one offsetTop per frame at most, and writes only on a change. */
  const root = document.documentElement;
  const nav = $('siteNav'), navLinks = $('navLinks');
  const blob = navLinks && navLinks.querySelector('.site-nav-blob');
  const secLinks = navLinks ? Array.from(navLinks.querySelectorAll('a[data-sec]')) : [];
  let navOn = false, navTick = false, activeSec = '';
  function placeBlob() {
    const a = secLinks.find(l => l.dataset.sec === activeSec);
    if (!blob || !a) return;
    // Set on a change of section only, so the CSS may ease it: the
    // left and the width run on different curves and the pill
    // stretches toward the new link before it settles.
    blob.style.setProperty('--bx', a.offsetLeft + 'px');
    blob.style.setProperty('--bw', a.offsetWidth + 'px');
    // On a narrow screen the links scroll sideways inside the bar:
    // bring the current one to the middle.
    if (navLinks.scrollWidth > navLinks.clientWidth + 1)
      navLinks.scrollTo({ left: a.offsetLeft - (navLinks.clientWidth - a.offsetWidth) / 2, behavior: reduce ? 'auto' : 'smooth' });
  }
  function setActive(key) {
    if (key === activeSec) return;
    activeSec = key;
    secLinks.forEach(l => {
      const on = l.dataset.sec === key;
      l.classList.toggle('is-active', on);
      if (on) l.setAttribute('aria-current', 'true'); else l.removeAttribute('aria-current');
    });
    placeBlob();
  }
  function navCheck() {
    navTick = false;
    const on = !!profile && profile.offsetParent !== null &&
      window.scrollY >= profile.offsetTop - window.innerHeight * 0.5;
    if (on === navOn) return;
    navOn = on;
    root.classList.toggle('nav-on', on);
    if (on) placeBlob();
  }
  if (nav && profile) {
    const onScroll = () => { if (!navTick) { navTick = true; requestAnimationFrame(navCheck); } };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', () => { onScroll(); placeBlob(); }, { passive: true });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(placeBlob);
    secLinks.forEach(l => l.addEventListener('click', e => {
      if (goTo($(l.dataset.sec))) e.preventDefault();
    }));
    onScroll();
  }
  if (orbit) orbit.querySelectorAll('a.pf-body').forEach(b => b.addEventListener('click', e => {
    if (goTo($(b.getAttribute('href').slice(1)))) e.preventDefault();
  }));

  /* ── Reveal, count-up, and the section in view ──
     A section comes in once, as a whole, when it enters the view
     (.is-in; the order inside it is CSS); the numbers run 0 → value
     with the first. Scrolling back up leaves everything in place.
     A second observer watches a thin band across the middle of the
     screen: the section crossing it is the one the top bar marks. */
  const secs = Array.from(document.querySelectorAll('.pf-sec'));
  const easeOut = t => 1 - Math.pow(1 - t, 3);
  let counted = false;
  function countUp() {
    if (counted) return; counted = true;
    if (reduce) return;
    document.querySelectorAll('.pf-num[data-value]').forEach((el, i) => {
      const target = parseInt(el.dataset.value, 10);
      if (!Number.isFinite(target)) return;
      const t0 = performance.now() + 450 + i * 90, dur = 900;
      el.textContent = '0';
      const tick = now => {
        const p = Math.min(1, Math.max(0, (now - t0) / dur));
        el.textContent = String(Math.round(target * easeOut(p)));
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }
  /* The system's page is the heavy one (three.js is 2 MB). Once the
     reader has reached TARS its files are fetched — only fetched,
     at the lowest priority, into the HTTP cache — so the page opens
     at once on the press. Nothing is parsed or run here. */
  let prefetched = false;
  function prefetchSystem() {
    if (prefetched) return; prefetched = true;
    const conn = navigator.connection;
    if (conn && (conn.saveData || /2g/.test(conn.effectiveType || ''))) return;
    ['system.html', 'js/system.js', 'js/emblems.js', 'js/hud.js', 'js/warp.js',
     'js/vendor/three/three.module.js', 'js/vendor/three/three.core.js',
     'js/vendor/three/addons/controls/OrbitControls.js'].forEach(href => {
      const l = document.createElement('link');
      l.rel = 'prefetch'; l.href = href;
      document.head.appendChild(l);
    });
  }
  if ('IntersectionObserver' in window) {
    if (reduce) secs.forEach(el => el.classList.add('is-in'));
    else {
      const io = new IntersectionObserver(entries => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add('is-in');
          if (e.target.id === 'about') countUp();
          if (e.target.id === 'build') prefetchSystem();
          io.unobserve(e.target);
        }
      }, { threshold: 0.14, rootMargin: '0px 0px -8% 0px' });
      secs.forEach(el => io.observe(el));
    }
    const mid = new IntersectionObserver(entries => {
      for (const e of entries) if (e.isIntersecting) setActive(e.target.id);
    }, { rootMargin: '-45% 0px -54% 0px' });
    secs.forEach(el => mid.observe(el));
  } else {
    secs.forEach(el => el.classList.add('is-in'));
  }
  if (!activeSec && secs.length) setActive(secs[0].id);

  /* ── Arriving at a section: galaxy.html#education ──
     The top bar on the other pages links here by hash. galaxy.js has
     then opened the page with the name already written (.is-written),
     so the profile exists; the sections are filled now, so their
     places are final. An instant jump — style.css makes scrolling
     smooth by default, and a glide through four screens is not an
     arrival. */
  const want = /^#(about|stack|education|build)$/.test(window.location.hash) && $(window.location.hash.slice(1));
  if (want && root.classList.contains('is-written'))
    window.scrollTo({ top: want.getBoundingClientRect().top + window.scrollY, behavior: 'instant' });
})();
