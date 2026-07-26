const express = require("express");
const { ObjectId } = require("mongodb");
const { ensureReady } = require("../db");
const { requireAuth } = require("../middleware");

const router = express.Router();

// Same in-memory-guard shape as auth.js's login attempt limiter, keyed by
// table number instead of username: stops a single table from spamming calls.
const CALL_COOLDOWN_MS = 60 * 1000;
const lastCallByTable = new Map();

// Public: customer taps "Call a waiter" in the Preferences panel.
router.post("/assistance-calls", async (req, res) => {
  const tableNumber = String((req.body || {}).table || "").trim();
  if (!tableNumber) {
    return res.status(400).json({ error: "invalid_input", message: "Table number is required." });
  }

  const lastCall = lastCallByTable.get(tableNumber) || 0;
  const elapsed = Date.now() - lastCall;
  if (elapsed < CALL_COOLDOWN_MS) {
    return res.status(429).json({ error: "too_soon", waitSeconds: Math.ceil((CALL_COOLDOWN_MS - elapsed) / 1000) });
  }
  lastCallByTable.set(tableNumber, Date.now());

  const db = await ensureReady();
  const now = new Date();
  const result = await db.collection("assistance_calls").insertOne({ tableNumber, status: "pending", createdAt: now });
  res.status(201).json({ id: result.insertedId.toString(), table: tableNumber, createdAt: now.toISOString() });
});

// Owner + receptionist — not role-gated, matches how both already act on orders identically.
router.get("/admin/assistance-calls", requireAuth, async (req, res) => {
  const db = await ensureReady();
  const docs = await db.collection("assistance_calls").find({ status: "pending" }).sort({ createdAt: 1 }).toArray();
  res.json(docs.map((d) => ({ id: d._id.toString(), table: d.tableNumber, createdAt: d.createdAt.toISOString() })));
});

router.patch("/admin/assistance-calls/:id/acknowledge", requireAuth, async (req, res) => {
  let _id;
  try { _id = new ObjectId(req.params.id); } catch { return res.status(404).json({ error: "not_found" }); }

  const db = await ensureReady();
  const user = req.session.user;
  const result = await db.collection("assistance_calls").updateOne(
    { _id, status: "pending" },
    { $set: { status: "acknowledged", acknowledgedBy: user ? user.username : null, acknowledgedAt: new Date() } }
  );
  if (result.matchedCount === 0) return res.status(404).json({ error: "not_found" });
  res.json({ ok: true });
});

module.exports = router;
