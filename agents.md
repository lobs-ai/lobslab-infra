# Agents — lobslab-infra

## What lobslab-infra Manages

lobslab-infra is the reverse-proxy stack for `*.lobslab.com`. It runs entirely in Docker and provides:

- **Traefik** — reverse proxy routing by subdomain
- **cloudflared** — Cloudflare Tunnel connecting to the internet
- **lobslab-home** — landing page at `home.lobslab.com`

**Architecture:**
```
Internet → Cloudflare → Cloudflare Tunnel → cloudflared → Traefik :80 → Services
```

Cloudflare handles TLS termination. All traffic inside Docker is plain HTTP on port 80.

## Standardized Scripts

Always use `deploy.sh` instead of raw `docker compose` commands.

```bash
./deploy.sh              # Full rebuild + restart all services (pulls images, starts stack)
./deploy.sh status       # Show running containers and accessible URLs
./deploy.sh logs         # Tail logs for all services
./deploy.sh logs traefik # Tail logs for a specific service (traefik, cloudflared, lobslab-home)
./deploy.sh add <name>   # Print docker-compose labels template for a new service
```

For first-time setup:
```bash
./setup.sh
```

## Key Conventions

- **The `lobslab` Docker network** is the shared network all services must join to be reachable via Traefik.
- **Access control is at Cloudflare**, not Traefik. Private services require a Cloudflare Access policy; Traefik routes everything equally.
- **No DNS changes needed for new services** — adding a subdomain is purely a Traefik label/config change.
- **Tunnel credentials are secret** — `tunnel-credentials.json` is gitignored and must be present at runtime.
- **Traefik dynamic config reloads automatically** — editing `traefik/dynamic.yml` takes effect without restarting anything.

## Adding a New Service

### Option A — Docker Container (preferred)

Add the service to the `lobslab` network with Traefik labels:

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
      - "traefik.http.services.my-app.loadbalancer.server.port=3000"  # your internal port
```

Then start it with `docker compose up -d`. Traefik discovers it within seconds — no restart needed.

### Option B — Host-Based Service (runs outside Docker)

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

Traefik picks up the change automatically (file provider watches the config).

### Making a Service Private

Create a Cloudflare Access policy in the **Zero Trust dashboard** for the subdomain. Traefik routing is unchanged — access control happens at the Cloudflare edge.

### Making a Service Public

Omit the Cloudflare Access policy. Traefik routes it and anyone can reach it.

## Existing Services

| Service | Subdomain | Type | Access |
|---------|-----------|------|--------|
| Home | `home.lobslab.com` | Docker container | Public |
| Traefik dashboard | `traefik.lobslab.com` | Host service | **Private** — Cloudflare Access |
| Nexus (lobs-core) | `nexus.lobslab.com` | Host port 9420 | **Private** — Cloudflare Access |

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Subdomain returns 502 | Check container is on `lobslab` network with `traefik.enable=true` label |
| Subdomain not responding | `./deploy.sh logs traefik` — verify labels and network |
| Tunnel disconnected | `./deploy.sh logs cloudflared` — verify `tunnel-credentials.json` is present |
| Nexus 502 | Ensure lobs-core is running on host port 9420: `curl http://localhost:9420` |
| Traefik dashboard 404 | Verify `lobslab` network exists and Traefik container is running |

## Files

```
lobslab-infra/
├── docker-compose.yml          # Traefik + cloudflared + lobslab-home
├── cloudflared-config.yml      # Tunnel config
├── tunnel-credentials.json     # Secret — gitignored
├── traefik/
│   ├── traefik.yml             # Static config (entrypoints, Docker provider, API)
│   └── dynamic.yml             # Host-based services (nexus, dashboard)
├── home/                       # home.lobslab.com
├── deploy.sh                   # Stack management (use this, not raw docker compose)
└── setup.sh                    # First-time setup
```
