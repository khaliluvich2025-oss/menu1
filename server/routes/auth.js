const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db");
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

router.post("/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "missing_credentials" });
  }

  const state = getAttemptState(username);
  if (state.lockUntil > Date.now()) {
    const waitSeconds = Math.ceil((state.lockUntil - Date.now()) / 1000);
    return res.status(429).json({ error: "locked", waitSeconds });
  }

  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  const ok = user && bcrypt.compareSync(password, user.password_hash);

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
  req.session.user = { id: user.id, username: user.username, role: user.role };
  res.json({
    username: user.username,
    role: user.role,
    mustChangePassword: !!user.must_change_password
  });
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
});

router.get("/me", requireAuth, (req, res) => {
  const user = db.prepare("SELECT username, role, must_change_password FROM users WHERE id = ?").get(req.session.user.id);
  if (!user) return res.status(401).json({ error: "not_authenticated" });
  res.json({ username: user.username, role: user.role, mustChangePassword: !!user.must_change_password });
});

router.post("/change-password", requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: "invalid_input", message: "New password must be at least 8 characters." });
  }
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.session.user.id);
  if (!user || !bcrypt.compareSync(currentPassword, user.password_hash)) {
    return res.status(401).json({ error: "wrong_current_password" });
  }
  const newHash = bcrypt.hashSync(newPassword, 10);
  db.prepare("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?").run(newHash, user.id);
  res.json({ ok: true });
});

module.exports = router;
