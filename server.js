require("dotenv").config();
const path = require("node:path");
const crypto = require("node:crypto");
const express = require("express");
// Express 4 doesn't catch rejections thrown inside async route handlers —
// every route here does `await ensureReady()` with no try/catch, so a failed
// DB call previously left the request hanging forever (no response, no
// error) instead of reaching the error-handling middleware below. This
// patches Express's routing layer to forward those rejections to next(err)
// automatically, app-wide, with no per-route changes needed.
require("express-async-errors");
const session = require("express-session");
// connect-mongo ships as an ESM package with a generated CJS build; a plain
// require() gets the module namespace object, not the class itself — the
// real export lives at .default (confirmed against the installed version,
// not assumed).
const MongoStore = require("connect-mongo").default;

const { clientPromise, DB_NAME } = require("./server/mongo");
require("./server/db").ensureReady().catch((err) => {
  // Route handlers await the same cached promise and will surface a real
  // error to the client; this just gets the connection warming up at boot
  // instead of waiting for the first request, and logs it either way.
  console.error("[db] MongoDB connection/initialization failed:", err.message);
});
const { IS_VERCEL, uploadsDir } = require("./server/env-paths");

const authRoutes = require("./server/routes/auth");
const menuRoutes = require("./server/routes/menu");
const restaurantRoutes = require("./server/routes/restaurant");
const uploadRoutes = require("./server/routes/upload");
const ordersRoutes = require("./server/routes/orders");
const statsRoutes = require("./server/routes/stats");

const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = process.env.PORT || 3000;

// Fixed, documented test default — NOT randomly generated. A per-instance
// random secret breaks logins on Vercel: every cold start (and Vercel routes
// requests across MULTIPLE concurrent instances, not just one) would mint a
// different secret, so a session cookie signed by one instance fails
// signature verification on another and the user silently appears logged
// out. Set a real SESSION_SECRET env var in production to use a private one.
const DEFAULT_SESSION_SECRET = "ember-table-test-session-secret-2026-not-for-real-production-use";
const SESSION_SECRET = process.env.SESSION_SECRET || DEFAULT_SESSION_SECRET;

const app = express();
app.disable("x-powered-by");
if (IS_VERCEL) app.set("trust proxy", 1); // needed for secure cookies behind Vercel's proxy/TLS termination

// Last-resort safety net: connect-mongo builds its own internal promise chain
// off `clientPromise` (store.collectionP) with no rejection handler attached
// at construction time. If the Mongo connection fails, that chain rejects
// unhandled and crashes the ENTIRE process for ALL users — confirmed live
// (a single failed login took the whole server down) — even though the
// app's own `ensureReady().catch()` below handled the same underlying
// failure just fine. Every request already surfaces real DB errors to the
// client that hit them; this just stops one bad promise anywhere from
// silently taking the whole server down for everyone else.
process.on("unhandledRejection", (err) => {
  console.error("[unhandledRejection]", err);
});

app.use(express.json());
const sessionStore = MongoStore.create({ clientPromise, dbName: DB_NAME, collectionName: "sessions" });
sessionStore.collectionP.catch((err) => {
  console.error("[db] Session store's MongoDB connection failed:", err.message);
});
app.use(
  session({
    name: "emberTable.sid",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    // Shares the same MongoDB connection as the app data. Without this,
    // express-session's default MemoryStore keeps sessions in one instance's
    // process memory — invisible to any other concurrent serverless
    // instance, which made logins randomly appear to fail on Vercel.
    store: sessionStore,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: IS_VERCEL, // Vercel always serves over HTTPS; local dev stays plain HTTP
      maxAge: 8 * 60 * 60 * 1000
    }
  })
);

app.use("/api/auth", authRoutes);
app.use("/api", menuRoutes);
app.use("/api", restaurantRoutes);
app.use("/api", uploadRoutes);
app.use("/api", ordersRoutes);
app.use("/api", statsRoutes);

app.use("/api", (req, res) => res.status(404).json({ error: "not_found" }));

// Local dev: Express serves these directly. On Vercel, express.static() is
// ignored for deployed functions — /admin and /images are served instead by
// Vercel's own CDN straight from the public/ directory (see vercel.json /
// project docs). The /uploads mount stays Express-served either way since
// uploaded files don't exist at build time; on Vercel they land in the
// ephemeral /tmp (see server/env-paths.js) and won't persist across cold starts.
app.use("/uploads", express.static(uploadsDir()));
app.use("/images", express.static(path.join(PUBLIC_DIR, "images")));
app.use("/admin", express.static(path.join(PUBLIC_DIR, "admin")));

app.get("/", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "server_error" });
});

// Vercel detects this call and routes requests to the app without exposing a
// real port; the port below is only used for local development.
app.listen(PORT, () => {
  console.log(`Ember Table site  → http://localhost:${PORT}`);
  console.log(`Admin CMS         → http://localhost:${PORT}/admin`);
});

module.exports = app;
