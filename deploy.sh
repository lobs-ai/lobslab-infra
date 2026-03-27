#!/usr/bin/env bash
# =============================================================================
# deploy.sh — Manage the lobslab-infra stack
#
# Usage:
#   ./deploy.sh              # Full rebuild + restart all services
#   ./deploy.sh status       # Show running containers
#   ./deploy.sh logs [svc]   # Tail logs (all services, or one)
#   ./deploy.sh add <name>   # Scaffold docker-compose labels for a new service
# =============================================================================

set -euo pipefail
cd "$(dirname "$0")"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; NC='\033[0m'
info()    { echo -e "${GREEN}▸${NC} $*"; }
warn()    { echo -e "${YELLOW}▸${NC} $*"; }
error()   { echo -e "${RED}✗${NC} $*" >&2; }
success() { echo -e "${GREEN}✓${NC} $*"; }

# ── Ensure lobslab network exists ─────────────────────────────────────────────
ensure_network() {
  if ! docker network inspect lobslab >/dev/null 2>&1; then
    info "Creating lobslab Docker network..."
    docker network create lobslab
    success "Network 'lobslab' created"
  fi
}

# ── Full rebuild ──────────────────────────────────────────────────────────────
deploy_all() {
  ensure_network
  info "Pulling latest images..."
  docker compose pull
  info "Starting services..."
  docker compose up -d --remove-orphans
  success "Stack is up"
  echo ""
  status
}

# ── Status ────────────────────────────────────────────────────────────────────
status() {
  echo -e "${BOLD}lobslab Infrastructure:${NC}"
  docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Service}}"
  echo ""
  echo -e "${BOLD}Reachable at:${NC}"
  echo "  https://traefik.lobslab.com  (private — Cloudflare Access)"
  echo "  https://nexus.lobslab.com    (private — Cloudflare Access)"
}

# ── Logs ──────────────────────────────────────────────────────────────────────
logs() {
  local service="${1:-}"
  if [[ -n "$service" ]]; then
    docker compose logs -f "$service"
  else
    docker compose logs -f
  fi
}

# ── Scaffold a new service ────────────────────────────────────────────────────
scaffold() {
  local name="${1:-}"
  if [[ -z "$name" ]]; then
    error "Usage: ./deploy.sh add <service-name>"
    exit 1
  fi

  echo -e "${BOLD}Template for ${name}.lobslab.com:${NC}"
  echo ""
  cat <<EOF
# Add to your service's docker-compose.yml (or to this stack's docker-compose.yml)
# Then run: docker compose up -d

services:
  ${name}:
    image: your-image-here
    restart: unless-stopped
    networks:
      - lobslab
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.${name}.rule=Host(\`${name}.lobslab.com\`)"
      - "traefik.http.routers.${name}.entrypoints=web"
      - "traefik.http.services.${name}.loadbalancer.server.port=3000"  # ← change to your app's port

networks:
  lobslab:
    name: lobslab
    external: true
EOF
  echo ""
  echo -e "${YELLOW}▸${NC} If this service is PRIVATE, create a Cloudflare Access policy for ${name}.lobslab.com"
  echo -e "${YELLOW}▸${NC} If this service is PUBLIC, no Access policy needed — Traefik routes it automatically"
  echo -e "${YELLOW}▸${NC} Make sure the container joins the 'lobslab' network"
}

# ── Main ──────────────────────────────────────────────────────────────────────
case "${1:-}" in
  status)  status ;;
  logs)    logs "${2:-}" ;;
  add)     scaffold "${2:-}" ;;
  *)       deploy_all ;;
esac
