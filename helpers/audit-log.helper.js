// helpers/audit-log.helper.js
//
// Helper ghi audit log cho toàn hệ thống (Super Admin, Company Admin, Customer, System).
//
// Cách dùng phổ biến:
//   await auditLogHelper.log(req, {
//     action: "tour.update",
//     resourceType: "Tour",
//     resourceId: tour._id,
//     resourceLabel: tour.name,
//     before: { price: 100 },
//     after: { price: 120 },
//   });
//
// Đối với thao tác của khách (customer) cũng dùng cùng helper — helper tự nhận ra
// actor từ `req.user` (đặt bởi auth middleware phía client) hoặc từ payload.
//
// Đối với cron job/system, truyền `req = null` và cung cấp `actor: { role: "system", name: "Scheduler" }`.

const mongoose = require("mongoose");
const AuditLog = require("../models/audit-log.model");

/* ───────────────────────── Helpers phụ ───────────────────────── */

function isPlainObject(v) {
  return (
    v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)
  );
}

function safeString(v, max = 4000) {
  if (v == null) return "";
  try {
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return s.length > max ? s.slice(0, max) + "…" : s;
  } catch {
    return "";
  }
}

/**
 * So sánh before vs after, chỉ giữ lại field thật sự thay đổi. Hỗ trợ nested 1 cấp.
 * Nếu truyền sẵn `before`/`after` dạng phẳng (đã lọc), hàm chỉ trả lại đúng object đó.
 */
function diffObjects(before, after) {
  if (!isPlainObject(before) || !isPlainObject(after)) {
    return { before: before ?? null, after: after ?? null };
  }
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const b = {};
  const a = {};
  for (const k of keys) {
    const bv = before[k];
    const av = after[k];
    const bvStr = bv instanceof Date ? bv.toISOString() : safeString(bv, 200);
    const avStr = av instanceof Date ? av.toISOString() : safeString(av, 200);
    if (bvStr !== avStr) {
      b[k] = bv === undefined ? null : bv;
      a[k] = av === undefined ? null : av;
    }
  }
  return { before: b, after: a };
}

/**
 * Xác định actor từ request:
 * - req.account  → Admin (có thể là super_admin hoặc company_admin)
 * - req.user     → Customer (AccountUser) ở phía client
 * - info.actor   → gán tay (vd. cho system job)
 */
function detectActor(req, info = {}) {
  if (info.actor && info.actor.role) {
    return {
      actorId: info.actor.id ? toObjectId(info.actor.id) : null,
      actorRef: info.actor.ref || "System",
      actorName: info.actor.name || "Hệ thống",
      actorEmail: info.actor.email || "",
      actorRole: info.actor.role,
      actorCompanyId: info.actor.companyId
        ? toObjectId(info.actor.companyId)
        : null,
      actorIsSuperAdmin: info.actor.role === "super_admin",
    };
  }

  // Super admin override (act-as-company) — actor vẫn là super admin
  if (req && req.overrideContext && req.overrideContext.isSuperAdminOverride) {
    const a = req.overrideContext.actor || req.account || {};
    return {
      actorId: toObjectId(a.id || a._id),
      actorRef: "AccountAdmin",
      actorName: a.fullName || a.email || "Super Admin",
      actorEmail: a.email || "",
      actorRole: "super_admin",
      actorCompanyId: null,
      actorIsSuperAdmin: true,
    };
  }

  if (req && req.account) {
    const a = req.account;
    // Suy luận vai trò:
    //  - isSuperAdmin === true               → super_admin
    //  - có companyId (admin công ty)        → company_admin
    //  - còn lại (AccountUser phía client)   → customer
    const isSuper = !!a.isSuperAdmin;
    const hasCompany = !!a.companyId;
    const role = isSuper
      ? "super_admin"
      : hasCompany
      ? "company_admin"
      : "customer";
    return {
      actorId: toObjectId(a.id || a._id),
      actorRef: role === "customer" ? "AccountUser" : "AccountAdmin",
      actorName: a.fullName || a.email || (role === "customer" ? "Khách" : ""),
      actorEmail: a.email || "",
      actorRole: role,
      actorCompanyId: hasCompany ? toObjectId(a.companyId) : null,
      actorIsSuperAdmin: isSuper,
    };
  }

  if (req && req.user) {
    const u = req.user;
    return {
      actorId: toObjectId(u.id || u._id),
      actorRef: "AccountUser",
      actorName: u.fullName || u.email || "Khách",
      actorEmail: u.email || "",
      actorRole: "customer",
      actorCompanyId: null,
      actorIsSuperAdmin: false,
    };
  }

  // Khách vãng lai (không đăng nhập): với các action dạng `customer.*`
  // vẫn coi là role "customer" và lấy tên/email/SĐT từ metadata/body do
  // controller truyền vào để nhận diện được actor.
  const isCustomerAction =
    typeof info.action === "string" && info.action.startsWith("customer.");
  if (isCustomerAction) {
    const body = (req && req.body) || {};
    const md = info.metadata || {};
    const guestName =
      md.guestName ||
      md.fullName ||
      body.fullName ||
      (body.guest && body.guest.fullName) ||
      "";
    const guestEmail =
      md.guestEmail || md.email || body.email || (body.guest && body.guest.email) || "";
    const guestPhone =
      md.guestPhone || md.phone || body.phone || (body.guest && body.guest.phone) || "";
    const displayName =
      guestName ||
      guestEmail ||
      guestPhone ||
      "Khách vãng lai";
    return {
      actorId: null,
      actorRef: "AccountUser",
      actorName: `${displayName}${guestPhone && guestName ? ` (${guestPhone})` : ""}`,
      actorEmail: guestEmail,
      actorRole: "customer",
      actorCompanyId: null,
      actorIsSuperAdmin: false,
    };
  }

  return {
    actorId: null,
    actorRef: "System",
    actorName: "Hệ thống",
    actorEmail: "",
    actorRole: "system",
    actorCompanyId: null,
    actorIsSuperAdmin: false,
  };
}

function toObjectId(v) {
  if (!v) return null;
  try {
    if (v instanceof mongoose.Types.ObjectId) return v;
    if (mongoose.Types.ObjectId.isValid(String(v))) {
      return new mongoose.Types.ObjectId(String(v));
    }
  } catch {}
  return null;
}

/* ───────────────────────── API chính ───────────────────────── */

/**
 * Ghi audit log. Không bao giờ throw lên.
 *
 * @param {import('express').Request|null} req
 * @param {Object} info
 * @param {string} info.action                ví dụ "tour.update", "order.create"
 * @param {string} [info.resourceType]        "Tour" | "Hotel" | "Order" | ...
 * @param {string|mongoose.Types.ObjectId} [info.resourceId]
 * @param {string} [info.resourceLabel]       tên/code gợi nhớ của resource
 * @param {Object} [info.before]              trạng thái trước (đã lọc)
 * @param {Object} [info.after]               trạng thái sau  (đã lọc)
 * @param {boolean} [info.autoDiff=true]      tự lọc before/after chỉ giữ field khác nhau
 * @param {Object} [info.metadata]            payload phụ (không nên nhét PII)
 * @param {string} [info.summary]             câu mô tả ngắn để hiển thị
 * @param {string} [info.asCompanyId]         khi super admin override
 * @param {Object} [info.actor]               ghi đè actor (system/job)
 */
module.exports.log = async (req, info) => {
  try {
    if (!info || !info.action) return;

    const actor = detectActor(req, info);

    const asCompanyId =
      info.asCompanyId ||
      (req && req.overrideContext && req.overrideContext.actAsCompanyId) ||
      null;

    // before/after
    let before = info.before != null ? info.before : {};
    let after = info.after != null ? info.after : {};
    if (info.autoDiff !== false && isPlainObject(before) && isPlainObject(after)) {
      const diff = diffObjects(before, after);
      before = diff.before;
      after = diff.after;
    }

    const ip =
      (req &&
        (req.ip ||
          (req.headers &&
            (req.headers["x-forwarded-for"] || req.headers["x-real-ip"])))) ||
      "";
    const userAgent =
      (req && req.headers && req.headers["user-agent"]) || "";

    await AuditLog.create({
      ...actor,
      action: info.action,
      resourceType: info.resourceType || "",
      resourceId: info.resourceId ? String(info.resourceId) : "",
      resourceLabel: info.resourceLabel ? String(info.resourceLabel) : "",
      asCompanyId: toObjectId(asCompanyId),
      before: before || {},
      after: after || {},
      metadata: info.metadata || {},
      summary: info.summary ? String(info.summary).slice(0, 500) : "",
      ip: String(ip || ""),
      userAgent: String(userAgent || ""),
    });
  } catch (error) {
    console.error("Audit log error:", error.message);
  }
};

/**
 * Query audit logs (dành cho Super Admin view / tool).
 */
module.exports.query = async ({
  action,
  resourceType,
  actorId,
  actorRole,
  actorCompanyId,
  startDate,
  endDate,
  asCompanyId,
  keyword,
  limit = 50,
  skip = 0,
}) => {
  const filter = {};
  if (action) filter.action = action;
  if (resourceType) filter.resourceType = resourceType;
  if (actorId) filter.actorId = actorId;
  if (actorRole) filter.actorRole = actorRole;
  if (actorCompanyId) filter.actorCompanyId = actorCompanyId;
  if (asCompanyId) filter.asCompanyId = asCompanyId;
  if (startDate || endDate) {
    filter.createdAt = {};
    if (startDate) filter.createdAt.$gte = new Date(startDate);
    if (endDate) filter.createdAt.$lte = new Date(endDate);
  }
  if (keyword) {
    const rx = new RegExp(String(keyword).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [
      { actorName: rx },
      { actorEmail: rx },
      { resourceLabel: rx },
      { resourceId: rx },
      { summary: rx },
    ];
  }
  const total = await AuditLog.countDocuments(filter);
  const items = await AuditLog.find(filter)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();
  return { items, total };
};

/** Tiện ích nội bộ: re-export để chỗ khác dùng nếu cần */
module.exports._utils = { diffObjects, detectActor };
