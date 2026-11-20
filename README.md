# passe•trou

Self-hosted LLM gateway with a first-class observability plane.

One LAN endpoint that **load-balances logical models across pooled upstream accounts** (API keys today, OAuth subscriptions later) and meters everything it carries: per-request timings (TTFT, tokens/sec), token breakdowns (reasoning, cached), tool calls, spend from hand-set prices — crossable per provider, subscription, model, API key, and person. Live "tour de contrôle" dashboard included.

Agent-first, T3 Code spirit: the dashboard is just a client of passe•trou's admin API — your agents can operate it end-to-end.

**Status: design phase.** The design doc is the contract: [docs/superpowers/specs/2026-11-20-passetrou-design.md](docs/superpowers/specs/2026-11-20-passetrou-design.md)

Name: `passe•trou`, lowercase with a middle dot (U+00B7). Where `•` is illegal (repos, packages, files): `passe-trou`.

## Dev run

Node ≥ 22 and one Postgres 16 — everything else is npm workspaces.

```bash
# Postgres (any instance works; this one-liner matches apps/api/.env.example):
docker run -d --name passetrou-pg \
  -e POSTGRES_PASSWORD=change-me -e POSTGRES_DB=passetrou \
  -p 127.0.0.1:5434:5432 postgres:16-alpine

npm install
cd apps/api && cp .env.example .env   # then edit the three required values:
# DATABASE_URL             postgresql://postgres:change-me@127.0.0.1:5434/passetrou
# ADMIN_TOKEN              bearer for every /admin/* route (32+ chars; openssl rand -hex 24)
# ENCRYPTION_MASTER_KEY    AES-256-GCM key for upstream credentials, 64+ hex (openssl rand -hex 32)

npm run db:migrate   # prisma migrate dev
npm run db:seed      # admin member, CommandCode/Mistral provider presets, demo member Will

cd .. && npm run dev # API on 0.0.0.0:8477 (PORT env overrides)
```

Smoke-check the full slice — boots a test instance on a free port, drives a
streamed request through a recorded mock upstream, asserts the row and its
cost in `GET /admin/overview`:

```bash
bash scripts/smoke.sh
```

LAN-only by design: plain HTTP on all interfaces, no TLS, no tunnel code —
public exposure is a deliberate operator move, later. Full route reference:
[API.md](API.md).

## Self-host (docker)

`docker-compose.yml` runs the API plus a Postgres 16 (`pgdata` volume);
migrations are applied automatically at boot.

```bash
cp /dev/null .env   # then set the required vars
# POSTGRES_PASSWORD=$(openssl rand -hex 24)
# ADMIN_TOKEN=$(openssl rand -hex 32)      # Bearer for /admin/*
# ENCRYPTION_MASTER_KEY=$(openssl rand -hex 32)  # AES-256-GCM master key — back it up: losing it bricks stored secrets
docker compose up -d --build
curl localhost:8477/healthz
```

`PASSETROU_PORT` overrides the published port (default `8477`).

## License

MIT — © 2026 Wyliam Burger.
