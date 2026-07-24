const express = require("express");
const db = require("../db");
const { requireAuth, requireOwner } = require("../middleware");

const router = express.Router();

function mapCategory(row) {
  return {
    id: row.id,
    sortOrder: row.sort_order,
    label: { fr: row.label_fr, en: row.label_en, ar: row.label_ar }
  };
}
function mapItem(row) {
  return {
    id: row.id,
    categoryId: row.category_id,
    sortOrder: row.sort_order,
    price: row.price,
    discountPrice: row.discount_price,
    image: row.image,
    featured: !!row.featured,
    recommended: !!row.recommended,
    available: !!row.available,
    name: { fr: row.name_fr, en: row.name_en, ar: row.name_ar },
    description: { fr: row.desc_fr, en: row.desc_en, ar: row.desc_ar }
  };
}

function slugify(text) {
  return String(text)
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

function uniqueId(base, exists) {
  let id = base || "item";
  let n = 2;
  while (exists(id)) { id = `${base}-${n}`; n += 1; }
  return id;
}

// ---------- PUBLIC ----------
router.get("/menu", (req, res) => {
  const categories = db.prepare("SELECT * FROM categories ORDER BY sort_order ASC").all().map(mapCategory);
  const items = db.prepare("SELECT * FROM menu_items ORDER BY category_id ASC, sort_order ASC").all().map(mapItem);
  res.json({ categories, items });
});

// ---------- ADMIN: CATEGORIES ----------
router.get("/admin/categories", requireAuth, (req, res) => {
  res.json(db.prepare("SELECT * FROM categories ORDER BY sort_order ASC").all().map(mapCategory));
});

router.post("/admin/categories", requireOwner, (req, res) => {
  const { labelFr, labelEn, labelAr } = req.body || {};
  if (!labelFr || !labelEn || !labelAr) {
    return res.status(400).json({ error: "invalid_input", message: "All three language labels are required." });
  }
  const base = slugify(labelEn) || "category";
  const id = uniqueId(base, (candidate) => !!db.prepare("SELECT 1 FROM categories WHERE id = ?").get(candidate));
  const maxOrder = db.prepare("SELECT COALESCE(MAX(sort_order), 0) AS m FROM categories").get().m;
  db.prepare("INSERT INTO categories (id, sort_order, label_fr, label_en, label_ar) VALUES (?, ?, ?, ?, ?)")
    .run(id, maxOrder + 1, labelFr, labelEn, labelAr);
  res.status(201).json(mapCategory(db.prepare("SELECT * FROM categories WHERE id = ?").get(id)));
});

router.put("/admin/categories/:id", requireOwner, (req, res) => {
  const existing = db.prepare("SELECT * FROM categories WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "not_found" });
  const { labelFr, labelEn, labelAr } = req.body || {};
  if (!labelFr || !labelEn || !labelAr) {
    return res.status(400).json({ error: "invalid_input", message: "All three language labels are required." });
  }
  db.prepare("UPDATE categories SET label_fr = ?, label_en = ?, label_ar = ? WHERE id = ?")
    .run(labelFr, labelEn, labelAr, req.params.id);
  res.json(mapCategory(db.prepare("SELECT * FROM categories WHERE id = ?").get(req.params.id)));
});

router.put("/admin/categories/:id/move", requireOwner, (req, res) => {
  const { direction } = req.body || {};
  const all = db.prepare("SELECT * FROM categories ORDER BY sort_order ASC").all();
  const idx = all.findIndex((c) => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "not_found" });
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= all.length) return res.json(all.map(mapCategory));
  const a = all[idx], b = all[swapIdx];
  db.prepare("UPDATE categories SET sort_order = ? WHERE id = ?").run(b.sort_order, a.id);
  db.prepare("UPDATE categories SET sort_order = ? WHERE id = ?").run(a.sort_order, b.id);
  res.json(db.prepare("SELECT * FROM categories ORDER BY sort_order ASC").all().map(mapCategory));
});

router.delete("/admin/categories/:id", requireOwner, (req, res) => {
  const count = db.prepare("SELECT COUNT(*) AS n FROM menu_items WHERE category_id = ?").get(req.params.id).n;
  if (count > 0) {
    return res.status(409).json({ error: "category_not_empty", message: "Remove or move all dishes out of this category first." });
  }
  const result = db.prepare("DELETE FROM categories WHERE id = ?").run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "not_found" });
  res.json({ ok: true });
});

// ---------- ADMIN: MENU ITEMS ----------
router.get("/admin/menu-items", requireAuth, (req, res) => {
  res.json(db.prepare("SELECT * FROM menu_items ORDER BY category_id ASC, sort_order ASC").all().map(mapItem));
});

router.post("/admin/menu-items", requireOwner, (req, res) => {
  const b = req.body || {};
  if (!b.categoryId || !b.nameFr || !b.nameEn || !b.nameAr || b.price == null) {
    return res.status(400).json({ error: "invalid_input", message: "Category, name (3 languages) and price are required." });
  }
  const category = db.prepare("SELECT 1 FROM categories WHERE id = ?").get(b.categoryId);
  if (!category) return res.status(400).json({ error: "invalid_category" });

  const base = slugify(b.nameEn) || "dish";
  const id = uniqueId(base, (candidate) => !!db.prepare("SELECT 1 FROM menu_items WHERE id = ?").get(candidate));
  const maxOrder = db.prepare("SELECT COALESCE(MAX(sort_order), 0) AS m FROM menu_items WHERE category_id = ?").get(b.categoryId).m;

  db.prepare(`
    INSERT INTO menu_items
      (id, category_id, sort_order, price, discount_price, image, featured, recommended, available,
       name_fr, name_en, name_ar, desc_fr, desc_en, desc_ar)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, b.categoryId, maxOrder + 1, Number(b.price), b.discountPrice != null ? Number(b.discountPrice) : null,
    b.image || null, b.featured ? 1 : 0, b.recommended ? 1 : 0, b.available === false ? 0 : 1,
    b.nameFr, b.nameEn, b.nameAr, b.descFr || "", b.descEn || "", b.descAr || ""
  );
  res.status(201).json(mapItem(db.prepare("SELECT * FROM menu_items WHERE id = ?").get(id)));
});

router.put("/admin/menu-items/:id", requireOwner, (req, res) => {
  const existing = db.prepare("SELECT * FROM menu_items WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "not_found" });
  const b = req.body || {};
  if (!b.categoryId || !b.nameFr || !b.nameEn || !b.nameAr || b.price == null) {
    return res.status(400).json({ error: "invalid_input", message: "Category, name (3 languages) and price are required." });
  }
  const category = db.prepare("SELECT 1 FROM categories WHERE id = ?").get(b.categoryId);
  if (!category) return res.status(400).json({ error: "invalid_category" });

  db.prepare(`
    UPDATE menu_items SET
      category_id = ?, price = ?, discount_price = ?, image = ?, featured = ?, recommended = ?, available = ?,
      name_fr = ?, name_en = ?, name_ar = ?, desc_fr = ?, desc_en = ?, desc_ar = ?
    WHERE id = ?
  `).run(
    b.categoryId, Number(b.price), b.discountPrice != null ? Number(b.discountPrice) : null,
    b.image || null, b.featured ? 1 : 0, b.recommended ? 1 : 0, b.available === false ? 0 : 1,
    b.nameFr, b.nameEn, b.nameAr, b.descFr || "", b.descEn || "", b.descAr || "",
    req.params.id
  );
  res.json(mapItem(db.prepare("SELECT * FROM menu_items WHERE id = ?").get(req.params.id)));
});

router.put("/admin/menu-items/:id/move", requireOwner, (req, res) => {
  const { direction } = req.body || {};
  const existing = db.prepare("SELECT * FROM menu_items WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "not_found" });
  const siblings = db.prepare("SELECT * FROM menu_items WHERE category_id = ? ORDER BY sort_order ASC").all(existing.category_id);
  const idx = siblings.findIndex((i) => i.id === existing.id);
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= siblings.length) {
    return res.json(db.prepare("SELECT * FROM menu_items ORDER BY category_id ASC, sort_order ASC").all().map(mapItem));
  }
  const a = siblings[idx], c = siblings[swapIdx];
  db.prepare("UPDATE menu_items SET sort_order = ? WHERE id = ?").run(c.sort_order, a.id);
  db.prepare("UPDATE menu_items SET sort_order = ? WHERE id = ?").run(a.sort_order, c.id);
  res.json(db.prepare("SELECT * FROM menu_items ORDER BY category_id ASC, sort_order ASC").all().map(mapItem));
});

// Owner AND receptionist can flip availability (the receptionist's main job).
router.patch("/admin/menu-items/:id/availability", requireAuth, (req, res) => {
  const { available } = req.body || {};
  const existing = db.prepare("SELECT * FROM menu_items WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "not_found" });
  db.prepare("UPDATE menu_items SET available = ? WHERE id = ?").run(available ? 1 : 0, req.params.id);
  res.json(mapItem(db.prepare("SELECT * FROM menu_items WHERE id = ?").get(req.params.id)));
});

router.delete("/admin/menu-items/:id", requireOwner, (req, res) => {
  const result = db.prepare("DELETE FROM menu_items WHERE id = ?").run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "not_found" });
  res.json({ ok: true });
});

module.exports = router;
