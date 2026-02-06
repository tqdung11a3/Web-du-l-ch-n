// scripts/importAmadeusActivitiesAsTours.js
require("dotenv").config();
const slugify = require("slugify");

const databaseConfig = require("../config/database.config");
const Tour = require("../models/tour.model");
const City = require("../models/city.model");
const AmadeusActivity = require("../models/amadeus-activity.model");

async function main() {
  await databaseConfig.connect();
  console.log("Kết nối CSDL thành công!");

  // 1) Lấy 1 tour mẫu để copy các field bắt buộc
  const baseTour = await Tour.findOne({
    deleted: false,
    status: "active",
  }).lean();

  if (!baseTour) {
    throw new Error(
      "Không tìm thấy tour mẫu (tour active nào) để copy cấu hình!"
    );
  }

  console.log("Dùng tour mẫu:", baseTour.name);

  // 2) Lấy tất cả activity đã sync
  const activities = await AmadeusActivity.find({}).lean();
  console.log(`Có tổng cộng ${activities.length} activities trong DB.`);

  // Đếm số tour hiện có của công ty này để tính position
  let positionBase = await Tour.countDocuments({
    companyId: baseTour.companyId,
  });

  let createdCount = 0;

  for (const act of activities) {
    // 2.1) Tránh tạo trùng: nếu đã có tour cùng tên trong cùng companyId thì bỏ qua
    const existed = await Tour.findOne({
      companyId: baseTour.companyId,
      name: act.name,
    })
      .select("_id")
      .lean();

    if (existed) {
      console.log(`Bỏ qua (đã tồn tại tour tên này): ${act.name}`);
      continue;
    }

    // 2.2) Map cityName -> City._id nếu có
    let locations = [];
    if (act.cityName) {
      const city = await City.findOne({ name: act.cityName })
        .select("_id")
        .lean();
      if (city) {
        locations = [city._id];
      }
    }

    // 2.3) Tính giá (fallback: dùng giá tour mẫu nếu activity không có)
    const fallbackPrice =
      Number(baseTour.priceNewAdult) || Number(baseTour.priceAdult) || 1000000;

    const price = Number(act.priceAmount) || fallbackPrice;

    // 2.4) Ngày khởi hành giả lập: +90 ngày từ hôm nay
    const departureDate = new Date();
    departureDate.setMonth(departureDate.getMonth() + 3);

    // 2.5) Tăng position
    positionBase += 1;

    // 2.6) Tên tour: thêm [Amadeus] để phân biệt → slug sẽ tự sinh từ name
    const tourName =
      (act.name || "Tour từ Amadeus") +
      " [" +
      (act.cityName || "Amadeus") +
      "]";

    const informationHtml =
      `<p>${act.shortDescription || "Hoạt động do đối tác cung cấp."}</p>` +
      (act.bookingLink
        ? `<p><a href="${act.bookingLink}" target="_blank" rel="noopener noreferrer">Xem chi tiết hoạt động gốc</a></p>`
        : "");

    const scheduleHtml =
      `<p>${
        act.shortDescription ||
        "Lịch trình chi tiết sẽ được tư vấn khi đặt tour."
      }</p>` +
      (act.bookingLink
        ? `<p><a href="${act.bookingLink}" target="_blank" rel="noopener noreferrer">Xem mô tả đầy đủ từ đối tác</a></p>`
        : "");

    // 2.7) Tạo đối tượng Tour mới (chỉ dùng field có trong schema)
    const newTour = new Tour({
      // --- đa công ty & phân loại ---
      companyId: baseTour.companyId,
      category: baseTour.category,

      // --- thông tin tour ---
      name: tourName,
      position: positionBase,
      status: "active",
      avatar: act.pictureUrl || baseTour.avatar || "",
      images: act.pictureUrl ? [act.pictureUrl] : baseTour.images || [],

      // Giá cũ / mới
      priceAdult: price,
      priceChildren: price,
      priceBaby: price,
      priceNewAdult: price,
      priceNewChildren: price,
      priceNewBaby: price,

      // Cấu hình em bé & ghế: copy từ tour mẫu
      babyPricingMode: baseTour.babyPricingMode || "fixed",
      babyPricingRules: baseTour.babyPricingRules || [],

      seatsTotal: baseTour.seatsTotal || 30,
      seatsRemaining: baseTour.seatsTotal || 30,

      // Không dùng stockAdult/Children/Baby nữa, để null cũng được
      stockAdult: null,
      stockChildren: null,
      stockBaby: null,

      // Địa điểm & lịch trình
      locations,
      time: baseTour.time || "1 ngày",
      vehicle: baseTour.vehicle || "Tự túc",
      departureDate,
      information: informationHtml,
      schedules: [
        {
          title: "Lịch trình tham khảo",
          description: scheduleHtml,
        },
      ],

      // Rating mặc định
      ratingAvg: 0,
      ratingCount: 0,

      // Audit
      createdBy: baseTour.createdBy || undefined,
      updatedBy: baseTour.updatedBy || undefined,

      // Soft delete
      deleted: false,
    });

    await newTour.save();
    createdCount += 1;
    console.log(`Đã tạo tour mới từ activity: ${act.name}`);
  }

  console.log(`Hoàn thành import. Đã tạo thêm ${createdCount} tour mới.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Lỗi khi import Amadeus activities thành tours:", err);
  process.exit(1);
});
