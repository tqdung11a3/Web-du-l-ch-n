// controllers/client/home.controller.js
const mongoose = require("mongoose");
const Tour = require("../../models/tour.model");
const Category = require("../../models/category.model");
const Company = require("../../models/company.model");
const Review = require("../../models/review.model");
const Order = require("../../models/order.model");
const City = require("../../models/city.model");
const News = require("../../models/news.model"); // Thêm model News
const Hotel = require("../../models/hotel.model");
const moment = require("moment");
const categoryHelper = require("../../helpers/category.helper");

// Helper: gắn ratingAvg + ratingCount vào mảng tours
async function attachRatings(tours) {
  if (!Array.isArray(tours) || tours.length === 0) return tours;

  const ids = tours
    .map((t) => t && (t._id || t.id))
    .filter(Boolean)
    .map((id) => new mongoose.Types.ObjectId(String(id)));

  if (ids.length === 0) return tours;

  const stats = await Review.aggregate([
    { $match: { deleted: false, tourId: { $in: ids } } },
    {
      $group: {
        _id: "$tourId",
        count: { $sum: 1 },
        avg: { $avg: "$rating" },
      },
    },
  ]);

  const map = Object.fromEntries(
    stats.map((s) => [String(s._id), { count: s.count, avg: s.avg }])
  );

  tours.forEach((t) => {
    const key = String(t._id || t.id);
    const st = map[key];
    t.ratingAvg = st ? st.avg : 0;
    t.ratingCount = st ? st.count : 0;
  });

  return tours;
}

// Helper: gắn tên điểm khởi hành (departureCityName) cho mảng tours
async function attachDepartureCities(tours) {
  if (!Array.isArray(tours) || tours.length === 0) return tours;

  const ids = Array.from(
    new Set(
      tours
        .map((t) => (t && t.departureCity ? String(t.departureCity) : ""))
        .filter((id) => id && mongoose.Types.ObjectId.isValid(id))
    )
  ).map((id) => new mongoose.Types.ObjectId(id));

  if (!ids.length) return tours;

  const cities = await City.find({ _id: { $in: ids } })
    .select("name")
    .lean();

  const cmap = new Map(cities.map((c) => [String(c._id), c.name]));

  tours.forEach((t) => {
    const cid = t && t.departureCity ? String(t.departureCity) : "";
    if (cid && cmap.has(cid)) {
      t.departureCityName = cmap.get(cid);
    }
  });

  return tours;
}

module.exports.home = async (req, res) => {
  // ====== SECTION 2: TOUR GIỜ CHÓT (TOP 10 TOUR ĐANG GIẢM GIÁ) ======
  const nowMoment = moment();
  const now = nowMoment.toDate();

  let tourListSection2 = await Tour.find({
    deleted: false,
    status: "active",

    discountFrom: { $ne: null, $lte: now },
    discountTo: { $ne: null, $gte: now },

    $or: [
      { discountPercent: { $gt: 0 } },
      {
        $or: [
          { priceAdult: { $gt: 0 } },
          { priceChildren: { $gt: 0 } },
          { priceBaby: { $gt: 0 } },
        ],
      },
    ],
  })
    .sort({ discountTo: 1, discountFrom: -1, updatedAt: -1 })
    .limit(10)
    .lean();

  // --- enrich tour section 2 ---
  for (const t of tourListSection2) {
    const oldP = Number(t.priceAdult || 0);
    const newP = Number(t.priceNewAdult || 0);

    t.discount =
      t.discountPercent && t.discountPercent > 0
        ? t.discountPercent
        : oldP > 0
        ? Math.floor(((oldP - newP) / oldP) * 100)
        : 0;

    if (t.departureDate) {
      t.departureDateFormat = moment(t.departureDate).format("DD/MM/YYYY");
    }

    if (t.discountFrom) {
      t.discountFromFormat = moment(t.discountFrom).format("DD/MM/YYYY");
    }
    if (t.discountTo) {
      t.discountToFormat = moment(t.discountTo).format("DD/MM/YYYY");
      t.discountExpireISO = moment(t.discountTo).endOf("day").toISOString();
    }

    t.seatsRemaining = Number(t.seatsRemaining) || 0;

    t.departuresWithSeats =
      Array.isArray(t.departures) && t.departures.length > 0
        ? t.departures
            .filter((d) => d && d.departureDate)
            .map((d) => ({
              dateFormatted: moment(d.departureDate).format("DD/MM/YYYY"),
              seatsTotal: d.seatsTotal ?? 0,
              seatsRemaining: d.seatsRemaining ?? 0,
            }))
        : [];
  }

  // Ghép công ty cho Section 2
  const rawIds = tourListSection2.map((t) => t.companyId);
  const companyIds = [
    ...new Set(
      rawIds.filter((id) => id && mongoose.Types.ObjectId.isValid(id))
    ),
  ];

  let companyById = {};
  if (companyIds.length) {
    const companies = await Company.find({ _id: { $in: companyIds } })
      .select("name slug logo hotline address website status")
      .lean();
    companyById = Object.fromEntries(companies.map((c) => [String(c._id), c]));
  }

  for (const t of tourListSection2) {
    const key = mongoose.Types.ObjectId.isValid(t.companyId)
      ? String(t.companyId)
      : null;
    t.company = key ? companyById[key] || null : null;
  }

  // GẮN RATING + ĐIỂM KHỞI HÀNH cho SECTION 2
  await attachRatings(tourListSection2);
  await attachDepartureCities(tourListSection2);

  // ====== SECTION 4 ======
  const categoryIdSection4 = req.settingWebsiteInfo.categoryIdSection4;

  const categorySection4 = await Category.findOne({
    _id: categoryIdSection4,
    deleted: false,
    status: "active",
  }).lean();

  const categoryChildSection4 = await categoryHelper.getCategoryChild(
    categoryIdSection4
  );
  const categoryChildIdSection4 = categoryChildSection4.map((item) => item.id);

  let tourListSection4 = await Tour.find({
    category: { $in: [categoryIdSection4, ...categoryChildIdSection4] },
    deleted: false,
    status: "active",
  })
    .sort({ position: "asc" })
    .limit(8)
    .lean();

  tourListSection4.forEach((item) => {
    const oldP = Number(item.priceAdult || 0);
    const newP = Number(item.priceNewAdult || 0);
    item.discount = oldP > 0 ? Math.floor(((oldP - newP) / oldP) * 100) : 0;

    if (item.departureDate) {
      item.departureDateFormat = moment(item.departureDate).format(
        "DD/MM/YYYY"
      );
    }
    item.seatsRemaining = Number(item.seatsRemaining) || 0;

    item.departuresWithSeats =
      Array.isArray(item.departures) && item.departures.length > 0
        ? item.departures
            .filter((d) => d && d.departureDate)
            .map((d) => ({
              dateFormatted: moment(d.departureDate).format("DD/MM/YYYY"),
              seatsTotal: d.seatsTotal ?? 0,
              seatsRemaining: d.seatsRemaining ?? 0,
            }))
        : [];
  });

  const validCompanyObjectIds = Array.from(
    new Set(
      tourListSection4
        .map((t) => (t && t.companyId ? String(t.companyId) : ""))
        .filter((id) => id && mongoose.Types.ObjectId.isValid(id))
    )
  ).map((id) => new mongoose.Types.ObjectId(id));

  if (validCompanyObjectIds.length) {
    const companies = await Company.find({
      _id: { $in: validCompanyObjectIds },
    })
      .select("name slug logo hotline address")
      .lean();

    const companyMap = new Map(companies.map((c) => [String(c._id), c]));

    tourListSection4.forEach((item) => {
      const c = companyMap.get(String(item.companyId));
      if (c) item.company = c;
    });
  }

  // GẮN RATING + ĐIỂM KHỞI HÀNH cho SECTION 4
  await attachRatings(tourListSection4);
  await attachDepartureCities(tourListSection4);

  // ====== SECTION 8: TIN TỨC MỚI ======
  // Lấy 5 tin tức mới nhất (1 tin nổi bật lớn + 4 tin thường)
  // Nếu có tin nổi bật thì lấy 1 tin nổi bật + 4 tin thường
  // Nếu không có tin nổi bật thì lấy 5 tin mới nhất
  let featuredNews = await News.findOne({
    deleted: { $ne: true },
    status: "active",
    isFeatured: true,
  })
    .sort({ publishedAt: -1 })
    .lean();

  let regularNews = [];
  if (featuredNews) {
    // Lấy 5 tin thường (không bao gồm tin nổi bật)
    regularNews = await News.find({
      deleted: { $ne: true },
      status: "active",
      _id: { $ne: featuredNews._id },
    })
      .sort({ publishedAt: -1 })
      .limit(5)
      .lean();
  } else {
    // Nếu không có tin nổi bật, lấy 5 tin mới nhất
    const allNews = await News.find({
      deleted: { $ne: true },
      status: "active",
    })
      .sort({ publishedAt: -1 })
      .limit(6)
      .lean();
    
    if (allNews.length > 0) {
      // Tin đầu tiên làm tin lớn, 4 tin còn lại làm tin nhỏ
      featuredNews = allNews[0];
      regularNews = allNews.slice(1);
    }
  }

  // Format dates
  if (featuredNews) {
    featuredNews.publishedAtFormat = moment(featuredNews.publishedAt).format("DD/MM/YYYY");
  }
  regularNews.forEach((news) => {
    news.publishedAtFormat = moment(news.publishedAt).format("DD/MM/YYYY");
  });

  // ====== SECTION 9: ĐỐI TÁC CỦA CHÚNG TÔI ======
  // Lấy tất cả công ty đối tác đang active (hiển thị dạng lưới)
  let partnerCompanies = await Company.find({
    deleted: { $ne: true },
    status: "active",
  })
    .sort({ createdAt: 1 })
    .select("name slug logo hotline email website address description overview createdAt")
    .lean();

  // Đếm số lượng tour đang active cho từng công ty
  let tourCountsByCompany = {};
  if (partnerCompanies.length) {
    const companyIds = partnerCompanies.map((c) => c._id);

    const tourCounts = await Tour.aggregate([
      {
        $match: {
          deleted: false,
          status: "active",
          companyId: { $in: companyIds },
        },
      },
      {
        $group: {
          _id: "$companyId",
          count: { $sum: 1 },
        },
      },
    ]);

    tourCountsByCompany = Object.fromEntries(
      tourCounts.map((t) => [String(t._id), t.count])
    );
  }

  // Dùng overview làm mô tả ngắn + gắn tourCounts
  partnerCompanies = partnerCompanies.map((c) => {
    const idStr = String(c._id);
    return {
      ...c,
      description: c.overview || c.description || "",
      toursCount: tourCountsByCompany[idStr] || 0,
    };
  });

  // ====== SECTION HOTELS: DANH SÁCH KHÁCH SẠN NỔI BẬT ======
  const hotelsRaw = await Hotel.find({ deleted: false, status: "active" })
    .populate("companyId", "name logo")
    .sort({ isFeatured: -1, starRating: -1, createdAt: -1 })
    .limit(8)
    .lean();

  const hotelListHome = hotelsRaw.map((h) => {
    const thumb =
      h.avatar ||
      (Array.isArray(h.images) && h.images[0]) ||
      "/images/no-image.jpg";

    let tags = [];
    if (Array.isArray(h.amenities) && h.amenities.length > 0) {
      tags = h.amenities
        .slice(0, 4)
        .map((a) => (typeof a === "string" ? a : a.name || ""))
        .filter(Boolean);
    }

    const roomTypesCount = Array.isArray(h.roomTypes) ? h.roomTypes.length : 0;
    const totalRooms     = Array.isArray(h.rooms)     ? h.rooms.length     : 0;
    const vacantRooms    = Array.isArray(h.rooms)
      ? h.rooms.filter((r) => r && r.status === "vacant").length
      : 0;

    const company     = h.companyId || {};
    const companyName = company.name || "";

    return {
      id:               String(h._id),
      name:             h.name           || "",
      address:          h.address        || "",
      cityName:         h.cityName       || "",
      starRating:       h.starRating     || 0,
      rating:           h.ratingOverall  || null,
      thumbnail:        thumb,
      pricePerNight:    Number(h.basePrice || 0),
      currency:         h.currency       || "VND",
      shortDescription: h.shortDescription || "",
      tags,
      roomTypesCount,
      totalRooms,
      vacantRooms,
      companyName,
    };
  });

  // ====== SECTION 10: THỐNG KÊ NGẮN ======
  const [totalTours, totalPartners, totalCustomers, ratingAgg] = await Promise.all([
    Tour.countDocuments({ deleted: { $ne: true }, status: "active" }),
    Company.countDocuments({ deleted: { $ne: true }, status: "active" }),
    Order.countDocuments({ deleted: { $ne: true }, paymentStatus: "paid" }),
    Review.aggregate([
      { $match: { deleted: false } },
      {
        $group: {
          _id: null,
          avg: { $avg: "$rating" },
        },
      },
    ]),
  ]);

  const avgRating = ratingAgg && ratingAgg[0] ? ratingAgg[0].avg : 0;

  res.render("client/pages/home", {
    pageTitle: "Trang chủ",
    tourListSection2,
    tourListSection4,
    categorySection4,
    hotelListHome,
    featuredNews,
    regularNews,
    partnerCompanies,
    stats: {
      totalTours,
      totalPartners,
      totalCustomers,
      avgRating,
    },
  });
};
