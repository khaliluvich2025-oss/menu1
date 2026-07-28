const bcrypt = require("bcryptjs");
const seed = require("./seed-data");
const { getDb } = require("./mongo");

// Fixed, documented test defaults — NOT randomly generated. Kept identical
// to the values already shared/documented for the SQLite-era deployment so
// existing test credentials keep working. Set OWNER_PASSWORD /
// RECEPTIONIST_PASSWORD as real environment variables for anything beyond
// casual testing — those always take priority over these defaults.
const DEFAULT_OWNER_PASSWORD = "EmberOwner#2026Secure";
const DEFAULT_RECEPTIONIST_PASSWORD = "EmberFrontDesk#2026";

let readyPromise = null;

// Lazily connects, creates indexes, and seeds on first use, then caches the
// same promise for every subsequent call on this instance — route handlers
// call `await ensureReady()` at the top and get the ready `db` handle back.
//
// Same failure-caching bug as server/mongo.js's getClientPromise(), just one
// layer up: without the .catch() below, a single failed initialize() (e.g.
// getDb() hiccups, or an index/seed call throws) would permanently wedge
// readyPromise as a rejected promise for this instance's whole lifetime —
// every route handler that calls ensureReady() would replay the same dead
// rejection forever instead of getting a chance to reconnect. Confirmed
// live: mongo.js's own connection retried fine (a direct getDb()+ping
// succeeded reliably) while every real route — which all go through THIS
// function — kept 500ing, because this cache, not the connection, was the
// one stuck.
function ensureReady() {
  if (!readyPromise) {
    readyPromise = initialize().catch((err) => {
      readyPromise = null;
      throw err;
    });
  }
  return readyPromise;
}

async function initialize() {
  const db = await getDb();

  await db.collection("orders").createIndex({ ref: 1 }, { unique: true });
  await db.collection("orders").createIndex({ createdAt: 1 });
  // sparse: orders created before this field existed have no trackingToken
  // at all, and a plain unique index would collide on the shared implicit
  // null the moment a second such document exists — sparse simply excludes
  // them (they were never reachable via a saved token anyway).
  await db.collection("orders").createIndex({ trackingToken: 1 }, { unique: true, sparse: true });
  await db.collection("users").createIndex({ username: 1 }, { unique: true });
  await db.collection("assistance_calls").createIndex({ status: 1, createdAt: 1 });
  // Low-volume, ephemeral collection — auto-clean 24h after creation regardless
  // of whether a call was ever acknowledged, so it never needs manual pruning.
  await db.collection("assistance_calls").createIndex({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 });

  await seedMenuIfEmpty(db);
  await seedUsersIfEmpty(db);

  return db;
}

async function seedMenuIfEmpty(db) {
  const categoryCount = await db.collection("categories").countDocuments();
  if (categoryCount > 0) return;

  const categories = seed.categories.map((c) => ({
    _id: c.id,
    sortOrder: c.sortOrder,
    label: { fr: c.labelFr, en: c.labelEn, ar: c.labelAr }
  }));
  await db.collection("categories").insertMany(categories);

  const items = seed.menuItems.map((i) => ({
    _id: i.id,
    categoryId: i.categoryId,
    sortOrder: i.sortOrder,
    price: i.price,
    discountPrice: i.discountPrice,
    image: i.image,
    featured: !!i.featured,
    recommended: !!i.recommended,
    available: !!i.available,
    name: { fr: i.nameFr, en: i.nameEn, ar: i.nameAr },
    description: { fr: i.descFr, en: i.descEn, ar: i.descAr },
    optionGroups: i.optionGroups || []
  }));
  await db.collection("menu_items").insertMany(items);

  const r = seed.restaurantInfo;
  await db.collection("restaurant_info").insertOne({
    _id: "main",
    name: r.name,
    logoInitials: r.logoInitials,
    currency: r.currency,
    whatsappNumber: r.whatsappNumber,
    defaultLanguage: r.defaultLanguage,
    defaultTheme: r.defaultTheme,
    animationIntensity: r.animationIntensity,
    heroImage: r.heroImage,
    logoImage: r.logoImage,
    openingHours: { fr: r.openingHoursFr, en: r.openingHoursEn, ar: r.openingHoursAr },
    address: { fr: r.addressFr, en: r.addressEn, ar: r.addressAr },
    phone: r.phone,
    phoneHref: r.phoneHref,
    social: { instagram: r.socialInstagram, facebook: r.socialFacebook, tiktok: r.socialTiktok },
    googleMapsUrl: r.googleMapsUrl,
    googleReviewUrl: r.googleReviewUrl
  });

  console.log(`[db] Seeded ${seed.categories.length} categories and ${seed.menuItems.length} menu items.`);
}

async function seedUsersIfEmpty(db) {
  const userCount = await db.collection("users").countDocuments();
  if (userCount > 0) return;

  const ownerPassword = process.env.OWNER_PASSWORD || DEFAULT_OWNER_PASSWORD;
  const receptionistPassword = process.env.RECEPTIONIST_PASSWORD || DEFAULT_RECEPTIONIST_PASSWORD;
  const usingDefaults = !process.env.OWNER_PASSWORD || !process.env.RECEPTIONIST_PASSWORD;

  await db.collection("users").insertMany([
    { username: "owner", passwordHash: bcrypt.hashSync(ownerPassword, 10), role: "owner", mustChangePassword: true },
    { username: "receptionist", passwordHash: bcrypt.hashSync(receptionistPassword, 10), role: "receptionist", mustChangePassword: true }
  ]);

  console.log("\n================  CMS LOGIN CREDENTIALS (seeded)  ================");
  console.log("  Owner login:         username: owner         password: (see OWNER_PASSWORD env var, or the documented default)");
  console.log("  Receptionist login:  username: receptionist  password: (see RECEPTIONIST_PASSWORD env var, or the documented default)");
  if (usingDefaults) {
    console.log("  NOTE: one or both env vars aren't set — using the fixed, public, documented test");
    console.log("  defaults from DEPLOYMENT.md instead of a random password.");
  }
  console.log("  Both accounts are asked to set a new password on first login. This now lives in");
  console.log("  MongoDB, so it persists across cold starts and across every server instance.");
  console.log("=======================================================================\n");
}

module.exports = { ensureReady };
