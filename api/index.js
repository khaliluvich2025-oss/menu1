// Vercel treats /api/** as a reserved, platform-routed namespace: any request
// under /api/ is matched against actual files in this directory BEFORE it
// ever reaches a "detected server" function like the root server.js. Since
// this app's API routes are mounted inside the Express app itself
// (app.use("/api", ...)) rather than as separate /api/*.js files, every
// /api/* request was 404-ing at the platform level.
//
// A [...path].js catch-all filename here was NOT enough on its own — Vercel's
// plain (non-Next.js) /api file convention only reliably matched single-segment
// paths (/api/menu worked, /api/auth/me and /api/admin/orders did not, both
// confirmed live). The vercel.json rewrite (source: "/api/:path*") is what
// actually routes every nested /api/* path to this one function; this file is
// just the destination it points to, exporting the same Express app used for
// local dev and everything else so its internal /api routing takes over.
module.exports = require("../server.js");
