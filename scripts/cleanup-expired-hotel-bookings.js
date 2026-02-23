// scripts/cleanup-expired-hotel-bookings.js
// Cron job: quét mỗi phút, tìm đặt phòng khách sạn tạm thời đã hết hạn
// và set status = 'cancelled' để trả phòng về pool.
// (Availability của khách sạn được tính động từ các booking không bị cancelled,
//  nên chỉ cần cancelled là phòng tự động được trả lại.)

const moment      = require("moment");
const HotelBooking = require("../models/hotel-booking.model");

async function cleanupExpiredHotelBookings() {
  try {
    const now = new Date();

    const result = await HotelBooking.updateMany(
      {
        isTemporaryHold: true,
        paymentStatus:   "unpaid",
        status:          { $nin: ["cancelled", "checked_out", "checked_in"] },
        holdExpiresAt:   { $lt: now },
      },
      {
        status:          "cancelled",
        isTemporaryHold: false,
        holdExpiresAt:   null,
      }
    );

    if (result.modifiedCount > 0) {
      console.log(
        `[cleanup-expired-hotel-bookings] ${moment(now).format("HH:mm:ss")} ` +
        `— Đã hủy ${result.modifiedCount} booking khách sạn hết hạn.`
      );
    }
  } catch (err) {
    console.error("[cleanup-expired-hotel-bookings] Lỗi:", err.message);
  }
}

function startExpiredHotelBookingsCleanup() {
  cleanupExpiredHotelBookings();
  setInterval(cleanupExpiredHotelBookings, 60 * 1000);
  console.log("[cleanup-expired-hotel-bookings] Scheduler đã khởi động (mỗi 60s).");
}

module.exports = { startExpiredHotelBookingsCleanup, cleanupExpiredHotelBookings };
