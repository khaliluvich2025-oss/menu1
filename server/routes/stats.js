const express = require("express");
const db = require("../db");
const { requireOwner } = require("../middleware");
const { ALL_STATUSES, NON_REVENUE_STATUSES } = require("./orders");

const router = express.Router();
const STATUS_LABELS = {
  received: "Received", confirmed: "Confirmed", preparing: "Preparing", ready: "Ready",
  completed: "Completed", cancelled: "Cancelled", rejected: "Rejected"
};
const PENDING_STATUSES = new Set(["received", "confirmed", "preparing", "ready"]);

// This deployment is single-tenant (one `orders`/`menu_items` set per restaurant
// install), so "restaurant-level isolation" is inherent to the deployment model —
// there is no shared multi-tenant table here that would need a restaurant_id scope.

function pad(n) { return String(n).padStart(2, "0"); }
function round2(n) { return Math.round(n * 100) / 100; }

function parseDbDate(s) {
  return new Date(s.includes("T") ? s : `${s.replace(" ", "T")}Z`);
}
function toDbDateString(d) {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

function fetchOrders(rangeStart, rangeEnd, statusFilter) {
  let sql = "SELECT * FROM orders WHERE created_at >= ? AND created_at < ?";
  const params = [toDbDateString(rangeStart), toDbDateString(rangeEnd)];
  if (statusFilter) {
    sql += " AND status = ?";
    params.push(statusFilter);
  }
  sql += " ORDER BY created_at ASC";
  return db.prepare(sql).all(...params).map((row) => ({
    ...row,
    items: JSON.parse(row.items_json),
    createdAtDate: parseDbDate(row.created_at)
  }));
}

function summarize(orders) {
  const revenueEligible = orders.filter((o) => !NON_REVENUE_STATUSES.has(o.status));
  const revenue = round2(revenueEligible.reduce((s, o) => s + o.total, 0));
  return {
    totalOrders: orders.length,
    revenue,
    avgOrderValue: revenueEligible.length ? round2(revenue / revenueEligible.length) : 0,
    pending: orders.filter((o) => PENDING_STATUSES.has(o.status)).length,
    completed: orders.filter((o) => o.status === "completed").length,
    // Cancelled and rejected are combined here into one "didn't happen" tile;
    // the full per-status breakdown still lives in statusDistribution below.
    cancelled: orders.filter((o) => NON_REVENUE_STATUSES.has(o.status)).length
  };
}

function bucketKey(d, hourly) {
  return hourly
    ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:00`
    : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function bucketLabel(d, hourly) {
  return hourly ? `${pad(d.getHours())}:00` : `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
}
function buildBuckets(rangeStart, rangeEnd, hourly) {
  const buckets = [];
  const cur = new Date(rangeStart);
  hourly ? cur.setMinutes(0, 0, 0) : cur.setHours(0, 0, 0, 0);
  while (cur < rangeEnd) {
    buckets.push({ key: bucketKey(cur, hourly), label: bucketLabel(cur, hourly), revenue: 0, orders: 0 });
    hourly ? cur.setHours(cur.getHours() + 1) : cur.setDate(cur.getDate() + 1);
  }
  return buckets;
}

function parseRangeParams(req) {
  const { start, end, status } = req.query;
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (!start || !end || Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || startDate >= endDate) {
    return { error: "Invalid date range." };
  }
  const statusFilter = ALL_STATUSES.includes(status) ? status : null;
  return { startDate, endDate, statusFilter };
}

router.get("/admin/stats", requireOwner, (req, res) => {
  const parsed = parseRangeParams(req);
  if (parsed.error) return res.status(400).json({ error: "invalid_input", message: parsed.error });
  const { startDate, endDate, statusFilter } = parsed;

  const durationMs = endDate.getTime() - startDate.getTime();
  const prevStart = new Date(startDate.getTime() - durationMs);
  const prevEnd = new Date(startDate.getTime());

  const rangeOrdersAll = fetchOrders(startDate, endDate, null);
  const rangeOrdersFiltered = statusFilter ? rangeOrdersAll.filter((o) => o.status === statusFilter) : rangeOrdersAll;
  const previousOrders = fetchOrders(prevStart, prevEnd, statusFilter);

  const summary = summarize(rangeOrdersFiltered);
  const previousSummary = summarize(previousOrders);

  // "Today" is an always-on pulse check, independent of whatever range/status is selected above.
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);
  const today = summarize(fetchOrders(startOfToday, endOfToday, null));

  const bucketHourly = durationMs <= 26 * 60 * 60 * 1000; // ~1 day of slack for "today"
  const buckets = buildBuckets(startDate, endDate, bucketHourly);
  const bucketMap = new Map(buckets.map((b) => [b.key, b]));
  rangeOrdersFiltered.forEach((o) => {
    const b = bucketMap.get(bucketKey(o.createdAtDate, bucketHourly));
    if (!b) return;
    b.orders += 1;
    if (!NON_REVENUE_STATUSES.has(o.status)) b.revenue = round2(b.revenue + o.total);
  });

  const hourCounts = Array.from({ length: 24 }, (_, h) => ({ hour: h, label: `${pad(h)}:00`, orders: 0 }));
  rangeOrdersFiltered.forEach((o) => { hourCounts[o.createdAtDate.getHours()].orders += 1; });

  // Best sellers / top categories reflect what was actually sold — cancelled/rejected excluded.
  const nonCancelled = rangeOrdersFiltered.filter((o) => !NON_REVENUE_STATUSES.has(o.status));
  const itemAgg = new Map();
  const catAgg = new Map();
  const itemCategoryMap = new Map(db.prepare("SELECT id, category_id FROM menu_items").all().map((r) => [r.id, r.category_id]));
  const categoryLabelMap = new Map(db.prepare("SELECT id, label_en FROM categories").all().map((r) => [r.id, r.label_en]));

  nonCancelled.forEach((o) => {
    o.items.forEach((it) => {
      const item = itemAgg.get(it.id) || { id: it.id, name: it.name, qty: 0, revenue: 0 };
      item.qty += it.qty;
      item.revenue = round2(item.revenue + it.lineTotal);
      itemAgg.set(it.id, item);

      const catId = itemCategoryMap.get(it.id) || "unknown";
      const catLabel = categoryLabelMap.get(catId) || "Other";
      const cat = catAgg.get(catId) || { id: catId, name: catLabel, qty: 0, revenue: 0 };
      cat.qty += it.qty;
      cat.revenue = round2(cat.revenue + it.lineTotal);
      catAgg.set(catId, cat);
    });
  });

  const bestSellers = [...itemAgg.values()].sort((a, b) => b.qty - a.qty).slice(0, 10);
  const topCategories = [...catAgg.values()].sort((a, b) => b.revenue - a.revenue);

  // Status distribution always reflects the true breakdown for the date range —
  // it ignores the status filter above (filtering a status-breakdown chart by a
  // single status would make the chart meaningless).
  const statusCounts = {};
  ALL_STATUSES.forEach((s) => { statusCounts[s] = 0; });
  rangeOrdersAll.forEach((o) => { statusCounts[o.status] = (statusCounts[o.status] || 0) + 1; });

  res.json({
    range: { start: startDate.toISOString(), end: endDate.toISOString() },
    previousRange: { start: prevStart.toISOString(), end: prevEnd.toISOString() },
    summary,
    previousSummary,
    today,
    revenueOverTime: buckets.map(({ key, ...rest }) => rest),
    bestSellers,
    topCategories,
    busiestHours: hourCounts,
    statusDistribution: ALL_STATUSES.map((s) => ({ status: s, label: STATUS_LABELS[s], count: statusCounts[s] }))
  });
});

function csvEscape(value) {
  const str = String(value ?? "");
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

router.get("/admin/stats/export", requireOwner, (req, res) => {
  const parsed = parseRangeParams(req);
  if (parsed.error) return res.status(400).json({ error: "invalid_input", message: parsed.error });
  const { startDate, endDate, statusFilter } = parsed;

  const orders = fetchOrders(startDate, endDate, statusFilter);
  const header = ["Order Ref", "Date", "Time", "Table", "Status", "Items", "Total (MAD)"];
  const rows = orders.map((o) => [
    o.ref,
    o.createdAtDate.toLocaleDateString("en-CA"),
    o.createdAtDate.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
    o.table_number,
    o.status,
    o.items.map((i) => `${i.qty}x ${i.name}`).join("; "),
    o.total.toFixed(2)
  ]);
  const csv = [header, ...rows].map((r) => r.map(csvEscape).join(",")).join("\r\n");

  const fname = `ember-table-orders-${startDate.toISOString().slice(0, 10)}-to-${endDate.toISOString().slice(0, 10)}.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
  res.send(`﻿${csv}`);
});

module.exports = router;
