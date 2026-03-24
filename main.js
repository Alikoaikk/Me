(function () {
  'use strict';

  /* ============================================================
     TYPEWRITER
     ============================================================ */
  class Typewriter {
    constructor(selector, phrases, options = {}) {
      this.el = document.querySelector(selector);
      this.phrases = phrases;
      this.typeSpeed = options.typeSpeed || 80;
      this.deleteSpeed = options.deleteSpeed || 45;
      this.pauseTime = options.pauseTime || 2200;
      this.index = 0;
    }

    start() {
      this._loop();
    }

    _wait(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    async _loop() {
      while (true) {
        const phrase = this.phrases[this.index % this.phrases.length];
        await this._type(phrase);
        await this._wait(this.pauseTime);
        await this._delete(phrase);
        await this._wait(400);
        this.index++;
      }
    }

    async _type(phrase) {
      for (let i = 0; i <= phrase.length; i++) {
        if (this.el) this.el.textContent = phrase.slice(0, i);
        await this._wait(this.typeSpeed);
      }
    }

    async _delete(phrase) {
      for (let i = phrase.length; i >= 0; i--) {
        if (this.el) this.el.textContent = phrase.slice(0, i);
        await this._wait(this.deleteSpeed);
      }
    }
  }

  /* ============================================================
     ANIMATED COUNTER
     ============================================================ */
  function animateCounter(el) {
    const target = parseInt(el.dataset.target, 10);
    const suffix = el.dataset.suffix || '';
    const duration = 1600;
    const start = performance.now();

    function step(now) {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.floor(eased * target) + suffix;
      if (progress < 1) requestAnimationFrame(step);
    }

    requestAnimationFrame(step);
  }

  /* ============================================================
     RENDER: HERO
     ============================================================ */
  function renderHero(data) {
    const { personal, socials } = data;

    document.getElementById('heroName').textContent = personal.name;

    // CTAs
    document.getElementById('heroCTAs').insertAdjacentHTML('beforeend', `
      <a href="${socials.github}" target="_blank" rel="noopener" class="btn-primary">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
        GitHub
      </a>
      <a href="${socials.linkedin}" target="_blank" rel="noopener" class="btn-outline">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
        LinkedIn
      </a>
      <a href="mailto:${socials.email}" class="btn-outline">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,12 2,6"/></svg>
        Email
      </a>
    `);

    // Start typewriter
    new Typewriter('#typewriterText', [
      'Systems Engineer',
      'C Developer',
      '42 Student',
      'Open Source Builder',
      'Low-Level Programmer',
    ]).start();
  }

  /* ============================================================
     RENDER: ABOUT
     ============================================================ */
  function renderAbout(data) {
    const { personal, stats } = data;

    // Bio paragraphs
    const bio = document.getElementById('aboutBio');
    personal.bio.forEach((p, i) => {
      const el = document.createElement('p');
      el.className = 'reveal';
      el.style.transitionDelay = `${i * 0.12}s`;
      el.textContent = p;
      bio.appendChild(el);
    });

    // Stat cards
    const statCards = [
      { icon: '🚀', value: '9', suffix: '+', label: 'Projects Built' },
      { icon: '💻', value: '5', suffix: '+', label: 'Languages' },
      { icon: '🎓', value: '2', suffix: '', label: 'Universities' },
      { icon: '⚡', value: stats.level42.toString(), suffix: '', label: '42 Level' },
    ];

    const statsContainer = document.getElementById('aboutStats');
    statCards.forEach((s, i) => {
      const card = document.createElement('div');
      card.className = 'stat-card reveal';
      card.style.transitionDelay = `${i * 0.1}s`;
      card.innerHTML = `
        <span class="stat-card-icon">${s.icon}</span>
        <span class="stat-card-number" data-target="${s.value}" data-suffix="${s.suffix}">0${s.suffix}</span>
        <span class="stat-card-label">${s.label}</span>
      `;
      statsContainer.appendChild(card);
    });
  }

  /* ============================================================
     RENDER: SKILLS
     ============================================================ */
  function renderSkills(data) {
    const { skills } = data;
    const container = document.getElementById('skillsContainer');

    const groups = [
      { key: 'languages', label: 'Languages', cls: 'tag-lang' },
      { key: 'tools', label: 'Tools & IDEs', cls: 'tag-tool' },
      { key: 'technologies', label: 'Technologies', cls: 'tag-tech' },
    ];

    groups.forEach((g, gi) => {
      const group = document.createElement('div');
      group.className = 'skills-group reveal';
      group.style.transitionDelay = `${gi * 0.1}s`;

      const tagsHTML = skills[g.key]
        .map((skill, si) => `<span class="skill-tag ${g.cls}" style="transition-delay:${si * 0.05}s">${skill}</span>`)
        .join('');

      group.innerHTML = `
        <p class="skills-group-label">${g.label}</p>
        <div class="skills-tags">${tagsHTML}</div>
      `;

      container.appendChild(group);
    });
  }

  /* ============================================================
     RENDER: PROJECTS
     ============================================================ */
  function buildProjectCard(project, index) {
    const card = document.createElement('div');
    card.className = 'project-card reveal';
    card.style.transitionDelay = `${index * 0.07}s`;

    const techTags = project.tech
      .map(t => `<span class="tech-tag">${t}</span>`)
      .join('');

    const demoLink = project.demo
      ? `<a href="${project.demo}" target="_blank" rel="noopener" class="project-link project-link-demo">▶ Demo</a>`
      : '';

    card.innerHTML = `
      <div class="project-icon">${project.icon}</div>
      <h3 class="project-name">${project.name}</h3>
      <p class="project-description">${project.description}</p>
      <div class="project-tech">${techTags}</div>
      <div class="project-links">
        <a href="${project.github}" target="_blank" rel="noopener" class="project-link">↗ GitHub</a>
        ${demoLink}
      </div>
    `;

    return card;
  }

  function renderProjects(data) {
    const grid = document.getElementById('projectsGrid');

    data.projects.slice(0, 3).forEach((project, i) => {
      grid.appendChild(buildProjectCard(project, i));
    });

    // "View all" button below the grid
    const wrapper = grid.parentElement;
    const btnWrap = document.createElement('div');
    btnWrap.style.cssText = 'text-align:center; margin-top:3rem;';
    btnWrap.innerHTML = `<a href="projects.html" class="btn-primary" style="display:inline-flex;">
      View All Projects
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-left:6px"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
    </a>`;
    wrapper.appendChild(btnWrap);
  }

  /* ============================================================
     RENDER: EDUCATION
     ============================================================ */
  function renderEducation(data) {
    const container = document.getElementById('timeline');
    container.className = 'edu-grid';

    const descriptions = {
      '42 Beirut':
        'A project-based, peer-to-peer coding school with no lectures or teachers. Learning happens through hands-on projects, collaboration, and peer review — pushing students through systems programming, algorithms, and real-world software engineering.',
      'University of Science and Arts in Lebanon':
        'A traditional university offering a structured Computer Science curriculum covering algorithms, data structures, software engineering, databases, operating systems, and networking — building a solid theoretical and practical foundation in computing.',
    };

    data.education.forEach((edu, i) => {
      const card = document.createElement('div');
      card.className = 'edu-card reveal';
      card.style.transitionDelay = `${i * 0.12}s`;

      const levelBadge = edu.level
        ? `<span class="edu-badge edu-badge-cyan">${edu.level}</span>`
        : '';

      const desc = descriptions[edu.institution] || '';

      card.innerHTML = `
        <div class="edu-card-front">
          <span class="edu-card-num">0${i + 1}</span>
          <div class="edu-card-header">
            <span class="edu-status-dot"></span>
            <span class="edu-period">${edu.period}</span>
          </div>
          <h3 class="edu-institution">${edu.institution}</h3>
          <div class="edu-divider"></div>
          <p class="edu-program">${edu.program}</p>
          <div class="edu-badges">
            <span class="edu-badge">${edu.badge}</span>
            ${levelBadge}
          </div>
        </div>
        <div class="edu-card-back">
          <p class="edu-back-desc">${desc}</p>
        </div>
      `;

      container.appendChild(card);
    });
  }

  /* ============================================================
     RENDER: CONTACT
     ============================================================ */
  function renderContact(data) {
    const { socials } = data;
    const section = document.getElementById('contactSection');

    section.innerHTML = `
      <div class="section-header reveal">
        <span class="section-tag">// contact</span>
        <h2 class="section-title contact-title">Let's Connect</h2>
      </div>
      <p class="contact-subtitle reveal">
        I'm open to opportunities, collaborations, and interesting conversations.
        Reach out — I'd love to hear from you.
      </p>
      <a href="mailto:${socials.email}" class="contact-email-link reveal">${socials.email}</a>
      <div class="contact-socials reveal">
        <a href="${socials.github}" target="_blank" rel="noopener" class="social-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
          GitHub
        </a>
        <a href="${socials.linkedin}" target="_blank" rel="noopener" class="social-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
          LinkedIn
        </a>
      </div>
    `;
  }

  /* ============================================================
     RENDER: FOOTER
     ============================================================ */
  function renderFooter(data) {
    document.getElementById('footerText').textContent =
      `© ${new Date().getFullYear()} ${data.personal.name}`;
  }

  /* ============================================================
     SCROLL ANIMATIONS
     ============================================================ */
  function initScrollAnimations() {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const el = entry.target;

        // Trigger counter if this element has a counter inside
        const counter = el.querySelector('[data-target]');
        if (counter) animateCounter(counter);

        el.classList.add('animate-in');
        el.style.transitionDelay = '0s';
        observer.unobserve(el);
      });
    }, {
      threshold: 0.15,
      rootMargin: '0px 0px -50px 0px',
    });

    document.querySelectorAll('.reveal, .reveal-left').forEach(el => {
      observer.observe(el);
    });
  }

  /* ============================================================
     NAVBAR
     ============================================================ */
  function initNavbar() {
    const navbar = document.getElementById('navbar');
    const hamburger = document.getElementById('hamburger');
    const navLinks = document.getElementById('navLinks');
    const links = navLinks.querySelectorAll('a');

    // Hamburger toggle
    hamburger.addEventListener('click', () => {
      hamburger.classList.toggle('open');
      navLinks.classList.toggle('open');
    });

    // Close on link click (mobile)
    links.forEach(link => {
      link.addEventListener('click', () => {
        hamburger.classList.remove('open');
        navLinks.classList.remove('open');
      });
    });

    // Scroll: scrolled class + active link
    const sections = document.querySelectorAll('section[id]');

    function onScroll() {
      // Navbar background
      navbar.classList.toggle('scrolled', window.scrollY > 50);

      // Active link
      let current = '';
      sections.forEach(section => {
        const sectionTop = section.offsetTop - 120;
        if (window.scrollY >= sectionTop) {
          current = section.getAttribute('id');
        }
      });

      links.forEach(link => {
        link.classList.toggle('active', link.getAttribute('href') === `#${current}`);
      });
    }

    const progressBar = document.getElementById('scrollProgress');
    function updateProgress() {
      const scrolled = window.scrollY;
      const total = document.documentElement.scrollHeight - window.innerHeight;
      progressBar.style.width = (total > 0 ? (scrolled / total) * 100 : 0) + '%';
    }
    window.addEventListener('scroll', updateProgress, { passive: true });

    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll(); // run once on load
  }

  /* ============================================================
     INIT
     ============================================================ */
  document.addEventListener('DOMContentLoaded', () => {
    const data = window.portfolioData;
    if (!data) {
      console.error('portfolioData not found. Make sure data.js is loaded before main.js.');
      return;
    }

    renderHero(data);
    renderAbout(data);
    renderSkills(data);
    renderProjects(data);
    renderEducation(data);
    renderContact(data);
    renderFooter(data);

    initScrollAnimations();
    initNavbar();
  });

})();
