const express = require("express");
const { ensureReady } = require("../db");
const { requireAuth, requireOwner } = require("../middleware");

const router = express.Router();

function mapCategory(doc) {
  return { id: doc._id, sortOrder: doc.sortOrder, label: doc.label };
}
function mapItem(doc) {
  return {
    id: doc._id,
    categoryId: doc.categoryId,
    sortOrder: doc.sortOrder,
    price: doc.price,
    discountPrice: doc.discountPrice,
    image: doc.image,
    featured: !!doc.featured,
    recommended: !!doc.recommended,
    available: !!doc.available,
    name: doc.name,
    description: doc.description,
    optionGroups: doc.optionGroups || []
  };
}

// Dish customization (size, sauces, extras): each group is single-select
// (e.g. Size, usually required) or multi-select (e.g. Extras, always
// optional), each option optionally adding to the base price. Sanitized
// server-side on every save — empty groups/options are dropped rather than
// stored, and ids are slugified + deduped within the item, not trusted
// from the client.
function uniqueSlugIn(base, existingIds) {
  let id = slugify(base) || "option";
  let n = 2;
  while (existingIds.has(id)) { id = `${slugify(base) || "option"}-${n}`; n += 1; }
  existingIds.add(id);
  return id;
}
function sanitizeOptionGroups(raw) {
  if (!Array.isArray(raw)) return [];
  const groupIds = new Set();
  return raw.map((g) => {
    const name = {
      fr: String((g && g.nameFr) || "").trim(),
      en: String((g && g.nameEn) || "").trim(),
      ar: String((g && g.nameAr) || "").trim()
    };
    const optionIds = new Set();
    const options = Array.isArray(g && g.options) ? g.options.map((o) => {
      const oName = {
        fr: String((o && o.nameFr) || "").trim(),
        en: String((o && o.nameEn) || "").trim(),
        ar: String((o && o.nameAr) || "").trim()
      };
      if (!oName.fr && !oName.en && !oName.ar) return null;
      return {
        id: uniqueSlugIn(oName.en || oName.fr || oName.ar, optionIds),
        name: oName,
        priceDelta: Number(o.priceDelta) || 0
      };
    }).filter(Boolean) : [];
    if ((!name.fr && !name.en && !name.ar) || options.length === 0) return null;
    return {
      id: uniqueSlugIn(name.en || name.fr || name.ar, groupIds),
      name,
      type: g.type === "multi" ? "multi" : "single",
      required: g.type !== "multi" && !!g.required, // "required" is only meaningful for single-select groups
      options
    };
  }).filter(Boolean);
}

function slugify(text) {
  return String(text)
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

async function uniqueId(base, existsAsync) {
  let id = base || "item";
  let n = 2;
  while (await existsAsync(id)) { id = `${base}-${n}`; n += 1; }
  return id;
}

// ---------- PUBLIC ----------
router.get("/menu", async (req, res) => {
  const db = await ensureReady();
  const categories = await db.collection("categories").find().sort({ sortOrder: 1 }).toArray();
  const items = await db.collection("menu_items").find().sort({ categoryId: 1, sortOrder: 1 }).toArray();
  res.json({ categories: categories.map(mapCategory), items: items.map(mapItem) });
});

// ---------- ADMIN: CATEGORIES ----------
router.get("/admin/categories", requireAuth, async (req, res) => {
  const db = await ensureReady();
  const categories = await db.collection("categories").find().sort({ sortOrder: 1 }).toArray();
  res.json(categories.map(mapCategory));
});

router.post("/admin/categories", requireOwner, async (req, res) => {
  const { labelFr, labelEn, labelAr } = req.body || {};
  if (!labelFr || !labelEn || !labelAr) {
    return res.status(400).json({ error: "invalid_input", message: "All three language labels are required." });
  }
  const db = await ensureReady();
  const base = slugify(labelEn) || "category";
  const id = await uniqueId(base, async (candidate) => !!(await db.collection("categories").findOne({ _id: candidate })));
  const maxOrderDocs = await db.collection("categories").find().sort({ sortOrder: -1 }).limit(1).toArray();
  const maxOrder = maxOrderDocs.length ? maxOrderDocs[0].sortOrder : 0;
  const doc = { _id: id, sortOrder: maxOrder + 1, label: { fr: labelFr, en: labelEn, ar: labelAr } };
  await db.collection("categories").insertOne(doc);
  res.status(201).json(mapCategory(doc));
});

router.put("/admin/categories/:id", requireOwner, async (req, res) => {
  const db = await ensureReady();
  const existing = await db.collection("categories").findOne({ _id: req.params.id });
  if (!existing) return res.status(404).json({ error: "not_found" });
  const { labelFr, labelEn, labelAr } = req.body || {};
  if (!labelFr || !labelEn || !labelAr) {
    return res.status(400).json({ error: "invalid_input", message: "All three language labels are required." });
  }
  await db.collection("categories").updateOne(
    { _id: req.params.id },
    { $set: { label: { fr: labelFr, en: labelEn, ar: labelAr } } }
  );
  const updated = await db.collection("categories").findOne({ _id: req.params.id });
  res.json(mapCategory(updated));
});

router.put("/admin/categories/:id/move", requireOwner, async (req, res) => {
  const { direction } = req.body || {};
  const db = await ensureReady();
  const all = await db.collection("categories").find().sort({ sortOrder: 1 }).toArray();
  const idx = all.findIndex((c) => c._id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "not_found" });
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= all.length) return res.json(all.map(mapCategory));
  const a = all[idx], b = all[swapIdx];
  await db.collection("categories").updateOne({ _id: a._id }, { $set: { sortOrder: b.sortOrder } });
  await db.collection("categories").updateOne({ _id: b._id }, { $set: { sortOrder: a.sortOrder } });
  const reordered = await db.collection("categories").find().sort({ sortOrder: 1 }).toArray();
  res.json(reordered.map(mapCategory));
});

router.delete("/admin/categories/:id", requireOwner, async (req, res) => {
  const db = await ensureReady();
  const count = await db.collection("menu_items").countDocuments({ categoryId: req.params.id });
  if (count > 0) {
    return res.status(409).json({ error: "category_not_empty", message: "Remove or move all dishes out of this category first." });
  }
  const result = await db.collection("categories").deleteOne({ _id: req.params.id });
  if (result.deletedCount === 0) return res.status(404).json({ error: "not_found" });
  res.json({ ok: true });
});

// ---------- ADMIN: MENU ITEMS ----------
router.get("/admin/menu-items", requireAuth, async (req, res) => {
  const db = await ensureReady();
  const items = await db.collection("menu_items").find().sort({ categoryId: 1, sortOrder: 1 }).toArray();
  res.json(items.map(mapItem));
});

router.post("/admin/menu-items", requireOwner, async (req, res) => {
  const b = req.body || {};
if (typeof b.categoryId !== "string" || !b.categoryId || !b.nameFr || !b.nameEn || !b.nameAr || b.price == null) {
  return res.status(400).json({ error: "invalid_input", message: "Category, name (3 languages) and price are required." });
  }
  const db = await ensureReady();
  const category = await db.collection("categories").findOne({ _id: b.categoryId });
  if (!category) return res.status(400).json({ error: "invalid_category" });

  const base = slugify(b.nameEn) || "dish";
  const id = await uniqueId(base, async (candidate) => !!(await db.collection("menu_items").findOne({ _id: candidate })));
  const maxOrderDocs = await db.collection("menu_items").find({ categoryId: b.categoryId }).sort({ sortOrder: -1 }).limit(1).toArray();
  const maxOrder = maxOrderDocs.length ? maxOrderDocs[0].sortOrder : 0;

  const doc = {
    _id: id,
    categoryId: b.categoryId,
    sortOrder: maxOrder + 1,
    price: Number(b.price),
    discountPrice: b.discountPrice != null ? Number(b.discountPrice) : null,
    image: b.image || null,
    featured: !!b.featured,
    recommended: !!b.recommended,
    available: b.available !== false,
    name: { fr: b.nameFr, en: b.nameEn, ar: b.nameAr },
    description: { fr: b.descFr || "", en: b.descEn || "", ar: b.descAr || "" },
    optionGroups: sanitizeOptionGroups(b.optionGroups)
  };
  await db.collection("menu_items").insertOne(doc);
  res.status(201).json(mapItem(doc));
});

router.put("/admin/menu-items/:id", requireOwner, async (req, res) => {
  const db = await ensureReady();
  const existing = await db.collection("menu_items").findOne({ _id: req.params.id });
  if (!existing) return res.status(404).json({ error: "not_found" });
  const b = req.body || {};
if (typeof b.categoryId !== "string" || !b.categoryId || !b.nameFr || !b.nameEn || !b.nameAr || b.price == null) {return res.status(400).json({ error: "invalid_input", message: "Category, name (3 languages) and price are required." });
  }
  const category = await db.collection("categories").findOne({ _id: b.categoryId });
  if (!category) return res.status(400).json({ error: "invalid_category" });

  await db.collection("menu_items").updateOne({ _id: req.params.id }, {
    $set: {
      categoryId: b.categoryId,
      price: Number(b.price),
      discountPrice: b.discountPrice != null ? Number(b.discountPrice) : null,
      image: b.image || null,
      featured: !!b.featured,
      recommended: !!b.recommended,
      available: b.available !== false,
      name: { fr: b.nameFr, en: b.nameEn, ar: b.nameAr },
      description: { fr: b.descFr || "", en: b.descEn || "", ar: b.descAr || "" },
      optionGroups: sanitizeOptionGroups(b.optionGroups)
    }
  });
  const updated = await db.collection("menu_items").findOne({ _id: req.params.id });
  res.json(mapItem(updated));
});

router.put("/admin/menu-items/:id/move", requireOwner, async (req, res) => {
  const { direction } = req.body || {};
  const db = await ensureReady();
  const existing = await db.collection("menu_items").findOne({ _id: req.params.id });
  if (!existing) return res.status(404).json({ error: "not_found" });
  const siblings = await db.collection("menu_items").find({ categoryId: existing.categoryId }).sort({ sortOrder: 1 }).toArray();
  const idx = siblings.findIndex((i) => i._id === existing._id);
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= siblings.length) {
    const all = await db.collection("menu_items").find().sort({ categoryId: 1, sortOrder: 1 }).toArray();
    return res.json(all.map(mapItem));
  }
  const a = siblings[idx], c = siblings[swapIdx];
  await db.collection("menu_items").updateOne({ _id: a._id }, { $set: { sortOrder: c.sortOrder } });
  await db.collection("menu_items").updateOne({ _id: c._id }, { $set: { sortOrder: a.sortOrder } });
  const all = await db.collection("menu_items").find().sort({ categoryId: 1, sortOrder: 1 }).toArray();
  res.json(all.map(mapItem));
});

// Owner AND receptionist can flip availability (the receptionist's main job).
router.patch("/admin/menu-items/:id/availability", requireAuth, async (req, res) => {
  const { available } = req.body || {};
  const db = await ensureReady();
  const existing = await db.collection("menu_items").findOne({ _id: req.params.id });
  if (!existing) return res.status(404).json({ error: "not_found" });
  await db.collection("menu_items").updateOne({ _id: req.params.id }, { $set: { available: !!available } });
  const updated = await db.collection("menu_items").findOne({ _id: req.params.id });
  res.json(mapItem(updated));
});

router.delete("/admin/menu-items/:id", requireOwner, async (req, res) => {
  const db = await ensureReady();
  const result = await db.collection("menu_items").deleteOne({ _id: req.params.id });
  if (result.deletedCount === 0) return res.status(404).json({ error: "not_found" });
  res.json({ ok: true });
});

module.exports = router;
