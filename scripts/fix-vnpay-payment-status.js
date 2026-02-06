// scripts/fix-vnpay-payment-status.js
// Script để cập nhật paymentStatus cho các booking VNPay đã thanh toán

require('dotenv').config();
const mongoose = require("mongoose");
const HotelBooking = require("../models/hotel-booking.model");

async function fixVNPayPaymentStatus() {
  try {
    // Kết nối database
    await mongoose.connect(process.env.DATABASE);
    console.log("✅ Connected to database");

    // Tìm các booking có paymentMethod = vnpay và paymentStatus = unpaid
    const unpaidVNPayBookings = await HotelBooking.find({
      paymentMethod: "vnpay",
      paymentStatus: "unpaid"
    });

    console.log(`\n📋 Found ${unpaidVNPayBookings.length} unpaid VNPay bookings:\n`);

    for (const booking of unpaidVNPayBookings) {
      console.log(`  - Code: ${booking.code}`);
      console.log(`    Guest: ${booking.guest.fullName} (${booking.guest.phone})`);
      console.log(`    Amount: ${booking.orderTotal} VND`);
      console.log(`    Created: ${booking.createdAt}`);
      console.log(`    Current paymentStatus: ${booking.paymentStatus}\n`);
    }

    // Hỏi xác nhận (trong môi trường thực tế, bạn có thể bỏ qua phần này)
    console.log("⚠️  Nếu các booking này đã thanh toán thành công qua VNPAY:");
    console.log("    Hãy cập nhật paymentStatus thành 'paid' bằng cách:");
    console.log("    1. Uncommment dòng code dưới đây");
    console.log("    2. Chạy lại script\n");

    // Cập nhật tất cả các booking VNPay chưa thanh toán thành đã thanh toán
    const result = await HotelBooking.updateMany(
      { paymentMethod: "vnpay", paymentStatus: "unpaid" },
      { $set: { paymentStatus: "paid" } }
    );
    console.log(`✅ Updated ${result.modifiedCount} bookings to 'paid'`);

    mongoose.connection.close();
  } catch (error) {
    console.error("❌ Error:", error);
    mongoose.connection.close();
    process.exit(1);
  }
}

fixVNPayPaymentStatus();

