const path = require("node:path");

// Vercel sets VERCEL=1 automatically at build and runtime. Its functions have
// a read-only filesystem except for /tmp (ephemeral — wiped on cold start).
// These helpers keep the app bootable there without changing the underlying
// SQLite/local-disk-upload approach (that migration is intentionally deferred).
const IS_VERCEL = !!process.env.VERCEL;
const PROJECT_ROOT = path.join(__dirname, "..");

function dataDir() {
  return IS_VERCEL ? path.join("/tmp", "data") : path.join(PROJECT_ROOT, "data");
}

function uploadsDir() {
  return IS_VERCEL ? path.join("/tmp", "uploads", "dishes") : path.join(PROJECT_ROOT, "uploads", "dishes");
}

module.exports = { IS_VERCEL, PROJECT_ROOT, dataDir, uploadsDir };
