/* ============================================================
   POSTS — posts.html, the user's LinkedIn posts as LinkedIn embeds
   ------------------------------------------------------------
   Reads `posts` from window.portfolioData (newest first). An entry
   is a string or { url, height?, date? }, where `url` may be any of
   what LinkedIn hands out for a post:
     - the post's own link   linkedin.com/posts/…-activity-7123…-abcd
     - a feed link           linkedin.com/feed/update/urn:li:activity:7123…/
     - the embed link        linkedin.com/embed/feed/update/urn:li:share:7123…
     - the whole <iframe …> code from "Embed this post" (its height is
       then taken from the code too)
   Each becomes an <iframe> on linkedin.com/embed/feed/update/<urn>,
   lazy, faded in when it has loaded, with "Open on LinkedIn" under
   it. LinkedIn's frame does not size itself to the post: the height
   is the entry's `height`, the one in the pasted code, or
   DEFAULT_HEIGHT — set it per post when a long one is cut short.
   An entry that cannot be read is skipped with a console warning.
   ============================================================ */
(function () {
  'use strict';

  const data = window.portfolioData || {};
  const list = document.getElementById('postsList');
  if (!list) return;

  const DEFAULT_HEIGHT = 620;     // px; LinkedIn's frames are 400–900 tall
  const profile = data.socials && data.socials.linkedin;
  if (profile) {
    for (const id of ['postsEmptyLink', 'postsProfile']) {
      const a = document.getElementById(id);
      if (a) a.href = profile;
    }
  }

  const esc = s => String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* Any form of a post's link → { urn, height }. */
  function readPost(entry) {
    const raw = typeof entry === 'string' ? entry : (entry && entry.url) || '';
    let text = String(raw).trim();
    let height = entry && entry.height;
    const code = text.match(/<iframe[^>]*>/i);
    if (code) {
      const src = code[0].match(/src="([^"]+)"/i);
      const h = code[0].match(/height="(\d+)"/i);
      if (h && !height) height = +h[1];
      text = src ? src[1] : '';
    }
    try { text = decodeURIComponent(text); } catch (e) { /* keep it as it is */ }
    let m = text.match(/urn:li:(activity|share|ugcPost):(\d+)/);
    if (!m) m = text.match(/-(activity|share|ugcPost)-(\d{12,})/);
    if (!m) return null;
    return { urn: `urn:li:${m[1]}:${m[2]}`, height: height || DEFAULT_HEIGHT };
  }

  function dateLabel(d) {
    if (!d) return '';
    const t = new Date(d);
    return isNaN(t) ? String(d) : t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  const posts = (data.posts || []).map(entry => {
    const p = readPost(entry);
    if (!p) console.warn('[posts] cannot read this entry as a LinkedIn post:', entry);
    return p && { ...p, date: entry && entry.date };
  }).filter(Boolean);

  if (!posts.length) {
    const empty = document.getElementById('postsEmpty');
    if (empty) empty.hidden = false;
    return;
  }

  list.innerHTML = posts.map((p, i) => {
    const when = dateLabel(p.date);
    return `
      <li class="post">
        <div class="post-frame" style="--h: ${p.height}px">
          <iframe src="https://www.linkedin.com/embed/feed/update/${p.urn}" loading="${i < 2 ? 'eager' : 'lazy'}"
            title="LinkedIn post by Ali Koaik${when ? ', ' + esc(when) : ''}" allowfullscreen></iframe>
        </div>
        <p class="post-meta">
          ${when ? `<span class="post-date">${esc(when)}</span>` : '<span></span>'}
          <a class="post-open" href="https://www.linkedin.com/feed/update/${p.urn}/" target="_blank" rel="noopener">Open on LinkedIn <span aria-hidden="true">↗</span></a>
        </p>
      </li>`;
  }).join('');

  // Each frame shows once LinkedIn has painted it, not as a white box first.
  list.querySelectorAll('.post-frame iframe').forEach(f =>
    f.addEventListener('load', () => f.parentNode.classList.add('is-loaded'), { once: true }));

  const foot = document.getElementById('postsFoot');
  if (foot) foot.hidden = false;
})();
