// scripts/cleanup-expired-bookings.js
// Script để cleanup các booking tạm thời đã hết hạn
// Chạy định kỳ mỗi 5 phút để đảm bảo TTL index hoạt động đúng

const moment = require("moment");
const HotelBooking = require("../models/hotel-booking.model");

/**
 * Cleanup các booking tạm thời đã hết hạn
 * - isTemporaryHold = true
 * - status = pending
 * - paymentStatus = unpaid
 * - holdExpiresAt < now
 */
async function cleanupExpiredBookings() {
  try {
    const now = new Date();
    console.log(`[cleanup-expired-bookings] Running at ${moment(now).format("YYYY-MM-DD HH:mm:ss")}`);

    // Tìm các booking đã hết hạn
    const expiredBookings = await HotelBooking.find({
      isTemporaryHold: true,
      status: "pending",
      paymentStatus: "unpaid",
      holdExpiresAt: { $lt: now },
    }).lean();

    if (expiredBookings.length === 0) {
      console.log("[cleanup-expired-bookings] No expired bookings found.");
      return { success: true, count: 0 };
    }

    console.log(`[cleanup-expired-bookings] Found ${expiredBookings.length} expired bookings.`);

    // Xóa các booking đã hết hạn
    const result = await HotelBooking.deleteMany({
      isTemporaryHold: true,
      status: "pending",
      paymentStatus: "unpaid",
      holdExpiresAt: { $lt: now },
    });

    console.log(`[cleanup-expired-bookings] Deleted ${result.deletedCount} expired bookings.`);

    // Log chi tiết các booking đã xóa
    expiredBookings.forEach(booking => {
      const expiredAt = moment(booking.holdExpiresAt).format("YYYY-MM-DD HH:mm:ss");
      console.log(`  - Booking ${booking.code} (expired at ${expiredAt})`);
    });

    return { success: true, count: result.deletedCount };
  } catch (error) {
    console.error("[cleanup-expired-bookings] Error:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Chạy script một lần (cho testing)
 */
async function runOnce() {
  console.log("=".repeat(60));
  console.log("CLEANUP EXPIRED BOOKINGS - ONE TIME RUN");
  console.log("=".repeat(60));

  // Kết nối database
  const mongoose = require("mongoose");
  const dbUrl = process.env.MONGO_URL || "mongodb://localhost:27017/travel-booking";
  
  try {
    await mongoose.connect(dbUrl);
    console.log("✓ Connected to database");

    const result = await cleanupExpiredBookings();

    if (result.success) {
      console.log(`✓ Cleanup completed successfully. Deleted ${result.count} booking(s).`);
    } else {
      console.error(`✗ Cleanup failed: ${result.error}`);
    }

    await mongoose.disconnect();
    console.log("✓ Disconnected from database");
  } catch (error) {
    console.error("✗ Database connection error:", error);
    process.exit(1);
  }

  console.log("=".repeat(60));
}

/**
 * Chạy script định kỳ (mỗi 5 phút)
 */
async function runPeriodically() {
  console.log("=".repeat(60));
  console.log("CLEANUP EXPIRED BOOKINGS - PERIODIC MODE");
  console.log("Running every 5 minutes...");
  console.log("=".repeat(60));

  // Kết nối database
  const mongoose = require("mongoose");
  const dbUrl = process.env.MONGO_URL || "mongodb://localhost:27017/travel-booking";
  
  try {
    await mongoose.connect(dbUrl);
    console.log("✓ Connected to database");

    // Chạy ngay lần đầu
    await cleanupExpiredBookings();

    // Chạy định kỳ mỗi 5 phút
    setInterval(async () => {
      await cleanupExpiredBookings();
    }, 5 * 60 * 1000); // 5 phút

    console.log("✓ Periodic cleanup started. Press Ctrl+C to stop.");
  } catch (error) {
    console.error("✗ Database connection error:", error);
    process.exit(1);
  }
}

// Export functions
module.exports = {
  cleanupExpiredBookings,
  runOnce,
  runPeriodically,
};

// Chạy script nếu được gọi trực tiếp
if (require.main === module) {
  const mode = process.argv[2] || "once";

  if (mode === "periodic") {
    runPeriodically();
  } else {
    runOnce().then(() => process.exit(0));
  }
}

