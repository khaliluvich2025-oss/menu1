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
    openingHours: doc.openingHours,
    address: doc.address,
    phone: doc.phone,
    phoneHref: doc.phoneHref,
    social: doc.social
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
  res.json(mapInfo(doc));
});

// Only the "restaurant info" subset is editable from the CMS (hours, address,
// phone, WhatsApp number, socials). Branding/theme fields are not accepted here.
router.put("/admin/restaurant-info", requireOwner, async (req, res) => {
  const b = req.body || {};
  const openingHours = b.openingHours || {};
  const address = b.address || {};
  const social = b.social || {};

  if (!b.whatsappNumber || !/^[0-9]{8,15}$/.test(String(b.whatsappNumber))) {
    return res.status(400).json({ error: "invalid_input", message: "WhatsApp number must be digits only (country code + number, no + or spaces)." });
  }

  const db = await ensureReady();
  await db.collection("restaurant_info").updateOne({ _id: "main" }, {
    $set: {
      whatsappNumber: String(b.whatsappNumber),
      openingHours: { fr: openingHours.fr || "", en: openingHours.en || "", ar: openingHours.ar || "" },
      address: { fr: address.fr || "", en: address.en || "", ar: address.ar || "" },
      phone: b.phone || "",
      phoneHref: b.phoneHref || "",
      social: { instagram: social.instagram || "#", facebook: social.facebook || "#", tiktok: social.tiktok || "#" }
    }
  });

  const updated = await db.collection("restaurant_info").findOne({ _id: "main" });
  res.json(mapInfo(updated));
});

module.exports = router;
