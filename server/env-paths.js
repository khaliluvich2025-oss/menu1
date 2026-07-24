const path = require("node:path");

// Vercel sets VERCEL=1 automatically at build and runtime. Its functions have
// a read-only filesystem except for /tmp (ephemeral — wiped on cold start).
// App data now lives in MongoDB (see server/mongo.js), not on disk, but
// uploaded dish photos still go through local/temp disk storage via multer —
// that migration (e.g. to Vercel Blob) is a separate, still-deferred piece.
const IS_VERCEL = !!process.env.VERCEL;
const PROJECT_ROOT = path.join(__dirname, "..");

function uploadsDir() {
  return IS_VERCEL ? path.join("/tmp", "uploads", "dishes") : path.join(PROJECT_ROOT, "uploads", "dishes");
}

module.exports = { IS_VERCEL, PROJECT_ROOT, uploadsDir };
