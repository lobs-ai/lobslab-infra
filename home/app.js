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

const grid       = document.getElementById('grid');
const emptyState = document.getElementById('empty-state');
const errorState = document.getElementById('error-state');
const errorDetail = document.getElementById('error-detail');
const heroStats  = document.getElementById('hero-stats');
const footerMeta = document.getElementById('footer-meta');

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

// ── Init ──────────────────────────────────────────────────────────────────────

loadServices(true);
loadIdentity();
setInterval(() => loadServices(false), REFRESH_MS);
