/**
 * home/server.mjs
 * Lightweight Node.js server (no dependencies) for home.lobslab.com
 * Queries Traefik API to auto-discover public services.
 */

import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ?? 3000;
const TRAEFIK_API = process.env.TRAEFIK_API ?? "http://traefik:8080";
const REQUESTS_FILE = path.join(__dirname, "data", "requests.json");
const CHANGELOG_FILE = path.join(__dirname, "data", "changelog.json");
const ADMIN_SECRET = process.env.ADMIN_SECRET ?? "";

// Hostnames that should never appear on the home page
const PRIVATE_HOSTS = new Set([
  "nexus.lobslab.com",
  "traefik.lobslab.com",
  "home.lobslab.com",
]);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

// ── Traefik API fetch (plain http, no external deps) ─────────────────────────

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    lib
      .get(url, { headers: { Accept: "application/json" } }, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Traefik API returned ${res.statusCode}`));
          res.resume();
          return;
        }
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error("Failed to parse Traefik API response"));
          }
        });
      })
      .on("error", reject);
  });
}

// Extract hostname from a Traefik Host() rule, e.g. "Host(`foo.lobslab.com`)" → "foo.lobslab.com"
function extractHostname(rule) {
  const m = rule?.match(/Host\(`([^`]+)`\)/);
  return m ? m[1] : null;
}

async function getPublicServices() {
  const routers = await fetchJSON(`${TRAEFIK_API}/api/http/routers`);
  const services = [];

  for (const router of routers) {
    // Skip anything not enabled
    if (router.status === "disabled") continue;

    // Skip internal Traefik routers
    if (router.provider === "internal") continue;

    const hostname = extractHostname(router.rule);
    if (!hostname) continue;

    // Skip private / meta services
    if (PRIVATE_HOSTS.has(hostname)) continue;

    services.push({
      name: router.name,
      hostname,
      url: `https://${hostname}`,
      status: router.status ?? "enabled",
    });
  }

  // Stable sort by hostname
  services.sort((a, b) => a.hostname.localeCompare(b.hostname));
  return services;
}

// ── Static file server ────────────────────────────────────────────────────────

function serveStatic(res, filePath) {
  const ext = path.extname(filePath);
  const contentType = MIME[ext] ?? "application/octet-stream";
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-cache, must-revalidate",
    });
    res.end(data);
  });
}

// ── Cookie helpers ────────────────────────────────────────────────────────────

const COOKIE_NAME = "lobslab_id";
const COOKIE_DOMAIN = ".lobslab.com";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365 * 2; // 2 years

function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  for (const pair of header.split(";")) {
    const [key, ...rest] = pair.trim().split("=");
    if (key) cookies[key.trim()] = rest.join("=").trim();
  }
  return cookies;
}

function generateId() {
  // UUID v4 without dependencies
  const hex = [...Array(32)].map(() => Math.floor(Math.random() * 16).toString(16)).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20)}`;
}

/** Ensures lobslab_id cookie exists. Returns the id and any Set-Cookie header needed. */
function ensureCookie(req) {
  const cookies = parseCookies(req.headers.cookie);
  const existing = cookies[COOKIE_NAME];
  if (existing) return { id: existing, header: null };

  const id = generateId();
  const header = `${COOKIE_NAME}=${id}; Domain=${COOKIE_DOMAIN}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax`;
  return { id, header };
}

// ── Feature requests storage ──────────────────────────────────────────────────

function readRequests() {
  try {
    const raw = fs.readFileSync(REQUESTS_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeRequests(data) {
  fs.mkdirSync(path.dirname(REQUESTS_FILE), { recursive: true });
  fs.writeFileSync(REQUESTS_FILE, JSON.stringify(data, null, 2), "utf8");
}

// ── Changelog storage ─────────────────────────────────────────────────────────

function readChangelog() {
  try {
    const raw = fs.readFileSync(CHANGELOG_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeChangelog(data) {
  fs.mkdirSync(path.dirname(CHANGELOG_FILE), { recursive: true });
  fs.writeFileSync(CHANGELOG_FILE, JSON.stringify(data, null, 2), "utf8");
}

function shortId() {
  return [...Array(6)].map(() => Math.floor(Math.random() * 36).toString(36)).join('');
}

// In-memory rate-limit tracker: { lobslab_id → [timestamps] }
const rateLimitMap = new Map();
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function checkRateLimit(lobslabId) {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const timestamps = (rateLimitMap.get(lobslabId) ?? []).filter(t => t > cutoff);
  if (timestamps.length >= RATE_LIMIT_MAX) return false;
  timestamps.push(now);
  rateLimitMap.set(lobslabId, timestamps);
  return true;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => (body += chunk));
    req.on("end", () => {
      try { resolve(JSON.parse(body)); }
      catch { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}

// ── Request handler ───────────────────────────────────────────────────────────

async function handler(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // Set cookie on every response if needed
  const { header: cookieHeader } = ensureCookie(req);
  if (cookieHeader) {
    res.setHeader("Set-Cookie", cookieHeader);
  }

  // API: identity
  if (pathname === "/api/me") {
    const { id } = ensureCookie(req);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ lobslab_id: id }));
    return;
  }

  // API endpoint
  if (pathname === "/api/services") {
    try {
      const services = await getPublicServices();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(services));
    } catch (err) {
      console.error("Failed to fetch services:", err.message);
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Could not reach Traefik API", detail: err.message }));
    }
    return;
  }

  // API: list feature requests (GET /api/requests)
  // Only returns reviewed items (not "pending", not "wontdo") — Rafe approves by editing the JSON
  if (pathname === "/api/requests" && req.method === "GET") {
    const all = readRequests();
    const reviewed = all.filter(r => r.status !== "pending" && r.status !== "wontdo");
    const sorted = reviewed.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const pub = sorted.map(({ id, title, description, type, project, created_at, status }) =>
      ({ id, title, description, type: type ?? 'feature', project: project ?? null, created_at, status })
    );
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(pub));
    return;
  }

  // API: submit feature request (POST /api/requests)
  if (pathname === "/api/requests" && req.method === "POST") {
    let body;
    try {
      body = await readBody(req);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON body" }));
      return;
    }

    const title = (body.title ?? "").trim();
    const description = (body.description ?? "").trim();
    const type = ["feature", "bug"].includes(body.type) ? body.type : "feature";
    const project = (body.project ?? "").trim().slice(0, 50);

    if (!title || title.length > 100) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "title is required and must be 1–100 characters" }));
      return;
    }
    if (description.length > 500) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "description must be 500 characters or fewer" }));
      return;
    }

    const { id: lobslab_id } = ensureCookie(req);
    if (!checkRateLimit(lobslab_id)) {
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Too many submissions — try again later" }));
      return;
    }

    const entry = {
      id: shortId(),
      title,
      description,
      type,
      project: project || null,
      lobslab_id,
      status: "pending",
      created_at: new Date().toISOString(),
    };

    const all = readRequests();
    all.push(entry);
    try {
      writeRequests(all);
    } catch (err) {
      console.error("Failed to write requests.json:", err.message);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Failed to save request" }));
      return;
    }

    res.writeHead(201, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, id: entry.id }));
    return;
  }

  // API: list changelog (GET /api/changelog) — public, newest-first
  if (pathname === "/api/changelog" && req.method === "GET") {
    const all = readChangelog();
    const sorted = all.slice().sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(sorted));
    return;
  }

  // ── Admin API (token-protected) ──────────────────────────────────────────────

  const isAdmin = ADMIN_SECRET && req.headers["x-admin-secret"] === ADMIN_SECRET;

  // Admin: list ALL requests including pending (GET /api/admin/requests)
  if (pathname === "/api/admin/requests" && req.method === "GET") {
    if (!isAdmin) { res.writeHead(401, { "Content-Type": "application/json" }); res.end('{"error":"Unauthorized"}'); return; }
    const all = readRequests();
    const sorted = all.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(sorted));
    return;
  }

  // Admin: update request status (PATCH /api/admin/requests/:id)
  if (pathname.startsWith("/api/admin/requests/") && req.method === "PATCH") {
    if (!isAdmin) { res.writeHead(401, { "Content-Type": "application/json" }); res.end('{"error":"Unauthorized"}'); return; }
    const reqId = pathname.split("/").pop();
    let body;
    try { body = await readBody(req); } catch {
      res.writeHead(400, { "Content-Type": "application/json" }); res.end('{"error":"Invalid JSON"}'); return;
    }
    const validStatuses = ["pending", "planned", "building", "done", "wontdo"];
    if (!body.status || !validStatuses.includes(body.status)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `status must be one of: ${validStatuses.join(", ")}` }));
      return;
    }
    const all = readRequests();
    const idx = all.findIndex(r => r.id === reqId);
    if (idx === -1) { res.writeHead(404, { "Content-Type": "application/json" }); res.end('{"error":"Not found"}'); return; }

    const wasAlreadyDone = all[idx].status === "done";
    all[idx].status = body.status;
    all[idx].updated_at = new Date().toISOString();

    // Auto-create changelog entry when a suggestion is marked done (only once)
    if (body.status === "done" && !wasAlreadyDone) {
      const req_entry = all[idx];
      const changelog = readChangelog();
      // Avoid duplicates if already linked
      const alreadyLinked = changelog.some(c => c.suggestion_id === req_entry.id);
      if (!alreadyLinked) {
        const clEntry = {
          id: shortId(),
          title: req_entry.title,
          description: req_entry.description || null,
          project: req_entry.project || null,
          type: req_entry.type ?? "feature",
          suggestion_id: req_entry.id,
          completed_at: new Date().toISOString(),
        };
        changelog.push(clEntry);
        try { writeChangelog(changelog); } catch (err) {
          console.error("Failed to write changelog.json:", err.message);
        }
      }
    }

    try { writeRequests(all); } catch {
      res.writeHead(500, { "Content-Type": "application/json" }); res.end('{"error":"Write failed"}'); return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(all[idx]));
    return;
  }

  // Admin: delete request (DELETE /api/admin/requests/:id)
  if (pathname.startsWith("/api/admin/requests/") && req.method === "DELETE") {
    if (!isAdmin) { res.writeHead(401, { "Content-Type": "application/json" }); res.end('{"error":"Unauthorized"}'); return; }
    const reqId = pathname.split("/").pop();
    const all = readRequests();
    const idx = all.findIndex(r => r.id === reqId);
    if (idx === -1) { res.writeHead(404, { "Content-Type": "application/json" }); res.end('{"error":"Not found"}'); return; }
    const removed = all.splice(idx, 1)[0];
    try { writeRequests(all); } catch {
      res.writeHead(500, { "Content-Type": "application/json" }); res.end('{"error":"Write failed"}'); return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, deleted: removed.id }));
    return;
  }

  // Admin: create changelog entry (POST /api/admin/changelog)
  if (pathname === "/api/admin/changelog" && req.method === "POST") {
    if (!isAdmin) { res.writeHead(401, { "Content-Type": "application/json" }); res.end('{"error":"Unauthorized"}'); return; }
    let body;
    try { body = await readBody(req); } catch {
      res.writeHead(400, { "Content-Type": "application/json" }); res.end('{"error":"Invalid JSON"}'); return;
    }
    const title = (body.title ?? "").trim();
    if (!title || title.length > 200) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "title is required and must be 1–200 characters" }));
      return;
    }
    const validTypes = ["feature", "bug", "improvement", "refactor", "other"];
    const entry = {
      id: shortId(),
      title,
      description: (body.description ?? "").trim() || null,
      project: (body.project ?? "").trim().slice(0, 50) || null,
      type: validTypes.includes(body.type) ? body.type : "feature",
      suggestion_id: (body.suggestion_id ?? null),
      completed_at: new Date().toISOString(),
    };
    const all = readChangelog();
    all.push(entry);
    try { writeChangelog(all); } catch (err) {
      console.error("Failed to write changelog.json:", err.message);
      res.writeHead(500, { "Content-Type": "application/json" }); res.end('{"error":"Write failed"}'); return;
    }
    res.writeHead(201, { "Content-Type": "application/json" });
    res.end(JSON.stringify(entry));
    return;
  }

  // Admin: delete changelog entry (DELETE /api/admin/changelog/:id)
  if (pathname.startsWith("/api/admin/changelog/") && req.method === "DELETE") {
    if (!isAdmin) { res.writeHead(401, { "Content-Type": "application/json" }); res.end('{"error":"Unauthorized"}'); return; }
    const clId = pathname.split("/").pop();
    const all = readChangelog();
    const idx = all.findIndex(c => c.id === clId);
    if (idx === -1) { res.writeHead(404, { "Content-Type": "application/json" }); res.end('{"error":"Not found"}'); return; }
    const removed = all.splice(idx, 1)[0];
    try { writeChangelog(all); } catch {
      res.writeHead(500, { "Content-Type": "application/json" }); res.end('{"error":"Write failed"}'); return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, deleted: removed.id }));
    return;
  }

  // Root → index.html
  if (pathname === "/" || pathname === "/index.html") {
    serveStatic(res, path.join(__dirname, "index.html"));
    return;
  }

  // Other static files (styles.css, app.js, etc.)
  // Strip leading slash then join with __dirname to ensure files stay within app directory
  const normalized = path.normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, "");
  const safePath = path.join(__dirname, normalized.replace(/^\//, ""));
  if (safePath.startsWith(__dirname)) {
    serveStatic(res, safePath);
  } else {
    res.writeHead(403);
    res.end("Forbidden");
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────

const server = http.createServer(handler);
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🏠 Lobs Lab home server running on port ${PORT}`);
  console.log(`   Traefik API: ${TRAEFIK_API}`);
});
