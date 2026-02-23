// scripts/cleanup-expired-orders.js
// Cron job: quét mỗi phút, tìm đơn tour tạm thời đã hết hạn,
// hủy đơn và trả lại ghế cho tour tương ứng.

const moment = require("moment");
const Order = require("../models/order.model");
const Tour  = require("../models/tour.model");

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
          {
            $inc: {
              stockAdult:     Number(item.quantityAdult    || 0),
              stockChildren:  Number(item.quantityChildren || 0),
              stockBaby:      Number(item.quantityBaby     || 0),
              seatsRemaining: seatsToRestore,
            },
          }
        );
      }

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
