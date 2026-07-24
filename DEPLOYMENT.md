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
- **All app data lives in MongoDB** (`server/mongo.js`, `server/db.js`) —
  categories, menu items, restaurant info, orders (with status history
  embedded per order), users, and sessions. This replaced an earlier
  SQLite-in-`/tmp` approach that turned out to be a hard blocker, not just a
  caveat: Vercel serverless functions have no persistent filesystem and can
  route requests across multiple concurrent instances with no shared memory,
  so a customer's order written by one instance could be genuinely invisible
  to an admin request served by another — confirmed live during an actual
  order-placement test, not theoretical. `server/env-paths.js` still redirects
  *uploaded dish photos* (multer, local disk) to `/tmp` since that piece
  hasn't been migrated yet (see limitations below) — everything else no
  longer touches the filesystem.

## Deploy steps

1. Push this repo to GitHub (already done if you're reading this via the PR).
2. Create a MongoDB cluster if you don't have one: [MongoDB Atlas](https://www.mongodb.com/cloud/atlas),
   free M0 tier, no credit card required. Under **Connect → Drivers**, copy
   the connection string (`mongodb+srv://user:password@cluster.../`).
3. In the Vercel dashboard: **Add New Project** → import `khaliluvich2025-oss/menu1`.
4. Framework preset: leave as **Other** (vercel.json already sets this).
5. Set environment variables (Project Settings → Environment Variables) —
   see `.env.example` for the full list:
   - `MONGODB_URI` — **required**, the connection string from step 2. The
     server throws on boot without it; there is no fallback.
   - `SESSION_SECRET` — a long random string, private to your deployment.
     Without it, every instance falls back to a fixed *public* default (see
     caveat below) — sessions still work correctly now that the store is
     shared via MongoDB, they just aren't private.
   - `OWNER_PASSWORD` / `RECEPTIONIST_PASSWORD` — recommended (see caveat below).
6. Deploy.

## Known limitations — read before relying on this in production

- **Uploaded dish photos still don't persist**, and may not reliably serve
  back at all. Multer writes them to `/tmp` on Vercel (see
  `server/env-paths.js`), which is wiped on cold start — this piece wasn't
  part of the MongoDB migration and still needs a real file store (e.g.
  Vercel Blob, S3, or storing images in MongoDB/GridFS) before it's reliable.
  Treat it as unverified/best-effort until that's done.
- **Login credentials are a fixed test default, not random.** First boot
  (i.e. the first time the `users` collection is empty) creates:
  - `owner` / `EmberOwner#2026Secure`
  - `receptionist` / `EmberFrontDesk#2026`

  These values are **public** — they're in this source file and in
  `server/db.js`. That's a deliberate trade-off for a test deployment (a
  *random* password would be unrecoverable except through Vercel's function
  logs). Set `OWNER_PASSWORD` / `RECEPTIONIST_PASSWORD` as real environment
  variables before this is used for anything beyond casual testing — they
  always override these defaults. Both accounts are forced to set a new
  password on first login; unlike the old SQLite-on-`/tmp` setup, that change
  now persists in MongoDB across cold starts and across every instance.
- **`SESSION_SECRET` defaults to a fixed public value if unset** — sessions
  will work correctly (the store is shared via MongoDB now), but anyone who
  reads this repo's source could theoretically forge a session cookie's
  signature. Set a private `SESSION_SECRET` before real use.
- **This deployment is single-tenant** (one menu/order set per install) — see
  `server/routes/stats.js` for the note on why "restaurant-level isolation"
  isn't a separate concern here.

## Local development

```bash
npm install
```

Copy `.env.example` to `.env` and set at least `MONGODB_URI` — local dev now
needs a real MongoDB connection too (the same free Atlas cluster works fine,
or point it at a local `mongod`/Docker MongoDB if you prefer). Then:

```bash
npm start
```

Serves everything from `http://localhost:3000` — same routes, same behavior
as production, just against whichever database `MONGODB_URI` points to.

## Verifying the Vercel build without deploying

Neither the `vercel` nor `gh` CLI was available in the environment this was
prepared in, so the build/config below wasn't validated against Vercel's
actual build pipeline — only reasoned through against current Vercel docs
and confirmed against the live deployment afterward. Before trusting this in
production, you can also run once yourself:

```bash
npx vercel@latest build
```
