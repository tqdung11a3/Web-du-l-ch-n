// scripts/syncAmadeusActivities.js
require("dotenv").config();
const databaseConfig = require("../config/database.config");
const amadeus = require("../amadeusClient");
const AmadeusActivity = require("../models/amadeus-activity.model");

// Hàm sync cho 1 thành phố (cityName là tên hiển thị trong bảng cities của bạn)
async function syncActivitiesForCity({
  latitude,
  longitude,
  radius,
  cityName,
}) {
  console.log(`Đang sync activities cho: ${cityName} ...`);

  const response = await amadeus.shopping.activities.get({
    latitude,
    longitude,
    radius, // km
  });

  const activities = response.data || [];

  for (const act of activities) {
    await AmadeusActivity.findOneAndUpdate(
      { amadeusId: act.id },
      {
        amadeusId: act.id,
        name: act.name,
        shortDescription: act.shortDescription,
        latitude: act.geoCode?.latitude,
        longitude: act.geoCode?.longitude,
        cityName, // gắn theo tham số truyền vào
        rating: act.rating ? Number(act.rating) : null,
        priceAmount: act.price ? Number(act.price.amount) : null,
        priceCurrency: act.price ? act.price.currencyCode : null,
        pictureUrl: Array.isArray(act.pictures) ? act.pictures[0] : null,
        bookingLink: act.bookingLink,
        lastSyncedAt: new Date(),
      },
      { upsert: true }
    );
  }

  console.log(`Đã sync xong ${activities.length} activities cho ${cityName}`);
}

async function main() {
  try {
    await databaseConfig.connect();

    // Ví dụ: sync cho 2 thành phố chính (bạn chỉnh lại toạ độ tuỳ ý)
    await syncActivitiesForCity({
      latitude: 21.028, // Hà Nội
      longitude: 105.852,
      radius: 20,
      cityName: "Hà Nội",
    });

    await syncActivitiesForCity({
      latitude: 10.8231, // TP. Hồ Chí Minh
      longitude: 106.6297,
      radius: 20,
      cityName: "TP. Hồ Chí Minh",
    });

    console.log("Hoàn thành sync Amadeus activities.");
    process.exit(0);
  } catch (err) {
    console.error("Lỗi khi sync activities:", err);
    process.exit(1);
  }
}

main();
