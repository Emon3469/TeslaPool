# Deployment

## Container contract (any platform)

| Aspect | Behaviour |
|---|---|
| Image | multi-stage (`deps` → `build` → `prod-deps` → `runtime`), `node:22-bookworm-slim`, production deps only, runs as non-root `node` |
| Listen | `HOST=0.0.0.0`, `PORT` from the environment (default 3000) |
| Start | `scripts/docker-entrypoint.sh`: `prisma migrate deploy` (retried up to 15× / 3 s while the DB boots) → optional seed (`SEED_ON_START=true`) → `exec node dist/src/main.js` |
| Config | 100% environment variables (see `.env.example`); invalid config fails fast at startup; production refuses the dev JWT secret and `CORS_ORIGINS=*` |
| State | none on local disk (DB is external; rate-limit counters are in memory) |
| Health | `GET /health` (liveness) · `GET /health/ready` (DB check, 503 if down; ML informational). Docker `HEALTHCHECK` uses `/health/ready` |
| Shutdown | `SIGTERM`/`SIGINT` → stop accepting connections, finish in-flight requests, disconnect Prisma, exit 0 (forced exit after 15 s) |
| Logs | JSON lines to stdout, each with `requestId` |

## Local: Docker Compose

> The step-by-step guide for **Render (API) + Vercel (web app)** is [`../../docs/DEPLOYMENT_GUIDE.md`](../../docs/DEPLOYMENT_GUIDE.md). This page covers the API's runtime behaviour in more depth.

```bash
cd ../..                 # repository root, where docker-compose.yml lives
docker compose up --build
```
Starts `postgres` (healthchecked) → `ml` sidecar → `backend` (waits for a healthy DB, migrates, seeds demo accounts) → `frontend`.

- API: http://localhost:4000 · Swagger: http://localhost:4000/api/docs · readiness: http://localhost:4000/health/ready
- Web app: http://localhost:3000 (`CORS_ORIGINS` defaults to it).
- Postgres is exposed on `127.0.0.1:5433` for inspection.
- Override defaults (`POSTGRES_PASSWORD`, `JWT_SECRET`, `API_HOST_PORT`, …) via a `.env` file next to `docker-compose.yml`.
- Run the scripted demo against it: `BASE_URL=http://localhost:4000 npm run demo`.
- ML outage drill: `docker compose stop ml`, then call `/health/ready` (→ `ready_degraded`) and create a ride (→ `fareSource: DETERMINISTIC`, `reason: ML_PREDICTION_UNAVAILABLE`).

## Local without Docker

```bash
cp .env.example .env              # set DATABASE_URL and JWT_SECRET (tests use an isolated schema)
npm ci
npx prisma migrate deploy && npm run db:seed
npm run dev                       # http://localhost:3000/api/docs
# optional ML sidecar (Python 3.13):
pip install -r ml/inference/requirements.txt
cd ml/inference && uvicorn app:app --port 8000      # then set ML_SIDECAR_URL=http://localhost:8000
```

## Render

### Option A: Blueprint (recommended)
The root `render.yaml` defines a PostgreSQL database and the API as a Docker web service with the health check and environment already wired (`DATABASE_URL` from the database, a generated `JWT_SECRET`).

1. Push the repository (the `TeslaPool` folder, with `render.yaml` at its root) to GitHub/GitLab. The blueprint already sets `rootDir: teslapool-backend`.
2. Render Dashboard → **New → Blueprint** → select the repository → **Apply**.
3. When prompted, set `CORS_ORIGINS` (your frontend origin, e.g. `https://teslapool.vercel.app`). Leave `ML_SIDECAR_URL` empty unless you deploy the sidecar (see below).
4. Wait for the deploy; continue at **Verify**.

### Option B: Manual (exact steps)
1. **Create PostgreSQL**: Dashboard → New → **PostgreSQL** → name `teslapool-db`, database `teslapool`, user `teslapool`, same region you will use for the API → Create. Copy the **Internal Database URL**.
2. **Create web service**: New → **Web Service** → connect the Git repository.
3. **Runtime: Docker**. Root directory: the backend folder (if not the repo root). Dockerfile path: `./Dockerfile`.
4. **Instance type**: Free is fine for a demo (it sleeps when idle; first request takes ~1 min).
5. **Environment variables**:

   | Key | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `DATABASE_URL` | Internal Database URL from step 1 (never `localhost`) |
   | `JWT_SECRET` | output of `openssl rand -base64 48` |
   | `TRUST_PROXY` | `2` with the Vercel web app in front (Vercel's proxy + Render's load balancer), `1` if browsers call Render directly. Wrong values make every user share one rate-limit bucket. |
   | `CORS_ORIGINS` | your frontend origin(s), comma-separated, e.g. `https://teslapool.vercel.app`. **Required even behind the Vercel proxy**: cookie-authenticated writes are CSRF-checked against it, and a missing origin makes every booking fail with `403 CSRF_ORIGIN_REJECTED`. |
   | `AUTH_COOKIE_SAMESITE` | `lax` (the web app proxies `/api/v1`, so the cookie is first-party) |
   | `SEED_ON_START` | `false` (or `true` for a demo environment; set `SEED_*_PASSWORD`) |
   | `BREVO_API_KEY`, `BREVO_SENDER_EMAIL` | required while `EMAIL_VERIFICATION` is `required`/`optional` (the sender must be verified in Brevo); without them production refuses to start |
   | `APP_URL` | the frontend URL, used in verification and reset emails |
   | `ML_SIDECAR_URL` | empty, or the sidecar URL |

   Do **not** set `PORT`: Render injects it and the app binds `0.0.0.0:$PORT`.
6. **Migrations**: nothing to configure. The container runs `prisma migrate deploy` on every start (idempotent, retried). On paid plans you may instead set a Pre-Deploy Command `./node_modules/.bin/prisma migrate deploy` and `RUN_MIGRATIONS=false`.
7. **Health check path**: Settings → Health Check Path → `/health/ready`.
8. **Deploy**: Create Web Service (or Manual Deploy → Deploy latest commit).
9. **Verify health**:
   ```bash
   curl https://<service>.onrender.com/health          # {"status":"ok",…}
   curl https://<service>.onrender.com/health/ready    # {"status":"ready" | "ready_degraded", "checks":{"database":{"status":"up"}…}}
   ```
10. **Verify the API**:
    ```bash
    curl -X POST https://<service>.onrender.com/api/v1/auth/register \
      -H 'content-type: application/json' \
      -d '{"name":"Smoke","email":"smoke@example.com","password":"smoke-test-123"}'
    BASE_URL=https://<service>.onrender.com npm run demo     # full scripted scenario
    ```
    Swagger UI: `https://<service>.onrender.com/api/docs`.

### Optional: ML sidecar on Render
Create a second **Web Service** (Docker) from the same repo with root directory `teslapool-backend/ml` (Dockerfile `./Dockerfile`), health check `/health`. Set the API's `ML_SIDECAR_URL` to its URL (private network URL `http://<name>:10000` on paid plans; the public URL otherwise). The API keeps working if the sidecar sleeps or fails: the circuit breaker falls back to deterministic estimates.

### Rollback and redeploy
- **Redeploy**: Manual Deploy → *Deploy latest commit* (or push; `autoDeploy` is on in the blueprint).
- **Rollback**: service → **Events** → pick a previous successful deploy → **Rollback**. The image is reused; no rebuild.
- **Migrations and rollback**: `migrate deploy` only moves forward. Rolling back the *code* past a migration is safe only if that migration was backward compatible (additive). Write migrations expand-then-contract (add column → deploy code → backfill → remove old column in a later release). Never edit an applied migration.
- **Config-only change**: edit Environment → Save → Render restarts with the new values (startup validation rejects bad ones, and the previous deploy keeps serving until the new one is healthy).

## CI suggestion

```bash
npm ci
npm run lint                   # eslint + tsc --noEmit
npm test                       # unit (no DB)
npm run test:all               # needs a Postgres service; uses <db>_test
docker build -t teslapool-api . && docker build -t teslapool-ml ./ml
```

## Vercel (web app)

The Next.js app in `../teslapool-frontend` proxies `/api/v1/*` to the API, so browsers only ever talk to the Vercel domain.

1. Import the repository in Vercel. Set **Root Directory** to the frontend folder. The framework preset is Next.js; keep the default install, build and output settings.
2. Environment variables (Production **and** Preview):

   | Key | Value |
   |---|---|
   | `BACKEND_URL` | the Render API URL, e.g. `https://teslapool-backend.onrender.com`. **Needed at build time**: rewrites are baked into the build, and the build fails on purpose without it. |
   | `NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS` | optional; `false` hides the one-click demo logins |

3. On Render, add the Vercel URL to `CORS_ORIGINS` and set `APP_URL` to it, then redeploy the API.
4. Check the deploy:
   - `/` shows live metrics.
   - The Nusrat demo login lands on the dashboard.
   - Booking a ride works.

   If booking fails with `CSRF_ORIGIN_REJECTED`, step 3 is missing.

On Render's free plan the API sleeps when idle. The first request after a pause can take about a minute: pages still render with placeholders, and API calls wait. Keep it warm, or use a paid instance, for a live demo.
