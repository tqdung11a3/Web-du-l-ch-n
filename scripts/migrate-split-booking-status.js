// scripts/migrate-split-booking-status.js
// Script để tách status thành 2 fields: status và paymentStatus

const mongoose = require("mongoose");
require("dotenv").config();

const HotelBooking = require("../models/hotel-booking.model");

async function migrateBookingStatus() {
  try {
    // Kết nối database
    const databaseConfig = require("../config/database.config");
    await databaseConfig.connect();
    console.log("Connected to database");

    // Lấy tất cả bookings
    const bookings = await HotelBooking.find({});
    console.log(`Found ${bookings.length} bookings to migrate`);

    let updatedCount = 0;

    for (const booking of bookings) {
      let needUpdate = false;
      let newStatus = booking.status;
      let newPaymentStatus = booking.paymentStatus;

      // Logic migration:
      // Nếu status hiện tại là "unpaid" hoặc "paid" → chuyển sang paymentStatus
      // và set status = "pending"
      
      if (booking.status === "unpaid") {
        newStatus = "pending";
        newPaymentStatus = "unpaid";
        needUpdate = true;
      } else if (booking.status === "paid") {
        newStatus = "pending";
        newPaymentStatus = "paid";
        needUpdate = true;
      }
      // Nếu status là checked_in, checked_out, cancelled thì giữ nguyên
      // Nếu paymentStatus chưa có thì set = "unpaid"
      else if (!booking.paymentStatus) {
        newPaymentStatus = "unpaid";
        needUpdate = true;
      }

      // Cập nhật nếu cần
      if (needUpdate) {
        booking.status = newStatus;
        booking.paymentStatus = newPaymentStatus;
        
        await booking.save();
        updatedCount++;
        console.log(`Updated booking ${booking.code}: status=${newStatus}, paymentStatus=${newPaymentStatus}`);
      }
    }

    console.log(`\nMigration completed: Updated ${updatedCount} bookings`);
    
    await mongoose.disconnect();
    console.log("Disconnected from database");
  } catch (error) {
    console.error("Migration error:", error);
    process.exit(1);
  }
}

// Chạy migration
migrateBookingStatus();

