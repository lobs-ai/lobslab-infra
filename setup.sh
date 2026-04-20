#!/usr/bin/env bash
# =============================================================================
# setup.sh — First-time setup for lobslab-infra (unified deployment)
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

# ── Check apps directory ───────────────────────────────────────────────────────
APPS_DIR="$(cd "$SCRIPT_DIR/../lobslab-apps" && pwd 2>/dev/null)" || {
    echo "⚠️  lobslab-apps not found as sibling directory."
    echo "   Apps will fail to build. Clone it with:"
    echo "   git clone https://github.com/lobs-ai/lobslab-apps ../lobslab-apps"
}

# ── Build and start stack ─────────────────────────────────────────────────────
echo "🐳 Building and starting Docker stack..."
docker compose build --parallel

echo "🚀 Starting services..."
docker compose up -d --remove-orphans

# ── Verify containers ─────────────────────────────────────────────────────────
sleep 5
echo ""
echo "Container status:"
docker compose ps --format "  {{.Name}}: {{.Status}}"

# ── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo "✅ Setup complete!"
echo ""
echo "Architecture (unified deployment):"
echo "  Internet → Cloudflare (*.lobslab.com) → Tunnel → cloudflared → Traefik :80"
echo "    home.lobslab.com      → lobslab-home (landing page)"
echo "    *.lobslab.com         → App services (auto-discovered via Docker labels)"
echo ""
echo "Public services:"
echo "  https://home.lobslab.com"
echo "  https://crapuler.lobslab.com"
echo "  https://ballz.lobslab.com"
echo "  https://stellar-siege.lobslab.com"
echo "  https://ballz-royale.lobslab.com"
echo "  https://games.lobslab.com"
echo ""
echo "Private services (Cloudflare Access required):"
echo "  https://traefik.lobslab.com"
echo "  https://nexus.lobslab.com"
echo "  https://cortex.lobslab.com"
echo ""
echo "Useful commands:"
echo "  ./deploy.sh          — full rebuild + restart"
echo "  ./deploy.sh build    — build images only"
echo "  ./deploy.sh status   — check running services"
echo "  ./deploy.sh logs     — tail all logs"
