// scripts/sync-hotels-from-amadeus.js
require("dotenv").config();
const mongoose = require("mongoose");
const moment = require("moment");

const amadeus = require("../amadeusClient");
const Hotel = require("../models/hotel.model");

// ------- CONFIG -------
const MAX_HOTELS_PER_CITY = 10; // tối đa 10 khách sạn / city
const REQUEST_DELAY_MS = 1200; // nghỉ 1.2s giữa các request

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 1) Kết nối Mongo (dùng DATABASE trong .env của bạn)
async function connectMongo() {
  const uri =
    process.env.DATABASE ||
    process.env.MONGO_URL ||
    "mongodb://127.0.0.1:27017/web-du-lich-fixed-dev";

  await mongoose.connect(uri);
  console.log("✅ Connected MongoDB:", uri);
}

// 2) Lấy offers theo cityCode nhưng gọi từng hotelId một
async function fetchCityHotelsFromAmadeus(cityCode) {
  const checkInDate = moment().add(7, "days").format("YYYY-MM-DD");
  const checkOutDate = moment().add(9, "days").format("YYYY-MM-DD");

  // Bước 1: lấy danh sách hotelId theo city
  const listRes = await amadeus.referenceData.locations.hotels.byCity.get({
    cityCode: cityCode.toUpperCase(),
    radius: 20,
    radiusUnit: "KM",
    hotelSource: "ALL",
  });

  let hotelsInCity = listRes.data || [];
  let hotelIds = hotelsInCity.map((h) => h.hotelId).filter(Boolean);

  if (!hotelIds.length) {
    console.log(`⚠️ Không lấy được hotelIds cho city ${cityCode}`);
    return [];
  }

  hotelIds = hotelIds.slice(0, MAX_HOTELS_PER_CITY);
  console.log(
    `👉 City ${cityCode}: thử sync tối đa ${hotelIds.length} khách sạn (gọi từng cái)`
  );

  const allOffers = [];

  // Bước 2: gọi hotelOffersSearch cho từng hotelId
  for (const hid of hotelIds) {
    try {
      const res = await amadeus.shopping.hotelOffersSearch.get({
        hotelIds: hid, // chỉ một hotelId
        checkInDate,
        checkOutDate,
        adults: 2,
      });

      const data = res.data || [];
      if (data.length) {
        allOffers.push(...data);
        console.log(`   ✅ Có ${data.length} offer cho hotelId=${hid}`);
      } else {
        console.log(`   ℹ️ Không có offer cho hotelId=${hid}`);
      }
    } catch (err) {
      const first = Array.isArray(err.description) ? err.description[0] : null;
      const msg =
        first?.detail || first?.title || err.message || "Unknown error";

      console.warn(`   ⚠️ Bỏ qua hotelId=${hid} vì lỗi: ${msg}`);
      // không throw, chỉ skip hotelId này
    }

    // nghỉ 1 chút cho an toàn
    await sleep(REQUEST_DELAY_MS);
  }

  return allOffers;
}

// 3) Map & upsert vào DB
async function syncCity(cityCode) {
  console.log(`\n========== Sync city ${cityCode} ==========`);

  const data = await fetchCityHotelsFromAmadeus(cityCode);
  console.log(`   -> Tổng số item Amadeus trả về: ${data.length}`);

  let count = 0;

  for (const item of data) {
    const hotel = item.hotel || {};
    const offers = item.offers || [];
    const firstOffer = offers[0] || {};
    const price = firstOffer.price || {};

    const amadeusHotelId = hotel.hotelId || hotel.hotelId; // fallback
    if (!amadeusHotelId) {
      console.log("   ⚠️ Bỏ qua item vì không có hotelId");
      continue;
    }

    const addrObj = hotel.address || {};
    const addrLines = Array.isArray(addrObj.lines)
      ? addrObj.lines.join(", ")
      : "";
    const addrCity = addrObj.cityName || "";
    const fullAddress = [addrLines, addrCity, addrObj.countryCode]
      .filter(Boolean)
      .join(", ");

    const thumbnail =
      Array.isArray(hotel.media) && hotel.media[0] && hotel.media[0].uri
        ? hotel.media[0].uri
        : "";

    const basePricePerNight = Number(price.total || 0);

    await Hotel.findOneAndUpdate(
      { amadeusHotelId },
      {
        $set: {
          name: hotel.name || "Không rõ tên",
          cityCode: hotel.cityCode || cityCode.toUpperCase(),
          address: fullAddress,
          rating: hotel.rating ? Number(hotel.rating) : null,
          thumbnail,
          basePricePerNight,
          currency: price.currency || "USD",
          rawData: item,
          lastSyncedAt: new Date(),
          deleted: false,
        },
      },
      { upsert: true, new: true }
    );

    count++;
  }

  console.log(`✅ Synced ${count} hotels for ${cityCode}`);
}

// 4) Main
(async () => {
  try {
    await connectMongo();

    // Dùng các city có data sandbox tốt hơn: Madrid, Paris, New York
    const cities = ["MAD", "PAR", "NYC"];

    for (const code of cities) {
      await syncCity(code);
    }

    console.log("\n🎉 DONE sync hotels from Amadeus");
  } catch (err) {
    console.error("❌ Sync error:", err);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
})();
