const express = require("express");
const multer = require("multer");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { requireOwner } = require("../middleware");
const { uploadsDir } = require("../env-paths");

const router = express.Router();

const UPLOAD_DIR = uploadsDir();
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomUUID()}${ext}`);
  }
});

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
  upload.single("image")(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: "upload_failed", message: err.message === "unsupported_file_type" ? "Only JPG, PNG, WEBP or GIF images are allowed." : "Upload failed." });
    }
    if (!req.file) return res.status(400).json({ error: "no_file" });
    res.status(201).json({ path: `/uploads/dishes/${req.file.filename}` });
  });
});

module.exports = router;
