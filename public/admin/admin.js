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
  soundEnabled: true // placeholder, overwritten by loadSoundPref() at init
};

const ORDERS_POLL_MS = 3500; // was 8000 — snappier alerts, matches the public tracker's 4000ms cadence
const STATS_POLL_MS = 20000;
const NEW_ORDER_HIGHLIGHT_MS = 20000; // safety-net auto-clear for the "new" highlight if never acknowledged
let ordersPollTimer = null;
let statsPollTimer = null;
const chimedOrderIds = new Set(); // ids already chimed for — never replay
const newOrderTimers = new Map(); // orderId -> setTimeout handle, so it can be cancelled

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
    loginError.textContent = err.status === 429
      ? `Too many attempts. Try again in a bit.`
      : "Incorrect username or password.";
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
const ORDER_STATUS_LABELS = {
  received: "Received", confirmed: "Confirmed", preparing: "Preparing", ready: "Ready",
  completed: "Completed", cancelled: "Cancelled", rejected: "Rejected"
};
const ORDER_PENDING_STATUSES = new Set(["received", "confirmed", "preparing", "ready"]);
const ORDER_TERMINAL_STATUSES = new Set(["completed", "cancelled", "rejected"]);

function formatOrderTime(isoDatetime) {
  const d = new Date(isoDatetime);
  const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

async function loadOrders(silent) {
  try {
    const orders = await api("GET", "/admin/orders");
    let newOrdersDetected = false;
    if (orders.length) {
      const newestId = orders[0].id;
      if (state.lastSeenOrderId !== null && newestId > state.lastSeenOrderId) {
        const newOnes = orders.filter((o) => o.id > state.lastSeenOrderId);
        newOrdersDetected = true;
        showToast(newOnes.length === 1 ? "New order received." : `${newOnes.length} new orders received.`);

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
    updateOrdersBadge();
    if (newOrdersDetected) bumpOrdersBadge();
    if (state.view === "orders") renderOrders();
  } catch (err) {
    if (!silent) showToast(err.message || "Could not load orders.", true);
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
      <span class="assistance-call-text">🔔 Table ${escapeHtml(c.table)} needs assistance</span>
      <button type="button" class="btn btn-primary btn-small" data-ack="${c.id}">Acknowledge</button>
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
    showToast(err.message || "Could not acknowledge.", true);
  }
});

function miniTrackerHtml(order) {
  if (ORDER_TERMINAL_STATUSES.has(order.status) && order.status !== "completed") {
    // Cancelled/rejected: the status badge already carries the signal (in red);
    // the list view doesn't fetch full history, so the mini-tracker just goes neutral
    // rather than guessing how far the order got. Use "View history" (per-order
    // GET /admin/orders/:id/history) if that detail is ever needed.
    return `<div class="order-mini-tracker is-stopped">
      ${ORDER_STAGE_ORDER.map((s) => `<span class="mini-step is-future" title="${ORDER_STATUS_LABELS[s]}"></span>`).join("")}
    </div>`;
  }
  const currentIndex = ORDER_STAGE_ORDER.indexOf(order.status);
  return `<div class="order-mini-tracker">
    ${ORDER_STAGE_ORDER.map((s, i) => {
      const cls = order.status === "completed" || i < currentIndex ? "is-done" : i === currentIndex ? "is-active" : "is-future";
      return `<span class="mini-step ${cls}" title="${ORDER_STATUS_LABELS[s]}"></span>`;
    }).join("")}
  </div>`;
}

function renderOrders() {
  ordersEmptyHint.hidden = state.orders.length !== 0;
  ordersContainer.innerHTML = state.orders.map((order) => {
    const itemsHtml = order.items.map((it) => `<li>${it.qty}× ${escapeHtml(it.name)} — ${it.lineTotal.toFixed(2)} MAD${it.note ? `<div class="order-item-note">📝 ${escapeHtml(it.note)}</div>` : ""}</li>`).join("");
    const isTerminal = ORDER_TERMINAL_STATUSES.has(order.status);
    const nextStage = ORDER_STAGE_ORDER[ORDER_STAGE_ORDER.indexOf(order.status) + 1];
    const isNew = state.newOrderIds.has(order.id);

    let actionsHtml = "";
    if (!isTerminal) {
      const rejectOrCancel = order.status === "received"
        ? `<button type="button" class="btn btn-danger btn-small" data-order-action="rejected" data-id="${order.id}">Reject</button>`
        : `<button type="button" class="btn btn-danger btn-small" data-order-action="cancelled" data-id="${order.id}">Cancel</button>`;
      actionsHtml = `
        <div class="order-note-row">
          <input type="text" class="order-note-input" placeholder="Optional note for this update…" data-note-for="${order.id}" maxlength="500">
        </div>
        <div class="order-actions">
          ${nextStage ? `<button type="button" class="btn btn-primary btn-small" data-order-action="${nextStage}" data-id="${order.id}">Mark as ${ORDER_STATUS_LABELS[nextStage]} →</button>` : ""}
          ${rejectOrCancel}
        </div>
      `;
    }

    return `
      <div class="order-card status-${order.status}${isNew ? " is-new" : ""}" data-id="${order.id}">
        <div class="order-card-head">
          <span class="order-ref">${escapeHtml(order.ref)}</span>
          ${isNew ? '<span class="order-new-pill">New</span>' : ""}
          <span class="order-table">Table ${escapeHtml(order.table)}</span>
          <span class="order-status-badge status-${order.status}">${ORDER_STATUS_LABELS[order.status]}</span>
          <span class="order-time">${formatOrderTime(order.createdAt)}</span>
        </div>
        <ul class="order-items">${itemsHtml}</ul>
        ${miniTrackerHtml(order)}
        <div class="order-card-foot">
          <span class="order-total">${order.total.toFixed(2)} MAD</span>
          <button type="button" class="btn btn-ghost btn-small" data-print-id="${order.id}">🖨️ Print ticket</button>
        </div>
        ${actionsHtml}
      </div>
    `;
  }).join("");
}

function printOrderTicket(id) {
  const order = state.orders.find((o) => o.id === id);
  if (!order) return;
  const itemsHtml = order.items.map((it) => `
    <li>
      <div>${it.qty}× ${escapeHtml(it.name)}</div>
      ${it.note ? `<div class="ticket-item-note">Note: ${escapeHtml(it.note)}</div>` : ""}
    </li>
  `).join("");
  document.getElementById("printTicket").innerHTML = `
    <div class="ticket-header">
      <h2>Ember Table</h2>
      <div class="ticket-ref">${escapeHtml(order.ref)}</div>
    </div>
    <div class="ticket-meta">
      <div><span>Table</span><span>${escapeHtml(order.table)}</span></div>
      <div><span>Time</span><span>${new Date(order.createdAt).toLocaleString()}</span></div>
    </div>
    <div class="ticket-divider"></div>
    <ul class="ticket-items">${itemsHtml}</ul>
    <div class="ticket-divider"></div>
    <div class="ticket-total"><span>Total</span><span>${order.total.toFixed(2)} MAD</span></div>
    <div class="ticket-footer">Printed ${new Date().toLocaleString()}</div>
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
      showToast(`Order marked ${ORDER_STATUS_LABELS[status].toLowerCase()}.`);
    } catch (err) {
      btn.disabled = false;
      showToast(err.message || "Could not update order.", true);
    }
    return;
  }

  // Any other click inside a specific order card acknowledges/dismisses its "new" highlight.
  const card = e.target.closest(".order-card");
  if (card && card.dataset.id) dismissNewFlag(card.dataset.id, card);
});

// ---------------------------------------------------------------- Change password
function openChangePasswordModal(forced) {
  openModal("Change password", `
    <form id="changePasswordForm">
      ${forced ? '<p class="form-hint">This account was created with a temporary password. Please set a new one to continue.</p>' : ""}
      <div class="form-grid">
        <label class="field"><span>Current password</span><input type="password" id="cpCurrent" required></label>
        <label class="field"><span>New password (min. 8 characters)</span><input type="password" id="cpNew" minlength="8" required></label>
        <label class="field"><span>Confirm new password</span><input type="password" id="cpConfirm" minlength="8" required></label>
      </div>
      <p class="form-error" id="cpError" hidden></p>
      <div class="modal-actions">
        ${forced ? "" : '<button type="button" class="btn btn-ghost" id="cpCancel">Cancel</button>'}
        <button type="submit" class="btn btn-primary">Save new password</button>
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
      cpError.textContent = "New passwords don't match.";
      cpError.hidden = false;
      return;
    }
    try {
      await api("POST", "/auth/change-password", { currentPassword, newPassword });
      state.user.mustChangePassword = false;
      closeModal();
      showToast("Password updated.");
    } catch (err) {
      cpError.textContent = err.message || "Could not change password.";
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
    showToast(err.message || "Could not load data.", true);
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
      if (item.featured) badges.push('<span class="tag tag-featured">Featured</span>');
      if (item.recommended) badges.push('<span class="tag tag-recommended">Recommended</span>');
      if (item.discountPrice != null) badges.push('<span class="tag tag-offer">Offer</span>');
      if (!item.available) badges.push('<span class="tag tag-unavailable">Sold out</span>');

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
          <label class="switch" title="Available">
            <input type="checkbox" data-toggle-id="${item.id}" ${item.available ? "checked" : ""}>
            <span class="track"></span>
          </label>
          ${isOwner ? `
            <button type="button" class="btn btn-ghost btn-icon" data-move="up" data-id="${item.id}" title="Move up">↑</button>
            <button type="button" class="btn btn-ghost btn-icon" data-move="down" data-id="${item.id}" title="Move down">↓</button>
            <button type="button" class="btn btn-ghost btn-small" data-edit-item="${item.id}">Edit</button>
            <button type="button" class="btn btn-danger btn-small" data-delete-item="${item.id}">Delete</button>
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
    showToast(updated.available ? "Marked available." : "Marked sold out.");
  } catch (err) {
    toggle.checked = !toggle.checked;
    showToast(err.message || "Could not update availability.", true);
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
      showToast(err.message || "Could not reorder.", true);
    }
  }
});

async function deleteDish(id) {
  const item = state.items.find((i) => i.id === id);
  if (!item) return;
  if (!confirm(`Delete "${item.name.en}"? This cannot be undone.`)) return;
  try {
    await api("DELETE", `/admin/menu-items/${id}`);
    state.items = state.items.filter((i) => i.id !== id);
    renderMenuItems();
    showToast("Dish deleted.");
  } catch (err) {
    showToast(err.message || "Could not delete dish.", true);
  }
}

addDishBtn.addEventListener("click", () => openDishModal(null));

function openDishModal(item) {
  const isEdit = !!item;
  const categoryOptions = state.categories
    .map((c) => `<option value="${c.id}" ${item && item.categoryId === c.id ? "selected" : ""}>${escapeHtml(categoryLabel(c))}</option>`)
    .join("");

  openModal(isEdit ? "Edit dish" : "Add dish", `
    <form id="dishForm">
      <div class="form-grid">
        <label class="field"><span>Category</span>
          <select id="dCategory" required>${categoryOptions}</select>
        </label>

        <div class="field-row">
          <label class="field"><span>Name (English)</span><input type="text" id="dNameEn" value="${escapeAttr(item?.name.en || "")}" required></label>
          <label class="field"><span>Name (French)</span><input type="text" id="dNameFr" value="${escapeAttr(item?.name.fr || "")}" required></label>
          <label class="field"><span>Name (Arabic)</span><input type="text" id="dNameAr" dir="rtl" value="${escapeAttr(item?.name.ar || "")}" required></label>
        </div>

        <div class="field-row">
          <label class="field"><span>Description (English)</span><textarea id="dDescEn">${escapeHtml(item?.description.en || "")}</textarea></label>
          <label class="field"><span>Description (French)</span><textarea id="dDescFr">${escapeHtml(item?.description.fr || "")}</textarea></label>
          <label class="field"><span>Description (Arabic)</span><textarea id="dDescAr" dir="rtl">${escapeHtml(item?.description.ar || "")}</textarea></label>
        </div>

        <div class="field-row">
          <label class="field"><span>Price (MAD)</span><input type="number" step="0.01" min="0" id="dPrice" value="${item ? item.price : ""}" required></label>
          <label class="field"><span>Discount price (optional)</span><input type="number" step="0.01" min="0" id="dDiscountPrice" value="${item && item.discountPrice != null ? item.discountPrice : ""}"></label>
        </div>

        <label class="field"><span>Photo</span>
          <div class="image-upload-row">
            <div class="image-preview" id="dImagePreview">${item && item.image ? `<img src="${escapeAttr(item.image)}" alt="">` : "No photo"}</div>
            <input type="file" id="dImageFile" accept="image/png,image/jpeg,image/webp,image/gif">
          </div>
          <input type="hidden" id="dImagePath" value="${escapeAttr(item?.image || "")}">
        </label>

        <div class="field-row">
          <label class="field field-check"><input type="checkbox" id="dFeatured" ${item?.featured ? "checked" : ""}> Featured</label>
          <label class="field field-check"><input type="checkbox" id="dRecommended" ${item?.recommended ? "checked" : ""}> Recommended</label>
          <label class="field field-check"><input type="checkbox" id="dAvailable" ${!item || item.available ? "checked" : ""}> Available</label>
        </div>
      </div>
      <p class="form-error" id="dishError" hidden></p>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="dishCancel">Cancel</button>
        <button type="submit" class="btn btn-primary">${isEdit ? "Save changes" : "Add dish"}</button>
      </div>
    </form>
  `);

  document.getElementById("dishCancel").addEventListener("click", closeModal);

  document.getElementById("dImageFile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const preview = document.getElementById("dImagePreview");
    preview.textContent = "Uploading…";
    try {
      const path = await uploadImage(file);
      document.getElementById("dImagePath").value = path;
      preview.innerHTML = `<img src="${escapeAttr(path)}" alt="">`;
    } catch (err) {
      preview.textContent = "Upload failed";
      showToast(err.message || "Image upload failed.", true);
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
      available: document.getElementById("dAvailable").checked
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
      showToast(isEdit ? "Dish updated." : "Dish added.");
    } catch (err) {
      dishError.textContent = err.message || "Could not save dish.";
      dishError.hidden = false;
    }
  });
}

// ---------------------------------------------------------------- Render: categories
function renderCategories() {
  categoriesContainer.innerHTML = "";
  state.categories.forEach((cat) => {
    const row = document.createElement("div");
    row.className = "category-row";
    row.innerHTML = `
      <div class="cat-labels"><b>${escapeHtml(cat.label.en)}</b> <span>FR: ${escapeHtml(cat.label.fr)}</span> <span dir="rtl">AR: ${escapeHtml(cat.label.ar)}</span></div>
      <div class="item-actions">
        <button type="button" class="btn btn-ghost btn-icon" data-cat-move="up" data-id="${cat.id}" title="Move up">↑</button>
        <button type="button" class="btn btn-ghost btn-icon" data-cat-move="down" data-id="${cat.id}" title="Move down">↓</button>
        <button type="button" class="btn btn-ghost btn-small" data-cat-edit="${cat.id}">Edit</button>
        <button type="button" class="btn btn-danger btn-small" data-cat-delete="${cat.id}">Delete</button>
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
      showToast(err.message || "Could not reorder.", true);
    }
    return;
  }
  if (delBtn) {
    const cat = state.categories.find((c) => c.id === delBtn.dataset.catDelete);
    if (!cat) return;
    if (!confirm(`Delete category "${cat.label.en}"? It must have no dishes in it.`)) return;
    try {
      await api("DELETE", `/admin/categories/${cat.id}`);
      state.categories = state.categories.filter((c) => c.id !== cat.id);
      renderCategories();
      showToast("Category deleted.");
    } catch (err) {
      showToast(err.message || "Could not delete category.", true);
    }
  }
});

addCategoryBtn.addEventListener("click", () => openCategoryModal(null));

function openCategoryModal(cat) {
  const isEdit = !!cat;
  openModal(isEdit ? "Edit category" : "Add category", `
    <form id="categoryForm">
      <div class="form-grid">
        <label class="field"><span>Name (English)</span><input type="text" id="cNameEn" value="${escapeAttr(cat?.label.en || "")}" required></label>
        <label class="field"><span>Name (French)</span><input type="text" id="cNameFr" value="${escapeAttr(cat?.label.fr || "")}" required></label>
        <label class="field"><span>Name (Arabic)</span><input type="text" id="cNameAr" dir="rtl" value="${escapeAttr(cat?.label.ar || "")}" required></label>
      </div>
      <p class="form-error" id="categoryError" hidden></p>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="categoryCancel">Cancel</button>
        <button type="submit" class="btn btn-primary">${isEdit ? "Save changes" : "Add category"}</button>
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
      showToast(isEdit ? "Category updated." : "Category added.");
    } catch (err) {
      categoryError.textContent = err.message || "Could not save category.";
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
      ? `<img src="${escapeAttr(info.logoImage)}" alt="">` : "No photo";
    document.getElementById("infoHeroImagePath").value = info.heroImage || "";
    document.getElementById("infoHeroImagePreview").innerHTML = info.heroImage
      ? `<img src="${escapeAttr(info.heroImage)}" alt="">` : "No photo";
    document.getElementById("infoWhatsapp").value = info.whatsappNumber;
    document.getElementById("infoPhone").value = info.phone;
    document.getElementById("infoPhoneHref").value = info.phoneHref;
    document.getElementById("infoGoogleMaps").value = info.googleMapsUrl;
    document.getElementById("infoGoogleReview").value = info.googleReviewUrl;
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
    showToast(err.message || "Could not load restaurant info.", true);
  }
}

document.getElementById("infoLogoImageFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const preview = document.getElementById("infoLogoImagePreview");
  preview.textContent = "Uploading…";
  try {
    const path = await uploadImage(file);
    document.getElementById("infoLogoImagePath").value = path;
    preview.innerHTML = `<img src="${escapeAttr(path)}" alt="">`;
  } catch (err) {
    preview.textContent = "Upload failed";
    showToast(err.message || "Image upload failed.", true);
  }
});

document.getElementById("infoHeroImageFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const preview = document.getElementById("infoHeroImagePreview");
  preview.textContent = "Uploading…";
  try {
    const path = await uploadImage(file);
    document.getElementById("infoHeroImagePath").value = path;
    preview.innerHTML = `<img src="${escapeAttr(path)}" alt="">`;
  } catch (err) {
    preview.textContent = "Upload failed";
    showToast(err.message || "Image upload failed.", true);
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
    showToast("Restaurant info saved.");
  } catch (err) {
    infoError.textContent = err.message || "Could not save restaurant info.";
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
  if (previous === 0) return current === 0 ? { text: "No change vs previous period", cls: "flat" } : { text: "New vs previous period", cls: "up" };
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return { text: "No change vs previous period", cls: "flat" };
  return { text: `${pct > 0 ? "+" : ""}${pct}% vs previous period`, cls: pct > 0 ? "up" : "down" };
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
    <span class="pulse-label">Today</span>
    <div class="pulse-stat"><b>${escapeHtml(String(today.totalOrders))}</b><span>Orders</span></div>
    <div class="pulse-stat"><b>${escapeHtml(formatMAD(today.revenue))}</b><span>Revenue</span></div>
    <div class="pulse-stat"><b>${escapeHtml(String(today.pending))}</b><span>Pending</span></div>
  `;
}

function renderKpiGrid(summary, previous) {
  statsKpiGrid.innerHTML = [
    kpiTileHtml("Total orders", summary.totalOrders, formatDelta(summary.totalOrders, previous.totalOrders), "accent-money"),
    kpiTileHtml("Total revenue", formatMAD(summary.revenue), formatDelta(summary.revenue, previous.revenue), "accent-money"),
    kpiTileHtml("Average order value", formatMAD(summary.avgOrderValue), formatDelta(summary.avgOrderValue, previous.avgOrderValue), "accent-money"),
    kpiTileHtml("Pending", summary.pending, null, "accent-pending"),
    kpiTileHtml("Completed", summary.completed, null, "accent-completed"),
    kpiTileHtml("Cancelled", summary.cancelled, null, "accent-cancelled")
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
      emptyText: "No revenue in this period."
    });
    renderColumnChart(document.getElementById("chartOrdersTime"), data.revenueOverTime, {
      valueKey: "orders", labelKey: "label", color: "var(--primary-hover)", formatValue: formatCount,
      emptyText: "No orders in this period."
    });
    renderBarList(document.getElementById("chartBestSellers"), data.bestSellers, {
      valueKey: "qty", labelKey: "name", color: "var(--primary-hover)", formatValue: (n) => `${n} sold`,
      emptyText: "No items sold in this period."
    });
    renderBarList(document.getElementById("chartTopCategories"), data.topCategories, {
      valueKey: "revenue", labelKey: "name", color: "var(--primary-hover)", formatValue: formatMAD,
      emptyText: "No sales in this period."
    });
    renderColumnChart(document.getElementById("chartBusiestHours"), data.busiestHours, {
      valueKey: "orders", labelKey: "label", color: "var(--primary-hover)", formatValue: formatCount,
      emptyText: "No orders in this period."
    });
    const statusColors = {
      received: "var(--primary-hover)", confirmed: "var(--primary-hover)", preparing: "var(--primary-hover)", ready: "var(--primary-hover)",
      completed: "var(--success)", cancelled: "var(--danger)", rejected: "var(--danger)"
    };
    renderBarList(document.getElementById("chartStatusDistribution"), data.statusDistribution, {
      valueKey: "count", labelKey: "label", color: (row) => statusColors[row.status] || "var(--primary-hover)",
      formatValue: formatCount, emptyText: "No orders in this period."
    });
  } catch (err) {
    showToast(err.message || "Could not load statistics.", true);
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
    showToast("Pick both a start and end date.", true);
    return;
  }
  if (state.statsCustomStart > state.statsCustomEnd) {
    showToast("Start date must be before end date.", true);
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
