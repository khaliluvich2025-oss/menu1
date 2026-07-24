const express = require("express");
const db = require("../db");
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

function insertHistory(orderId, status, user, note) {
  db.prepare(`
    INSERT INTO order_status_history (order_id, status, changed_by_username, changed_by_role, note)
    VALUES (?, ?, ?, ?, ?)
  `).run(orderId, status, user ? user.username : null, user ? user.role : null, note || null);
}

function mapOrder(row) {
  return {
    id: row.id,
    ref: row.ref,
    table: row.table_number,
    items: JSON.parse(row.items_json),
    total: row.total,
    status: row.status,
    lang: row.lang,
    createdAt: row.created_at
  };
}

// Public-safe history: timestamps and stage only — never the staff member's
// name or their internal note, which are staff-only details.
function publicHistory(orderId) {
  return db.prepare("SELECT status, created_at AS at FROM order_status_history WHERE order_id = ? ORDER BY id ASC").all(orderId);
}

// Full history for the admin/staff side, including who made the change and why.
function staffHistory(orderId) {
  return db.prepare(`
    SELECT status, changed_by_username AS "by", changed_by_role AS role, note, created_at AS at
    FROM order_status_history WHERE order_id = ? ORDER BY id ASC
  `).all(orderId);
}

// Public: the customer's cart is submitted here instead of opening WhatsApp.
// Prices/names are re-resolved server-side from the current menu so a client
// can't tamper with what it's charged.
router.post("/orders", (req, res) => {
  const { table, items, lang } = req.body || {};
  const tableNumber = String(table || "").trim();
  if (!tableNumber) {
    return res.status(400).json({ error: "invalid_input", message: "Table number is required." });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "invalid_input", message: "Cart is empty." });
  }

  const resolvedLang = ["fr", "en", "ar"].includes(lang) ? lang : "fr";
  const nameCol = { fr: "name_fr", en: "name_en", ar: "name_ar" }[resolvedLang];

  const orderItems = [];
  for (const line of items) {
    const qty = Math.max(1, parseInt(line.qty, 10) || 0);
    const dbItem = db.prepare("SELECT * FROM menu_items WHERE id = ?").get(line.id);
    if (!dbItem || !dbItem.available) continue; // skip items that vanished/sold out since being added to cart
    const unitPrice = dbItem.discount_price != null ? dbItem.discount_price : dbItem.price;
    orderItems.push({
      id: dbItem.id,
      name: dbItem[nameCol],
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
  do { ref = generateOrderRef(); } while (db.prepare("SELECT 1 FROM orders WHERE ref = ?").get(ref));

  const result = db.prepare(`
    INSERT INTO orders (ref, table_number, items_json, total, status, lang)
    VALUES (?, ?, ?, ?, 'received', ?)
  `).run(ref, tableNumber, JSON.stringify(orderItems), total, resolvedLang);

  insertHistory(result.lastInsertRowid, "received", null, null);

  const row = db.prepare("SELECT * FROM orders WHERE ref = ?").get(ref);
  res.status(201).json({ ...mapOrder(row), history: publicHistory(row.id) });
});

// Public: live tracker polling target. Looked up by ref (an unguessable
// ET-YYMMDD-#### token), not by numeric id — no auth, this is the same
// information the customer already has from their own confirmation screen.
router.get("/orders/:ref", (req, res) => {
  const row = db.prepare("SELECT * FROM orders WHERE ref = ?").get(req.params.ref);
  if (!row) return res.status(404).json({ error: "not_found" });
  res.json({ ...mapOrder(row), history: publicHistory(row.id) });
});

// Owner + receptionist: the order queue.
router.get("/admin/orders", requireAuth, (req, res) => {
  const rows = db.prepare("SELECT * FROM orders ORDER BY id DESC LIMIT 200").all();
  res.json(rows.map(mapOrder));
});

router.get("/admin/orders/:id/history", requireAuth, (req, res) => {
  const row = db.prepare("SELECT id FROM orders WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "not_found" });
  res.json(staffHistory(row.id));
});

router.patch("/admin/orders/:id/status", requireAuth, (req, res) => {
  const { status, note } = req.body || {};
  if (!ALL_STATUSES.includes(status)) {
    return res.status(400).json({ error: "invalid_status" });
  }
  const existing = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "not_found" });

  db.prepare("UPDATE orders SET status = ? WHERE id = ?").run(status, req.params.id);
  insertHistory(existing.id, status, req.session.user, note ? String(note).slice(0, 500) : null);

  const updated = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
  res.json({ ...mapOrder(updated), history: staffHistory(updated.id) });
});

module.exports = router;
module.exports.ALL_STATUSES = ALL_STATUSES;
module.exports.NON_REVENUE_STATUSES = NON_REVENUE_STATUSES;
