// scripts/release-stale-tour-holds.js
//
// Migration một-lần: dọn các HotelBooking thuộc dạng "[Tour Hold]" nhưng vẫn
// còn `orderCode` (và các field liên quan: holdExpiresAt, userId, email,
// isTemporaryHold) sót lại từ những lần admin đổi/xoá phòng phân công tour
// bằng UI cũ — phiên bản đó reset thiếu các field này, khiến Tour Hold trông
// "đang có khách" → đơn ở ghép mới không bind được Tour Hold đó nữa.
//
// Cách chạy:
//   node scripts/release-stale-tour-holds.js                → preview (dry run)
//   node scripts/release-stale-tour-holds.js --apply        → thực sự cập nhật
//   node scripts/release-stale-tour-holds.js --apply --segmentId=<id>   → chỉ 1 segment

require("dotenv").config();
const mongoose = require("mongoose");
const databaseConfig = require("../config/database.config");
const HotelBooking = require("../models/hotel-booking.model");

function parseArgs() {
  const args = { apply: false, segmentId: null, hotelId: null };
  for (const a of process.argv.slice(2)) {
    if (a === "--apply") args.apply = true;
    else if (a.startsWith("--segmentId=")) args.segmentId = a.split("=")[1];
    else if (a.startsWith("--hotelId=")) args.hotelId = a.split("=")[1];
  }
  return args;
}

async function main() {
  const args = parseArgs();
  await databaseConfig.connect();
  console.log("✅ Đã kết nối database");

  const filter = {
    tourSegmentId: { $exists: true, $ne: null },
    "guest.fullName": "[Tour Hold]",
    status: { $nin: ["cancelled", "checked_out"] },
    orderCode: { $exists: true, $nin: [null, ""] },
  };
  if (args.segmentId) {
    try {
      filter.tourSegmentId = new mongoose.Types.ObjectId(args.segmentId);
    } catch {
      filter.tourSegmentId = args.segmentId;
    }
  }
  if (args.hotelId) {
    try {
      filter["hotel.hotelId"] = new mongoose.Types.ObjectId(args.hotelId);
    } catch {
      filter["hotel.hotelId"] = args.hotelId;
    }
  }

  const matches = await HotelBooking.find(filter)
    .select("_id code orderCode tourSegmentId hotel.hotelId hotel.name roomTypeId checkIn checkOut")
    .lean();

  console.log(`\n🔍 Tổng số Tour Hold bị dirty: ${matches.length}\n`);

  if (matches.length > 0) {
    const sample = matches.slice(0, 10);
    console.log("Mẫu (tối đa 10):");
    for (const m of sample) {
      console.log(
        `  • ${m.code} | ${m.hotel?.name || "?"} | seg=${m.tourSegmentId} | orderCode=${m.orderCode} | checkIn=${
          m.checkIn ? m.checkIn.toISOString().slice(0, 10) : "?"
        }`
      );
    }
    if (matches.length > 10) console.log(`  ... và ${matches.length - 10} bản ghi khác`);
  }

  if (matches.length === 0) {
    console.log("✅ Không có Tour Hold nào cần dọn.");
    await mongoose.disconnect();
    process.exit(0);
  }

  if (!args.apply) {
    console.log("\n⚠️  Đây là DRY RUN — chưa thay đổi gì.");
    console.log("Chạy lại với cờ --apply để thực sự cập nhật:");
    console.log("    node scripts/release-stale-tour-holds.js --apply");
    await mongoose.disconnect();
    process.exit(0);
  }

  const ids = matches.map((m) => m._id);
  const result = await HotelBooking.updateMany(
    { _id: { $in: ids } },
    {
      $set: {
        "guest.phone": "",
        "guest.email": "",
        isTemporaryHold: false,
      },
      $unset: {
        orderCode: "",
        holdExpiresAt: "",
        userId: "",
      },
    }
  );

  console.log(`\n✅ Đã cập nhật ${result.modifiedCount}/${matches.length} bản ghi.`);
  console.log("Các Tour Hold giờ sạch — đơn ở ghép mới có thể bind vào.");
  await mongoose.disconnect();
  process.exit(0);
}

main().catch(async (err) => {
  console.error("❌ Lỗi:", err);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
