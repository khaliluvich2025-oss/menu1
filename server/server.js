require("dotenv").config();
const path = require("node:path");
const crypto = require("node:crypto");
const express = require("express");
const session = require("express-session");

require("./db"); // opens/creates data/app.db and seeds it on first run

const authRoutes = require("./routes/auth");
const menuRoutes = require("./routes/menu");
const restaurantRoutes = require("./routes/restaurant");
const uploadRoutes = require("./routes/upload");
const ordersRoutes = require("./routes/orders");
const statsRoutes = require("./routes/stats");

const ROOT_DIR = path.join(__dirname, "..");
const PORT = process.env.PORT || 3000;

// A random secret keeps sessions safe by default. It means everyone is logged
// out if the server restarts — fine for this scale. Set SESSION_SECRET in a
// .env file instead if you'd rather sessions survive restarts.
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");

const app = express();
app.disable("x-powered-by");
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
      secure: false, // flip to true once this runs behind HTTPS
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

app.use("/uploads", express.static(path.join(ROOT_DIR, "uploads")));
app.use("/images", express.static(path.join(ROOT_DIR, "images")));
app.use("/admin", express.static(path.join(ROOT_DIR, "admin")));

app.get("/", (req, res) => res.sendFile(path.join(ROOT_DIR, "index.html")));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "server_error" });
});

app.listen(PORT, () => {
  console.log(`Ember Table site  → http://localhost:${PORT}`);
  console.log(`Admin CMS         → http://localhost:${PORT}/admin`);
});
