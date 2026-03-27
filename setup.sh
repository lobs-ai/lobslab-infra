#!/usr/bin/env bash
# =============================================================================
# setup.sh — First-time setup for lobslab-infra
#
# Run after a fresh clone or system restore.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
echo "🏗️  Setting up lobslab-infra from $SCRIPT_DIR"
cd "$SCRIPT_DIR"

# ── Prerequisites ──────────────────────────────────────────────────────────────
command -v docker >/dev/null 2>&1 || { echo "❌ Docker not installed"; exit 1; }

# ── Check credentials ─────────────────────────────────────────────────────────
if [ ! -f "$SCRIPT_DIR/tunnel-credentials.json" ]; then
    echo "❌ tunnel-credentials.json not found."
    echo "   Get it from 1Password or the Cloudflare Zero Trust dashboard."
    exit 1
fi

# ── Create Docker network ─────────────────────────────────────────────────────
echo "🌐 Ensuring lobslab Docker network exists..."
if ! docker network inspect lobslab >/dev/null 2>&1; then
    docker network create lobslab
    echo "   ✓ Network 'lobslab' created"
else
    echo "   ✓ Network 'lobslab' already exists"
fi

# ── Pull images + start stack ─────────────────────────────────────────────────
echo "🐳 Starting Docker stack..."
docker compose pull --quiet
docker compose up -d --remove-orphans

# ── Verify containers ─────────────────────────────────────────────────────────
sleep 3
echo ""
echo "Container status:"
docker compose ps --format "  {{.Name}}: {{.Status}}"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "✅ Setup complete!"
echo ""
echo "Architecture:"
echo "  Internet → Cloudflare (*.lobslab.com) → Tunnel → cloudflared → Traefik"
echo "    traefik.lobslab.com  → Traefik dashboard  (PRIVATE — Cloudflare Access)"
echo "    nexus.lobslab.com    → lobs-core :9420     (PRIVATE — Cloudflare Access)"
echo ""
echo "Next steps (if first time):"
echo "  1. Set DNS wildcard CNAME in Cloudflare dashboard:"
echo "     *.lobslab.com → 5e8ce13d-a3f2-4217-a135-d9b0b3a35ba5.cfargotunnel.com"
echo "  2. Create Cloudflare Access policies for traefik.lobslab.com and nexus.lobslab.com"
echo "  3. Make sure lobs-core is running on host port 9420"
echo ""
echo "Useful commands:"
echo "  ./deploy.sh status       — check running services"
echo "  ./deploy.sh logs         — tail all logs"
echo "  ./deploy.sh add <name>   — scaffold a new service"
