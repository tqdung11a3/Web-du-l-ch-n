// scripts/update-vnpay-bookings.js
// Script để cập nhật các bookings đã thanh toán VNPay thành công thành status "paid"

const mongoose = require("mongoose");
require("dotenv").config();

const HotelBooking = require("../models/hotel-booking.model");

async function updateVNPayBookings() {
  try {
    // Kết nối database
    const databaseConfig = require("../config/database.config");
    await databaseConfig.connect();
    console.log("Connected to database");

    // Lấy tất cả bookings có paymentMethod = "vnpay" và status = "unpaid"
    const vnpayBookings = await HotelBooking.find({
      paymentMethod: "vnpay",
      status: "unpaid"
    });

    console.log(`Found ${vnpayBookings.length} VNPay bookings with status "unpaid"`);

    if (vnpayBookings.length === 0) {
      console.log("No bookings to update");
      await mongoose.disconnect();
      return;
    }

    console.log("\nBookings found:");
    vnpayBookings.forEach(b => {
      console.log(`  - ${b.code}: ${b.guest?.fullName || 'N/A'} (${b.guest?.phone || 'N/A'})`);
    });

    // Hỏi user có muốn cập nhật không
    console.log("\n⚠️  Những booking này đã thanh toán VNPay thành công chưa?");
    console.log("Nếu đúng, script sẽ cập nhật status thành 'paid'");
    console.log("\nĐể cập nhật tất cả các booking này thành 'paid', hãy chạy lại script với flag --confirm:");
    console.log("node scripts/update-vnpay-bookings.js --confirm");

    // Kiểm tra flag --confirm
    if (process.argv.includes("--confirm")) {
      console.log("\n✓ Đang cập nhật...");
      
      let updatedCount = 0;
      for (const booking of vnpayBookings) {
        booking.status = "paid";
        await booking.save();
        updatedCount++;
        console.log(`  ✓ Updated ${booking.code} to "paid"`);
      }

      console.log(`\n✓ Completed: Updated ${updatedCount} bookings to "paid"`);
    }
    
    await mongoose.disconnect();
    console.log("\nDisconnected from database");
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

// Chạy script
updateVNPayBookings();

