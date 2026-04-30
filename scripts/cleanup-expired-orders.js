// scripts/cleanup-expired-orders.js
// Cron job: quét mỗi phút, tìm đơn tour tạm thời đã hết hạn,
// hủy đơn và trả lại ghế cho tour tương ứng.

const moment = require("moment");
const Order = require("../models/order.model");
const Tour  = require("../models/tour.model");
const TourSegment = require("../models/tour-segment.model");
const HotelBooking = require("../models/hotel-booking.model");

/**
 * Release các TH (Tour Hold) HotelBooking đang được gán cho đơn hàng đã hết
 * hạn — đẩy assignment khỏi TourSegment và reset TH về placeholder
 * "[Tour Hold]" để giữ nguyên quota cho tour. Cũng xóa các HotelBooking dạng
 * khách-tự-tạo (HB...) gắn theo orderCode.
 */
async function releaseHotelHoldsForExpiredOrder(order) {
  try {
    // 1) Tìm các segment có assignment thuộc đơn này. Xử lý share cross-order:
    //    nếu TH còn đơn khác đang share → chỉ rebuild note + chuyển primary
    //    sang đơn còn lại; chỉ reset hẳn TH nếu không còn đơn nào dùng.
    const segments = await TourSegment.find({
      "assignments.orderId": order._id,
    })
      .select("_id tourId departureDate endDate assignments")
      .lean();

    for (const seg of segments) {
      const toRelease = (seg.assignments || []).filter(
        (a) => String(a.orderId) === String(order._id)
      );
      const holdBookingIdsAll = toRelease
        .map((a) => a.holdBookingId)
        .filter(Boolean);

      const holdToReset = [];
      const holdToKeep = [];
      for (const thId of holdBookingIdsAll) {
        const remaining = (seg.assignments || []).filter(
          (a) =>
            String(a.holdBookingId || "") === String(thId) &&
            String(a.orderId) !== String(order._id)
        );
        if (remaining.length === 0) holdToReset.push(thId);
        else holdToKeep.push({ thId, remaining });
      }

      await TourSegment.updateOne(
        { _id: seg._id },
        { $pull: { assignments: { orderId: order._id } } }
      );

      if (holdToReset.length) {
        const tourDoc = await Tour.findById(seg.tourId).select("name").lean();
        const tourName = tourDoc?.name || "Tour";
        const depDateFmt = moment(seg.departureDate).format("DD/MM/YYYY");
        const endDateFmt = seg.endDate
          ? moment(seg.endDate).format("DD/MM/YYYY")
          : "—";
        const resetNote = `[Tour Hold] ${tourName} | ${depDateFmt} – ${endDateFmt}`;

        await HotelBooking.updateMany(
          { _id: { $in: holdToReset } },
          {
            $set: {
              "guest.fullName": "[Tour Hold]",
              "guest.phone": "",
              "guest.email": "",
              note: resetNote,
              status: "confirmed",
              isTemporaryHold: false,
            },
            $unset: {
              orderCode: "",
              holdExpiresAt: "",
              userId: "",
            },
          }
        );
      }

      for (const { thId, remaining } of holdToKeep) {
        const sorted = [...remaining].sort((a, b) =>
          String(a.orderCode || "").localeCompare(String(b.orderCode || ""))
        );
        const primary = sorted[0];
        const noteParts = sorted.map((entry) => {
          const labels =
            Array.isArray(entry.atomLabels) && entry.atomLabels.length
              ? entry.atomLabels.join(" || ")
              : entry.guestName || "";
          return `Đơn ${entry.orderCode || "?"}: ${labels}`;
        });
        const newNote = `[Tour Booking - Ở ghép] Share phòng | ${noteParts.join(" || ")}`;
        await HotelBooking.findByIdAndUpdate(thId, {
          $set: {
            "guest.fullName": primary.guestName || "Khách tour",
            "guest.phone": primary.phone || "",
            orderCode: primary.orderCode || "",
            note: newNote,
          },
        });
      }
    }

    // 2) Xóa các HotelBooking khách-tự-tạo (HB...) gắn theo orderCode (lúc
    //    này TH đã bị clear orderCode ở bước 1 → không bị xóa nhầm).
    if (order.code) {
      await HotelBooking.deleteMany({ orderCode: order.code });
    }
  } catch (err) {
    console.error(
      "[cleanup-expired-orders] release hotel holds error:",
      err.message
    );
  }
}

async function cleanupExpiredOrders() {
  try {
    const now = new Date();

    // Tìm đơn tạm đã hết hạn, chưa thanh toán, chưa bị hủy
    const expiredOrders = await Order.find({
      isTemporaryHold: true,
      paymentStatus:   "unpaid",
      status:          { $ne: "cancel" },
      holdExpiresAt:   { $lt: now },
      deleted:         { $ne: true },
    }).lean();

    if (expiredOrders.length === 0) return;

    console.log(
      `[cleanup-expired-orders] ${moment(now).format("HH:mm:ss")} — ` +
      `Tìm thấy ${expiredOrders.length} đơn tour hết hạn, đang xử lý...`
    );

    for (const order of expiredOrders) {
      // ── Khôi phục ghế cho từng tour item ──────────────────────────────────
      for (const item of order.items || []) {
        if (!item.tourId) continue;

        const seatsToRestore =
          Number(item.quantityAdult    || 0) +
          Number(item.quantityChildren || 0) +
          (item.babySeat ? Number(item.quantityBaby || 0) : 0);

        await Tour.updateOne(
          { _id: item.tourId },
          { $inc: { seatsRemaining: seatsToRestore } }
        );
      }

      // ── Release TH bookings + xóa HotelBooking khách-tự-tạo ──────────────
      await releaseHotelHoldsForExpiredOrder(order);

      // ── Đánh dấu đơn là đã hủy ────────────────────────────────────────────
      await Order.updateOne(
        { _id: order._id },
        { status: "cancel", isTemporaryHold: false, holdExpiresAt: null }
      );

      console.log(
        `[cleanup-expired-orders]  → Đã hủy đơn ${order.code} ` +
        `(hết hạn lúc ${moment(order.holdExpiresAt).format("HH:mm:ss")})`
      );
    }
  } catch (err) {
    console.error("[cleanup-expired-orders] Lỗi:", err.message);
  }
}

/**
 * Khởi động scheduler: chạy ngay 1 lần rồi lặp mỗi 60 giây.
 */
function startExpiredOrdersCleanup() {
  cleanupExpiredOrders(); // chạy ngay khi server start
  setInterval(cleanupExpiredOrders, 60 * 1000); // mỗi 1 phút
  console.log("[cleanup-expired-orders] Scheduler đã khởi động (mỗi 60s).");
}

module.exports = { startExpiredOrdersCleanup, cleanupExpiredOrders };
