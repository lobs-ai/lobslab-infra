#!/bin/bash
# lobslab-infra setup script
# Run this after a fresh clone or system restore to get everything running.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
echo "🏗️  Setting up lobslab-infra from $SCRIPT_DIR"

# ── Prerequisites ──────────────────────────────────────────────────────
command -v docker >/dev/null 2>&1 || { echo "❌ Docker not installed"; exit 1; }
command -v cloudflared >/dev/null 2>&1 || { echo "❌ cloudflared not installed (brew install cloudflared)"; exit 1; }

# ── Check credentials ─────────────────────────────────────────────────
if [ ! -f "$SCRIPT_DIR/tunnel-credentials.json" ]; then
    echo "❌ tunnel-credentials.json not found. Run: cloudflared tunnel login"
    exit 1
fi

# ── Build Nexus (pre-build locally for faster Docker builds) ──────────
echo "📦 Building Nexus..."
NEXUS_DIR="${NEXUS_DIR:-$HOME/lobs-nexus}"
if [ -d "$NEXUS_DIR" ]; then
    cd "$NEXUS_DIR"
    npm run build
    cd "$SCRIPT_DIR"
else
    echo "⚠️  Nexus source not found at $NEXUS_DIR — skipping pre-build"
fi

# ── Start Docker containers ───────────────────────────────────────────
echo "🐳 Starting Docker containers..."
cd "$SCRIPT_DIR"
docker compose up -d --build --remove-orphans

# Verify containers are healthy
sleep 3
echo ""
echo "Container status:"
docker compose ps --format "  {{.Name}}: {{.Status}}"

# ── Verify local ports ────────────────────────────────────────────────
echo ""
echo "Testing local ports..."
for port in 3080 3081; do
    status=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:$port/ 2>/dev/null || echo "fail")
    echo "  127.0.0.1:$port → $status"
done

# ── Install cloudflared launchd service ────────────────────────────────
echo ""
echo "🌐 Setting up cloudflared tunnel..."

# Stop any existing cloudflared
pkill -f "cloudflared tunnel" 2>/dev/null || true
launchctl bootout gui/$(id -u) com.lobslab.cloudflared 2>/dev/null || true
sleep 1

# Create launchd plist
cat > ~/Library/LaunchAgents/com.lobslab.cloudflared.plist << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.lobslab.cloudflared</string>
    <key>ProgramArguments</key>
    <array>
        <string>$(which cloudflared)</string>
        <string>tunnel</string>
        <string>--config</string>
        <string>$SCRIPT_DIR/cloudflared-config.yml</string>
        <string>run</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardErrorPath</key>
    <string>/tmp/cloudflared.err</string>
    <key>StandardOutPath</key>
    <string>/tmp/cloudflared.out</string>
</dict>
</plist>
EOF

launchctl load ~/Library/LaunchAgents/com.lobslab.cloudflared.plist
sleep 3

# Verify tunnel
TUNNEL_OK=$(grep -c "Registered tunnel" /tmp/cloudflared.err 2>/dev/null || echo 0)
echo "  Tunnel connections: $TUNNEL_OK"

# ── Final verification ─────────────────────────────────────────────────
echo ""
echo "🔍 Testing public endpoints..."
for host in lobslab.com nexus.lobslab.com; do
    status=$(curl -s -o /dev/null -w "%{http_code}" https://$host/ 2>/dev/null || echo "fail")
    echo "  https://$host → $status"
done

echo ""
echo "✅ Setup complete!"
echo ""
echo "Architecture:"
echo "  nexus.lobslab.com → Cloudflare Access → tunnel → localhost:3080 → nexus container (nginx)"
echo "  lobslab.com       → tunnel → localhost:3081 → lobslab-home container (nginx)"
echo ""
echo "Notes:"
echo "  - Cloudflare cache bypass rule required for nexus.lobslab.com"
echo "  - Docker containers auto-restart (restart: unless-stopped)"
echo "  - cloudflared runs via launchd (auto-start on boot)"
echo "  - Nexus API calls proxy through nginx to PAW plugin at host:18789"
