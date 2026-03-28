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

// ── Request handler ───────────────────────────────────────────────────────────

async function handler(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

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
