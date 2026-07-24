const path = require("node:path");
const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");
const bcrypt = require("bcryptjs");
const seed = require("./seed-data");
const { dataDir, IS_VERCEL } = require("./env-paths");

const DATA_DIR = dataDir();
const DB_PATH = path.join(DATA_DIR, "app.db");
if (IS_VERCEL) {
  // /tmp is wiped on every cold start: menu edits, orders, and password
  // changes made during a warm invocation will NOT survive the next one.
  // This keeps the app bootable on Vercel without migrating off SQLite yet.
  console.warn("[db] Running on Vercel with an ephemeral /tmp database — data will not persist across cold starts.");
}

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
  CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    sort_order INTEGER NOT NULL DEFAULT 0,
    label_fr TEXT NOT NULL,
    label_en TEXT NOT NULL,
    label_ar TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS menu_items (
    id TEXT PRIMARY KEY,
    category_id TEXT NOT NULL REFERENCES categories(id),
    sort_order INTEGER NOT NULL DEFAULT 0,
    price REAL NOT NULL,
    discount_price REAL,
    image TEXT,
    featured INTEGER NOT NULL DEFAULT 0,
    recommended INTEGER NOT NULL DEFAULT 0,
    available INTEGER NOT NULL DEFAULT 1,
    name_fr TEXT NOT NULL,
    name_en TEXT NOT NULL,
    name_ar TEXT NOT NULL,
    desc_fr TEXT NOT NULL DEFAULT '',
    desc_en TEXT NOT NULL DEFAULT '',
    desc_ar TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS restaurant_info (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    name TEXT NOT NULL,
    logo_initials TEXT NOT NULL,
    currency TEXT NOT NULL,
    whatsapp_number TEXT NOT NULL,
    default_language TEXT NOT NULL,
    default_theme TEXT NOT NULL,
    animation_intensity TEXT NOT NULL,
    hero_image TEXT,
    opening_hours_fr TEXT NOT NULL DEFAULT '',
    opening_hours_en TEXT NOT NULL DEFAULT '',
    opening_hours_ar TEXT NOT NULL DEFAULT '',
    address_fr TEXT NOT NULL DEFAULT '',
    address_en TEXT NOT NULL DEFAULT '',
    address_ar TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    phone_href TEXT NOT NULL DEFAULT '',
    social_instagram TEXT NOT NULL DEFAULT '#',
    social_facebook TEXT NOT NULL DEFAULT '#',
    social_tiktok TEXT NOT NULL DEFAULT '#'
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ref TEXT NOT NULL UNIQUE,
    table_number TEXT NOT NULL,
    items_json TEXT NOT NULL,
    total REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','completed','cancelled')),
    lang TEXT NOT NULL DEFAULT 'fr',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('owner','receptionist')),
    must_change_password INTEGER NOT NULL DEFAULT 0
  );
`);

// ---------------------------------------------------------------------
// MIGRATIONS — SQLite can't ALTER a CHECK constraint in place, so schema
// changes to `orders` go through rebuild-and-copy, guarded by PRAGMA
// user_version so each migration runs exactly once.
// ---------------------------------------------------------------------
function runMigrations() {
  const version = db.prepare("PRAGMA user_version").get().user_version;

  if (version < 1) {
    // v1: expand order status to the full kitchen lifecycle (received →
    // confirmed → preparing → ready → completed, or cancelled/rejected),
    // and add order_status_history to record who changed what, when, and why.
    db.exec("PRAGMA foreign_keys = OFF;");
    db.exec(`
      CREATE TABLE orders_v1 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ref TEXT NOT NULL UNIQUE,
        table_number TEXT NOT NULL,
        items_json TEXT NOT NULL,
        total REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'received'
          CHECK (status IN ('received','confirmed','preparing','ready','completed','cancelled','rejected')),
        lang TEXT NOT NULL DEFAULT 'fr',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO orders_v1 (id, ref, table_number, items_json, total, status, lang, created_at)
        SELECT id, ref, table_number, items_json, total,
          CASE status WHEN 'new' THEN 'received' ELSE status END,
          lang, created_at
        FROM orders;
      DROP TABLE orders;
      ALTER TABLE orders_v1 RENAME TO orders;

      CREATE TABLE order_status_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL REFERENCES orders(id),
        status TEXT NOT NULL,
        changed_by_username TEXT,
        changed_by_role TEXT,
        note TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO order_status_history (order_id, status, changed_by_username, changed_by_role, note, created_at)
        SELECT id, status, NULL, NULL, NULL, created_at FROM orders;
    `);
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec("PRAGMA user_version = 1;");
    console.log("[db] Migrated to schema v1 (expanded order status + history).");
  }
}
runMigrations();

function seedIfEmpty() {
  const categoryCount = db.prepare("SELECT COUNT(*) AS n FROM categories").get().n;
  if (categoryCount === 0) {
    const insertCategory = db.prepare(
      "INSERT INTO categories (id, sort_order, label_fr, label_en, label_ar) VALUES (?, ?, ?, ?, ?)"
    );
    for (const c of seed.categories) {
      insertCategory.run(c.id, c.sortOrder, c.labelFr, c.labelEn, c.labelAr);
    }

    const insertItem = db.prepare(`
      INSERT INTO menu_items
        (id, category_id, sort_order, price, discount_price, image, featured, recommended, available,
         name_fr, name_en, name_ar, desc_fr, desc_en, desc_ar)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const i of seed.menuItems) {
      insertItem.run(
        i.id, i.categoryId, i.sortOrder, i.price, i.discountPrice, i.image,
        i.featured, i.recommended, i.available,
        i.nameFr, i.nameEn, i.nameAr, i.descFr, i.descEn, i.descAr
      );
    }

    const r = seed.restaurantInfo;
    db.prepare(`
      INSERT INTO restaurant_info
        (id, name, logo_initials, currency, whatsapp_number, default_language, default_theme, animation_intensity,
         hero_image, opening_hours_fr, opening_hours_en, opening_hours_ar, address_fr, address_en, address_ar,
         phone, phone_href, social_instagram, social_facebook, social_tiktok)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      r.name, r.logoInitials, r.currency, r.whatsappNumber, r.defaultLanguage, r.defaultTheme, r.animationIntensity,
      r.heroImage, r.openingHoursFr, r.openingHoursEn, r.openingHoursAr, r.addressFr, r.addressEn, r.addressAr,
      r.phone, r.phoneHref, r.socialInstagram, r.socialFacebook, r.socialTiktok
    );

    console.log(`[db] Seeded ${seed.categories.length} categories and ${seed.menuItems.length} menu items.`);
  }
}

// Fixed, documented test defaults — NOT randomly generated. On Vercel the
// database resets on every cold start (see IS_VERCEL note above), so a
// random password would be unrecoverable except through function logs.
// Set OWNER_PASSWORD / RECEPTIONIST_PASSWORD as real environment variables
// for anything beyond casual testing — those always take priority over
// these defaults. These defaults are public (they're in source control);
// treat them as a known test-only door, not a secret.
const DEFAULT_OWNER_PASSWORD = "EmberOwner#2026Secure";
const DEFAULT_RECEPTIONIST_PASSWORD = "EmberFrontDesk#2026";

function seedUsersIfEmpty() {
  const userCount = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
  if (userCount === 0) {
    const ownerPassword = process.env.OWNER_PASSWORD || DEFAULT_OWNER_PASSWORD;
    const receptionistPassword = process.env.RECEPTIONIST_PASSWORD || DEFAULT_RECEPTIONIST_PASSWORD;
    const usingDefaults = !process.env.OWNER_PASSWORD || !process.env.RECEPTIONIST_PASSWORD;

    const insertUser = db.prepare(
      "INSERT INTO users (username, password_hash, role, must_change_password) VALUES (?, ?, ?, 1)"
    );
    insertUser.run("owner", bcrypt.hashSync(ownerPassword, 10), "owner");
    insertUser.run("receptionist", bcrypt.hashSync(receptionistPassword, 10), "receptionist");

    console.log("\n================  CMS LOGIN CREDENTIALS (seeded)  ================");
    console.log("  Owner login:      username: owner         password: (see OWNER_PASSWORD env var, or the documented default)");
    console.log("  Receptionist login: username: receptionist password: (see RECEPTIONIST_PASSWORD env var, or the documented default)");
    if (usingDefaults) {
      console.log("  NOTE: one or both env vars aren't set — using the fixed, public, documented test");
      console.log("  defaults from DEPLOYMENT.md instead of a random password. Fine for testing;");
      console.log("  set OWNER_PASSWORD/RECEPTIONIST_PASSWORD for anything beyond that.");
    }
    console.log("  Both accounts are asked to set a new password on first login (won't survive");
    console.log("  the next cold start on Vercel without persistent storage — expected for now).");
    console.log("=======================================================================\n");
  }
}

seedIfEmpty();
seedUsersIfEmpty();

module.exports = db;
