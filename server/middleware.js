function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: "not_authenticated" });
  }
  next();
}

function requireOwner(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: "not_authenticated" });
  }
  if (req.session.user.role !== "owner") {
    return res.status(403).json({ error: "owner_only" });
  }
  next();
}

module.exports = { requireAuth, requireOwner };
