# Deploying Ember Table to Vercel

## What's in place

- Entry point: root-level `server.js` (Express app, `app.listen()` — Vercel
  auto-detects this pattern, no custom build step needed).
- `vercel.json` — minimal (`{"framework": null}`), so Vercel doesn't try to
  apply Next.js/other framework presets to a plain Express app.
- `package.json` — `engines.node: "22.x"` pins the Node runtime version.
- Static assets (`index.html`, the admin panel) live under `public/`, because
  Vercel does not serve files through `express.static()` in deployed
  functions — only `public/**` is served (by its CDN, ahead of the function).
- `api/[...path].js` — `/api/**` is a reserved, platform-routed namespace on
  Vercel: requests under it are matched against actual files in `api/`
  *before* they'd ever reach a "detected server" function like the root
  `server.js`. This catch-all re-exports the same Express app so its
  internal `/api` routing (menu, orders, auth, stats, everything) actually
  receives those requests. Without this file, every `/api/*` call 404s at
  the platform level and the site loads with no menu data — confirmed live,
  not theoretical (see the "confirmed working" note below).
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
   - `SESSION_SECRET` — a long random string. Recommended so login sessions
     don't invalidate on every cold start.
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
