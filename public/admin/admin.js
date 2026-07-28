// =====================================================================
// Ember Table Admin CMS — vanilla JS, talks to the Express API under /api.
// =====================================================================

const state = {
  user: null,       // { username, role, mustChangePassword }
  categories: [],   // from /api/admin/categories
  items: [],        // from /api/admin/menu-items
  orders: [],       // from /api/admin/orders
  assistanceCalls: [], // pending "call a waiter" requests from /api/admin/assistance-calls
  lastSeenOrderId: null,
  newOrderIds: new Set(), // ids currently flagged "new" — drives the highlighted-card render below
  view: "orders",
  statsPreset: "today",
  statsCustomStart: null,
  statsCustomEnd: null,
  statsStatus: "",
  soundEnabled: true, // placeholder, overwritten by loadSoundPref() at init
  autoPrintEnabled: false, // placeholder, overwritten by loadAutoPrintPref() at init
  lang: "en" // placeholder, overwritten by loadLangPref() at init
};

const ORDERS_POLL_MS = 3500; // was 8000 — snappier alerts, matches the public tracker's 4000ms cadence
const STATS_POLL_MS = 20000;
const NEW_ORDER_HIGHLIGHT_MS = 20000; // safety-net auto-clear for the "new" highlight if never acknowledged
let ordersPollTimer = null;
let statsPollTimer = null;
const chimedOrderIds = new Set(); // ids already chimed for — never replay
const newOrderTimers = new Map(); // orderId -> setTimeout handle, so it can be cancelled

// ---------------------------------------------------------------- i18n
// Same data-i18n / t() / translations pattern already used on the public
// site (public/index.html) — kept independent (own dictionary, own storage
// key) since the admin panel is a separate app with its own string set.
const ADMIN_LANG_KEY = "emberTable.admin.lang";

const adminTranslations = {
  en: {
    loginTitle: "Ember Table CMS",
    loginSubtitle: "Sign in to manage the menu and restaurant info.",
    fieldUsername: "Username",
    fieldPassword: "Password",
    signIn: "Sign in",
    errLocked: "Too many attempts. Try again in a bit.",
    errInvalidCreds: "Incorrect username or password.",

    adminTitleSuffix: "Admin",
    navOrders: "Orders",
    navDashboard: "Dashboard",
    navMenuItems: "Menu items",
    navCategories: "Categories",
    navRestaurantInfo: "Restaurant info",
    soundLabel: "Sound",
    autoPrintLabel: "Auto-print",
    soundToggleTitle: "Toggle sound alerts for new orders",
    autoPrintToggleTitle: "Automatically open the print dialog for a kitchen ticket when a new order arrives",
    viewSite: "View site ↗",
    viewSiteTitle: "Opens the customer-facing site in a new tab",
    changePasswordBtn: "Change password",
    logOut: "Log out",

    autoRefresh: "Auto-refresh",
    ordersEmptyHint: "No orders yet. New orders placed from the menu will show up here automatically.",
    toastNewOrder: "New order received.",
    toastNewOrders: "{count} new orders received.",
    tableWord: "Table",
    newBadge: "New",
    printTicketBtn: "🖨️ Print ticket",
    notePlaceholder: "Optional note for this update…",
    reject: "Reject",
    cancel: "Cancel",
    markAsStatus: "Mark as {status} →",
    toastOrderMarked: "Order marked {status}.",
    errCouldNotLoadOrders: "Could not load orders.",
    errCouldNotUpdateOrder: "Could not update order.",
    status_received: "Received",
    status_confirmed: "Confirmed",
    status_preparing: "Preparing",
    status_ready: "Ready",
    status_completed: "Completed",
    status_cancelled: "Cancelled",
    status_rejected: "Rejected",
    justNow: "just now",
    minAgo: "{n}m ago",

    assistanceNeedsHelp: "🔔 Table {table} needs assistance",
    acknowledge: "Acknowledge",
    errCouldNotAcknowledge: "Could not acknowledge.",

    ticketTime: "Time",
    ticketTotal: "Total",
    ticketNote: "Note: {note}",
    ticketPrinted: "Printed {datetime}",

    forcedPasswordHint: "This account was created with a temporary password. Please set a new one to continue.",
    currentPassword: "Current password",
    newPasswordMin8: "New password (min. 8 characters)",
    confirmNewPassword: "Confirm new password",
    errPasswordsDontMatch: "New passwords don't match.",
    errCouldNotChangePassword: "Could not change password.",
    toastPasswordUpdated: "Password updated.",
    saveNewPassword: "Save new password",

    addDish: "+ Add dish",
    tagFeatured: "Featured",
    tagRecommended: "Recommended",
    tagOffer: "Offer",
    tagSoldOut: "Sold out",
    availableTitle: "Available",
    moveUpTitle: "Move up",
    moveDownTitle: "Move down",
    edit: "Edit",
    deleteWord: "Delete",
    toastMarkedAvailable: "Marked available.",
    toastMarkedSoldOut: "Marked sold out.",
    errCouldNotUpdateAvailability: "Could not update availability.",
    errCouldNotReorder: "Could not reorder.",
    confirmDeleteDish: "Delete \"{name}\"? This cannot be undone.",
    toastDishDeleted: "Dish deleted.",
    errCouldNotDeleteDish: "Could not delete dish.",

    editDishTitle: "Edit dish",
    addDishTitle: "Add dish",
    categoryLabel: "Category",
    nameEnglish: "Name (English)",
    nameFrench: "Name (French)",
    nameArabic: "Name (Arabic)",
    descEnglish: "Description (English)",
    descFrench: "Description (French)",
    descArabic: "Description (Arabic)",
    priceMad: "Price (MAD)",
    discountPriceOptional: "Discount price (optional)",
    photoLabel: "Photo",
    noPhoto: "No photo",
    uploadingText: "Uploading…",
    uploadFailedText: "Upload failed",
    dishOptionsLegend: "Dish options (size, sauces, extras — optional)",
    addOptionGroup: "+ Add option group",
    saveChanges: "Save changes",
    toastDishAdded: "Dish added.",
    toastDishUpdated: "Dish updated.",
    errCouldNotSaveDish: "Could not save dish.",
    errImageUploadFailed: "Image upload failed.",

    optNameEnPh: "Option (English) e.g. Large",
    optNameFrPh: "Option (French)",
    optNameArPh: "Option (Arabic)",
    optPriceDeltaPh: "+MAD",
    removeOptionTitle: "Remove option",
    grpNameEnPh: "Group name (English) e.g. Size",
    grpNameFrPh: "Group name (French)",
    grpNameArPh: "Group name (Arabic)",
    pickOne: "Pick one",
    pickAny: "Pick any",
    requiredCheckTitle: "Customer must pick one option in this group",
    requiredWord: "Required",
    removeGroup: "Remove group",
    addOption: "+ Add option",

    addCategory: "+ Add category",
    confirmDeleteCategory: "Delete category \"{name}\"? It must have no dishes in it.",
    toastCategoryDeleted: "Category deleted.",
    errCouldNotDeleteCategory: "Could not delete category.",
    editCategoryTitle: "Edit category",
    addCategoryTitle: "Add category",
    toastCategoryAdded: "Category added.",
    toastCategoryUpdated: "Category updated.",
    errCouldNotSaveCategory: "Could not save category.",

    brandingHint: "Colors, default language/theme, and other branding are set in the code template and aren't editable here.",
    logoLabel: "Logo",
    coverImageLabel: "Cover image (homepage)",
    whatsappLabel: "WhatsApp number (digits only, country code first)",
    phoneDisplayedLabel: "Phone (displayed)",
    phoneLinkLabel: "Phone link (tel:)",
    googleMapsLabel: "Google Maps URL",
    googleReviewLabel: "Google Review URL",
    webhookLabel: "Webhook URL (optional — POS / Zapier / custom integration)",
    webhookHint: "Every new order and status change gets POSTed here as JSON. Leave blank to disable.",
    openingHoursLegend: "Opening hours",
    addressLegend: "Address",
    socialLinksLegend: "Social links",
    frenchLabel: "French",
    englishLabel: "English",
    arabicLabel: "Arabic",
    instagramUrlLabel: "Instagram URL",
    facebookUrlLabel: "Facebook URL",
    tiktokUrlLabel: "TikTok URL",
    saveRestaurantInfo: "Save restaurant info",
    toastRestaurantInfoSaved: "Restaurant info saved.",
    errCouldNotSaveRestaurantInfo: "Could not save restaurant info.",
    errCouldNotLoadRestaurantInfo: "Could not load restaurant info.",
    errCouldNotLoadData: "Could not load data.",

    exportCsv: "Export CSV",
    presetToday: "Today",
    presetWeek: "This week",
    presetMonth: "This month",
    presetCustom: "Custom range",
    ariaDateRange: "Date range",
    ariaCustomStart: "Custom range start",
    ariaCustomEnd: "Custom range end",
    ariaStatusFilter: "Filter by order status",
    applyBtn: "Apply",
    allStatuses: "All statuses",
    statusPendingOpt: "Pending",
    statusCompletedOpt: "Completed",
    statusCancelledOpt: "Cancelled",
    dineInNote: "Dine-in is the only order type this menu supports, so there's no order-type filter to show yet.",
    revenueWord: "Revenue",
    chartRevenueOverTime: "Revenue over time",
    chartOrdersOverTime: "Orders over time",
    chartBestSelling: "Best-selling products",
    chartTopCategories: "Top categories",
    chartBusiestHours: "Busiest hours",
    chartStatusDistribution: "Order status distribution",
    kpiTotalOrders: "Total orders",
    kpiTotalRevenue: "Total revenue",
    kpiAvgOrderValue: "Average order value",
    noChangeVsPrevious: "No change vs previous period",
    newVsPrevious: "New vs previous period",
    vsPreviousPeriod: "vs previous period",
    pickBothDates: "Pick both a start and end date.",
    startBeforeEnd: "Start date must be before end date.",
    noRevenuePeriod: "No revenue in this period.",
    noOrdersPeriod: "No orders in this period.",
    noItemsSoldPeriod: "No items sold in this period.",
    noSalesPeriod: "No sales in this period.",
    soldSuffix: "{n} sold",
    errCouldNotLoadStats: "Could not load statistics."
  },
  fr: {
    loginTitle: "Ember Table CMS",
    loginSubtitle: "Connectez-vous pour gérer le menu et les informations du restaurant.",
    fieldUsername: "Nom d'utilisateur",
    fieldPassword: "Mot de passe",
    signIn: "Se connecter",
    errLocked: "Trop de tentatives. Réessayez dans quelques instants.",
    errInvalidCreds: "Nom d'utilisateur ou mot de passe incorrect.",

    adminTitleSuffix: "Administration",
    navOrders: "Commandes",
    navDashboard: "Tableau de bord",
    navMenuItems: "Plats du menu",
    navCategories: "Catégories",
    navRestaurantInfo: "Infos du restaurant",
    soundLabel: "Son",
    autoPrintLabel: "Impression auto",
    soundToggleTitle: "Activer/désactiver les alertes sonores pour les nouvelles commandes",
    autoPrintToggleTitle: "Ouvre automatiquement la fenêtre d'impression du ticket cuisine à l'arrivée d'une nouvelle commande",
    viewSite: "Voir le site ↗",
    viewSiteTitle: "Ouvre le site client dans un nouvel onglet",
    changePasswordBtn: "Changer le mot de passe",
    logOut: "Déconnexion",

    autoRefresh: "Actualisation auto",
    ordersEmptyHint: "Aucune commande pour l'instant. Les nouvelles commandes passées depuis le menu apparaîtront ici automatiquement.",
    toastNewOrder: "Nouvelle commande reçue.",
    toastNewOrders: "{count} nouvelles commandes reçues.",
    tableWord: "Table",
    newBadge: "Nouveau",
    printTicketBtn: "🖨️ Imprimer le ticket",
    notePlaceholder: "Note facultative pour cette mise à jour…",
    reject: "Refuser",
    cancel: "Annuler",
    markAsStatus: "Marquer comme {status} →",
    toastOrderMarked: "Commande marquée {status}.",
    errCouldNotLoadOrders: "Impossible de charger les commandes.",
    errCouldNotUpdateOrder: "Impossible de mettre à jour la commande.",
    status_received: "Reçue",
    status_confirmed: "Confirmée",
    status_preparing: "En préparation",
    status_ready: "Prête",
    status_completed: "Terminée",
    status_cancelled: "Annulée",
    status_rejected: "Refusée",
    justNow: "à l'instant",
    minAgo: "il y a {n} min",

    assistanceNeedsHelp: "🔔 La table {table} a besoin d'assistance",
    acknowledge: "Marquer comme vu",
    errCouldNotAcknowledge: "Impossible de valider.",

    ticketTime: "Heure",
    ticketTotal: "Total",
    ticketNote: "Note : {note}",
    ticketPrinted: "Imprimé le {datetime}",

    forcedPasswordHint: "Ce compte a été créé avec un mot de passe temporaire. Merci d'en définir un nouveau pour continuer.",
    currentPassword: "Mot de passe actuel",
    newPasswordMin8: "Nouveau mot de passe (min. 8 caractères)",
    confirmNewPassword: "Confirmer le nouveau mot de passe",
    errPasswordsDontMatch: "Les nouveaux mots de passe ne correspondent pas.",
    errCouldNotChangePassword: "Impossible de changer le mot de passe.",
    toastPasswordUpdated: "Mot de passe mis à jour.",
    saveNewPassword: "Enregistrer le nouveau mot de passe",

    addDish: "+ Ajouter un plat",
    tagFeatured: "En vedette",
    tagRecommended: "Recommandé",
    tagOffer: "Promo",
    tagSoldOut: "Épuisé",
    availableTitle: "Disponible",
    moveUpTitle: "Monter",
    moveDownTitle: "Descendre",
    edit: "Modifier",
    deleteWord: "Supprimer",
    toastMarkedAvailable: "Marqué disponible.",
    toastMarkedSoldOut: "Marqué épuisé.",
    errCouldNotUpdateAvailability: "Impossible de mettre à jour la disponibilité.",
    errCouldNotReorder: "Impossible de réorganiser.",
    confirmDeleteDish: "Supprimer « {name} » ? Cette action est irréversible.",
    toastDishDeleted: "Plat supprimé.",
    errCouldNotDeleteDish: "Impossible de supprimer le plat.",

    editDishTitle: "Modifier le plat",
    addDishTitle: "Ajouter un plat",
    categoryLabel: "Catégorie",
    nameEnglish: "Nom (Anglais)",
    nameFrench: "Nom (Français)",
    nameArabic: "Nom (Arabe)",
    descEnglish: "Description (Anglais)",
    descFrench: "Description (Français)",
    descArabic: "Description (Arabe)",
    priceMad: "Prix (MAD)",
    discountPriceOptional: "Prix promo (facultatif)",
    photoLabel: "Photo",
    noPhoto: "Aucune photo",
    uploadingText: "Envoi en cours…",
    uploadFailedText: "Échec de l'envoi",
    dishOptionsLegend: "Options du plat (taille, sauces, suppléments — facultatif)",
    addOptionGroup: "+ Ajouter un groupe d'options",
    saveChanges: "Enregistrer les modifications",
    toastDishAdded: "Plat ajouté.",
    toastDishUpdated: "Plat mis à jour.",
    errCouldNotSaveDish: "Impossible d'enregistrer le plat.",
    errImageUploadFailed: "Échec de l'envoi de l'image.",

    optNameEnPh: "Option (Anglais) ex. Grand",
    optNameFrPh: "Option (Français)",
    optNameArPh: "Option (Arabe)",
    optPriceDeltaPh: "+MAD",
    removeOptionTitle: "Supprimer l'option",
    grpNameEnPh: "Nom du groupe (Anglais) ex. Taille",
    grpNameFrPh: "Nom du groupe (Français)",
    grpNameArPh: "Nom du groupe (Arabe)",
    pickOne: "Choix unique",
    pickAny: "Choix multiple",
    requiredCheckTitle: "Le client doit choisir une option dans ce groupe",
    requiredWord: "Obligatoire",
    removeGroup: "Supprimer le groupe",
    addOption: "+ Ajouter une option",

    addCategory: "+ Ajouter une catégorie",
    confirmDeleteCategory: "Supprimer la catégorie « {name} » ? Elle ne doit contenir aucun plat.",
    toastCategoryDeleted: "Catégorie supprimée.",
    errCouldNotDeleteCategory: "Impossible de supprimer la catégorie.",
    editCategoryTitle: "Modifier la catégorie",
    addCategoryTitle: "Ajouter une catégorie",
    toastCategoryAdded: "Catégorie ajoutée.",
    toastCategoryUpdated: "Catégorie mise à jour.",
    errCouldNotSaveCategory: "Impossible d'enregistrer la catégorie.",

    brandingHint: "Les couleurs, la langue/thème par défaut et les autres éléments de marque sont définis dans le modèle de code et ne sont pas modifiables ici.",
    logoLabel: "Logo",
    coverImageLabel: "Image de couverture (page d'accueil)",
    whatsappLabel: "Numéro WhatsApp (chiffres uniquement, indicatif pays en premier)",
    phoneDisplayedLabel: "Téléphone (affiché)",
    phoneLinkLabel: "Lien téléphone (tel:)",
    googleMapsLabel: "URL Google Maps",
    googleReviewLabel: "URL avis Google",
    webhookLabel: "URL du webhook (facultatif — caisse / Zapier / intégration personnalisée)",
    webhookHint: "Chaque nouvelle commande et changement de statut est envoyé ici en JSON. Laisser vide pour désactiver.",
    openingHoursLegend: "Horaires d'ouverture",
    addressLegend: "Adresse",
    socialLinksLegend: "Réseaux sociaux",
    frenchLabel: "Français",
    englishLabel: "Anglais",
    arabicLabel: "Arabe",
    instagramUrlLabel: "URL Instagram",
    facebookUrlLabel: "URL Facebook",
    tiktokUrlLabel: "URL TikTok",
    saveRestaurantInfo: "Enregistrer les infos du restaurant",
    toastRestaurantInfoSaved: "Infos du restaurant enregistrées.",
    errCouldNotSaveRestaurantInfo: "Impossible d'enregistrer les infos du restaurant.",
    errCouldNotLoadRestaurantInfo: "Impossible de charger les infos du restaurant.",
    errCouldNotLoadData: "Impossible de charger les données.",

    exportCsv: "Exporter en CSV",
    presetToday: "Aujourd'hui",
    presetWeek: "Cette semaine",
    presetMonth: "Ce mois-ci",
    presetCustom: "Période personnalisée",
    ariaDateRange: "Période",
    ariaCustomStart: "Début de la période personnalisée",
    ariaCustomEnd: "Fin de la période personnalisée",
    ariaStatusFilter: "Filtrer par statut de commande",
    applyBtn: "Appliquer",
    allStatuses: "Tous les statuts",
    statusPendingOpt: "En attente",
    statusCompletedOpt: "Terminé",
    statusCancelledOpt: "Annulé",
    dineInNote: "Sur place est le seul type de commande pris en charge par ce menu, il n'y a donc pas encore de filtre par type de commande.",
    revenueWord: "Recettes",
    chartRevenueOverTime: "Recettes dans le temps",
    chartOrdersOverTime: "Commandes dans le temps",
    chartBestSelling: "Produits les plus vendus",
    chartTopCategories: "Meilleures catégories",
    chartBusiestHours: "Heures d'affluence",
    chartStatusDistribution: "Répartition des statuts de commande",
    kpiTotalOrders: "Total des commandes",
    kpiTotalRevenue: "Recettes totales",
    kpiAvgOrderValue: "Panier moyen",
    noChangeVsPrevious: "Aucun changement vs période précédente",
    newVsPrevious: "Nouveau vs période précédente",
    vsPreviousPeriod: "vs période précédente",
    pickBothDates: "Choisissez une date de début et de fin.",
    startBeforeEnd: "La date de début doit précéder la date de fin.",
    noRevenuePeriod: "Aucune recette sur cette période.",
    noOrdersPeriod: "Aucune commande sur cette période.",
    noItemsSoldPeriod: "Aucun article vendu sur cette période.",
    noSalesPeriod: "Aucune vente sur cette période.",
    soldSuffix: "{n} vendus",
    errCouldNotLoadStats: "Impossible de charger les statistiques."
  },
  ar: {
    loginTitle: "Ember Table CMS",
    loginSubtitle: "سجّل الدخول لإدارة القائمة ومعلومات المطعم.",
    fieldUsername: "اسم المستخدم",
    fieldPassword: "كلمة المرور",
    signIn: "تسجيل الدخول",
    errLocked: "محاولات كثيرة جدًا. حاول مرة أخرى بعد قليل.",
    errInvalidCreds: "اسم المستخدم أو كلمة المرور غير صحيحة.",

    adminTitleSuffix: "الإدارة",
    navOrders: "الطلبات",
    navDashboard: "لوحة التحكم",
    navMenuItems: "أصناف القائمة",
    navCategories: "الفئات",
    navRestaurantInfo: "معلومات المطعم",
    soundLabel: "الصوت",
    autoPrintLabel: "طباعة تلقائية",
    soundToggleTitle: "تفعيل/إيقاف التنبيهات الصوتية للطلبات الجديدة",
    autoPrintToggleTitle: "فتح نافذة طباعة تذكرة المطبخ تلقائيًا عند وصول طلب جديد",
    viewSite: "عرض الموقع ↗",
    viewSiteTitle: "يفتح موقع العملاء في تبويب جديد",
    changePasswordBtn: "تغيير كلمة المرور",
    logOut: "تسجيل الخروج",

    autoRefresh: "تحديث تلقائي",
    ordersEmptyHint: "لا توجد طلبات بعد. ستظهر هنا تلقائيًا الطلبات الجديدة المرسلة من القائمة.",
    toastNewOrder: "تم استلام طلب جديد.",
    toastNewOrders: "تم استلام {count} طلبات جديدة.",
    tableWord: "الطاولة",
    newBadge: "جديد",
    printTicketBtn: "🖨️ طباعة التذكرة",
    notePlaceholder: "ملاحظة اختيارية لهذا التحديث…",
    reject: "رفض",
    cancel: "إلغاء",
    markAsStatus: "تحديد كـ {status} ←",
    toastOrderMarked: "تم تحديد الطلب كـ {status}.",
    errCouldNotLoadOrders: "تعذّر تحميل الطلبات.",
    errCouldNotUpdateOrder: "تعذّر تحديث الطلب.",
    status_received: "تم الاستلام",
    status_confirmed: "مؤكد",
    status_preparing: "قيد التحضير",
    status_ready: "جاهز",
    status_completed: "مكتمل",
    status_cancelled: "ملغى",
    status_rejected: "مرفوض",
    justNow: "الآن",
    minAgo: "منذ {n} د",

    assistanceNeedsHelp: "🔔 الطاولة {table} بحاجة إلى مساعدة",
    acknowledge: "تم الاطلاع",
    errCouldNotAcknowledge: "تعذّر التأكيد.",

    ticketTime: "الوقت",
    ticketTotal: "المجموع",
    ticketNote: "ملاحظة: {note}",
    ticketPrinted: "طُبع في {datetime}",

    forcedPasswordHint: "تم إنشاء هذا الحساب بكلمة مرور مؤقتة. يرجى تعيين كلمة جديدة للمتابعة.",
    currentPassword: "كلمة المرور الحالية",
    newPasswordMin8: "كلمة المرور الجديدة (8 أحرف على الأقل)",
    confirmNewPassword: "تأكيد كلمة المرور الجديدة",
    errPasswordsDontMatch: "كلمتا المرور الجديدتان غير متطابقتين.",
    errCouldNotChangePassword: "تعذّر تغيير كلمة المرور.",
    toastPasswordUpdated: "تم تحديث كلمة المرور.",
    saveNewPassword: "حفظ كلمة المرور الجديدة",

    addDish: "+ إضافة طبق",
    tagFeatured: "مميز",
    tagRecommended: "موصى به",
    tagOffer: "عرض",
    tagSoldOut: "نفدت الكمية",
    availableTitle: "متوفر",
    moveUpTitle: "تحريك لأعلى",
    moveDownTitle: "تحريك لأسفل",
    edit: "تعديل",
    deleteWord: "حذف",
    toastMarkedAvailable: "تم التحديد كمتوفر.",
    toastMarkedSoldOut: "تم التحديد كنافد.",
    errCouldNotUpdateAvailability: "تعذّر تحديث التوفر.",
    errCouldNotReorder: "تعذّر إعادة الترتيب.",
    confirmDeleteDish: "حذف «{name}»؟ لا يمكن التراجع عن هذا الإجراء.",
    toastDishDeleted: "تم حذف الطبق.",
    errCouldNotDeleteDish: "تعذّر حذف الطبق.",

    editDishTitle: "تعديل الطبق",
    addDishTitle: "إضافة طبق",
    categoryLabel: "الفئة",
    nameEnglish: "الاسم (إنجليزي)",
    nameFrench: "الاسم (فرنسي)",
    nameArabic: "الاسم (عربي)",
    descEnglish: "الوصف (إنجليزي)",
    descFrench: "الوصف (فرنسي)",
    descArabic: "الوصف (عربي)",
    priceMad: "السعر (درهم)",
    discountPriceOptional: "سعر الخصم (اختياري)",
    photoLabel: "صورة",
    noPhoto: "لا توجد صورة",
    uploadingText: "جارٍ الرفع…",
    uploadFailedText: "فشل الرفع",
    dishOptionsLegend: "خيارات الطبق (الحجم، الصلصات، الإضافات — اختياري)",
    addOptionGroup: "+ إضافة مجموعة خيارات",
    saveChanges: "حفظ التغييرات",
    toastDishAdded: "تمت إضافة الطبق.",
    toastDishUpdated: "تم تحديث الطبق.",
    errCouldNotSaveDish: "تعذّر حفظ الطبق.",
    errImageUploadFailed: "فشل رفع الصورة.",

    optNameEnPh: "خيار (إنجليزي) مثال: كبير",
    optNameFrPh: "خيار (فرنسي)",
    optNameArPh: "خيار (عربي)",
    optPriceDeltaPh: "+درهم",
    removeOptionTitle: "حذف الخيار",
    grpNameEnPh: "اسم المجموعة (إنجليزي) مثال: الحجم",
    grpNameFrPh: "اسم المجموعة (فرنسي)",
    grpNameArPh: "اسم المجموعة (عربي)",
    pickOne: "اختيار واحد",
    pickAny: "اختيار متعدد",
    requiredCheckTitle: "يجب على العميل اختيار خيار واحد من هذه المجموعة",
    requiredWord: "إلزامي",
    removeGroup: "حذف المجموعة",
    addOption: "+ إضافة خيار",

    addCategory: "+ إضافة فئة",
    confirmDeleteCategory: "حذف الفئة «{name}»؟ يجب ألا تحتوي على أي أطباق.",
    toastCategoryDeleted: "تم حذف الفئة.",
    errCouldNotDeleteCategory: "تعذّر حذف الفئة.",
    editCategoryTitle: "تعديل الفئة",
    addCategoryTitle: "إضافة فئة",
    toastCategoryAdded: "تمت إضافة الفئة.",
    toastCategoryUpdated: "تم تحديث الفئة.",
    errCouldNotSaveCategory: "تعذّر حفظ الفئة.",

    brandingHint: "الألوان واللغة/المظهر الافتراضي وعناصر الهوية الأخرى مُحددة في قالب الكود ولا يمكن تعديلها هنا.",
    logoLabel: "الشعار",
    coverImageLabel: "صورة الغلاف (الصفحة الرئيسية)",
    whatsappLabel: "رقم واتساب (أرقام فقط، مع رمز الدولة أولاً)",
    phoneDisplayedLabel: "الهاتف (المعروض)",
    phoneLinkLabel: "رابط الهاتف (tel:)",
    googleMapsLabel: "رابط خرائط Google",
    googleReviewLabel: "رابط تقييم Google",
    webhookLabel: "رابط الويب هوك (اختياري — نقطة بيع / Zapier / تكامل مخصص)",
    webhookHint: "يتم إرسال كل طلب جديد وتغيير في الحالة إلى هذا الرابط بصيغة JSON. اتركه فارغًا للتعطيل.",
    openingHoursLegend: "ساعات العمل",
    addressLegend: "العنوان",
    socialLinksLegend: "روابط التواصل الاجتماعي",
    frenchLabel: "الفرنسية",
    englishLabel: "الإنجليزية",
    arabicLabel: "العربية",
    instagramUrlLabel: "رابط انستغرام",
    facebookUrlLabel: "رابط فيسبوك",
    tiktokUrlLabel: "رابط تيك توك",
    saveRestaurantInfo: "حفظ معلومات المطعم",
    toastRestaurantInfoSaved: "تم حفظ معلومات المطعم.",
    errCouldNotSaveRestaurantInfo: "تعذّر حفظ معلومات المطعم.",
    errCouldNotLoadRestaurantInfo: "تعذّر تحميل معلومات المطعم.",
    errCouldNotLoadData: "تعذّر تحميل البيانات.",

    exportCsv: "تصدير CSV",
    presetToday: "اليوم",
    presetWeek: "هذا الأسبوع",
    presetMonth: "هذا الشهر",
    presetCustom: "فترة مخصصة",
    ariaDateRange: "الفترة الزمنية",
    ariaCustomStart: "بداية الفترة المخصصة",
    ariaCustomEnd: "نهاية الفترة المخصصة",
    ariaStatusFilter: "التصفية حسب حالة الطلب",
    applyBtn: "تطبيق",
    allStatuses: "كل الحالات",
    statusPendingOpt: "قيد الانتظار",
    statusCompletedOpt: "مكتمل",
    statusCancelledOpt: "ملغى",
    dineInNote: "الطلب من داخل المطعم هو النوع الوحيد المدعوم حاليًا في هذه القائمة، لذا لا يوجد بعد فلتر حسب نوع الطلب.",
    revenueWord: "الإيرادات",
    chartRevenueOverTime: "الإيرادات عبر الزمن",
    chartOrdersOverTime: "الطلبات عبر الزمن",
    chartBestSelling: "المنتجات الأكثر مبيعًا",
    chartTopCategories: "أفضل الفئات",
    chartBusiestHours: "أكثر الساعات ازدحامًا",
    chartStatusDistribution: "توزيع حالات الطلبات",
    kpiTotalOrders: "إجمالي الطلبات",
    kpiTotalRevenue: "إجمالي الإيرادات",
    kpiAvgOrderValue: "متوسط قيمة الطلب",
    noChangeVsPrevious: "لا تغيير مقارنة بالفترة السابقة",
    newVsPrevious: "جديد مقارنة بالفترة السابقة",
    vsPreviousPeriod: "مقارنة بالفترة السابقة",
    pickBothDates: "اختر تاريخ البداية والنهاية.",
    startBeforeEnd: "يجب أن يسبق تاريخ البداية تاريخ النهاية.",
    noRevenuePeriod: "لا إيرادات في هذه الفترة.",
    noOrdersPeriod: "لا طلبات في هذه الفترة.",
    noItemsSoldPeriod: "لم يُباع أي صنف في هذه الفترة.",
    noSalesPeriod: "لا مبيعات في هذه الفترة.",
    soldSuffix: "بيع {n}",
    errCouldNotLoadStats: "تعذّر تحميل الإحصائيات."
  }
};

function t(key, vars) {
  let str = (adminTranslations[state.lang] && adminTranslations[state.lang][key]) || adminTranslations.en[key] || key;
  if (vars) {
    Object.keys(vars).forEach((k) => { str = str.replace(`{${k}}`, vars[k]); });
  }
  return str;
}

function orderStatusLabel(status) { return t(`status_${status}`); }

function applyTranslations() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.setAttribute("title", t(el.getAttribute("data-i18n-title")));
  });
  document.querySelectorAll("[data-i18n-aria]").forEach((el) => {
    el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria")));
  });
  document.title = `Ember Table — ${t("adminTitleSuffix")}`;
}

function loadLangPref() {
  try {
    const raw = localStorage.getItem(ADMIN_LANG_KEY);
    return ["fr", "en", "ar"].includes(raw) ? raw : "en"; // default EN — opt-in, doesn't change behavior for existing staff
  } catch (e) {
    return "en";
  }
}
function saveLangPref(lang) {
  try { localStorage.setItem(ADMIN_LANG_KEY, lang); } catch (e) { /* ignore */ }
}

function updateLangSwitcherUI() {
  document.querySelectorAll("[data-admin-lang]").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.adminLang === state.lang);
  });
}

// Re-renders whatever's currently visible so already-fetched data (orders,
// menu items, stats) reflows in the new language without a full reload.
function rerenderCurrentView() {
  if (state.user) {
    renderAssistanceBanner();
    renderMenuItems();
    renderCategories();
    if (state.view === "orders") renderOrders();
    if (state.view === "stats") loadStats();
  }
}

function setLanguage(lang) {
  if (!["fr", "en", "ar"].includes(lang)) return;
  state.lang = lang;
  document.documentElement.setAttribute("lang", lang);
  document.documentElement.setAttribute("dir", lang === "ar" ? "rtl" : "ltr");
  saveLangPref(lang);
  applyTranslations();
  updateLangSwitcherUI();
  rerenderCurrentView();
}

document.body.addEventListener("click", (e) => {
  const langBtn = e.target.closest("[data-admin-lang]");
  if (langBtn) setLanguage(langBtn.dataset.adminLang);
});

// ---------------------------------------------------------------- API
async function api(method, path, body) {
  const opts = { method, credentials: "include", headers: {} };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, opts);
  let data = null;
  try { data = await res.json(); } catch (e) { /* no body */ }
  if (!res.ok) {
    const err = new Error((data && data.message) || (data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function uploadImage(file) {
  const formData = new FormData();
  formData.append("image", file);
  const res = await fetch("/api/admin/upload", { method: "POST", credentials: "include", body: formData });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || "Upload failed");
  return data.path;
}

// ---------------------------------------------------------------- DOM refs
const loginScreen = document.getElementById("loginScreen");
const appScreen = document.getElementById("appScreen");
const loginForm = document.getElementById("loginForm");
const loginError = document.getElementById("loginError");
const adminNav = document.getElementById("adminNav");
const userLabel = document.getElementById("userLabel");
const logoutBtn = document.getElementById("logoutBtn");
const changePasswordBtn = document.getElementById("changePasswordBtn");
const ordersContainer = document.getElementById("ordersContainer");
const ordersBadge = document.getElementById("ordersBadge");
const newOrderDot = document.getElementById("newOrderDot");
const assistanceBanner = document.getElementById("assistanceBanner");
const ordersEmptyHint = document.getElementById("ordersEmptyHint");
const ordersAutoRefresh = document.getElementById("ordersAutoRefresh");
const statsPresets = document.getElementById("statsPresets");
const statsCustomRange = document.getElementById("statsCustomRange");
const statsCustomStart = document.getElementById("statsCustomStart");
const statsCustomEnd = document.getElementById("statsCustomEnd");
const statsCustomApply = document.getElementById("statsCustomApply");
const statsStatusFilter = document.getElementById("statsStatusFilter");
const statsAutoRefresh = document.getElementById("statsAutoRefresh");
const statsExportBtn = document.getElementById("statsExportBtn");
const statsTodayCard = document.getElementById("statsTodayCard");
const statsKpiGrid = document.getElementById("statsKpiGrid");
const menuItemsContainer = document.getElementById("menuItemsContainer");
const categoriesContainer = document.getElementById("categoriesContainer");
const addDishBtn = document.getElementById("addDishBtn");
const addCategoryBtn = document.getElementById("addCategoryBtn");
const restaurantInfoForm = document.getElementById("restaurantInfoForm");
const infoError = document.getElementById("infoError");
const modalRoot = document.getElementById("modalRoot");
const toastEl = document.getElementById("adminToast");
const soundToggle = document.getElementById("soundToggle");
const autoPrintToggle = document.getElementById("autoPrintToggle");

// Language is applied as early as possible (before checkSession()'s first
// render) so the login screen itself shows in the staff member's saved
// language, not a flash of English.
state.lang = loadLangPref();
document.documentElement.setAttribute("lang", state.lang);
document.documentElement.setAttribute("dir", state.lang === "ar" ? "rtl" : "ltr");
applyTranslations();
updateLangSwitcherUI();

// ---------------------------------------------------------------- Toast
let toastTimer = null;
function showToast(message, isError) {
  toastEl.textContent = message;
  toastEl.classList.toggle("is-error", !!isError);
  toastEl.classList.add("show");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2600);
}

// ---------------------------------------------------------------- Sound
// A short two-tone chime, synthesized with the Web Audio API rather than a
// sampled/licensed audio file — no external asset, and no ambiguity about
// where the sound "came from" since nothing is copied from any other app.
const SOUND_PREF_KEY = "emberTable.admin.soundEnabled";
let audioCtx = null;
function getAudioContext() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}
function playTone(ctx, freq, startTime, duration, gainPeak) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(gainPeak, startTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.02);
}
function playChime() {
  if (!state.soundEnabled) return;
  const ctx = getAudioContext();
  if (ctx.state !== "running") return; // not unlocked by a gesture yet this load — skip silently, never fake success
  const now = ctx.currentTime;
  playTone(ctx, 880, now, 0.18, 0.18);          // A5
  playTone(ctx, 1318.5, now + 0.12, 0.28, 0.16); // E6 — gentle rising "ding-ding"
}
function unlockAudioOnce() {
  const ctx = getAudioContext();
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  document.removeEventListener("click", unlockAudioOnce);
}
document.addEventListener("click", unlockAudioOnce);

function loadSoundPref() {
  try {
    const raw = localStorage.getItem(SOUND_PREF_KEY);
    return raw === null ? true : raw === "true"; // default ON the first time
  } catch (e) {
    return true; // localStorage unavailable — default ON, never throw
  }
}
function saveSoundPref(enabled) {
  try { localStorage.setItem(SOUND_PREF_KEY, String(enabled)); } catch (e) { /* ignore */ }
}
state.soundEnabled = loadSoundPref();
soundToggle.checked = state.soundEnabled;
soundToggle.addEventListener("change", () => {
  state.soundEnabled = soundToggle.checked;
  saveSoundPref(state.soundEnabled);
});

// ---------------------------------------------------------------- Auto-print
const AUTO_PRINT_PREF_KEY = "emberTable.admin.autoPrintEnabled";
function loadAutoPrintPref() {
  try {
    const raw = localStorage.getItem(AUTO_PRINT_PREF_KEY);
    return raw === "true"; // default OFF — opening a print dialog per order is disruptive until the owner opts in
  } catch (e) {
    return false;
  }
}
function saveAutoPrintPref(enabled) {
  try { localStorage.setItem(AUTO_PRINT_PREF_KEY, String(enabled)); } catch (e) { /* ignore */ }
}
state.autoPrintEnabled = loadAutoPrintPref();
autoPrintToggle.checked = state.autoPrintEnabled;
autoPrintToggle.addEventListener("change", () => {
  state.autoPrintEnabled = autoPrintToggle.checked;
  saveAutoPrintPref(state.autoPrintEnabled);
});

// ---------------------------------------------------------------- Modal
function closeModal() { modalRoot.innerHTML = ""; }
function openModal(titleHtml, bodyHtml) {
  modalRoot.innerHTML = `
    <div class="modal-overlay" id="modalOverlay">
      <div class="modal-card" role="dialog" aria-modal="true" aria-label="${titleHtml}">
        <h3>${titleHtml}</h3>
        ${bodyHtml}
      </div>
    </div>
  `;
  document.getElementById("modalOverlay").addEventListener("mousedown", (e) => {
    if (e.target.id === "modalOverlay") closeModal();
  });
}

// ---------------------------------------------------------------- Auth flow
async function checkSession() {
  try {
    state.user = await api("GET", "/auth/me");
    showApp();
  } catch (e) {
    showLogin();
  }
}

function showLogin() {
  loginScreen.hidden = false;
  appScreen.hidden = true;
}

async function showApp() {
  loginScreen.hidden = true;
  appScreen.hidden = false;
  userLabel.textContent = `${state.user.username} · ${state.user.role}`;

  const isOwner = state.user.role === "owner";
  adminNav.querySelectorAll('[data-view="categories"], [data-view="info"], [data-view="stats"]').forEach((btn) => {
    btn.hidden = !isOwner;
  });
  addDishBtn.hidden = !isOwner;
  addCategoryBtn.hidden = !isOwner;

  const ownerOnlyViews = ["categories", "info", "stats"];
  if (!isOwner && ownerOnlyViews.includes(state.view)) setView("orders");
  else setView(state.view);

  if (state.user.mustChangePassword) {
    openChangePasswordModal(true);
  }

  await loadAll();
  await loadOrders();
  await loadAssistanceCalls();
  startOrdersPolling();
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.hidden = true;
  const username = document.getElementById("loginUsername").value.trim();
  const password = document.getElementById("loginPassword").value;
  try {
    state.user = await api("POST", "/auth/login", { username, password });
    loginForm.reset();
    showApp();
  } catch (err) {
    loginError.textContent = err.status === 429 ? t("errLocked") : t("errInvalidCreds");
    loginError.hidden = false;
  }
});

logoutBtn.addEventListener("click", async () => {
  await api("POST", "/auth/logout");
  state.user = null;
  state.lastSeenOrderId = null;
  state.assistanceCalls = [];
  clearAllNewOrderTimers();
  chimedOrderIds.clear();
  stopOrdersPolling();
  stopStatsPolling();
  showLogin();
});

// ---------------------------------------------------------------- Nav
function setView(view) {
  state.view = view;
  document.querySelectorAll(".admin-view").forEach((el) => { el.hidden = el.id !== `view-${view}`; });
  adminNav.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.view === view);
  });
}
adminNav.addEventListener("click", (e) => {
  const btn = e.target.closest(".nav-btn");
  if (!btn || btn.hidden) return;
  setView(btn.dataset.view);
  if (btn.dataset.view === "info") loadRestaurantInfo();
  if (btn.dataset.view === "orders") renderOrders();
  if (btn.dataset.view === "stats") {
    loadStats();
    startStatsPolling();
  } else {
    stopStatsPolling();
  }
});

// ---------------------------------------------------------------- Orders
const ORDER_STAGE_ORDER = ["received", "confirmed", "preparing", "ready", "completed"];
const ORDER_PENDING_STATUSES = new Set(["received", "confirmed", "preparing", "ready"]);
const ORDER_TERMINAL_STATUSES = new Set(["completed", "cancelled", "rejected"]);

function formatOrderTime(isoDatetime) {
  const d = new Date(isoDatetime);
  const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
  if (diffMin < 1) return t("justNow");
  if (diffMin < 60) return t("minAgo", { n: diffMin });
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

async function loadOrders(silent) {
  try {
    const orders = await api("GET", "/admin/orders");
    let newOrdersDetected = false;
    let newOnes = [];
    if (orders.length) {
      const newestId = orders[0].id;
      if (state.lastSeenOrderId !== null && newestId > state.lastSeenOrderId) {
        newOnes = orders.filter((o) => o.id > state.lastSeenOrderId);
        newOrdersDetected = true;
        showToast(newOnes.length === 1 ? t("toastNewOrder") : t("toastNewOrders", { count: newOnes.length }));

        const unchimed = newOnes.filter((o) => !chimedOrderIds.has(o.id));
        if (unchimed.length) {
          playChime(); // one chime per poll tick, not per order
          unchimed.forEach((o) => chimedOrderIds.add(o.id));
        }
        newOnes.forEach((o) => flagOrderAsNew(o.id));
      }
      state.lastSeenOrderId = newestId;
    }
    state.orders = orders;
    if (state.autoPrintEnabled) newOnes.forEach((o) => printOrderTicket(o.id));
    updateOrdersBadge();
    if (newOrdersDetected) bumpOrdersBadge();
    if (state.view === "orders") renderOrders();
  } catch (err) {
    if (!silent) showToast(err.message || t("errCouldNotLoadOrders"), true);
  }
}

function updateNewOrderDot() {
  newOrderDot.hidden = state.newOrderIds.size === 0;
}
function flagOrderAsNew(id) {
  state.newOrderIds.add(id);
  updateNewOrderDot();
  if (newOrderTimers.has(id)) clearTimeout(newOrderTimers.get(id));
  const timer = setTimeout(() => clearNewFlagByTimeout(id), NEW_ORDER_HIGHLIGHT_MS);
  newOrderTimers.set(id, timer);
}
function clearNewFlagByTimeout(id) {
  if (!state.newOrderIds.has(id)) return;
  state.newOrderIds.delete(id);
  newOrderTimers.delete(id);
  updateNewOrderDot();
  if (state.view === "orders") renderOrders();
}
function clearAllNewOrderTimers() {
  newOrderTimers.forEach((timer) => clearTimeout(timer));
  newOrderTimers.clear();
  state.newOrderIds.clear();
  updateNewOrderDot();
}
function dismissNewFlag(id, cardEl) {
  if (!state.newOrderIds.has(id)) return;
  state.newOrderIds.delete(id);
  const timer = newOrderTimers.get(id);
  if (timer) { clearTimeout(timer); newOrderTimers.delete(id); }
  updateNewOrderDot();
  if (cardEl) {
    cardEl.classList.remove("is-new");
    const pill = cardEl.querySelector(".order-new-pill");
    if (pill) pill.remove();
  }
}

function updateOrdersBadge() {
  const count = state.orders.filter((o) => ORDER_PENDING_STATUSES.has(o.status)).length;
  ordersBadge.hidden = count === 0;
  ordersBadge.textContent = String(count);
}
function bumpOrdersBadge() {
  ordersBadge.classList.remove("bump");
  void ordersBadge.offsetWidth; // force reflow so the animation restarts on repeat triggers
  ordersBadge.classList.add("bump");
}

function startOrdersPolling() {
  stopOrdersPolling();
  ordersPollTimer = setInterval(() => {
    if (ordersAutoRefresh.checked) loadOrders(true);
    loadAssistanceCalls(); // always checked — not gated by the Orders auto-refresh toggle, calls are urgent regardless of view
  }, ORDERS_POLL_MS);
}
function stopOrdersPolling() {
  if (ordersPollTimer) { clearInterval(ordersPollTimer); ordersPollTimer = null; }
}

// ---------------------------------------------------------------- Assistance calls
async function loadAssistanceCalls() {
  try {
    const calls = await api("GET", "/admin/assistance-calls");
    const hasNew = calls.some((c) => !state.assistanceCalls.some((existing) => existing.id === c.id));
    state.assistanceCalls = calls;
    renderAssistanceBanner();
    if (hasNew) playChime();
  } catch (err) {
    // silent on poll failures, matches loadOrders(true)'s behavior
  }
}
function renderAssistanceBanner() {
  if (!state.assistanceCalls.length) {
    assistanceBanner.hidden = true;
    assistanceBanner.innerHTML = "";
    return;
  }
  assistanceBanner.hidden = false;
  assistanceBanner.innerHTML = state.assistanceCalls.map((c) => `
    <div class="assistance-call-row">
      <span class="assistance-call-text">${escapeHtml(t("assistanceNeedsHelp", { table: c.table }))}</span>
      <button type="button" class="btn btn-primary btn-small" data-ack="${c.id}">${escapeHtml(t("acknowledge"))}</button>
    </div>
  `).join("");
}
assistanceBanner.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-ack]");
  if (!btn) return;
  btn.disabled = true;
  try {
    await api("PATCH", `/admin/assistance-calls/${btn.dataset.ack}/acknowledge`);
    state.assistanceCalls = state.assistanceCalls.filter((c) => c.id !== btn.dataset.ack);
    renderAssistanceBanner();
  } catch (err) {
    btn.disabled = false;
    showToast(err.message || t("errCouldNotAcknowledge"), true);
  }
});

function miniTrackerHtml(order) {
  if (ORDER_TERMINAL_STATUSES.has(order.status) && order.status !== "completed") {
    // Cancelled/rejected: the status badge already carries the signal (in red);
    // the list view doesn't fetch full history, so the mini-tracker just goes neutral
    // rather than guessing how far the order got. Use "View history" (per-order
    // GET /admin/orders/:id/history) if that detail is ever needed.
    return `<div class="order-mini-tracker is-stopped">
      ${ORDER_STAGE_ORDER.map((s) => `<span class="mini-step is-future" title="${escapeAttr(orderStatusLabel(s))}"></span>`).join("")}
    </div>`;
  }
  const currentIndex = ORDER_STAGE_ORDER.indexOf(order.status);
  return `<div class="order-mini-tracker">
    ${ORDER_STAGE_ORDER.map((s, i) => {
      const cls = order.status === "completed" || i < currentIndex ? "is-done" : i === currentIndex ? "is-active" : "is-future";
      return `<span class="mini-step ${cls}" title="${escapeAttr(orderStatusLabel(s))}"></span>`;
    }).join("")}
  </div>`;
}

function renderOrders() {
  ordersEmptyHint.hidden = state.orders.length !== 0;
  ordersContainer.innerHTML = state.orders.map((order) => {
    const itemsHtml = order.items.map((it) => `<li>${it.qty}× ${escapeHtml(it.name)} — ${it.lineTotal.toFixed(2)} MAD${formatItemOptions(it) ? `<div class="order-item-options">${escapeHtml(formatItemOptions(it))}</div>` : ""}${it.note ? `<div class="order-item-note">📝 ${escapeHtml(it.note)}</div>` : ""}</li>`).join("");
    const isTerminal = ORDER_TERMINAL_STATUSES.has(order.status);
    const nextStage = ORDER_STAGE_ORDER[ORDER_STAGE_ORDER.indexOf(order.status) + 1];
    const isNew = state.newOrderIds.has(order.id);

    let actionsHtml = "";
    if (!isTerminal) {
      const rejectOrCancel = order.status === "received"
        ? `<button type="button" class="btn btn-danger btn-small" data-order-action="rejected" data-id="${order.id}">${escapeHtml(t("reject"))}</button>`
        : `<button type="button" class="btn btn-danger btn-small" data-order-action="cancelled" data-id="${order.id}">${escapeHtml(t("cancel"))}</button>`;
      actionsHtml = `
        <div class="order-note-row">
          <input type="text" class="order-note-input" placeholder="${escapeAttr(t("notePlaceholder"))}" data-note-for="${order.id}" maxlength="500">
        </div>
        <div class="order-actions">
          ${nextStage ? `<button type="button" class="btn btn-primary btn-small" data-order-action="${nextStage}" data-id="${order.id}">${escapeHtml(t("markAsStatus", { status: orderStatusLabel(nextStage) }))}</button>` : ""}
          ${rejectOrCancel}
        </div>
      `;
    }

    return `
      <div class="order-card status-${order.status}${isNew ? " is-new" : ""}" data-id="${order.id}">
        <div class="order-card-head">
          <span class="order-ref">${escapeHtml(order.ref)}</span>
          ${isNew ? `<span class="order-new-pill">${escapeHtml(t("newBadge"))}</span>` : ""}
          <span class="order-table">${escapeHtml(t("tableWord"))} ${escapeHtml(order.table)}</span>
          <span class="order-status-badge status-${order.status}">${escapeHtml(orderStatusLabel(order.status))}</span>
          <span class="order-time">${escapeHtml(formatOrderTime(order.createdAt))}</span>
        </div>
        <ul class="order-items">${itemsHtml}</ul>
        ${miniTrackerHtml(order)}
        <div class="order-card-foot">
          <span class="order-total">${order.total.toFixed(2)} MAD</span>
          <button type="button" class="btn btn-ghost btn-small" data-print-id="${order.id}">${escapeHtml(t("printTicketBtn"))}</button>
        </div>
        ${actionsHtml}
      </div>
    `;
  }).join("");
}

function formatItemOptions(it) {
  if (!it.selectedOptions || !it.selectedOptions.length) return "";
  return it.selectedOptions.map((g) => g.options.map((o) => o.name).join(", ")).join(" · ");
}
function printOrderTicket(id) {
  const order = state.orders.find((o) => o.id === id);
  if (!order) return;
  const itemsHtml = order.items.map((it) => `
    <li>
      <div>${it.qty}× ${escapeHtml(it.name)}</div>
      ${formatItemOptions(it) ? `<div class="ticket-item-options">${escapeHtml(formatItemOptions(it))}</div>` : ""}
      ${it.note ? `<div class="ticket-item-note">${escapeHtml(t("ticketNote", { note: it.note }))}</div>` : ""}
    </li>
  `).join("");
  document.getElementById("printTicket").innerHTML = `
    <div class="ticket-header">
      <h2>Ember Table</h2>
      <div class="ticket-ref">${escapeHtml(order.ref)}</div>
    </div>
    <div class="ticket-meta">
      <div><span>${escapeHtml(t("tableWord"))}</span><span>${escapeHtml(order.table)}</span></div>
      <div><span>${escapeHtml(t("ticketTime"))}</span><span>${new Date(order.createdAt).toLocaleString()}</span></div>
    </div>
    <div class="ticket-divider"></div>
    <ul class="ticket-items">${itemsHtml}</ul>
    <div class="ticket-divider"></div>
    <div class="ticket-total"><span>${escapeHtml(t("ticketTotal"))}</span><span>${order.total.toFixed(2)} MAD</span></div>
    <div class="ticket-footer">${escapeHtml(t("ticketPrinted", { datetime: new Date().toLocaleString() }))}</div>
  `;
  window.print();
}

ordersContainer.addEventListener("click", async (e) => {
  const printBtn = e.target.closest("[data-print-id]");
  if (printBtn) {
    printOrderTicket(printBtn.dataset.printId);
    return;
  }

  const btn = e.target.closest("[data-order-action]");
  if (btn) {
    const id = btn.dataset.id;
    const status = btn.dataset.orderAction;
    const noteInput = ordersContainer.querySelector(`[data-note-for="${id}"]`);
    const note = noteInput ? noteInput.value.trim() : "";
    btn.disabled = true;
    try {
      const updated = await api("PATCH", `/admin/orders/${id}/status`, { status, note });
      const idx = state.orders.findIndex((o) => o.id === updated.id);
      if (idx !== -1) state.orders[idx] = updated;
      updateOrdersBadge();
      renderOrders();
      showToast(t("toastOrderMarked", { status: orderStatusLabel(status) }));
    } catch (err) {
      btn.disabled = false;
      showToast(err.message || t("errCouldNotUpdateOrder"), true);
    }
    return;
  }

  // Any other click inside a specific order card acknowledges/dismisses its "new" highlight.
  const card = e.target.closest(".order-card");
  if (card && card.dataset.id) dismissNewFlag(card.dataset.id, card);
});

// ---------------------------------------------------------------- Change password
function openChangePasswordModal(forced) {
  openModal(t("changePasswordBtn"), `
    <form id="changePasswordForm">
      ${forced ? `<p class="form-hint">${escapeHtml(t("forcedPasswordHint"))}</p>` : ""}
      <div class="form-grid">
        <label class="field"><span>${escapeHtml(t("currentPassword"))}</span><input type="password" id="cpCurrent" required></label>
        <label class="field"><span>${escapeHtml(t("newPasswordMin8"))}</span><input type="password" id="cpNew" minlength="8" required></label>
        <label class="field"><span>${escapeHtml(t("confirmNewPassword"))}</span><input type="password" id="cpConfirm" minlength="8" required></label>
      </div>
      <p class="form-error" id="cpError" hidden></p>
      <div class="modal-actions">
        ${forced ? "" : `<button type="button" class="btn btn-ghost" id="cpCancel">${escapeHtml(t("cancel"))}</button>`}
        <button type="submit" class="btn btn-primary">${escapeHtml(t("saveNewPassword"))}</button>
      </div>
    </form>
  `);
  if (!forced) {
    document.getElementById("cpCancel").addEventListener("click", closeModal);
  }
  document.getElementById("changePasswordForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const cpError = document.getElementById("cpError");
    cpError.hidden = true;
    const currentPassword = document.getElementById("cpCurrent").value;
    const newPassword = document.getElementById("cpNew").value;
    const confirm = document.getElementById("cpConfirm").value;
    if (newPassword !== confirm) {
      cpError.textContent = t("errPasswordsDontMatch");
      cpError.hidden = false;
      return;
    }
    try {
      await api("POST", "/auth/change-password", { currentPassword, newPassword });
      state.user.mustChangePassword = false;
      closeModal();
      showToast(t("toastPasswordUpdated"));
    } catch (err) {
      cpError.textContent = err.message || t("errCouldNotChangePassword");
      cpError.hidden = false;
    }
  });
}
changePasswordBtn.addEventListener("click", () => openChangePasswordModal(false));

// ---------------------------------------------------------------- Load data
async function loadAll() {
  try {
    const [categories, items] = await Promise.all([
      api("GET", "/admin/categories"),
      api("GET", "/admin/menu-items")
    ]);
    state.categories = categories;
    state.items = items;
    renderCategories();
    renderMenuItems();
  } catch (err) {
    showToast(err.message || t("errCouldNotLoadData"), true);
  }
}

function categoryLabel(cat) { return `${cat.label.en} (FR: ${cat.label.fr} / AR: ${cat.label.ar})`; }

// ---------------------------------------------------------------- Render: menu items
function itemThumbHtml(item) {
  if (item.image) {
    return `<div class="item-thumb"><img src="${escapeAttr(item.image)}" alt="" onerror="this.remove()"></div>`;
  }
  return `<div class="item-thumb">ET</div>`;
}

function renderMenuItems() {
  if (!state.user) return;
  const isOwner = state.user.role === "owner";
  menuItemsContainer.innerHTML = "";
  state.categories.forEach((cat) => {
    const itemsInCat = state.items.filter((i) => i.categoryId === cat.id);
    if (itemsInCat.length === 0) return;
    const block = document.createElement("div");
    block.className = "category-block";
    block.innerHTML = `<div class="category-block-title">${escapeHtml(cat.label.en)}</div>`;
    itemsInCat.forEach((item) => {
      const row = document.createElement("div");
      row.className = "item-row" + (isOwner ? "" : " simple");
      const badges = [];
      if (item.featured) badges.push(`<span class="tag tag-featured">${escapeHtml(t("tagFeatured"))}</span>`);
      if (item.recommended) badges.push(`<span class="tag tag-recommended">${escapeHtml(t("tagRecommended"))}</span>`);
      if (item.discountPrice != null) badges.push(`<span class="tag tag-offer">${escapeHtml(t("tagOffer"))}</span>`);
      if (!item.available) badges.push(`<span class="tag tag-unavailable">${escapeHtml(t("tagSoldOut"))}</span>`);

      const priceHtml = item.discountPrice != null
        ? `<span class="old">${item.price.toFixed(2)}</span>${item.discountPrice.toFixed(2)} MAD`
        : `${item.price.toFixed(2)} MAD`;

      row.innerHTML = `
        ${itemThumbHtml(item)}
        <div class="item-main">
          <div class="item-name">${escapeHtml(item.name.en)}</div>
          <div class="item-sub">${escapeHtml(item.name.fr)} · ${escapeHtml(item.name.ar)}</div>
          <div class="item-badges">${badges.join("")}</div>
        </div>
        <div class="item-price">${priceHtml}</div>
        <div class="item-actions">
          <label class="switch" title="${escapeAttr(t("availableTitle"))}">
            <input type="checkbox" data-toggle-id="${item.id}" ${item.available ? "checked" : ""}>
            <span class="track"></span>
          </label>
          ${isOwner ? `
            <button type="button" class="btn btn-ghost btn-icon" data-move="up" data-id="${item.id}" title="${escapeAttr(t("moveUpTitle"))}">↑</button>
            <button type="button" class="btn btn-ghost btn-icon" data-move="down" data-id="${item.id}" title="${escapeAttr(t("moveDownTitle"))}">↓</button>
            <button type="button" class="btn btn-ghost btn-small" data-edit-item="${item.id}">${escapeHtml(t("edit"))}</button>
            <button type="button" class="btn btn-danger btn-small" data-delete-item="${item.id}">${escapeHtml(t("deleteWord"))}</button>
          ` : ""}
        </div>
      `;
      block.appendChild(row);
    });
    menuItemsContainer.appendChild(block);
  });
}

menuItemsContainer.addEventListener("change", async (e) => {
  const toggle = e.target.closest("[data-toggle-id]");
  if (!toggle) return;
  const id = toggle.dataset.toggleId;
  try {
    const updated = await api("PATCH", `/admin/menu-items/${id}/availability`, { available: toggle.checked });
    const item = state.items.find((i) => i.id === id);
    if (item) item.available = updated.available;
    renderMenuItems();
    showToast(updated.available ? t("toastMarkedAvailable") : t("toastMarkedSoldOut"));
  } catch (err) {
    toggle.checked = !toggle.checked;
    showToast(err.message || t("errCouldNotUpdateAvailability"), true);
  }
});

menuItemsContainer.addEventListener("click", async (e) => {
  const editBtn = e.target.closest("[data-edit-item]");
  const delBtn = e.target.closest("[data-delete-item]");
  const moveBtn = e.target.closest("[data-move]");

  if (editBtn) return openDishModal(state.items.find((i) => i.id === editBtn.dataset.editItem));
  if (delBtn) return deleteDish(delBtn.dataset.deleteItem);
  if (moveBtn) {
    try {
      state.items = await api("PUT", `/admin/menu-items/${moveBtn.dataset.id}/move`, { direction: moveBtn.dataset.move });
      renderMenuItems();
    } catch (err) {
      showToast(err.message || t("errCouldNotReorder"), true);
    }
  }
});

async function deleteDish(id) {
  const item = state.items.find((i) => i.id === id);
  if (!item) return;
  if (!confirm(t("confirmDeleteDish", { name: item.name.en }))) return;
  try {
    await api("DELETE", `/admin/menu-items/${id}`);
    state.items = state.items.filter((i) => i.id !== id);
    renderMenuItems();
    showToast(t("toastDishDeleted"));
  } catch (err) {
    showToast(err.message || t("errCouldNotDeleteDish"), true);
  }
}

addDishBtn.addEventListener("click", () => openDishModal(null));

function optionRowHtml(o) {
  return `
    <div class="option-row" data-option-row>
      <input type="text" data-opt="nameEn" placeholder="${escapeAttr(t("optNameEnPh"))}" value="${escapeAttr(o?.name?.en || "")}">
      <input type="text" data-opt="nameFr" placeholder="${escapeAttr(t("optNameFrPh"))}" value="${escapeAttr(o?.name?.fr || "")}">
      <input type="text" data-opt="nameAr" dir="rtl" placeholder="${escapeAttr(t("optNameArPh"))}" value="${escapeAttr(o?.name?.ar || "")}">
      <input type="number" step="0.01" data-opt="priceDelta" placeholder="${escapeAttr(t("optPriceDeltaPh"))}" value="${o && o.priceDelta ? o.priceDelta : ""}">
      <button type="button" class="btn btn-ghost btn-small" data-remove-option title="${escapeAttr(t("removeOptionTitle"))}">×</button>
    </div>
  `;
}
function optionGroupBlockHtml(g) {
  const options = (g && g.options && g.options.length ? g.options : [null]).map(optionRowHtml).join("");
  return `
    <div class="option-group-block" data-group-block>
      <div class="option-group-head">
        <input type="text" data-og="nameEn" placeholder="${escapeAttr(t("grpNameEnPh"))}" value="${escapeAttr(g?.name?.en || "")}">
        <input type="text" data-og="nameFr" placeholder="${escapeAttr(t("grpNameFrPh"))}" value="${escapeAttr(g?.name?.fr || "")}">
        <input type="text" data-og="nameAr" dir="rtl" placeholder="${escapeAttr(t("grpNameArPh"))}" value="${escapeAttr(g?.name?.ar || "")}">
        <select data-og="type">
          <option value="single" ${!g || g.type === "single" ? "selected" : ""}>${escapeHtml(t("pickOne"))}</option>
          <option value="multi" ${g && g.type === "multi" ? "selected" : ""}>${escapeHtml(t("pickAny"))}</option>
        </select>
        <label class="field-check" title="${escapeAttr(t("requiredCheckTitle"))}"><input type="checkbox" data-og="required" ${g?.required ? "checked" : ""}> ${escapeHtml(t("requiredWord"))}</label>
        <button type="button" class="btn btn-danger btn-small" data-remove-group>${escapeHtml(t("removeGroup"))}</button>
      </div>
      <div class="option-list" data-option-list>${options}</div>
      <button type="button" class="btn btn-ghost btn-small" data-add-option>${escapeHtml(t("addOption"))}</button>
    </div>
  `;
}

function openDishModal(item) {
  const isEdit = !!item;
  const categoryOptions = state.categories
    .map((c) => `<option value="${c.id}" ${item && item.categoryId === c.id ? "selected" : ""}>${escapeHtml(categoryLabel(c))}</option>`)
    .join("");

  openModal(isEdit ? t("editDishTitle") : t("addDishTitle"), `
    <form id="dishForm">
      <div class="form-grid">
        <label class="field"><span>${escapeHtml(t("categoryLabel"))}</span>
          <select id="dCategory" required>${categoryOptions}</select>
        </label>

        <div class="field-row">
          <label class="field"><span>${escapeHtml(t("nameEnglish"))}</span><input type="text" id="dNameEn" value="${escapeAttr(item?.name.en || "")}" required></label>
          <label class="field"><span>${escapeHtml(t("nameFrench"))}</span><input type="text" id="dNameFr" value="${escapeAttr(item?.name.fr || "")}" required></label>
          <label class="field"><span>${escapeHtml(t("nameArabic"))}</span><input type="text" id="dNameAr" dir="rtl" value="${escapeAttr(item?.name.ar || "")}" required></label>
        </div>

        <div class="field-row">
          <label class="field"><span>${escapeHtml(t("descEnglish"))}</span><textarea id="dDescEn">${escapeHtml(item?.description.en || "")}</textarea></label>
          <label class="field"><span>${escapeHtml(t("descFrench"))}</span><textarea id="dDescFr">${escapeHtml(item?.description.fr || "")}</textarea></label>
          <label class="field"><span>${escapeHtml(t("descArabic"))}</span><textarea id="dDescAr" dir="rtl">${escapeHtml(item?.description.ar || "")}</textarea></label>
        </div>

        <div class="field-row">
          <label class="field"><span>${escapeHtml(t("priceMad"))}</span><input type="number" step="0.01" min="0" id="dPrice" value="${item ? item.price : ""}" required></label>
          <label class="field"><span>${escapeHtml(t("discountPriceOptional"))}</span><input type="number" step="0.01" min="0" id="dDiscountPrice" value="${item && item.discountPrice != null ? item.discountPrice : ""}"></label>
        </div>

        <label class="field"><span>${escapeHtml(t("photoLabel"))}</span>
          <div class="image-upload-row">
            <div class="image-preview" id="dImagePreview">${item && item.image ? `<img src="${escapeAttr(item.image)}" alt="">` : escapeHtml(t("noPhoto"))}</div>
            <input type="file" id="dImageFile" accept="image/png,image/jpeg,image/webp,image/gif">
          </div>
          <input type="hidden" id="dImagePath" value="${escapeAttr(item?.image || "")}">
        </label>

        <fieldset class="field-group">
          <legend>${escapeHtml(t("dishOptionsLegend"))}</legend>
          <div id="dOptionGroupsContainer">${(item?.optionGroups || []).map(optionGroupBlockHtml).join("")}</div>
          <button type="button" class="btn btn-ghost btn-small" id="addOptionGroupBtn">${escapeHtml(t("addOptionGroup"))}</button>
        </fieldset>

        <div class="field-row">
          <label class="field field-check"><input type="checkbox" id="dFeatured" ${item?.featured ? "checked" : ""}> ${escapeHtml(t("tagFeatured"))}</label>
          <label class="field field-check"><input type="checkbox" id="dRecommended" ${item?.recommended ? "checked" : ""}> ${escapeHtml(t("tagRecommended"))}</label>
          <label class="field field-check"><input type="checkbox" id="dAvailable" ${!item || item.available ? "checked" : ""}> ${escapeHtml(t("availableTitle"))}</label>
        </div>
      </div>
      <p class="form-error" id="dishError" hidden></p>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="dishCancel">${escapeHtml(t("cancel"))}</button>
        <button type="submit" class="btn btn-primary">${isEdit ? escapeHtml(t("saveChanges")) : escapeHtml(t("addDishTitle"))}</button>
      </div>
    </form>
  `);

  document.getElementById("dishCancel").addEventListener("click", closeModal);

  document.getElementById("dImageFile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const preview = document.getElementById("dImagePreview");
    preview.textContent = t("uploadingText");
    try {
      const path = await uploadImage(file);
      document.getElementById("dImagePath").value = path;
      preview.innerHTML = `<img src="${escapeAttr(path)}" alt="">`;
    } catch (err) {
      preview.textContent = t("uploadFailedText");
      showToast(err.message || t("errImageUploadFailed"), true);
    }
  });

  const optionGroupsContainer = document.getElementById("dOptionGroupsContainer");
  document.getElementById("addOptionGroupBtn").addEventListener("click", () => {
    optionGroupsContainer.insertAdjacentHTML("beforeend", optionGroupBlockHtml(null));
  });
  optionGroupsContainer.addEventListener("click", (e) => {
    if (e.target.closest("[data-remove-group]")) {
      e.target.closest("[data-group-block]").remove();
      return;
    }
    if (e.target.closest("[data-add-option]")) {
      e.target.closest("[data-group-block]").querySelector("[data-option-list]").insertAdjacentHTML("beforeend", optionRowHtml(null));
      return;
    }
    if (e.target.closest("[data-remove-option]")) {
      e.target.closest("[data-option-row]").remove();
    }
  });

  document.getElementById("dishForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const dishError = document.getElementById("dishError");
    dishError.hidden = true;
    const discountRaw = document.getElementById("dDiscountPrice").value;
    const payload = {
      categoryId: document.getElementById("dCategory").value,
      nameEn: document.getElementById("dNameEn").value.trim(),
      nameFr: document.getElementById("dNameFr").value.trim(),
      nameAr: document.getElementById("dNameAr").value.trim(),
      descEn: document.getElementById("dDescEn").value.trim(),
      descFr: document.getElementById("dDescFr").value.trim(),
      descAr: document.getElementById("dDescAr").value.trim(),
      price: parseFloat(document.getElementById("dPrice").value),
      discountPrice: discountRaw === "" ? null : parseFloat(discountRaw),
      image: document.getElementById("dImagePath").value || null,
      featured: document.getElementById("dFeatured").checked,
      recommended: document.getElementById("dRecommended").checked,
      available: document.getElementById("dAvailable").checked,
      optionGroups: Array.from(optionGroupsContainer.querySelectorAll("[data-group-block]")).map((block) => ({
        nameEn: block.querySelector('[data-og="nameEn"]').value.trim(),
        nameFr: block.querySelector('[data-og="nameFr"]').value.trim(),
        nameAr: block.querySelector('[data-og="nameAr"]').value.trim(),
        type: block.querySelector('[data-og="type"]').value,
        required: block.querySelector('[data-og="required"]').checked,
        options: Array.from(block.querySelectorAll("[data-option-row]")).map((row) => ({
          nameEn: row.querySelector('[data-opt="nameEn"]').value.trim(),
          nameFr: row.querySelector('[data-opt="nameFr"]').value.trim(),
          nameAr: row.querySelector('[data-opt="nameAr"]').value.trim(),
          priceDelta: parseFloat(row.querySelector('[data-opt="priceDelta"]').value) || 0
        }))
      }))
    };
    try {
      if (isEdit) {
        const updated = await api("PUT", `/admin/menu-items/${item.id}`, payload);
        const idx = state.items.findIndex((i) => i.id === item.id);
        state.items[idx] = updated;
      } else {
        const created = await api("POST", "/admin/menu-items", payload);
        state.items.push(created);
      }
      closeModal();
      renderMenuItems();
      showToast(isEdit ? t("toastDishUpdated") : t("toastDishAdded"));
    } catch (err) {
      dishError.textContent = err.message || t("errCouldNotSaveDish");
      dishError.hidden = false;
    }
  });
}

// ---------------------------------------------------------------- Render: categories
function renderCategories() {
  if (!state.user) return;
  categoriesContainer.innerHTML = "";
  state.categories.forEach((cat) => {
    const row = document.createElement("div");
    row.className = "category-row";
    row.innerHTML = `
      <div class="cat-labels"><b>${escapeHtml(cat.label.en)}</b> <span>FR: ${escapeHtml(cat.label.fr)}</span> <span dir="rtl">AR: ${escapeHtml(cat.label.ar)}</span></div>
      <div class="item-actions">
        <button type="button" class="btn btn-ghost btn-icon" data-cat-move="up" data-id="${cat.id}" title="${escapeAttr(t("moveUpTitle"))}">↑</button>
        <button type="button" class="btn btn-ghost btn-icon" data-cat-move="down" data-id="${cat.id}" title="${escapeAttr(t("moveDownTitle"))}">↓</button>
        <button type="button" class="btn btn-ghost btn-small" data-cat-edit="${cat.id}">${escapeHtml(t("edit"))}</button>
        <button type="button" class="btn btn-danger btn-small" data-cat-delete="${cat.id}">${escapeHtml(t("deleteWord"))}</button>
      </div>
    `;
    categoriesContainer.appendChild(row);
  });
}

categoriesContainer.addEventListener("click", async (e) => {
  const editBtn = e.target.closest("[data-cat-edit]");
  const delBtn = e.target.closest("[data-cat-delete]");
  const moveBtn = e.target.closest("[data-cat-move]");

  if (editBtn) return openCategoryModal(state.categories.find((c) => c.id === editBtn.dataset.catEdit));
  if (moveBtn) {
    try {
      state.categories = await api("PUT", `/admin/categories/${moveBtn.dataset.id}/move`, { direction: moveBtn.dataset.catMove });
      renderCategories();
      renderMenuItems();
    } catch (err) {
      showToast(err.message || t("errCouldNotReorder"), true);
    }
    return;
  }
  if (delBtn) {
    const cat = state.categories.find((c) => c.id === delBtn.dataset.catDelete);
    if (!cat) return;
    if (!confirm(t("confirmDeleteCategory", { name: cat.label.en }))) return;
    try {
      await api("DELETE", `/admin/categories/${cat.id}`);
      state.categories = state.categories.filter((c) => c.id !== cat.id);
      renderCategories();
      showToast(t("toastCategoryDeleted"));
    } catch (err) {
      showToast(err.message || t("errCouldNotDeleteCategory"), true);
    }
  }
});

addCategoryBtn.addEventListener("click", () => openCategoryModal(null));

function openCategoryModal(cat) {
  const isEdit = !!cat;
  openModal(isEdit ? t("editCategoryTitle") : t("addCategoryTitle"), `
    <form id="categoryForm">
      <div class="form-grid">
        <label class="field"><span>${escapeHtml(t("nameEnglish"))}</span><input type="text" id="cNameEn" value="${escapeAttr(cat?.label.en || "")}" required></label>
        <label class="field"><span>${escapeHtml(t("nameFrench"))}</span><input type="text" id="cNameFr" value="${escapeAttr(cat?.label.fr || "")}" required></label>
        <label class="field"><span>${escapeHtml(t("nameArabic"))}</span><input type="text" id="cNameAr" dir="rtl" value="${escapeAttr(cat?.label.ar || "")}" required></label>
      </div>
      <p class="form-error" id="categoryError" hidden></p>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="categoryCancel">${escapeHtml(t("cancel"))}</button>
        <button type="submit" class="btn btn-primary">${isEdit ? escapeHtml(t("saveChanges")) : escapeHtml(t("addCategoryTitle"))}</button>
      </div>
    </form>
  `);
  document.getElementById("categoryCancel").addEventListener("click", closeModal);
  document.getElementById("categoryForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const categoryError = document.getElementById("categoryError");
    categoryError.hidden = true;
    const payload = {
      labelEn: document.getElementById("cNameEn").value.trim(),
      labelFr: document.getElementById("cNameFr").value.trim(),
      labelAr: document.getElementById("cNameAr").value.trim()
    };
    try {
      if (isEdit) {
        const updated = await api("PUT", `/admin/categories/${cat.id}`, payload);
        const idx = state.categories.findIndex((c) => c.id === cat.id);
        state.categories[idx] = updated;
      } else {
        const created = await api("POST", "/admin/categories", payload);
        state.categories.push(created);
      }
      closeModal();
      renderCategories();
      renderMenuItems();
      showToast(isEdit ? t("toastCategoryUpdated") : t("toastCategoryAdded"));
    } catch (err) {
      categoryError.textContent = err.message || t("errCouldNotSaveCategory");
      categoryError.hidden = false;
    }
  });
}

// ---------------------------------------------------------------- Restaurant info
async function loadRestaurantInfo() {
  try {
    const info = await api("GET", "/admin/restaurant-info");
    document.getElementById("infoLogoImagePath").value = info.logoImage || "";
    document.getElementById("infoLogoImagePreview").innerHTML = info.logoImage
      ? `<img src="${escapeAttr(info.logoImage)}" alt="">` : escapeHtml(t("noPhoto"));
    document.getElementById("infoHeroImagePath").value = info.heroImage || "";
    document.getElementById("infoHeroImagePreview").innerHTML = info.heroImage
      ? `<img src="${escapeAttr(info.heroImage)}" alt="">` : escapeHtml(t("noPhoto"));
    document.getElementById("infoWhatsapp").value = info.whatsappNumber;
    document.getElementById("infoPhone").value = info.phone;
    document.getElementById("infoPhoneHref").value = info.phoneHref;
    document.getElementById("infoGoogleMaps").value = info.googleMapsUrl;
    document.getElementById("infoGoogleReview").value = info.googleReviewUrl;
    document.getElementById("infoWebhookUrl").value = info.webhookUrl || "";
    document.getElementById("infoHoursFr").value = info.openingHours.fr;
    document.getElementById("infoHoursEn").value = info.openingHours.en;
    document.getElementById("infoHoursAr").value = info.openingHours.ar;
    document.getElementById("infoAddressFr").value = info.address.fr;
    document.getElementById("infoAddressEn").value = info.address.en;
    document.getElementById("infoAddressAr").value = info.address.ar;
    document.getElementById("infoInstagram").value = info.social.instagram;
    document.getElementById("infoFacebook").value = info.social.facebook;
    document.getElementById("infoTiktok").value = info.social.tiktok;
  } catch (err) {
    showToast(err.message || t("errCouldNotLoadRestaurantInfo"), true);
  }
}

document.getElementById("infoLogoImageFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const preview = document.getElementById("infoLogoImagePreview");
  preview.textContent = t("uploadingText");
  try {
    const path = await uploadImage(file);
    document.getElementById("infoLogoImagePath").value = path;
    preview.innerHTML = `<img src="${escapeAttr(path)}" alt="">`;
  } catch (err) {
    preview.textContent = t("uploadFailedText");
    showToast(err.message || t("errImageUploadFailed"), true);
  }
});

document.getElementById("infoHeroImageFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const preview = document.getElementById("infoHeroImagePreview");
  preview.textContent = t("uploadingText");
  try {
    const path = await uploadImage(file);
    document.getElementById("infoHeroImagePath").value = path;
    preview.innerHTML = `<img src="${escapeAttr(path)}" alt="">`;
  } catch (err) {
    preview.textContent = t("uploadFailedText");
    showToast(err.message || t("errImageUploadFailed"), true);
  }
});

restaurantInfoForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  infoError.hidden = true;
  const payload = {
    logoImage: document.getElementById("infoLogoImagePath").value.trim(),
    heroImage: document.getElementById("infoHeroImagePath").value.trim(),
    whatsappNumber: document.getElementById("infoWhatsapp").value.trim(),
    phone: document.getElementById("infoPhone").value.trim(),
    phoneHref: document.getElementById("infoPhoneHref").value.trim(),
    googleMapsUrl: document.getElementById("infoGoogleMaps").value.trim(),
    googleReviewUrl: document.getElementById("infoGoogleReview").value.trim(),
    webhookUrl: document.getElementById("infoWebhookUrl").value.trim(),
    openingHours: {
      fr: document.getElementById("infoHoursFr").value.trim(),
      en: document.getElementById("infoHoursEn").value.trim(),
      ar: document.getElementById("infoHoursAr").value.trim()
    },
    address: {
      fr: document.getElementById("infoAddressFr").value.trim(),
      en: document.getElementById("infoAddressEn").value.trim(),
      ar: document.getElementById("infoAddressAr").value.trim()
    },
    social: {
      instagram: document.getElementById("infoInstagram").value.trim() || "#",
      facebook: document.getElementById("infoFacebook").value.trim() || "#",
      tiktok: document.getElementById("infoTiktok").value.trim() || "#"
    }
  };
  try {
    await api("PUT", "/admin/restaurant-info", payload);
    showToast(t("toastRestaurantInfoSaved"));
  } catch (err) {
    infoError.textContent = err.message || t("errCouldNotSaveRestaurantInfo");
    infoError.hidden = false;
  }
});

// ---------------------------------------------------------------- Dashboard / Stats
function formatMAD(n) { return `${Number(n).toFixed(2)} MAD`; }
function formatCount(n) { return String(n); }

function computeStatsRange() {
  const now = new Date();
  if (state.statsPreset === "week") {
    const diffToMonday = (now.getDay() + 6) % 7; // Mon=0..Sun=6
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diffToMonday);
    return { start, end: now };
  }
  if (state.statsPreset === "month") {
    return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: now };
  }
  if (state.statsPreset === "custom" && state.statsCustomStart && state.statsCustomEnd) {
    const start = new Date(`${state.statsCustomStart}T00:00:00`);
    const end = new Date(`${state.statsCustomEnd}T00:00:00`);
    end.setDate(end.getDate() + 1); // make the end date inclusive
    return { start, end };
  }
  return { start: new Date(now.getFullYear(), now.getMonth(), now.getDate()), end: now }; // today (also the custom-not-set fallback)
}

function formatDelta(current, previous) {
  if (previous === 0) return current === 0 ? { text: t("noChangeVsPrevious"), cls: "flat" } : { text: t("newVsPrevious"), cls: "up" };
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return { text: t("noChangeVsPrevious"), cls: "flat" };
  return { text: `${pct > 0 ? "+" : ""}${pct}% ${t("vsPreviousPeriod")}`, cls: pct > 0 ? "up" : "down" };
}

function kpiTileHtml(label, value, delta, accentClass) {
  return `
    <div class="kpi-tile ${accentClass || ""}">
      <div class="kpi-label">${escapeHtml(label)}</div>
      <div class="kpi-value">${escapeHtml(String(value))}</div>
      ${delta ? `<div class="kpi-delta ${delta.cls}">${escapeHtml(delta.text)}</div>` : ""}
    </div>
  `;
}

function renderTodayCard(today) {
  statsTodayCard.innerHTML = `
    <span class="pulse-label">${escapeHtml(t("presetToday"))}</span>
    <div class="pulse-stat"><b>${escapeHtml(String(today.totalOrders))}</b><span>${escapeHtml(t("navOrders"))}</span></div>
    <div class="pulse-stat"><b>${escapeHtml(formatMAD(today.revenue))}</b><span>${escapeHtml(t("revenueWord"))}</span></div>
    <div class="pulse-stat"><b>${escapeHtml(String(today.pending))}</b><span>${escapeHtml(t("statusPendingOpt"))}</span></div>
  `;
}

function renderKpiGrid(summary, previous) {
  statsKpiGrid.innerHTML = [
    kpiTileHtml(t("kpiTotalOrders"), summary.totalOrders, formatDelta(summary.totalOrders, previous.totalOrders), "accent-money"),
    kpiTileHtml(t("kpiTotalRevenue"), formatMAD(summary.revenue), formatDelta(summary.revenue, previous.revenue), "accent-money"),
    kpiTileHtml(t("kpiAvgOrderValue"), formatMAD(summary.avgOrderValue), formatDelta(summary.avgOrderValue, previous.avgOrderValue), "accent-money"),
    kpiTileHtml(t("statusPendingOpt"), summary.pending, null, "accent-pending"),
    kpiTileHtml(t("statusCompletedOpt"), summary.completed, null, "accent-completed"),
    kpiTileHtml(t("statusCancelledOpt"), summary.cancelled, null, "accent-cancelled")
  ].join("");
}

// Ranked horizontal bars — best-sellers, top categories, status distribution.
// A single validated brand hue by default; status distribution passes a
// per-row color function instead, since new/completed/cancelled must stay
// visually tied to the same colors already used on the Orders tab. Every row
// always carries a text label, so identity never depends on hue alone.
function renderBarList(container, items, opts) {
  const values = items.map((i) => Number(i[opts.valueKey]) || 0);
  if (!items.length || values.every((v) => v === 0)) {
    container.innerHTML = `<p class="chart-empty">${escapeHtml(opts.emptyText)}</p>`;
    return;
  }
  const max = Math.max(...values, 1);
  container.innerHTML = items.map((item, i) => {
    const value = values[i];
    const color = typeof opts.color === "function" ? opts.color(item) : opts.color;
    const widthPct = Math.max(3, (value / max) * 100);
    const label = String(item[opts.labelKey]);
    return `
      <div class="bar-row">
        <span class="bar-row-label" title="${escapeHtml(label)}">${escapeHtml(label)}</span>
        <div class="bar-row-track"><div class="bar-row-fill" style="width:${widthPct}%; background:${color}"></div></div>
        <span class="bar-row-value">${escapeHtml(opts.formatValue(value))}</span>
      </div>
    `;
  }).join("");
}

// Vertical columns — revenue/orders over time, busiest hours. Labels render
// sparsely for long series (>12 buckets) so they never collide or clip.
function renderColumnChart(container, points, opts) {
  const values = points.map((p) => Number(p[opts.valueKey]) || 0);
  if (!points.length || values.every((v) => v === 0)) {
    container.innerHTML = `<p class="chart-empty">${escapeHtml(opts.emptyText)}</p>`;
    return;
  }
  const max = Math.max(...values, 1);
  const labelEvery = points.length > 12 ? Math.ceil(points.length / 8) : 1;
  const bars = points.map((p, i) => {
    const value = values[i];
    const heightPct = Math.max(2, (value / max) * 100);
    const label = String(p[opts.labelKey]);
    return `<div class="column-bar-wrap" title="${escapeHtml(label)}: ${escapeHtml(opts.formatValue(value))}">
      <div class="column-bar" style="height:${heightPct}%; background:${opts.color}"></div>
    </div>`;
  }).join("");
  const labels = points.map((p, i) => `<span>${i % labelEvery === 0 ? escapeHtml(String(p[opts.labelKey])) : ""}</span>`).join("");
  container.innerHTML = `<div class="column-chart-values">${bars}</div><div class="column-chart-labels">${labels}</div>`;
}

async function loadStats() {
  const { start, end } = computeStatsRange();
  const params = new URLSearchParams({ start: start.toISOString(), end: end.toISOString() });
  if (state.statsStatus) params.set("status", state.statsStatus);
  try {
    const data = await api("GET", `/admin/stats?${params.toString()}`);
    renderTodayCard(data.today);
    renderKpiGrid(data.summary, data.previousSummary);

    renderColumnChart(document.getElementById("chartRevenueTime"), data.revenueOverTime, {
      valueKey: "revenue", labelKey: "label", color: "var(--primary-hover)", formatValue: formatMAD,
      emptyText: t("noRevenuePeriod")
    });
    renderColumnChart(document.getElementById("chartOrdersTime"), data.revenueOverTime, {
      valueKey: "orders", labelKey: "label", color: "var(--primary-hover)", formatValue: formatCount,
      emptyText: t("noOrdersPeriod")
    });
    renderBarList(document.getElementById("chartBestSellers"), data.bestSellers, {
      valueKey: "qty", labelKey: "name", color: "var(--primary-hover)", formatValue: (n) => t("soldSuffix", { n }),
      emptyText: t("noItemsSoldPeriod")
    });
    renderBarList(document.getElementById("chartTopCategories"), data.topCategories, {
      valueKey: "revenue", labelKey: "name", color: "var(--primary-hover)", formatValue: formatMAD,
      emptyText: t("noSalesPeriod")
    });
    renderColumnChart(document.getElementById("chartBusiestHours"), data.busiestHours, {
      valueKey: "orders", labelKey: "label", color: "var(--primary-hover)", formatValue: formatCount,
      emptyText: t("noOrdersPeriod")
    });
    const statusColors = {
      received: "var(--primary-hover)", confirmed: "var(--primary-hover)", preparing: "var(--primary-hover)", ready: "var(--primary-hover)",
      completed: "var(--success)", cancelled: "var(--danger)", rejected: "var(--danger)"
    };
    renderBarList(document.getElementById("chartStatusDistribution"), data.statusDistribution.map((s) => ({ ...s, label: orderStatusLabel(s.status) })), {
      valueKey: "count", labelKey: "label", color: (row) => statusColors[row.status] || "var(--primary-hover)",
      formatValue: formatCount, emptyText: t("noOrdersPeriod")
    });
  } catch (err) {
    showToast(err.message || t("errCouldNotLoadStats"), true);
  }
}

function startStatsPolling() {
  stopStatsPolling();
  statsPollTimer = setInterval(() => { if (statsAutoRefresh.checked) loadStats(); }, STATS_POLL_MS);
}
function stopStatsPolling() {
  if (statsPollTimer) { clearInterval(statsPollTimer); statsPollTimer = null; }
}

statsPresets.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-preset]");
  if (!btn) return;
  state.statsPreset = btn.dataset.preset;
  statsPresets.querySelectorAll("[data-preset]").forEach((b) => b.classList.toggle("is-active", b === btn));
  statsCustomRange.hidden = state.statsPreset !== "custom";
  if (state.statsPreset !== "custom") loadStats();
});
statsCustomApply.addEventListener("click", () => {
  state.statsCustomStart = statsCustomStart.value;
  state.statsCustomEnd = statsCustomEnd.value;
  if (!state.statsCustomStart || !state.statsCustomEnd) {
    showToast(t("pickBothDates"), true);
    return;
  }
  if (state.statsCustomStart > state.statsCustomEnd) {
    showToast(t("startBeforeEnd"), true);
    return;
  }
  loadStats();
});
statsStatusFilter.addEventListener("change", () => {
  state.statsStatus = statsStatusFilter.value;
  loadStats();
});
statsExportBtn.addEventListener("click", () => {
  const { start, end } = computeStatsRange();
  const params = new URLSearchParams({ start: start.toISOString(), end: end.toISOString() });
  if (state.statsStatus) params.set("status", state.statsStatus);
  window.location.href = `/api/admin/stats/export?${params.toString()}`;
});

(function initStatsDefaults() {
  const todayStr = new Date().toISOString().slice(0, 10);
  statsCustomStart.value = todayStr;
  statsCustomEnd.value = todayStr;
})();

// ---------------------------------------------------------------- Utils
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(str) { return escapeHtml(str); }

// ---------------------------------------------------------------- Init
checkSession();
