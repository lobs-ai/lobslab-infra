/**
 * app.js — Lobs Lab home page client
 * Fetches /api/services and renders service cards.
 * Auto-refreshes every 30 seconds.
 */

// ── Theme ─────────────────────────────────────────────────────────────────────
// Script is at bottom of body, DOM is ready.

(function initTheme() {
  const root = document.documentElement;
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;

  function isDark() {
    return root.getAttribute('data-theme') !== 'light';
  }

  function setTheme(dark) {
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
    localStorage.setItem('lobslab-theme', dark ? 'dark' : 'light');
    btn.textContent = dark ? '☀️' : '🌙';
    btn.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
  }

  // Initialize from stored preference (head script may have already set light)
  const stored = localStorage.getItem('lobslab-theme');
  if (stored === 'light') {
    setTheme(false);
  } else {
    setTheme(true); // dark default
  }

  btn.addEventListener('click', () => setTheme(!isDark()));
})();

// ── Constants ─────────────────────────────────────────────────────────────────

const REFRESH_MS = 30_000;

const grid        = document.getElementById('grid');
const emptyState  = document.getElementById('empty-state');
const errorState  = document.getElementById('error-state');
const errorDetail = document.getElementById('error-detail');
const heroStats   = document.getElementById('hero-stats');
const footerMeta  = document.getElementById('footer-meta');

// ── Service icons ─────────────────────────────────────────────────────────────

const ICON_MAP = {
  hub:      '🧩',
  grafana:  '📊',
  loki:     '📋',
  prom:     '📈',
  home:     '🏠',
  git:      '🗂️',
  portainer:'🐳',
  traefik:  '🔀',
  nextcloud:'☁️',
  vault:    '🔐',
  wiki:     '📚',
  dash:     '🖥️',
  monitor:  '👁️',
  mail:     '📬',
  blog:     '✍️',
  code:     '💻',
  notes:    '📝',
};

function serviceIcon(name) {
  const lower = name.toLowerCase();
  for (const [key, icon] of Object.entries(ICON_MAP)) {
    if (lower.includes(key)) return icon;
  }
  return '🌐';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Clean up a Traefik router name into a human-readable service name.
 * e.g. "lobslab-home@docker" → "Lobslab Home"
 *      "my-cool-app"         → "My Cool App"
 */
function formatName(raw) {
  const name = raw.replace(/@\w+$/, '');
  return name
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function showOnly(state) {
  grid.classList.toggle('hidden', state !== 'grid');
  emptyState.classList.toggle('hidden', state !== 'empty');
  errorState.classList.toggle('hidden', state !== 'error');
}

function renderSkeletons(count = 3) {
  grid.innerHTML = Array.from({ length: count }, () => `
    <div class="skeleton">
      <div class="skel-line skel-icon"></div>
      <div class="skel-line skel-title"></div>
      <div class="skel-line skel-url"></div>
    </div>
  `).join('');
  showOnly('grid');
}

function renderCard(service) {
  const isEnabled = service.status === 'enabled';
  const statusClass = isEnabled ? 'enabled' : 'disabled';
  const statusLabel = isEnabled ? 'enabled' : service.status;
  const icon = serviceIcon(service.name);

  return `
    <a class="card" href="${service.url}" target="_blank" rel="noopener noreferrer">
      <span class="card-icon">${icon}</span>
      <div class="card-top">
        <span class="card-name">${formatName(service.name)}</span>
        <span class="status-badge ${statusClass}">
          <span class="status-dot"></span>
          ${statusLabel}
        </span>
      </div>
      <span class="card-url">${service.hostname}</span>
      <span class="card-arrow">↗</span>
    </a>
  `;
}

function renderServices(services) {
  if (services.length === 0) {
    showOnly('empty');
    setHeroStats(0, true);
    return;
  }

  grid.innerHTML = services.map(renderCard).join('');
  showOnly('grid');

  const allHealthy = services.every(s => s.status === 'enabled');
  setHeroStats(services.length, allHealthy);

  // Populate the project dropdown from discovered services
  populateProjectDropdown(services);
}

function setHeroStats(count, allHealthy) {
  if (!heroStats) return;
  const label = `${count} service${count !== 1 ? 's' : ''}`;
  const health = allHealthy ? 'all healthy' : 'some issues';
  heroStats.innerHTML = `
    <span class="hero-stat-pill ${allHealthy ? '' : 'error'}">
      <span class="pulse-dot"></span>
      ${label} · ${health}
    </span>
  `;
}

function setFooterTime() {
  if (!footerMeta) return;
  const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  footerMeta.textContent = `Last updated ${now}`;
}

// ── Identity ──────────────────────────────────────────────────────────────────

async function loadIdentity() {
  const el = document.getElementById('identity-value');
  const copyBtn = document.getElementById('copy-id-btn');
  if (!el) return;

  try {
    const res = await fetch('/api/me');
    const data = await res.json();
    if (data.lobslab_id) {
      el.textContent = data.lobslab_id;

      if (copyBtn) {
        copyBtn.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(data.lobslab_id);
            copyBtn.textContent = '✅';
            copyBtn.classList.add('copied');
            setTimeout(() => {
              copyBtn.textContent = '📋';
              copyBtn.classList.remove('copied');
            }, 1800);
          } catch {
            // Fallback: select the text
            const range = document.createRange();
            range.selectNode(el);
            window.getSelection().removeAllRanges();
            window.getSelection().addRange(range);
          }
        });
      }
    } else {
      el.textContent = 'not set';
    }
  } catch {
    el.textContent = 'unavailable';
  }
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

async function loadServices(isInitial = false) {
  if (isInitial) {
    renderSkeletons();
  }

  try {
    const res = await fetch('/api/services');
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    const services = await res.json();
    renderServices(services);
    setFooterTime();
  } catch (err) {
    console.error('Failed to load services:', err);
    if (isInitial) {
      errorDetail.textContent = err.message ?? 'Unknown error';
      showOnly('error');
      heroStats.innerHTML = `
        <span class="hero-stat-pill error">
          <span class="pulse-dot"></span>
          unable to reach Traefik
        </span>
      `;
    } else {
      // On background refresh failures, keep existing cards visible
      if (footerMeta) {
        const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        footerMeta.textContent = `⚠ Refresh failed at ${now} · showing cached data`;
      }
    }
  }
}

// ── Tab navigation ────────────────────────────────────────────────────────────

(function initTabs() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabPanels = document.querySelectorAll('.tab-panel');

  function activateTab(targetTab) {
    tabBtns.forEach(btn => {
      const isActive = btn.dataset.tab === targetTab;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    tabPanels.forEach(panel => {
      const isActive = panel.id === `panel-${targetTab}`;
      panel.classList.toggle('hidden', !isActive);
    });
  }

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      activateTab(btn.dataset.tab);
      if (btn.dataset.tab === 'changelog') {
        loadChangelog();
      }
    });
  });
})();

// ── Feature Requests ──────────────────────────────────────────────────────────

const reqList      = document.getElementById('req-list');
const reqEmpty     = document.getElementById('req-empty');
const reqForm      = document.getElementById('req-form');
const reqTitleEl   = document.getElementById('req-title');
const reqDescEl    = document.getElementById('req-desc');
const reqTypeEl    = document.getElementById('req-type');
const reqProjectEl = document.getElementById('req-project');
const reqSubmitBtn = document.getElementById('req-submit-btn');
const reqFeedback  = document.getElementById('req-form-feedback');

const REQ_STATUS_LABELS = {
  pending:  'pending',
  planned:  'planned',
  building: 'building',
  done:     'done',
  wontdo:   "won't do",
};

const REQ_TYPE_LABELS = {
  feature: '💡 Feature',
  bug:     '🐛 Bug',
};

/** Populate the project dropdown from discovered services */
function populateProjectDropdown(services) {
  if (!reqProjectEl) return;
  // Keep the first "All / New idea" option
  while (reqProjectEl.options.length > 1) reqProjectEl.remove(1);
  for (const svc of services) {
    const name = formatName(svc.name);
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    reqProjectEl.appendChild(opt);
  }
}

// Update input placeholder based on type
if (reqTypeEl && reqTitleEl) {
  reqTypeEl.addEventListener('change', () => {
    reqTitleEl.placeholder = reqTypeEl.value === 'bug'
      ? 'Describe the bug…'
      : 'Suggest a new service or feature…';
  });
}

/**
 * Format a date string as a relative time label: "just now", "3 hours ago", etc.
 */
function relativeTime(isoString) {
  const diff = Date.now() - new Date(isoString).getTime();
  const secs  = Math.floor(diff / 1000);
  const mins  = Math.floor(secs / 60);
  const hours = Math.floor(mins / 60);
  const days  = Math.floor(hours / 24);

  if (secs < 60)   return 'just now';
  if (mins < 60)   return `${mins} minute${mins !== 1 ? 's' : ''} ago`;
  if (hours < 24)  return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
  if (days < 30)   return `${days} day${days !== 1 ? 's' : ''} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months !== 1 ? 's' : ''} ago`;
  const years = Math.floor(days / 365);
  return `${years} year${years !== 1 ? 's' : ''} ago`;
}

function renderReqItem(req) {
  const status    = req.status ?? 'pending';
  const label     = REQ_STATUS_LABELS[status] ?? status;
  const desc      = req.description
    ? `<p class="req-item-desc">${escapeHtml(req.description)}</p>`
    : '';
  const time      = relativeTime(req.created_at);
  const typeLabel = REQ_TYPE_LABELS[req.type] ?? '💡 Feature';
  const projectTag = req.project
    ? `<span class="req-tag req-tag-project">${escapeHtml(req.project)}</span>`
    : '';
  // "Shipped" indicator for done items
  const shippedIndicator = status === 'done'
    ? `<span class="req-shipped-badge">✅ shipped</span>`
    : '';

  return `
    <div class="req-item${status === 'done' ? ' req-item-done' : ''}" data-id="${escapeHtml(req.id)}">
      <div class="req-item-body">
        <div class="req-item-header">
          <span class="req-item-title">${escapeHtml(req.title)}</span>
          <div class="req-item-badges">
            ${shippedIndicator}
            <span class="req-badge ${escapeHtml(status)}">${escapeHtml(label)}</span>
          </div>
        </div>
        <div class="req-item-tags">
          <span class="req-tag req-tag-type">${typeLabel}</span>
          ${projectTag}
        </div>
        ${desc}
        <p class="req-item-meta">${time}</p>
      </div>
    </div>
  `;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderReqList(requests) {
  if (!reqList || !reqEmpty) return;

  if (requests.length === 0) {
    reqList.innerHTML = '';
    reqEmpty.classList.remove('hidden');
    return;
  }

  reqEmpty.classList.add('hidden');
  reqList.innerHTML = requests.map(renderReqItem).join('');
}

function setFeedback(msg, type) {
  if (!reqFeedback) return;
  reqFeedback.textContent = msg;
  reqFeedback.className = 'req-form-feedback' + (type ? ` ${type}` : '');
}

async function loadRequests() {
  try {
    const res = await fetch('/api/requests');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderReqList(data);
  } catch (err) {
    console.error('Failed to load feature requests:', err);
  }
}

if (reqForm) {
  reqForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const title       = reqTitleEl   ? reqTitleEl.value.trim()   : '';
    const description = reqDescEl    ? reqDescEl.value.trim()    : '';
    const type        = reqTypeEl    ? reqTypeEl.value           : 'feature';
    const project     = reqProjectEl ? reqProjectEl.value        : '';

    if (!title) {
      setFeedback('Please enter a title for your request.', 'error');
      reqTitleEl && reqTitleEl.focus();
      return;
    }
    if (title.length > 100) {
      setFeedback('Title must be 100 characters or fewer.', 'error');
      reqTitleEl && reqTitleEl.focus();
      return;
    }
    if (description.length > 500) {
      setFeedback('Description must be 500 characters or fewer.', 'error');
      reqDescEl && reqDescEl.focus();
      return;
    }

    // Optimistic UI: disable form while submitting
    if (reqSubmitBtn) reqSubmitBtn.disabled = true;
    setFeedback('Submitting…', '');

    try {
      const payload = { title, description, type };
      if (project) payload.project = project;

      const res = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        setFeedback(data.error ?? 'Submission failed — try again.', 'error');
        return;
      }

      // Success — clear form and show confirmation
      if (reqTitleEl)   reqTitleEl.value = '';
      if (reqDescEl)    reqDescEl.value = '';
      if (reqTypeEl)    reqTypeEl.value = 'feature';
      if (reqProjectEl) reqProjectEl.value = '';
      if (reqTitleEl)   reqTitleEl.placeholder = 'Suggest a new service or feature…';
      setFeedback("✓ Submitted! We'll review it shortly.", 'success');

      // Clear success message after a few seconds
      setTimeout(() => {
        if (reqFeedback && reqFeedback.classList.contains('success')) {
          setFeedback('', '');
        }
      }, 5000);

    } catch (err) {
      console.error('Request submission error:', err);
      setFeedback('Network error — please try again.', 'error');
    } finally {
      if (reqSubmitBtn) reqSubmitBtn.disabled = false;
    }
  });
}

// ── Changelog ─────────────────────────────────────────────────────────────────

const changelogList  = document.getElementById('changelog-list');
const changelogEmpty = document.getElementById('changelog-empty');

const CL_TYPE_LABELS = {
  feature:     '💡 Feature',
  bug:         '🐛 Bug fix',
  improvement: '✨ Improvement',
  refactor:    '🔧 Refactor',
  other:       '📦 Other',
};

function renderChangelogItem(entry) {
  const typeLabel  = CL_TYPE_LABELS[entry.type] ?? '📦 Other';
  const time       = relativeTime(entry.completed_at);
  const desc       = entry.description
    ? `<p class="cl-item-desc">${escapeHtml(entry.description)}</p>`
    : '';
  const projectTag = entry.project
    ? `<span class="req-tag req-tag-project">${escapeHtml(entry.project)}</span>`
    : '';

  return `
    <div class="cl-item">
      <div class="cl-dot-col">
        <span class="cl-dot"></span>
        <span class="cl-line"></span>
      </div>
      <div class="cl-body">
        <div class="cl-header">
          <span class="cl-title">${escapeHtml(entry.title)}</span>
        </div>
        <div class="cl-tags">
          <span class="req-tag req-tag-type">${typeLabel}</span>
          ${projectTag}
        </div>
        ${desc}
        <p class="cl-meta">${time}</p>
      </div>
    </div>
  `;
}

let changelogLoaded = false;

async function loadChangelog() {
  if (!changelogList || !changelogEmpty) return;

  try {
    const res = await fetch('/api/changelog');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    changelogLoaded = true;

    if (data.length === 0) {
      changelogList.innerHTML = '';
      changelogEmpty.classList.remove('hidden');
      return;
    }

    changelogEmpty.classList.add('hidden');
    changelogList.innerHTML = data.map(renderChangelogItem).join('');
  } catch (err) {
    console.error('Failed to load changelog:', err);
    if (changelogList) {
      changelogList.innerHTML = `<p class="cl-error">Couldn't load changelog — try again later.</p>`;
    }
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

loadServices(true);
loadIdentity();
loadRequests();
setInterval(() => loadServices(false), REFRESH_MS);
