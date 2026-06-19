const mongoose = require("mongoose");
const UserNotification = require("../models/user-notification.model");
const { sendMail } = require("./mail.helper");
const { buildOrderUpdateEmailHtml } = require("./email-templates/customer-order-update.template");
const {
  statusList,
  paymentStatusList,
  paymentMethodList,
} = require("../config/variable.config");

const HOTEL_BOOKING_STATUS_LABELS = {
  pending: "Chờ xác nhận",
  confirmed: "Chưa nhận phòng",
  checked_in: "Đã nhận phòng",
  checked_out: "Đã trả phòng",
  cancelled: "Đã hủy",
};

const GUEST_STATUS_LABELS = {
  confirmed: "Chưa nhận phòng",
  checked_in: "Đã nhận phòng",
  checked_out: "Đã trả phòng",
};

const FIELD_LABELS = {
  status: "Trạng thái đơn",
  paymentStatus: "Thanh toán",
  paymentMethod: "Phương thức thanh toán",
  note: "Ghi chú",
  fullName: "Họ tên",
  phone: "Số điện thoại",
  email: "Email",
  guestStatus: "Trạng thái lưu trú",
};

function getClientBaseUrl() {
  const base =
    process.env.CLIENT_BASE_URL ||
    process.env.BASE_URL ||
    process.env.WEBSITE_URL ||
    "";
  return String(base).replace(/\/$/, "");
}

function toAbsoluteLink(relativeLink) {
  if (!relativeLink) return "";
  if (/^https?:\/\//i.test(relativeLink)) return relativeLink;
  const base = getClientBaseUrl();
  if (!base) return relativeLink;
  return `${base}${relativeLink.startsWith("/") ? "" : "/"}${relativeLink}`;
}

function labelFromList(list, value) {
  if (value == null || value === "") return "—";
  const found = (list || []).find((x) => x.value === value);
  return found ? found.label : String(value);
}

function formatFieldValue(field, value, context = {}) {
  if (value == null || value === "") return "—";
  switch (field) {
    case "status":
      if (context.type === "hotel_booking") {
        return HOTEL_BOOKING_STATUS_LABELS[value] || String(value);
      }
      return labelFromList(statusList, value);
    case "paymentStatus":
      return labelFromList(paymentStatusList, value);
    case "paymentMethod":
      return labelFromList(paymentMethodList, value);
    case "guestStatus":
      return GUEST_STATUS_LABELS[value] || String(value);
    case "note":
      return String(value).trim() || "—";
    default:
      return String(value);
  }
}

/**
 * So sánh before/after và trả về mảng thay đổi.
 * @param {Record<string, unknown>} before
 * @param {Record<string, unknown>} after
 * @param {string[]} fields
 * @param {{ type?: string }} context
 */
function diffChanges(before, after, fields, context = {}) {
  const changes = [];
  for (const field of fields) {
    const fromVal = before?.[field];
    const toVal = after?.[field];
    const fromNorm = fromVal == null ? "" : String(fromVal).trim();
    const toNorm = toVal == null ? "" : String(toVal).trim();
    if (fromNorm === toNorm) continue;
    changes.push({
      field,
      label: FIELD_LABELS[field] || field,
      from: formatFieldValue(field, fromVal, context),
      to: formatFieldValue(field, toVal, context),
    });
  }
  return changes;
}

function buildTourOrderProfileLink(orderCode, status) {
  const tab = status === "cancel" || status === "done" ? "history" : "upcoming";
  const q = orderCode ? `&highlight=${encodeURIComponent(orderCode)}` : "";
  return `/account/profile?tab=${tab}${q}`;
}

function buildHotelBookingProfileLink(bookingCode) {
  const q = bookingCode ? `&highlight=${encodeURIComponent(bookingCode)}` : "";
  return `/account/profile?tab=hotel-bookings${q}`;
}

function buildNotificationContent(changes, resourceLabel) {
  if (!changes.length) {
    return `${resourceLabel} đã được cập nhật.`;
  }
  const lines = changes.map((c) => {
    const hasFrom = c.from != null && c.from !== "" && c.from !== "—";
    return hasFrom
      ? `${c.label}: ${c.from} → ${c.to}`
      : `${c.label}: ${c.to}`;
  });
  return `${resourceLabel} — ${lines.join("; ")}`;
}

function buildEmailSubject(type, resourceLabel) {
  if (type === "hotel_booking") {
    return `Đặt phòng ${resourceLabel} đã được cập nhật`;
  }
  if (type === "room_assignment") {
    return `Đơn ${resourceLabel} — Xếp phòng thành công`;
  }
  if (type === "tour_assignment") {
    return `Cập nhật lưu trú tour — ${resourceLabel}`;
  }
  return `Đơn tour ${resourceLabel} đã được cập nhật`;
}

/**
 * Gửi thông báo in-app (nếu có userId) + email (nếu có email).
 * Không throw — lỗi chỉ log.
 */
async function notifyCustomerOrderUpdate(options) {
  const {
    userId,
    email,
    customerName,
    type,
    tourName,
    resourceLabel,
    orderCode,
    bookingCode,
    orderId,
    link,
    changes = [],
    introLine,
  } = options;

  if (!changes || changes.length === 0) return;

  const tourPrefix = tourName ? `${tourName} — ` : "";
  const title =
    type === "hotel_booking"
      ? `Đặt phòng ${resourceLabel} đã cập nhật`
      : type === "room_assignment"
        ? `Xếp phòng thành công — ${tourPrefix}${resourceLabel}`
        : type === "tour_assignment"
          ? `Lưu trú tour — ${tourPrefix}${resourceLabel}`
          : `Đơn tour ${tourPrefix}${resourceLabel} đã cập nhật`;

  const content = buildNotificationContent(changes, resourceLabel);
  const relativeLink = link || "/account/profile";
  const absoluteLink = toAbsoluteLink(relativeLink);

  try {
    if (userId && mongoose.Types.ObjectId.isValid(String(userId))) {
      await UserNotification.create({
        userId,
        type: type || "tour_order",
        title,
        content,
        link: relativeLink,
        metadata: {
          orderId: orderId || undefined,
          orderCode: orderCode || "",
          bookingCode: bookingCode || "",
          resourceLabel,
          changes,
        },
      });
    }
  } catch (err) {
    console.error("[notifyCustomerOrderUpdate] UserNotification.create:", err);
  }

  const toEmail = email && String(email).trim();
  if (toEmail) {
    try {
      const subject = buildEmailSubject(type, resourceLabel);
      const html = buildOrderUpdateEmailHtml({
        customerName: customerName || "Quý khách",
        orderLabel: resourceLabel,
        introLine,
        changes,
        absoluteLink,
      });
      sendMail(toEmail, subject, html);
    } catch (err) {
      console.error("[notifyCustomerOrderUpdate] sendMail:", err);
    }
  }
}

module.exports = {
  notifyCustomerOrderUpdate,
  diffChanges,
  buildTourOrderProfileLink,
  buildHotelBookingProfileLink,
  HOTEL_BOOKING_STATUS_LABELS,
  GUEST_STATUS_LABELS,
};
