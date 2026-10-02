/* ============================================================
   WORK — the projects as a plain list (work.html)
   ------------------------------------------------------------
   The same projects, in the same order and with the same fields, as
   the card the system opens for a body (projectHtml() in hud.js):
   number, icon, name, description, tech, and the Demo / Source
   links. Change the two together. Reads window.portfolioData and
   writes one <li> per project; no canvas, no animation.
   ============================================================ */
(function () {
  'use strict';

  const data = window.portfolioData;
  const list = document.getElementById('workList');
  if (!data || !list) return;

  const esc = s => String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const projects = data.projects || [];

  list.innerHTML = projects.map((pr, i) => {
    const tech = (pr.tech || []).map(t => `<li>${esc(t)}</li>`).join('');
    const links =
      (pr.demo ? `<a href="${esc(pr.demo)}" target="_blank" rel="noopener" aria-label="${esc(pr.name)}: demo">▶ Demo</a>` : '') +
      (pr.github ? `<a href="${esc(pr.github)}" target="_blank" rel="noopener" aria-label="${esc(pr.name)}: source">↗ Source</a>` : '');
    return `
      <li class="work-card">
        <div class="work-card-top">
          ${pr.icon ? `<span class="work-card-icon" aria-hidden="true">${esc(pr.icon)}</span>` : '<span></span>'}
          <span class="work-card-num">${String(i + 1).padStart(2, '0')}</span>
        </div>
        <h2 class="work-card-title">${esc(pr.name || '')}</h2>
        <p class="work-card-desc">${esc(pr.description || '')}</p>
        ${tech ? `<ul class="work-card-tags" aria-label="Built with">${tech}</ul>` : ''}
        ${links ? `<p class="work-card-links">${links}</p>` : ''}
      </li>`;
  }).join('');

  const lead = document.getElementById('workLead');
  if (lead && projects.length) {
    lead.textContent = `The ${projects.length} projects that orbit in the system, as a plain list.`;
  }
})();
