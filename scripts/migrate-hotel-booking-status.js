// scripts/migrate-hotel-booking-status.js
// Script để migrate trạng thái booking từ schema cũ sang schema mới

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
      let newStatus = booking.status;

      // Logic migration:
      // 1. Nếu có paymentStatus = "paid" -> status = "paid"
      // 2. Nếu có paymentStatus = "unpaid" và status = "confirmed" -> status = "unpaid"
      // 3. Nếu có paymentStatus = "unpaid" và status = "pending" -> status = "unpaid"
      // 4. Nếu status = "cancelled" -> giữ nguyên
      
      if (booking.paymentStatus === "paid") {
        newStatus = "paid";
      } else if (booking.paymentStatus === "unpaid") {
        newStatus = "unpaid";
      } else if (booking.status === "confirmed") {
        // Booking đã xác nhận nhưng không có paymentStatus -> coi như chưa thanh toán
        newStatus = "unpaid";
      } else if (booking.status === "pending") {
        // Booking đang chờ -> chưa thanh toán
        newStatus = "unpaid";
      }
      // Nếu status = "cancelled" thì giữ nguyên

      // Cập nhật nếu status thay đổi
      if (newStatus !== booking.status) {
        booking.status = newStatus;
        
        // Xóa field paymentStatus cũ
        booking.paymentStatus = undefined;
        
        await booking.save();
        updatedCount++;
        console.log(`Updated booking ${booking.code}: ${booking.status} -> ${newStatus}`);
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

