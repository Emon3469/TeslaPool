# TeslaPool web

The Next.js frontend for **TeslaPool**, shared auto-rickshaw ("Tesla") rides for Dhaka. It includes a marketing site, a passenger app, a driver app and an ops console, all driven by the [TeslaPool API](../teslapool-backend).

- **Design:** a lime / cream / charcoal system (`#C1F11D`, `#FFFEE9`, `#151515`, `#797979`, Roboto).
- **Components:** rounded-2xl/3xl cards, pill buttons, lime focus rings and marker highlights.
- **Home page:** follows the reference layout section for section (A–I), rebranded and filled with TeslaPool's own copy and live numbers.

## Run it

```bash
# 1. API on :4000 (from ../teslapool-backend, with its .env)
PORT=4000 npm run dev
# 2. Web on :3000
npm install
npm run dev
```

Open http://localhost:3000.

- **How the browser reaches the API:** it only talks to `/api/v1/*` on port 3000. Next.js proxies those calls to `BACKEND_URL` (default `http://localhost:4000`). The HttpOnly `tp_session` cookie is therefore first-party: no CORS, and no token in JavaScript.
- **Accounts:** the login page has one-click demo logins. The passwords are listed in the table below; `src/content/demo.ts` keeps them in sync with the API seed. You can also register a new account and confirm it with the emailed code.

| Role | Email | Password |
|---|---|---|
| Passenger | `nusrat@teslapool.dev` (also `rafiq@`, `arif@`, `shirin@`) | `Passenger@2026` |
| Driver | `jashim@teslapool.dev` | `Driver@2026` |
| Admin | `ops@teslapool.dev` | `Admin@2026` |

#### Reviewer walkthrough: a full Tesla (about 3 minutes, in the web app)

Jashim's Bullet has 3 seats. Use the one-click demo logins on `/login`; each step is a different account. Everything below was run end to end against the live API.

1. **Nusrat** requests Banani → Mohakhali (1 seat) and taps **Join this pool** on Bullet.
2. **Rafiq** requests Banani → Gulshan 1 and joins Bullet. The route becomes Banani → Gulshan 1 → Mohakhali, and fares re-price as riders share.
3. **Arif** requests Banani → Mohakhali and joins Bullet, which is now **3/3**. Nusrat went from ৳126.50 riding alone to ৳94.88 with three riders.
4. **Shirin** requests Banani → Gulshan 1:
   - The matching page shows Bullet as **"Not matched: Only 0 seats left, 1 requested"**.
   - **Best match for me** finds nothing, and her request stays open for another driver.
5. **Jashim** opens his dashboard:
   - It shows **3 / 3 taken**, the stop order, and each rider's fare.
   - A note says all seats are taken.
   - Shirin is listed as waiting, with the same verdict and no Accept button. Forcing an accept through the API returns `409 CAPACITY_EXCEEDED`.
   - He can't go offline while carrying passengers.
   - His decision is to drive the three he has: **Arrived at pickup → Start trip → Complete trip**, one rider at a time.
6. **Ops** (admin) sees the full pool live on `/ops`, and `/impact` still reports **0 capacity violations**.

To run it again, cancel the four rides from each passenger's ride page. Jashim's pool returns to OPEN with 3 free seats.

Full stack in Docker (Postgres + ML + API + web): `docker compose up --build` from the repository root (`../`). Web runs on :3000, API on :4000. Deploying: see [`../docs/DEPLOYMENT_GUIDE.md`](../docs/DEPLOYMENT_GUIDE.md) (Vercel + Render).

| Script | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js dev server / production build (standalone) / serve the build |
| `npm run lint` | ESLint (next/core-web-vitals + TypeScript) and `tsc --noEmit` |
| `npm test` | Vitest + Testing Library (44 tests) |
| `npm run test:e2e` | Playwright end-to-end suite (29 tests): drives every page in a real browser against the real API and checks the UI shows exactly what the API returned. Starts the API and web app if they aren't running; uses the installed Microsoft Edge locally. |
| `npm run api:types` | Regenerate `src/lib/api-types.ts` from `../teslapool-backend/openapi/openapi.json` |

## Pages

| Area | Route | What it does |
|---|---|---|
| Marketing | `/` | Landing page following the reference design (sections A–I), with live metrics |
| | `/how-it-works`, `/safety`, `/impact`, `/drive`, `/about`, `/news`, `/news/[slug]`, `/terms`, `/privacy` | Steps, rules and fare calculator; safety pact and seat guarantee; live impact; driver recruitment; company; product news; legal |
| | `/areas` | **Dhaka areas**: the ten predefined zones with exact lat/long, neighbours and distances on a free OpenStreetMap map. Links straight into a ride request. |
| | `/intelligence` | **Intelligence / system dashboard**, with five sections:<br>• **System health:** API, PostgreSQL and ML sidecar.<br>• **Prediction lab:** runs the live ETA and fare models, shows the guardrail band, and can sweep all four traffic levels.<br>• **Model and matching metrics.**<br>• **Engine rules and ride state machine.**<br>• **Zone distance matrix.** |
| Auth | `/login`, `/register` | Safe `?next=` redirects, ride-or-drive role picker, one-click demo logins (passenger / driver / admin) |
| | `/verify-email` | 6-digit code boxes (paste, auto-submit, `one-time-code` autofill), resend with countdown. After sign-up you land here; the app shows a banner until the email is confirmed. |
| | `/forgot-password`, `/reset-password` | Email a reset code, then set a new password with it |
| Passenger | `/passenger` | **Dashboard**: live active ride with its stepper, a quick request from area chips, one-tap "again" routes, TeslaPay balance, own savings / spend / trips, recent rides |
| | `/ride/new` | **Request ride**:<br>• Pick areas from chips, or drop exact pins on a street map (snapped to the nearest zone); "use my location" is also available.<br>• A live price preview comes from the same prediction pipeline as the real quote.<br>• Choose vehicle, seats, cash or TeslaPay, and optional trip conditions. |
| | `/rides/[id]/matches` | **Pool matching / results**: the quote with its itemised fare. Every open pool shows its verdict and rule-by-rule reasons, and hovering a pool shows its route on the map. Join a pool, ask for the best match, wait for a driver, or cancel. |
| | `/rides/[id]` | **Active ride**:<br>• Live stepper; driver and vehicle; stop order; co-riders.<br>• Why you were matched, and the pools that rejected you.<br>• Fare breakdown and discount; leave pool / cancel.<br>• Timeline and raw event log; printable receipt.<br>• Admin controls when signed in as ops. |
| | `/pools/[id]` | **Active pool**: vehicle, seats, stop order, riders (privacy-filtered), map. Driver or ops can close an empty pool. |
| | `/rides`, `/wallet`, `/profile` | History (status filter, pagination); wallet top-up (idempotent) + ledger; profile |
| Driver | `/driver` | **Dashboard**: go online/offline; live seat bar and stop order; one next action per passenger (arrive → start → complete); waiting riders with an explained fit and **Accept** |
| | `/driver/vehicles`, `/driver/history` | Register, rename, change seats, (de)activate, **open a pool** with a vehicle; past pools with riders and fares |
| Admin | `/ops` | Live pools (linking to pool pages) and platform health; ride pages gain operations controls |

## API coverage

Every backend endpoint is used by at least one page:

| Endpoint | Where |
|---|---|
| `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` | `/register`, `/login`, account menu, every signed-in page |
| `POST /auth/email/verify`, `POST /auth/email/resend` | `/verify-email` (banner on app pages, link from `EMAIL_NOT_VERIFIED` errors, profile badge) |
| `POST /auth/password/forgot`, `POST /auth/password/reset` | `/forgot-password`, `/reset-password` |
| `PATCH /users/me` | `/profile` (reads use `GET /auth/me`) |
| `GET /meta` | request form, maps, calculator, `/how-it-works`, `/areas`, `/intelligence` |
| `POST /predictions/fare` | live price preview on `/ride/new`; prediction lab |
| `POST /predictions/eta` | prediction lab |
| `POST /rides`, `GET /rides` | `/ride/new`; `/rides`, `/passenger`, active-ride checks |
| `GET /rides/{id}`, `GET /rides/{id}/explanation`, `GET /rides/{id}/events` | `/rides/[id]` |
| `POST /rides/{id}/match` | `/rides/[id]/matches` (best match), `/rides/[id]`, ops controls |
| `POST /rides/{id}/cancel` | matches page, ride page, ops controls |
| `POST /rides/{id}/arrive`, `start`, `complete` | `/driver`, ops controls on `/rides/[id]` |
| `GET /pools` | `/driver/history`, `/ops` |
| `POST /pools` | "Open pool" on `/driver/vehicles` |
| `GET /pools/{id}` | `/pools/[id]` |
| `POST /pools/{id}/join` | `/rides/[id]/matches` |
| `POST /pools/{id}/leave` | `/rides/[id]` |
| `POST /pools/{id}/cancel` | `/pools/[id]` |
| `GET /pools/{id}/requests`, `POST /pools/{id}/accept` | `/driver` |
| `GET /driver/status`, `POST /driver/online`, `POST /driver/offline` | `/driver` |
| `GET /vehicles`, `POST /vehicles`, `PATCH /vehicles/{id}` | `/driver/vehicles` |
| `GET /wallet`, `POST /wallet/top-up` | `/wallet`, `/passenger`, request form |
| `GET /stats/impact` | `/`, `/impact`, `/safety`, `/intelligence`, `/ops` |
| `GET /health`, `GET /health/ready` | `/intelligence` (proxied as `/api/sys/health`, `/api/sys/ready`) |

**Maps:** free [OpenStreetMap](https://www.openstreetmap.org/copyright) tiles through Leaflet, muted to the brand palette. Every map can switch to an offline schematic zone graph, and the viewer's choice is remembered.

## Design and engineering notes

- **Everything shown comes from the API.** Headlines, rule checks, fare lines and timelines are the API's explanations, rendered, never invented in the UI. Marketing numbers are live (`/stats/impact`, `/meta`), with graceful placeholders when the API is down.
- **Money is integer poysha.** `formatBdt` never floats an amount. The calculator reproduces the API's half-up rounding; the tests pin the PRD's hand-checked fares (Nusrat ৳126.50 → ৳108.93, Rafiq ৳106.25 → ৳79.69).
- **Safe writes.**
  - Ride requests, joins, top-ups and lifecycle actions send an `Idempotency-Key`, so a retry never double-books or double-credits.
  - A top-up keeps the same key until it succeeds.
  - Buttons disable while a request is in flight.
- **Errors are traceable.** Every failure shows the API's message, `error.code` and `requestId`.
  - Network failures and a down API get their own messages.
  - 4xx errors are not retried; 5xx and network errors are.
- **Auth is layered.**
  - `middleware.ts` redirects signed-out visitors away from app routes before rendering.
  - `AppPage` handles expired sessions (401 → `/login?reason=expired`) and role gating.
  - The API remains the authority for every request.
- **Accessibility.**
  - Semantic landmarks and a skip link; lime `:focus-visible` rings; labelled controls with `aria-invalid`/`aria-describedby`.
  - Keyboard-operable zone map; `aria-live` quotes and toasts; `prefers-reduced-motion` respected.
  - No horizontal scroll at 375 px.
- **Security headers:** `X-Frame-Options: DENY`, `nosniff`, a strict referrer policy, and a permissions policy.

## Structure

```
src/
  app/                 routes (marketing, auth, passenger, driver, ops), error + 404 pages
  components/
    marketing/         header, footer, home sections, page hero, calculator, impact dashboard
    app/               AppPage shell, zone map, match decision card, fare breakdown, stepper, ride list
    illustrations/     brand line-art SVGs (auto-rickshaw, city, service art, safety ring)
    ui/                button, states (loading/error/empty), toast, field, pills, photo
  content/             news items and photo URLs
  lib/                 api client, types (from OpenAPI), formatting, fare math, ride rules, hooks
  middleware.ts        signed-out redirect for app routes
```

Photos are AI-generated stock images supplied with the design. They are hot-linked, and each falls back to a captioned tile if the host is unreachable.
