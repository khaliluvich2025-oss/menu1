const express = require("express");
const { ensureReady } = require("../db");
const { requireOwner } = require("../middleware");

const router = express.Router();

function mapInfo(doc) {
  return {
    name: doc.name,
    logoInitials: doc.logoInitials,
    currency: doc.currency,
    whatsappNumber: doc.whatsappNumber,
    defaultLanguage: doc.defaultLanguage,
    defaultTheme: doc.defaultTheme,
    animationIntensity: doc.animationIntensity,
    heroImage: doc.heroImage,
    logoImage: doc.logoImage || "",
    openingHours: doc.openingHours,
    address: doc.address,
    phone: doc.phone,
    phoneHref: doc.phoneHref,
    social: doc.social,
    googleMapsUrl: doc.googleMapsUrl || "",
    googleReviewUrl: doc.googleReviewUrl || ""
  };
}

// Public: the storefront needs the full config to render (branding fields included),
// even though only a subset below is editable from the CMS.
router.get("/restaurant-info", async (req, res) => {
  const db = await ensureReady();
  const doc = await db.collection("restaurant_info").findOne({ _id: "main" });
  res.json(mapInfo(doc));
});

router.get("/admin/restaurant-info", requireOwner, async (req, res) => {
  const db = await ensureReady();
  const doc = await db.collection("restaurant_info").findOne({ _id: "main" });
  // webhookUrl is owner-only — never included in the public mapInfo() above.
  res.json({ ...mapInfo(doc), webhookUrl: doc.webhookUrl || "" });
});

// The "restaurant info" subset is editable from the CMS (hours, address,
// phone, WhatsApp number, socials, review/map links), plus the homepage
// cover/hero image. Other branding/theme fields are not accepted here.
router.put("/admin/restaurant-info", requireOwner, async (req, res) => {
  const b = req.body || {};
  const openingHours = b.openingHours || {};
  const address = b.address || {};
  const social = b.social || {};

  if (!b.whatsappNumber || !/^[0-9]{8,15}$/.test(String(b.whatsappNumber))) {
    return res.status(400).json({ error: "invalid_input", message: "WhatsApp number must be digits only (country code + number, no + or spaces)." });
  }
  const webhookUrl = b.webhookUrl ? String(b.webhookUrl).trim() : "";
  if (webhookUrl && !/^https?:\/\/.+/i.test(webhookUrl)) {
    return res.status(400).json({ error: "invalid_input", message: "Webhook URL must start with http:// or https://" });
  }

  const setFields = {
    webhookUrl,
    whatsappNumber: String(b.whatsappNumber),
    openingHours: { fr: openingHours.fr || "", en: openingHours.en || "", ar: openingHours.ar || "" },
    address: { fr: address.fr || "", en: address.en || "", ar: address.ar || "" },
    phone: b.phone || "",
    phoneHref: b.phoneHref || "",
    social: { instagram: social.instagram || "#", facebook: social.facebook || "#", tiktok: social.tiktok || "#" },
    googleMapsUrl: b.googleMapsUrl ? String(b.googleMapsUrl).trim() : "",
    googleReviewUrl: b.googleReviewUrl ? String(b.googleReviewUrl).trim() : ""
  };
  // Only touched if a real path is provided — never wipe the cover image or
  // logo to blank just because a request happened to omit it.
  if (b.heroImage) setFields.heroImage = String(b.heroImage).trim();
  if (b.logoImage) setFields.logoImage = String(b.logoImage).trim();

  const db = await ensureReady();
  await db.collection("restaurant_info").updateOne({ _id: "main" }, { $set: setFields });

  const updated = await db.collection("restaurant_info").findOne({ _id: "main" });
  res.json({ ...mapInfo(updated), webhookUrl: updated.webhookUrl || "" });
});

module.exports = router;
