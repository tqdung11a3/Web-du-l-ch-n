// scripts/cleanup-tour-booking-zombies.js
//
// Dọn các HotelBooking "zombie" sinh ra từ placeholder "[Tour Booking]" của đơn
// tour ở riêng. Placeholder này có roomId = null, chỉ dùng để giữ tồn kho tạm
// trong lúc khách chờ thanh toán; sau khi đơn paid/cancel/hết hạn lẽ ra nó phải
// bị XÓA (hoặc TTL tự xóa). Tuy nhiên một số luồng cũ lại set nó thành
// status = "cancelled" + isTemporaryHold = false → record thoát khỏi TTL index
// và kẹt lại vĩnh viễn dưới dạng cancelled + unpaid, gây khó hiểu khi soi DB.
//
// Các record này HOÀN TOÀN trơ về mặt nghiệp vụ: mọi hàm tính phòng trống đều
// loại bỏ booking status "cancelled" → xóa chúng không ảnh hưởng tồn kho.
//
// AN TOÀN:
//   - Chỉ đụng tới HotelBooking thuộc tour (tourSegmentId != null).
//   - Chỉ xóa placeholder (roomId = null / không tồn tại). KHÔNG bao giờ chạm
//     tới Tour Hold đã gán phòng vật lý (roomId != null).
//   - Chỉ xóa record đã "cancelled" (đã trơ). Không đụng record đang active.
//
// CÁCH CHẠY:
//   node scripts/cleanup-tour-booking-zombies.js          # dry-run (chỉ liệt kê)
//   node scripts/cleanup-tour-booking-zombies.js --apply  # thực sự xóa

const mongoose = require("mongoose");
require("dotenv").config();

const HotelBooking = require("../models/hotel-booking.model");

const APPLY = process.argv.includes("--apply");

// Điều kiện xác định 1 zombie placeholder cần dọn.
const ZOMBIE_FILTER = {
  tourSegmentId: { $ne: null },
  roomId: null, // khớp cả null lẫn field không tồn tại
  status: "cancelled",
  note: { $regex: "^\\[Tour Booking", $options: "i" },
};

async function run() {
  try {
    const databaseConfig = require("../config/database.config");
    await databaseConfig.connect();
    console.log("Đã kết nối database");

    const matched = await HotelBooking.find(ZOMBIE_FILTER)
      .select("code orderCode status paymentStatus note createdAt")
      .lean();

    console.log(
      `\nTìm thấy ${matched.length} record zombie [Tour Booking] (cancelled, roomId=null):`
    );
    for (const b of matched) {
      console.log(
        `  - ${b.code} | order ${b.orderCode || "-"} | ${b.status}/${b.paymentStatus} | ${b.note || ""}`
      );
    }

    if (matched.length === 0) {
      console.log("\nKhông có gì để dọn.");
    } else if (!APPLY) {
      console.log(
        `\n[DRY-RUN] Chưa xóa gì. Chạy lại với cờ --apply để xóa ${matched.length} record trên.`
      );
    } else {
      const res = await HotelBooking.deleteMany(ZOMBIE_FILTER);
      console.log(`\nĐã xóa ${res.deletedCount} record zombie.`);
    }

    await mongoose.disconnect();
    console.log("Đã ngắt kết nối database");
  } catch (err) {
    console.error("Lỗi khi dọn zombie:", err);
    process.exit(1);
  }
}

run();
