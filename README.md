# lobslab-infra

Self-contained Docker stack for lobslab.com and nexus.lobslab.com.

## Architecture

```
Internet → Cloudflare (DNS + Access) → Cloudflare Tunnel → Docker cloudflared container
                                                              ├── nexus.lobslab.com → nexus container (nginx, port 80)
                                                              └── lobslab.com → lobslab-home container (nginx, port 80)
```

Everything runs inside Docker Compose. No host-level cloudflared or port bindings needed.

## Services

| Service | Source | Description |
|---------|--------|-------------|
| `cloudflared` | `cloudflare/cloudflared:latest` | Tunnel connector. Routes traffic to other containers by Docker service name. |
| `nexus` | `~/lobs-nexus` | Nexus web dashboard (React/Vite build served by nginx). |
| `lobslab-home` | `~/lobs-ai.github.io` | lobslab.com homepage (static nginx). |

## Tunnel Details

- **Tunnel name:** `lobs-lab`
- **Tunnel ID:** `5e8ce13d-a3f2-4217-a135-d9b0b3a35ba5`
- **Credentials:** `tunnel-credentials.json` (mounted read-only into cloudflared container)
- **Config:** `cloudflared-config.yml` (routes hostnames to Docker service names)
- **Cloudflare Access:** `nexus.lobslab.com` is protected by Cloudflare Access (Zero Trust dashboard)

## DNS Setup (Cloudflare Dashboard)

The `lobslab.com` zone is in a separate Cloudflare account from `paw-engineering.com`. DNS records must be configured manually in the Cloudflare dashboard (the `cloudflared tunnel route dns` command targets the wrong zone).

Required CNAME records in the **lobslab.com** zone (proxied):
- `@` (or `lobslab.com`) → `5e8ce13d-a3f2-4217-a135-d9b0b3a35ba5.cfargotunnel.com`
- `nexus` → `5e8ce13d-a3f2-4217-a135-d9b0b3a35ba5.cfargotunnel.com`

**OR** configure public hostnames on the tunnel in **Zero Trust → Networks → Tunnels → lobs-lab**.

## Common Operations

```bash
# Start everything
cd ~/lobslab-infra && docker compose up -d

# Rebuild after code changes (e.g. nexus deploy)
docker compose up -d --build nexus

# Rebuild everything
docker compose up -d --build

# Check tunnel status
docker logs lobslab-infra-cloudflared-1
cloudflared tunnel info lobs-lab

# Full restart
docker compose down && docker compose up -d
```

## Troubleshooting

### 404 on nexus.lobslab.com
1. **Check connectors:** `cloudflared tunnel info lobs-lab` — should show exactly ONE connector (linux_arm64 from Docker). If there are multiple, a rogue process somewhere has old tunnel credentials.
2. **Rogue connectors:** The old tunnel (`ee11947e-...`) was deleted on 2026-03-09 because an unknown linux box (52.124.39.58) kept reconnecting with stolen credentials and serving 404s for nexus traffic. Fix: delete tunnel, create new one, rotate credentials.
3. **DNS not routing:** If `lobslab.com` works but `nexus.lobslab.com` doesn't, check that the CNAME record exists in the Cloudflare dashboard pointing to the correct tunnel ID.
4. **Cloudflare Access redirect (302):** Expected for `nexus.lobslab.com`. Authenticate via the Access login page.

### Deploying Nexus changes
```bash
cd ~/lobs-nexus && npm run build
cd ~/lobslab-infra && docker compose up -d --build nexus
```

## History

- **2026-03-04:** Initial tunnel (`ee11947e`) created with native cloudflared on Mac Mini.
- **2026-03-09:** Moved to Docker-based cloudflared. Discovered rogue connector (52.124.39.58) on the old tunnel causing intermittent 404s — Cloudflare load-balanced traffic to it and it had no nexus service. Deleted old tunnel, created new one (`5e8ce13d`), rotated credentials. Removed native cloudflared launchd service.

## Files

- `docker-compose.yml` — service definitions
- `cloudflared-config.yml` — tunnel ingress rules (hostnames → Docker service names)
- `tunnel-credentials.json` — tunnel auth (SECRET — do not commit)
- `Caddyfile` — legacy, unused (was for local reverse proxy before tunnel)
- `deploy.sh` / `setup.sh` — deployment helpers
