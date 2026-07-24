require("dotenv").config();
const path = require("node:path");
const crypto = require("node:crypto");
const express = require("express");
const session = require("express-session");

require("./server/db"); // opens/creates the database and seeds it on first run
const { IS_VERCEL, uploadsDir } = require("./server/env-paths");

const authRoutes = require("./server/routes/auth");
const menuRoutes = require("./server/routes/menu");
const restaurantRoutes = require("./server/routes/restaurant");
const uploadRoutes = require("./server/routes/upload");
const ordersRoutes = require("./server/routes/orders");
const statsRoutes = require("./server/routes/stats");

const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = process.env.PORT || 3000;

// A random secret keeps sessions safe by default. It means everyone is logged
// out if the server restarts — fine for this scale. Set SESSION_SECRET in a
// .env file (or a Vercel environment variable) instead if you'd rather
// sessions survive restarts/cold starts.
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");

const app = express();
app.disable("x-powered-by");
if (IS_VERCEL) app.set("trust proxy", 1); // needed for secure cookies behind Vercel's proxy/TLS termination

app.use(express.json());
app.use(
  session({
    name: "emberTable.sid",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
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
