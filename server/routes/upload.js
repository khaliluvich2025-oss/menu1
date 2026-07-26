const express = require("express");
const multer = require("multer");
const { ObjectId } = require("mongodb");
const { ensureReady } = require("../db");
const { requireOwner } = require("../middleware");

const router = express.Router();

// Images are stored in MongoDB, not on local disk. Vercel serverless functions
// only have a writable /tmp, which is wiped on cold start and NOT shared
// across concurrent instances — a photo written by the instance that handled
// the upload was invisible to (and often gone before) the instance that later
// served it back, so uploaded dish photos, the cover image, and the logo
// never reliably displayed once deployed. Storing the bytes in Mongo (already
// the app's one shared, persistent store) fixes this on every platform,
// local dev included, with no new service/credentials to set up.
const storage = multer.memoryStorage();

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED.has(file.mimetype)) {
      return cb(new Error("unsupported_file_type"));
    }
    cb(null, true);
  }
});

router.post("/admin/upload", requireOwner, (req, res) => {
  upload.single("image")(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: "upload_failed", message: err.message === "unsupported_file_type" ? "Only JPG, PNG, WEBP or GIF images are allowed." : "Upload failed." });
    }
    if (!req.file) return res.status(400).json({ error: "no_file" });
    try {
      const db = await ensureReady();
      const result = await db.collection("uploaded_images").insertOne({
        contentType: req.file.mimetype,
        data: req.file.buffer,
        createdAt: new Date()
      });
      res.status(201).json({ path: `/api/uploads/${result.insertedId.toString()}` });
    } catch (dbErr) {
      res.status(500).json({ error: "upload_failed", message: "Could not save the image. Please try again." });
    }
  });
});

// Public: dish photos / cover image / logo all need to load for anyone
// viewing the site, not just logged-in staff. Long-cached and immutable —
// a given id's bytes never change; replacing a photo always creates a new id.
router.get("/uploads/:id", async (req, res) => {
  let _id;
  try { _id = new ObjectId(req.params.id); } catch { return res.status(404).end(); }

  const db = await ensureReady();
  const doc = await db.collection("uploaded_images").findOne({ _id });
  if (!doc) return res.status(404).end();

  res.set("Content-Type", doc.contentType);
  res.set("Cache-Control", "public, max-age=31536000, immutable");
  res.send(doc.data.buffer);
});

module.exports = router;
