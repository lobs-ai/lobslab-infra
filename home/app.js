/**
 * app.js — Lobs Lab home page client
 * Fetches /api/services and renders service cards.
 * Auto-refreshes every 30 seconds.
 */

const REFRESH_MS = 30_000;

const grid = document.getElementById("grid");
const emptyState = document.getElementById("empty-state");
const errorState = document.getElementById("error-state");
const errorDetail = document.getElementById("error-detail");
const statusBar = document.getElementById("status-bar");
const refreshIndicator = document.getElementById("refresh-indicator");

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Clean up a Traefik router name into a human-readable service name.
 * e.g. "lobslab-home@docker" → "Lobslab Home"
 *      "my-cool-app"         → "My Cool App"
 */
function formatName(raw) {
  // Strip provider suffix (@docker, @file, etc.)
  const name = raw.replace(/@\w+$/, "");
  return name
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function showOnly(state) {
  grid.classList.toggle("hidden", state !== "grid");
  emptyState.classList.toggle("hidden", state !== "empty");
  errorState.classList.toggle("hidden", state !== "error");
}

function renderSkeletons(count = 3) {
  grid.innerHTML = Array.from({ length: count }, () => `
    <div class="skeleton">
      <div class="skel-line skel-title"></div>
      <div class="skel-line skel-url"></div>
    </div>
  `).join("");
  showOnly("grid");
}

function renderCard(service) {
  const isEnabled = service.status === "enabled";
  const statusClass = isEnabled ? "enabled" : "disabled";
  const statusLabel = isEnabled ? "enabled" : service.status;

  return `
    <a class="card" href="${service.url}" target="_blank" rel="noopener noreferrer">
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
    showOnly("empty");
    return;
  }

  grid.innerHTML = services.map(renderCard).join("");
  showOnly("grid");
}

function setStatus(msg) {
  statusBar.textContent = msg;
  statusBar.classList.remove("hidden");
}

function clearStatus() {
  statusBar.classList.add("hidden");
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

async function loadServices(isInitial = false) {
  refreshIndicator.classList.add("fetching");

  if (isInitial) {
    renderSkeletons();
  }

  try {
    const res = await fetch("/api/services");
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    const services = await res.json();
    renderServices(services);

    const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    setStatus(`${services.length} service${services.length !== 1 ? "s" : ""} · last updated ${now}`);
  } catch (err) {
    console.error("Failed to load services:", err);
    if (isInitial) {
      errorDetail.textContent = err.message ?? "Unknown error";
      showOnly("error");
    } else {
      // On background refresh failures, keep existing cards visible, just update status
      setStatus(`⚠ Refresh failed at ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} — showing cached data`);
    }
  } finally {
    refreshIndicator.classList.remove("fetching");
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

loadServices(true);
setInterval(() => loadServices(false), REFRESH_MS);
