const express = require("express");
const bcrypt = require("bcryptjs");
const { ObjectId } = require("mongodb");
const { ensureReady } = require("../db");
const { requireAuth } = require("../middleware");

const router = express.Router();

// Very small in-memory brute-force guard: 5 failed attempts per username
// locks that username out for 5 minutes. Resets on success.
const MAX_ATTEMPTS = 5;
const LOCK_MS = 5 * 60 * 1000;
const attempts = new Map();

function getAttemptState(username) {
  return attempts.get(username) || { count: 0, lockUntil: 0 };
}

router.post("/login", async (req, res) => {
  const { username, password } = req.body || {};
  // Must be strings, not just truthy — an object like {"$ne": null} passed
  // as username would otherwise reach findOne() below as a raw MongoDB query
  // operator instead of a value, matching any/every user and bypassing the
  // credential check entirely (classic NoSQL injection).
  if (typeof username !== "string" || typeof password !== "string" || !username || !password) {
    return res.status(400).json({ error: "missing_credentials" });
  }

  const state = getAttemptState(username);
  if (state.lockUntil > Date.now()) {
    const waitSeconds = Math.ceil((state.lockUntil - Date.now()) / 1000);
    return res.status(429).json({ error: "locked", waitSeconds });
  }

  const db = await ensureReady();
  const user = await db.collection("users").findOne({ username });
  const ok = user && bcrypt.compareSync(password, user.passwordHash);

  if (!ok) {
    state.count += 1;
    if (state.count >= MAX_ATTEMPTS) {
      state.lockUntil = Date.now() + LOCK_MS;
      state.count = 0;
    }
    attempts.set(username, state);
    return res.status(401).json({ error: "invalid_credentials" });
  }

  attempts.delete(username);
  req.session.user = { id: user._id.toString(), username: user.username, role: user.role };
  res.json({
    username: user.username,
    role: user.role,
    mustChangePassword: !!user.mustChangePassword
  });
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("emberTable.sid");
    res.json({ ok: true });
  });
});

router.get("/me", requireAuth, async (req, res) => {
  const db = await ensureReady();
  const user = await db.collection("users").findOne({ _id: new ObjectId(req.session.user.id) });
  if (!user) return res.status(401).json({ error: "not_authenticated" });
  res.json({ username: user.username, role: user.role, mustChangePassword: !!user.mustChangePassword });
});

router.post("/change-password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: "invalid_input", message: "New password must be at least 8 characters." });
  }
  const db = await ensureReady();
  const _id = new ObjectId(req.session.user.id);
  const user = await db.collection("users").findOne({ _id });
  if (!user || !bcrypt.compareSync(currentPassword, user.passwordHash)) {
    return res.status(401).json({ error: "wrong_current_password" });
  }
  const newHash = bcrypt.hashSync(newPassword, 10);
  await db.collection("users").updateOne({ _id }, { $set: { passwordHash: newHash, mustChangePassword: false } });
  res.json({ ok: true });
});

module.exports = router;
