#!/usr/bin/env bash
# =============================================================================
# deploy.sh — Manage the lobslab-infra stack (unified deployment)
#
# Usage:
#   ./deploy.sh              # Full rebuild + restart all services
#   ./deploy.sh build        # Build all images without starting
#   ./deploy.sh status       # Show running containers
#   ./deploy.sh logs [svc]   # Tail logs (all services, or one)
#   ./deploy.sh add <name>   # Scaffold docker-compose labels for a new service
# ==============================================================================

set -euo pipefail
cd "$(dirname "$0")"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; NC='\033[0m'
info()    { echo -e "${GREEN}▸${NC} $*"; }
warn()    { echo -e "${YELLOW}▸${NC} $*"; }
error()   { echo -e "${RED}✗${NC} $*" >&2; }
success() { echo -e "${GREEN}✓${NC} $*"; }

# ── Full rebuild ──────────────────────────────────────────────────────────────
build_all() {
  info "Building all images..."
  docker compose build --parallel
  success "Images built"
}

# ── Deploy ─────────────────────────────────────────────────────────────────────
deploy_all() {
  info "Deploying stack..."
  docker compose up -d --remove-orphans
  success "Stack is up"
  echo ""
  status
}

# ── Full rebuild + deploy ──────────────────────────────────────────────────────
full_deploy() {
  info "Pulling latest base images..."
  docker compose pull
  build_all
  deploy_all
}

# ── Status ────────────────────────────────────────────────────────────────────
status() {
  echo -e "${BOLD}lobslab Stack:${NC}"
  docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Service}}"
  echo ""
  echo -e "${BOLD}Public Services:${NC}"
  echo "  https://home.lobslab.com"
  echo "  https://crapuler.lobslab.com"
  echo "  https://ballz.lobslab.com"
  echo "  https://stellar-siege.lobslab.com"
  echo "  https://ballz-royale.lobslab.com"
  echo "  https://games.lobslab.com"
  echo ""
  echo -e "${BOLD}Private Services (Cloudflare Access):${NC}"
  echo "  https://traefik.lobslab.com"
  echo "  https://nexus.lobslab.com"
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

# ── Restart ────────────────────────────────────────────────────────────────────
restart() {
  local service="${1:-}"
  if [[ -n "$service" ]]; then
    docker compose restart "$service"
    success "$service restarted"
  else
    docker compose restart
    success "Stack restarted"
  fi
}

# ── Cleanup ───────────────────────────────────────────────────────────────────
cleanup() {
  info "Removing stopped containers and dangling images..."
  docker compose rm -f
  docker image prune -f
  success "Cleanup complete"
}

# ── Main ──────────────────────────────────────────────────────────────────────
case "${1:-}" in
  build)    build_all ;;
  status)   status ;;
  logs)     logs "${2:-}" ;;
  restart)  restart "${2:-}" ;;
  clean)    cleanup ;;
  *)        full_deploy ;;
esac
