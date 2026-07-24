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
- **Login passwords reset too**, for the same reason — a fresh random owner/
  receptionist password is generated on every reseed unless you set
  `OWNER_PASSWORD` / `RECEPTIONIST_PASSWORD` as environment variables, which
  makes at least the *credentials* stable even though the *data* still isn't.
- **Uploaded dish photos won't persist**, and may not reliably serve back at
  all depending on how Vercel's Node runtime bundles the function — this
  wasn't verified against a live deployment (no Vercel account access from
  this environment). Treat image upload as untested on Vercel until you've
  tried it yourself.
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
