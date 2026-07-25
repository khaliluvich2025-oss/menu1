const express = require("express");
const crypto = require("node:crypto");
const { ObjectId } = require("mongodb");
const { ensureReady } = require("../db");
const { requireAuth } = require("../middleware");

const router = express.Router();

const ALL_STATUSES = ["received", "confirmed", "preparing", "ready", "completed", "cancelled", "rejected"];
const NON_REVENUE_STATUSES = new Set(["cancelled", "rejected"]);

function generateOrderRef() {
  const now = new Date();
  const stamp = String(now.getFullYear()).slice(2) + String(now.getMonth() + 1).padStart(2, "0") + String(now.getDate()).padStart(2, "0");
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `ET-${stamp}-${rand}`;
}

// 256 bits, URL-safe — used as the sole customer-facing lookup key for order
// tracking (see GET /orders/by-token/:token below), unlike `ref` which is
// only a few random digits + the date and stays purely a cosmetic label.
// No DB-uniqueness retry loop needed at this size (collision probability is
// negligible), unlike generateOrderRef().
function generateTrackingToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function mapOrder(doc) {
  return {
    id: doc._id.toString(),
    ref: doc.ref,
    table: doc.tableNumber,
    items: doc.items,
    total: doc.total,
    status: doc.status,
    lang: doc.lang,
    createdAt: doc.createdAt.toISOString()
  };
}

// Public-safe history: timestamps and stage only — never the staff member's
// name or their internal note, which are staff-only details.
function publicHistory(doc) {
  return (doc.statusHistory || []).map((h) => ({ status: h.status, at: h.at.toISOString() }));
}

// Full history for the admin/staff side, including who made the change and why.
function staffHistory(doc) {
  return (doc.statusHistory || []).map((h) => ({
    status: h.status,
    by: h.changedBy ? h.changedBy.username : null,
    role: h.changedBy ? h.changedBy.role : null,
    note: h.note || null,
    at: h.at.toISOString()
  }));
}

function parseObjectId(id) {
  try { return new ObjectId(id); } catch { return null; }
}

// Public: the customer's cart is submitted here instead of opening WhatsApp.
// Prices/names are re-resolved server-side from the current menu so a client
// can't tamper with what it's charged.
router.post("/orders", async (req, res) => {
  const { table, items, lang } = req.body || {};
  const tableNumber = String(table || "").trim();
  if (!tableNumber) {
    return res.status(400).json({ error: "invalid_input", message: "Table number is required." });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "invalid_input", message: "Cart is empty." });
  }

  const resolvedLang = ["fr", "en", "ar"].includes(lang) ? lang : "fr";
  const db = await ensureReady();

  const orderItems = [];
  for (const line of items) {
    const qty = Math.max(1, parseInt(line.qty, 10) || 0);
    const dbItem = await db.collection("menu_items").findOne({ _id: line.id });
    if (!dbItem || !dbItem.available) continue; // skip items that vanished/sold out since being added to cart
    const unitPrice = dbItem.discountPrice != null ? dbItem.discountPrice : dbItem.price;
    orderItems.push({
      id: dbItem._id,
      name: dbItem.name[resolvedLang],
      qty,
      unitPrice,
      lineTotal: Math.round(unitPrice * qty * 100) / 100
    });
  }

  if (orderItems.length === 0) {
    return res.status(409).json({ error: "empty_after_validation", message: "None of the items in this order are currently available." });
  }

  const total = Math.round(orderItems.reduce((sum, i) => sum + i.lineTotal, 0) * 100) / 100;

  let ref;
  do { ref = generateOrderRef(); } while (await db.collection("orders").findOne({ ref }));
  const trackingToken = generateTrackingToken();

  const now = new Date();
  const doc = {
    ref,
    trackingToken,
    tableNumber,
    items: orderItems,
    total,
    status: "received",
    lang: resolvedLang,
    createdAt: now,
    statusHistory: [{ status: "received", changedBy: null, note: null, at: now }]
  };
  const result = await db.collection("orders").insertOne(doc);
  doc._id = result.insertedId;

  res.status(201).json({ ...mapOrder(doc), history: publicHistory(doc), trackingToken });
});

// Public: live tracker polling target. Looked up by a random 256-bit
// tracking token generated once at checkout — never the human-readable
// ref (guessable: date + 4 random digits, no rate limiting), which stays
// purely a cosmetic display label from here on.
router.get("/orders/by-token/:token", async (req, res) => {
  const db = await ensureReady();
  const doc = await db.collection("orders").findOne({ trackingToken: req.params.token });
  if (!doc) return res.status(404).json({ error: "not_found" });
  res.json({ ...mapOrder(doc), history: publicHistory(doc) });
});

// Owner + receptionist: the order queue.
router.get("/admin/orders", requireAuth, async (req, res) => {
  const db = await ensureReady();
  const docs = await db.collection("orders").find().sort({ _id: -1 }).limit(200).toArray();
  res.json(docs.map(mapOrder));
});

router.get("/admin/orders/:id/history", requireAuth, async (req, res) => {
  const _id = parseObjectId(req.params.id);
  if (!_id) return res.status(404).json({ error: "not_found" });
  const db = await ensureReady();
  const doc = await db.collection("orders").findOne({ _id });
  if (!doc) return res.status(404).json({ error: "not_found" });
  res.json(staffHistory(doc));
});

router.patch("/admin/orders/:id/status", requireAuth, async (req, res) => {
  const { status, note } = req.body || {};
  if (!ALL_STATUSES.includes(status)) {
    return res.status(400).json({ error: "invalid_status" });
  }
  const _id = parseObjectId(req.params.id);
  if (!_id) return res.status(404).json({ error: "not_found" });

  const db = await ensureReady();
  const existing = await db.collection("orders").findOne({ _id });
  if (!existing) return res.status(404).json({ error: "not_found" });

  const user = req.session.user;
  const historyEntry = {
    status,
    changedBy: user ? { username: user.username, role: user.role } : null,
    note: note ? String(note).slice(0, 500) : null,
    at: new Date()
  };
  await db.collection("orders").updateOne({ _id }, { $set: { status }, $push: { statusHistory: historyEntry } });
  const updated = await db.collection("orders").findOne({ _id });

  res.json({ ...mapOrder(updated), history: staffHistory(updated) });
});

module.exports = router;
module.exports.ALL_STATUSES = ALL_STATUSES;
module.exports.NON_REVENUE_STATUSES = NON_REVENUE_STATUSES;
