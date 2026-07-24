// Vercel treats /api/** as a reserved, platform-routed namespace: any request
// under /api/ is matched against actual files in this directory BEFORE it
// ever reaches a "detected server" function like the root server.js. Since
// this app's API routes are mounted inside the Express app itself
// (app.use("/api", ...)) rather than as separate /api/*.js files, Vercel was
// 404-ing every /api/* request at the platform level — the Express app never
// saw them. This catch-all ([...path] matches any sub-path) hands every
// /api/* request to the same Express app used for local dev and everything
// else, so its internal /api routing takes over from here.
module.exports = require("../server.js");
