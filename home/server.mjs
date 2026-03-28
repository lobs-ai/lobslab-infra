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
    res.writeHead(200, { "Content-Type": contentType });
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

  // Root → index.html
  if (pathname === "/" || pathname === "/index.html") {
    serveStatic(res, path.join(__dirname, "index.html"));
    return;
  }

  // Other static files (styles.css, app.js, etc.)
  const safePath = path.join(__dirname, path.normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, ""));
  if (safePath.startsWith(__dirname)) {
    serveStatic(res, safePath);
  } else {
    res.writeHead(403);
    res.end("Forbidden");
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────

const server = http.createServer(handler);
server.listen(PORT, () => {
  console.log(`🏠 Lobs Lab home server running on port ${PORT}`);
  console.log(`   Traefik API: ${TRAEFIK_API}`);
});
