const express = require("express");
const db = require("../db");
const { requireOwner } = require("../middleware");

const router = express.Router();

function mapInfo(row) {
  return {
    name: row.name,
    logoInitials: row.logo_initials,
    currency: row.currency,
    whatsappNumber: row.whatsapp_number,
    defaultLanguage: row.default_language,
    defaultTheme: row.default_theme,
    animationIntensity: row.animation_intensity,
    heroImage: row.hero_image,
    openingHours: { fr: row.opening_hours_fr, en: row.opening_hours_en, ar: row.opening_hours_ar },
    address: { fr: row.address_fr, en: row.address_en, ar: row.address_ar },
    phone: row.phone,
    phoneHref: row.phone_href,
    social: { instagram: row.social_instagram, facebook: row.social_facebook, tiktok: row.social_tiktok }
  };
}

// Public: the storefront needs the full config to render (branding fields included),
// even though only a subset below is editable from the CMS.
router.get("/restaurant-info", (req, res) => {
  const row = db.prepare("SELECT * FROM restaurant_info WHERE id = 1").get();
  res.json(mapInfo(row));
});

router.get("/admin/restaurant-info", requireOwner, (req, res) => {
  const row = db.prepare("SELECT * FROM restaurant_info WHERE id = 1").get();
  res.json(mapInfo(row));
});

// Only the "restaurant info" subset is editable from the CMS (hours, address,
// phone, WhatsApp number, socials). Branding/theme fields are not accepted here.
router.put("/admin/restaurant-info", requireOwner, (req, res) => {
  const b = req.body || {};
  const openingHours = b.openingHours || {};
  const address = b.address || {};
  const social = b.social || {};

  if (!b.whatsappNumber || !/^[0-9]{8,15}$/.test(String(b.whatsappNumber))) {
    return res.status(400).json({ error: "invalid_input", message: "WhatsApp number must be digits only (country code + number, no + or spaces)." });
  }

  db.prepare(`
    UPDATE restaurant_info SET
      whatsapp_number = ?,
      opening_hours_fr = ?, opening_hours_en = ?, opening_hours_ar = ?,
      address_fr = ?, address_en = ?, address_ar = ?,
      phone = ?, phone_href = ?,
      social_instagram = ?, social_facebook = ?, social_tiktok = ?
    WHERE id = 1
  `).run(
    String(b.whatsappNumber),
    openingHours.fr || "", openingHours.en || "", openingHours.ar || "",
    address.fr || "", address.en || "", address.ar || "",
    b.phone || "", b.phoneHref || "",
    social.instagram || "#", social.facebook || "#", social.tiktok || "#"
  );

  res.json(mapInfo(db.prepare("SELECT * FROM restaurant_info WHERE id = 1").get()));
});

module.exports = router;
