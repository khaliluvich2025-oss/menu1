# Deploying Ember Table to Vercel

## What's in place

- Entry point: root-level `server.js` (Express app, `app.listen()` — Vercel
  auto-detects this pattern, no custom build step needed).
- `vercel.json` — `{"framework": null}` so Vercel doesn't apply Next.js/other
  framework presets to a plain Express app, plus a `rewrites` rule (see below).
- `package.json` — `engines.node: "22.x"` pins the Node runtime version.
- Static assets (`index.html`, the admin panel) live under `public/`, because
  Vercel does not serve files through `express.static()` in deployed
  functions — only `public/**` is served (by its CDN, ahead of the function).
- `api/index.js` — `/api/**` is a reserved, platform-routed namespace on
  Vercel: requests under it are matched against actual files in `api/`
  *before* they'd ever reach a "detected server" function like the root
  `server.js`. This file re-exports the same Express app so its internal
  `/api` routing (menu, orders, auth, stats, everything) actually receives
  those requests. A bracket catch-all filename (`api/[...path].js`) was tried
  first and only reliably matched single-segment paths (`/api/menu` worked,
  `/api/auth/me` and `/api/admin/orders` 404'd) — confirmed live, not
  theoretical. The `vercel.json` rewrite below is what makes nested paths
  work; without both pieces, `/api/*` either 404s outright or only partially
  works in a way that's easy to miss if you only test one endpoint.
  ```json
  "rewrites": [{ "source": "/api/:path*", "destination": "/api/index" }]
  ```
- `server/env-paths.js` redirects the SQLite file and upload destination to
  `/tmp` when `process.env.VERCEL` is set, since Vercel functions have a
  read-only filesystem everywhere except `/tmp`. Without this the app would
  crash on boot trying to write `data/app.db`.

## Deploy steps

1. Push this repo to GitHub (already done if you're reading this via the PR).
2. In the Vercel dashboard: **Add New Project** → import `khaliluvich2025-oss/menu1`.
3. Framework preset: leave as **Other** (vercel.json already sets this).
4. Set environment variables (Project Settings → Environment Variables) —
   see `.env.example` for the full list:
   - `SESSION_SECRET` — a long random string, private to your deployment.
     Not just "recommended": without it, every serverless instance falls
     back to its own fixed *public* default (see caveat below) — logins
     still work, but aren't private.
   - `OWNER_PASSWORD` / `RECEPTIONIST_PASSWORD` — recommended (see caveat below).
5. Deploy.

## Known limitations — read before relying on this in production

You asked to defer migrating off SQLite and the local uploads folder, so
this deployment keeps both, made just stable enough not to crash. Concretely:

- **The database resets on every cold start.** Vercel functions have no
  persistent filesystem; `data/app.db` lives in `/tmp`, which is wiped
  whenever a fresh instance spins up (after ~a few minutes idle, or on every
  deploy). Any menu edits, orders, or status changes made during one "warm"
  window are gone on the next cold start — it reseeds from `server/seed-data.js`
  each time.
- **Sessions use a fixed test secret, not random — and even so, are not
  reliably shared across concurrent visitors.** `SESSION_SECRET` used to fall
  back to a fresh random value per cold start; since Vercel routes requests
  across *multiple concurrent* instances (not one long-lived process), a
  cookie signed by instance A failed verification on instance B, and login
  appeared to randomly fail on the very next request — confirmed live via a
  live client+admin test (login returned 200, the immediate next request 401'd,
  100% of the time). Fixed the same way as the passwords below: a fixed,
  public, documented fallback secret so all instances agree, unless you set a
  real `SESSION_SECRET`. That fixes signature verification, but sessions are
  still stored in each instance's own memory (`express-session`'s default
  `MemoryStore`) — two requests that land on *different* instances still
  won't see each other's logged-in state. Same root cause as the database
  reset above (no shared storage across instances), and it needs the same
  fix: a real external, shared store (Postgres/Redis/Supabase-backed session
  store), not just a code tweak. Low-traffic testing mostly avoids this
  because Vercel tends to reuse one warm instance; don't rely on it for real
  concurrent staff+customer usage.
- **Login credentials are a fixed test default, not random.** Every reseed
  (i.e. every cold start, until you set real env vars) creates:
  - `owner` / `EmberOwner#2026Secure`
  - `receptionist` / `EmberFrontDesk#2026`

  These values are **public** — they're in this source file and in
  `server/db.js`. That's a deliberate trade-off for a test deployment with an
  ephemeral database (a *random* password would be unrecoverable except
  through Vercel's function logs, which is worse for testing). Set
  `OWNER_PASSWORD` / `RECEPTIONIST_PASSWORD` as real environment variables
  before this is used for anything beyond casual testing — they always
  override these defaults. Either way, both accounts are forced to set a new
  password on first login; on Vercel that change won't survive the next cold
  start without persistent storage (expected, same root cause as above).
- **Uploaded dish photos won't persist**, and may not reliably serve back at
  all — this specific feature (multer upload → serve back) hasn't been
  tested against the live deployment yet. Treat it as unverified until tried.
- **This is a structural/demo deployment, not production-ready for real
  customer traffic.** Before that, you'll want a real persistent database
  (Vercel Postgres, Turso, or the Supabase move discussed earlier) and a
  proper file storage service (e.g. Vercel Blob) for uploads.

## Local development is unchanged

```bash
npm install
npm start
```

Still serves everything from `http://localhost:3000` exactly as before —
`server.js` at the root now, but same behavior, same routes, same data
folder on local disk (no `/tmp` redirect kicks in unless `VERCEL` is set).

## Verifying the Vercel build without deploying

Neither the `vercel` nor `gh` CLI was available in the environment this was
prepared in, so the build/config below wasn't validated against Vercel's
actual build pipeline — only reasoned through against current Vercel docs.
Before trusting this in production, run once yourself:

```bash
npx vercel@latest build
```
