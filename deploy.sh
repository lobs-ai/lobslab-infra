#!/usr/bin/env bash
# =============================================================================
# deploy.sh — Build and deploy lobslab.com + Nexus
#
# Usage:
#   ./deploy.sh              # Full rebuild + restart all
#   ./deploy.sh nexus        # Rebuild + restart Nexus only
#   ./deploy.sh home         # Rebuild + restart lobslab.com only
#   ./deploy.sh status       # Show status
#   ./deploy.sh logs         # Tail logs
# =============================================================================

set -euo pipefail
cd "$(dirname "$0")"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; NC='\033[0m'
info()    { echo -e "${GREEN}▸${NC} $*"; }
warn()    { echo -e "${YELLOW}▸${NC} $*"; }
error()   { echo -e "${RED}✗${NC} $*" >&2; }
success() { echo -e "${GREEN}✓${NC} $*"; }

NEXUS_SRC="$HOME/lobs-nexus"
HOME_SRC="$HOME/lobs-ai.github.io"

# ── Build Nexus ───────────────────────────────────────────────────────────────
build_nexus() {
  info "Building Nexus frontend..."
  if [[ -d "$NEXUS_SRC" ]]; then
    cd "$NEXUS_SRC"
    npm run build 2>&1 | tail -3
    success "Nexus built"
  else
    error "Nexus source not found at $NEXUS_SRC"
    return 1
  fi

  info "Rebuilding Nexus container..."
  cd "$(dirname "$0")"
  docker compose build nexus 2>&1 | tail -3
  docker compose up -d nexus 2>&1 | tail -2
  success "Nexus deployed"
}

# ── Build lobslab.com ────────────────────────────────────────────────────────
build_home() {
  info "Rebuilding lobslab.com container..."
  if [[ ! -d "$HOME_SRC" ]]; then
    error "lobslab.com source not found at $HOME_SRC"
    return 1
  fi

  cd "$(dirname "$0")"
  docker compose build lobslab-home 2>&1 | tail -3
  docker compose up -d lobslab-home 2>&1 | tail -2
  success "lobslab.com deployed"
}

# ── Status ────────────────────────────────────────────────────────────────────
status() {
  echo -e "${BOLD}lobslab Infrastructure:${NC}"
  docker ps --filter "name=lobslab-infra" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null
}

# ── Logs ──────────────────────────────────────────────────────────────────────
logs() {
  local service="${1:-}"
  if [[ -n "$service" ]]; then
    docker compose logs -f "$service" 2>&1
  else
    docker compose logs -f 2>&1
  fi
}

# ── Main ──────────────────────────────────────────────────────────────────────
case "${1:-}" in
  nexus)    build_nexus ;;
  home)     build_home ;;
  status)   status ;;
  logs)     logs "${2:-}" ;;
  *)        build_nexus && build_home && status ;;
esac
