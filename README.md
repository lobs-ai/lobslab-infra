# lobslab-infra

Reverse-proxy stack for `*.lobslab.com` — Traefik behind a Cloudflare Tunnel.

> **lobslab.com root** is hosted on GitHub Pages. Do not add a route for it here.

---

## Architecture

```
Internet
  └── Cloudflare (DNS: *.lobslab.com wildcard CNAME → tunnel)
        └── Cloudflare Tunnel (tunnel ID: 5e8ce13d-...)
              └── cloudflared container
                    └── Traefik :80  (Docker network: lobslab)
                          ├── traefik.lobslab.com  → Traefik dashboard  [PRIVATE]
                          ├── nexus.lobslab.com    → host:9420           [PRIVATE]
                          └── *.lobslab.com        → Docker labels       [add more here]
```

- **Cloudflare handles TLS** — all traffic inside Docker is plain HTTP on port 80.
- **Traefik routes by subdomain** — via Docker labels (auto-discovery) or `traefik/dynamic.yml` (host services).
- **Access control is at the Cloudflare edge** — private services use Cloudflare Access (Zero Trust), not Traefik middleware.

---

## Services

| Service | Subdomain | Access | Notes |
|---------|-----------|--------|-------|
| Home (landing page) | `home.lobslab.com` | **Public** | Auto-discovers public services via Traefik API |
| Traefik dashboard | `traefik.lobslab.com` | **Private** | Cloudflare Access required |
| Nexus (lobs-core) | `nexus.lobslab.com` | **Private** | Cloudflare Access required; routes to host port 9420 |

---

## Tunnel Details

| Field | Value |
|-------|-------|
| Tunnel name | `lobs-lab` |
| Tunnel ID | `5e8ce13d-a3f2-4217-a135-d9b0b3a35ba5` |
| Credentials | `tunnel-credentials.json` (gitignored — never commit) |
| Config | `cloudflared-config.yml` |

---

## DNS Setup (Cloudflare Dashboard)

Set ONE wildcard CNAME in the `lobslab.com` zone (proxied):

| Type | Name | Target |
|------|------|--------|
| CNAME | `*` | `5e8ce13d-a3f2-4217-a135-d9b0b3a35ba5.cfargotunnel.com` |

This covers every subdomain. Adding a new service requires **no DNS changes** — just Traefik labels.

---

## Cloudflare Access (Zero Trust)

Access control happens in the **Cloudflare Zero Trust dashboard**, not in config files.

### Services requiring Access policies

| Subdomain | Policy | Who |
|-----------|--------|-----|
| `traefik.lobslab.com` | Email allowlist | Rafe only |
| `nexus.lobslab.com` | Email allowlist | Rafe only |

To configure: **Zero Trust → Access → Applications → Add application → Self-hosted**

- Application domain: the subdomain (e.g. `nexus.lobslab.com`)
- Policy: allow emails matching `rafe@...`

Public services don't need an Access policy — they're routed by Traefik and reachable by anyone.

---

## First-Time Setup

```bash
git clone <repo> lobslab-infra
cd lobslab-infra

# Drop tunnel-credentials.json in here (from 1Password)

./setup.sh
```

Then in the Cloudflare dashboard:
1. Add the wildcard DNS CNAME (see DNS Setup above)
2. Add Access policies for `traefik.lobslab.com` and `nexus.lobslab.com`

---

## Common Operations

```bash
# Start / restart everything
./deploy.sh

# Check status
./deploy.sh status

# Tail logs (all services, or one)
./deploy.sh logs
./deploy.sh logs traefik
./deploy.sh logs cloudflared

# Scaffold a new service
./deploy.sh add myapp
```

---

## Adding a New Service

### Option A — Docker container (auto-discovery via labels)

Add labels to the service container so Traefik picks it up automatically. The service must be on the `lobslab` network.

**In the service's own `docker-compose.yml`:**

```yaml
services:
  my-app:
    image: your-image
    restart: unless-stopped
    networks:
      - lobslab
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.my-app.rule=Host(`myapp.lobslab.com`)"
      - "traefik.http.routers.my-app.entrypoints=web"
      - "traefik.http.services.my-app.loadbalancer.server.port=3000"  # your app's internal port

networks:
  lobslab:
    name: lobslab
    external: true
```

Then `docker compose up -d` — Traefik picks it up within seconds. No restart needed.

### Option B — Host-based service (runs on the host, not in Docker)

Add an entry to `traefik/dynamic.yml`:

```yaml
http:
  routers:
    my-host-app:
      rule: "Host(`myapp.lobslab.com`)"
      entryPoints:
        - web
      service: my-host-app

  services:
    my-host-app:
      loadBalancer:
        servers:
          - url: "http://host.docker.internal:XXXX"  # host port
```

Traefik reloads the file automatically — no restart needed.

### Making a service private

Create a Cloudflare Access policy in the Zero Trust dashboard for the subdomain. Nothing changes in Traefik — access control is handled entirely at the Cloudflare edge.

### Making a service public

Don't create an Access policy. Traefik routes it, Cloudflare proxies it, anyone can reach it.

---

## Troubleshooting

### Nothing responds on a subdomain
1. Check Traefik logs: `./deploy.sh logs traefik`
2. Check the container has the correct `traefik.enable=true` label and is on the `lobslab` network
3. Verify the `lobslab` network exists: `docker network inspect lobslab`

### Cloudflare tunnel is disconnected
1. Check cloudflared logs: `./deploy.sh logs cloudflared`
2. Verify `tunnel-credentials.json` is present and matches tunnel ID `5e8ce13d-...`
3. Restart: `docker compose restart cloudflared`

### Nexus returns 502
- lobs-core must be running on the **host** at port 9420
- Check: `curl http://localhost:9420`
- Traefik reaches it via `host.docker.internal:9420` (configured in `traefik/dynamic.yml`)

### Traefik dashboard returns 404
- Confirm the `lobslab` network exists and Traefik is running
- Check `traefik/dynamic.yml` has the `traefik-dashboard` router pointing to `api@internal`

### Rogue connectors / duplicate tunnel connections
- Only ONE connector should appear for this tunnel
- Check: Zero Trust → Networks → Tunnels → lobs-lab
- If there are unexpected connectors, rotate the credentials and restart

---

## Files

```
lobslab-infra/
├── docker-compose.yml          # Traefik + cloudflared + lobslab-home services
├── cloudflared-config.yml      # Tunnel config (wildcard → Traefik)
├── tunnel-credentials.json     # SECRET — gitignored, never commit
├── traefik/
│   ├── traefik.yml             # Static config (entrypoints, providers, API)
│   └── dynamic.yml             # Dynamic config (host services, dashboard route)
├── home/                       # home.lobslab.com landing page
│   ├── Dockerfile
│   ├── server.mjs              # Node.js server (no deps) — serves UI + /api/services
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── deploy.sh                   # Manage the stack
├── setup.sh                    # First-time setup
└── README.md
```

---

## History

- **2026-03-04:** Initial tunnel (`ee11947e`) with native cloudflared on Mac Mini.
- **2026-03-09:** Moved to Docker-based cloudflared. Rogue connector (`52.124.39.58`) on old tunnel caused intermittent 404s. Deleted old tunnel, created new one (`5e8ce13d`).
- **2026-03-27:** Replaced direct cloudflared routing with Traefik reverse proxy. Wildcard `*.lobslab.com` → Traefik. lobslab.com root moved to GitHub Pages (out of this stack).
