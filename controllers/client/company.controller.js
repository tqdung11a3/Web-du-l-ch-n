// controllers/client/company.controller.js
const moment = require("moment");
const mongoose = require("mongoose");
const Tour = require("../../models/tour.model");
const Company = require("../../models/company.model");
const City = require("../../models/city.model");
const Review = require("../../models/review.model");
const Order = require("../../models/order.model");
const Hotel = require("../../models/hotel.model");
const HotelBooking = require("../../models/hotel-booking.model");

/* ------------------------------ helpers ------------------------------ */
function escapeRegex(str = "") {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Tạo điều kiện $and theo các token của q, mỗi token phải xuất hiện trong:
 *  - name (tiêu đề tour)
 *  - locations.cityName / locations.cityLabel
 *  - locations.spots (mảng string: các điểm đến trong tỉnh/thành)
 */
function nameOrLocationContainsTokens(q) {
  const raw = String(q || "").trim();
  if (!raw) return null;

  const tokens = raw
    .split(/\s*-\s*|\s+/) // tách theo '-' và khoảng trắng
    .map((t) => t.trim())
    .filter(Boolean);

  if (!tokens.length) return null;

  return {
    $and: tokens.map((t) => {
      const regex = new RegExp(escapeRegex(t), "i");
      return {
        $or: [
          { name: regex }, // tiêu đề tour
          { "locations.cityName": regex }, // tên tỉnh/thành
          { "locations.cityLabel": regex }, // label nếu có
          { "locations.spots": regex }, // điểm tham quan trong tỉnh/thành
        ],
      };
    }),
  };
}

// ép về number an toàn trong pipeline
function toNumberExpr(pathOrExpr) {
  return {
    $convert: {
      input: pathOrExpr,
      to: "double",
      onError: 0,
      onNull: 0,
    },
  };
}

// chuẩn hoá dữ liệu tour để product.pug dùng
function decorateTour(t, company) {
  const priceOld = Number(t._priceAdult ?? t.priceAdult ?? 0);
  const priceNew = Number(t._priceNewAdult ?? t.priceNewAdult ?? 0);
  const discount =
    priceOld > 0
      ? Math.max(0, Math.round(((priceOld - priceNew) / priceOld) * 100))
      : 0;

  const departureDateFormat = t.departureDate
    ? moment(t.departureDate).format("DD/MM/YYYY")
    : "";

  // ===== THỜI GIAN KHUYẾN MÃI (CHỈ ĐỂ HIỂN THỊ, KHÔNG COUNTDOWN) =====
  const discountFromFormat = t.discountFrom
    ? moment(t.discountFrom).format("DD/MM/YYYY")
    : "";
  const discountToFormat = t.discountTo
    ? moment(t.discountTo).format("DD/MM/YYYY")
    : "";

  const seatsRemaining =
    typeof t.seatsRemainingEff === "number"
      ? t.seatsRemainingEff
      : Number(t.seatsRemaining ?? 0);

  const departuresWithSeats =
    Array.isArray(t.departures) && t.departures.length > 0
      ? t.departures
          .filter((d) => d && d.departureDate)
          .map((d) => ({
            dateFormatted: moment(d.departureDate).format("DD/MM/YYYY"),
            seatsTotal: d.seatsTotal ?? 0,
            seatsRemaining: d.seatsRemaining ?? 0,
          }))
      : [];

  const companyInfo = {
    _id: company?._id,
    name: company?.name || "",
    slug: company?.slug || "",
    logo: company?.logo || "",
    hotline: company?.hotline || "",
    address: company?.address || "",
  };

  return {
    ...t,
    discount,
    departureDateFormat,
    discountFromFormat,
    discountToFormat,
    seatsRemaining,
    departuresWithSeats,
    company: companyInfo,
  };
}

/**
 * Gắn tên điểm khởi hành (departureCityName) cho mảng tours
 * để product.pug hiển thị "Khởi hành từ: ..."
 */
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

/* ---------------------- GET /company (company list) ---------------------- */
module.exports.listCompanies = async (req, res) => {
  try {
    const companies = await Company.find({
      status: "active",
      deleted: { $ne: true },
    })
      .select(
        "name slug logo banner hotline email website address description overview foundedAt createdAt"
      )
      .sort({ name: 1 })
      .lean();

    const companyIds = companies.map((c) => c._id);

    // Đếm số đơn hàng (order) đã đặt tour của từng công ty
    let orderCountsByCompany = {};
    if (companyIds.length) {
      const orderAgg = await Order.aggregate([
        {
          $match: {
            deleted: { $ne: true },
            paymentStatus: "paid",
          },
        },
        {
          $addFields: {
            companyId: { $arrayElemAt: ["$items.companyId", 0] },
          },
        },
        {
          $match: {
            companyId: { $ne: null },
          },
        },
        {
          $addFields: {
            companyId: {
              $convert: {
                input: "$companyId",
                to: "objectId",
                onError: null,
                onNull: null,
              },
            },
          },
        },
        {
          $match: {
            companyId: { $ne: null, $in: companyIds },
          },
        },
        {
          $group: {
            _id: "$companyId",
            orderCount: { $sum: 1 },
          },
        },
      ]);

      orderCountsByCompany = Object.fromEntries(
        orderAgg.map((d) => [String(d._id), d.orderCount])
      );
    }

    const companyList = await Promise.all(
      companies.map(async (c) => {
        const [toursCount, ratingAgg] = await Promise.all([
          Tour.countDocuments({
            companyId: c._id,
            status: "active",
            deleted: false,
          }),
          Tour.aggregate([
            {
              $match: {
                companyId: c._id,
                deleted: false,
                status: "active",
                ratingAvg: { $gt: 0 },
              },
            },
            {
              $group: {
                _id: null,
                avg: { $avg: "$ratingAvg" },
              },
            },
          ]),
        ]);

        const foundedYear = c.foundedAt
          ? moment(c.foundedAt).format("YYYY")
          : "";

        const rating =
          Array.isArray(ratingAgg) && ratingAgg[0] ? ratingAgg[0].avg : 0;

        const orderCount = orderCountsByCompany[String(c._id)] || 0;

        return {
          ...c,
          toursCount,
          foundedYear,
          rating,
          orderCount,
          shortOverview: c.overview || c.description || "",
        };
      })
    );

    const [totalTours, totalCustomers] = await Promise.all([
      Tour.countDocuments({ deleted: false, status: "active" }),
      Order.countDocuments({ deleted: { $ne: true }, paymentStatus: "paid" }),
    ]);

    const summary = {
      totalCompanies: companyList.length,
      totalTours,
      totalCustomers,
    };

    return res.render("client/pages/company-list", {
      pageTitle: "Danh sách công ty du lịch",
      companyList,
      summary,
    });
  } catch (err) {
    console.error("company.listCompanies error:", err);
    return res
      .status(500)
      .render("client/pages/500", { pageTitle: "Lỗi hệ thống" });
  }
};

/* ----------------- GET /company/:slug (company detail page) ----------------- */
module.exports.companyDetail = async (req, res) => {
  try {
    const { slug } = req.params;

    // 1) Lấy thông tin công ty
    const company = await Company.findOne({
      slug,
      status: "active",
      deleted: { $ne: true },
    })
      .select(
        "name slug logo banner hotline email website address description overview foundedAt cancelPolicyTour cancelPolicyHotel"
      )
      .lean();

    if (!company) {
      return res
        .status(404)
        .render("client/pages/404", { pageTitle: "Không tìm thấy công ty" });
    }

    // 2) Tính thống kê
    const [toursCount, hotelsCount, flightsCount, orderAgg, ratingAgg] =
      await Promise.all([
        Tour.countDocuments({
          companyId: company._id,
          deleted: false,
          status: "active",
        }),
        Hotel.countDocuments({
          companyId: company._id,
          deleted: false,
          status: "active",
        }),
        // TODO: Đếm chuyến bay khi có model Flight
        Promise.resolve(0), // Flight.countDocuments({ companyId: company._id, ... })
        // Đếm số đơn hàng đã thanh toán (để tính số khách hàng)
        Order.aggregate([
          {
            $match: {
              deleted: { $ne: true },
              paymentStatus: "paid",
            },
          },
          {
            $addFields: {
              companyId: { $arrayElemAt: ["$items.companyId", 0] },
            },
          },
          {
            $match: {
              companyId: {
                $ne: null,
                $eq: company._id,
              },
            },
          },
          {
            $group: {
              _id: null,
              count: { $sum: 1 },
            },
          },
        ]),
        // Tính rating trung bình từ các tour của công ty
        Tour.aggregate([
          {
            $match: {
              companyId: company._id,
              deleted: false,
              status: "active",
              ratingAvg: { $gt: 0 },
            },
          },
          {
            $group: {
              _id: null,
              avg: { $avg: "$ratingAvg" },
            },
          },
        ]),
      ]);

    const customersCount = orderAgg && orderAgg[0] ? orderAgg[0].count : 0;
    const rating =
      Array.isArray(ratingAgg) && ratingAgg[0] ? ratingAgg[0].avg : 0;

    const foundedYear = company.foundedAt
      ? moment(company.foundedAt).format("YYYY")
      : "";

    const stats = {
      tours: toursCount || 0,
      customers: customersCount || 0,
      hotels: hotelsCount || 0,
      flights: flightsCount || 0,
    };

    // 3) Lấy 3 tours đầu tiên để hiển thị
    let topTours = [];
    if (toursCount > 0) {
      const toursAgg = await Tour.aggregate([
        {
          $match: {
            companyId: company._id,
            deleted: false,
            status: "active",
          },
        },
        {
          $addFields: {
            _priceAdult: toNumberExpr("$priceAdult"),
            _priceNewAdult: toNumberExpr("$priceNewAdult"),
            seatsRemainingEff: toNumberExpr("$seatsRemaining"),
          },
        },
        { $sort: { position: 1 } },
        { $limit: 3 },
      ]);

      topTours = toursAgg.map((t) => decorateTour(t, company));
      await attachDepartureCities(topTours);

      // Tính rating cho tours
      const tourIds = topTours.map((t) => new mongoose.Types.ObjectId(t._id));
      if (tourIds.length) {
        const ratingAgg = await Review.aggregate([
          { $match: { deleted: false, tourId: { $in: tourIds } } },
          {
            $group: {
              _id: "$tourId",
              ratingAvg: { $avg: "$rating" },
              ratingCount: { $sum: 1 },
            },
          },
        ]);
        const rmap = Object.fromEntries(
          ratingAgg.map((r) => [
            String(r._id),
            {
              ratingAvg: Number((r.ratingAvg || 0).toFixed(1)),
              ratingCount: r.ratingCount || 0,
            },
          ])
        );
        topTours.forEach((t) =>
          Object.assign(
            t,
            rmap[String(t._id)] || { ratingAvg: 0, ratingCount: 0 }
          )
        );
      }
    }

    // 4) Lấy 3 hotels đầu tiên để hiển thị
    let topHotels = [];
    if (hotelsCount > 0) {
      const hotelsRaw = await Hotel.find({
        companyId: company._id,
        deleted: false,
        status: "active",
      })
        .select(
          "name slug avatar images address province cityName starRating basePrice currency shortDescription amenities"
        )
        .populate("province", "name")
        .sort({ isFeatured: -1, starRating: -1, basePrice: 1 })
        .limit(3)
        .lean();
      
      // Transform amenities từ objects sang strings (lấy name)
      topHotels = hotelsRaw.map(h => ({
        ...h,
        amenities: Array.isArray(h.amenities) && h.amenities.length > 0
          ? h.amenities.map(a => typeof a === 'string' ? a : (a.name || '')).filter(a => a)
          : []
      }));
    }

    // 5) Lấy 3 flights đầu tiên (TODO: khi có model Flight)
    const topFlights = [];

    return res.render("client/pages/company-detail", {
      pageTitle: company.name,
      company: {
        ...company,
        rating: rating ? Number(rating.toFixed(1)) : 0,
        foundedYear,
      },
      stats,
      topTours,
      topHotels,
      topFlights,
    });
  } catch (err) {
    console.error("company.companyDetail error:", err);
    return res
      .status(500)
      .render("client/pages/500", { pageTitle: "Lỗi hệ thống" });
  }
};

/* ----------------- GET /company/:slug/tours (tours by company) ----------------- */
module.exports.toursByCompany = async (req, res) => {
  try {
    const { slug } = req.params;

    // 1) Công ty
    const company = await Company.findOne({ slug, status: "active" })
      .select(
        "name slug logo banner hotline address description email website createdAt"
      )
      .lean();
    if (!company) {
      return res
        .status(404)
        .render("client/pages/404", { pageTitle: "Không tìm thấy công ty" });
    }

    /* ========= A. TOP 10 TOUR ĐANG KHUYẾN MÃI CỦA CÔNG TY (CHO SECTION-2) ========= */
    const now = new Date();

    // Lấy cả tour giảm theo % lẫn tour giảm theo số tiền cố định
    let discountTourList = await Tour.find({
      companyId: company._id,
      deleted: false,
      status: "active",
      discountFrom: { $lte: now }, // đã bắt đầu KM
      discountTo: { $gte: now }, // chưa hết hạn
      $or: [
        { discountPercent: { $gt: 0 } }, // giảm theo %
        { priceAdult: { $gt: 0 } }, // hoặc có giá cũ NL
        { priceChildren: { $gt: 0 } }, // hoặc có giá cũ TE
        { priceBaby: { $gt: 0 } }, // hoặc có giá cũ EB
      ],
    })
      .sort({ discountTo: 1, discountFrom: -1, updatedAt: -1 }) // sắp hết KM trước
      .limit(10)
      .lean();

    // enrich giống home.section-2
    discountTourList = discountTourList.map((t) => {
      const oldP = Number(t.priceAdult || 0);
      const newP = Number(t.priceNewAdult || 0);

      const discount =
        t.discountPercent && t.discountPercent > 0
          ? t.discountPercent
          : oldP > 0
          ? Math.floor(((oldP - newP) / oldP) * 100)
          : 0;

      const departureDateFormat = t.departureDate
        ? moment(t.departureDate).format("DD/MM/YYYY")
        : "";

      let discountFromFormat = "";
      let discountToFormat = "";
      let discountExpireISO = "";

      if (t.discountFrom) {
        discountFromFormat = moment(t.discountFrom).format("DD/MM/YYYY");
      }
      if (t.discountTo) {
        discountToFormat = moment(t.discountTo).format("DD/MM/YYYY");
        // dùng cho countdown JS
        discountExpireISO = moment(t.discountTo).endOf("day").toISOString();
      }

      const seatsRemaining = Number(t.seatsRemaining) || 0;

      const departuresWithSeats =
        Array.isArray(t.departures) && t.departures.length > 0
          ? t.departures
              .filter((d) => d && d.departureDate)
              .map((d) => ({
                dateFormatted: moment(d.departureDate).format("DD/MM/YYYY"),
                seatsTotal: d.seatsTotal ?? 0,
                seatsRemaining: d.seatsRemaining ?? 0,
              }))
          : [];

      return {
        ...t,
        discount,
        departureDateFormat,
        discountFromFormat,
        discountToFormat,
        discountExpireISO,
        seatsRemaining,
        departuresWithSeats,
        company: {
          _id: company._id,
          name: company.name,
          slug: company.slug,
          logo: company.logo || "",
          hotline: company.hotline || "",
          address: company.address || "",
        },
      };
    });

    // Gắn tên điểm khởi hành cho top tour KM
    await attachDepartureCities(discountTourList);

    /* ========= B. DANH SÁCH TẤT CẢ TOUR CỦA CÔNG TY (GIỐNG CŨ) ========= */

    // 2) Filters + sort cho danh sách chính
    const { q, departureDate, price, minSeats, tags } = req.query;
    const sortKey = (req.query.sort || "rating").trim(); // price_asc | price_desc | rating

    const matchBase = {
      companyId: company._id,
      deleted: false,
      status: "active",
    };

    // Tìm theo cả tiêu đề + địa điểm trong từng tỉnh/thành
    const keywordCond = nameOrLocationContainsTokens(q);
    if (keywordCond) Object.assign(matchBase, keywordCond);

    if (departureDate) {
      const start = moment(departureDate, "YYYY-MM-DD").startOf("day").toDate();
      const end = moment(departureDate, "YYYY-MM-DD").endOf("day").toDate();
      matchBase.departureDate = { $gte: start, $lte: end };
    }

    // Lọc theo tags
    let tagArray = [];
    if (tags) {
      tagArray = Array.isArray(tags) ? tags : [tags];
      tagArray = tagArray.filter((t) => t && typeof t === "string");
    }
    if (tagArray.length > 0) {
      matchBase.tags = { $in: tagArray };
    }

    // 3) Pipeline lấy tour + chuẩn hoá số, seatsRemaining hiệu dụng
    const pipeline = [
      { $match: matchBase },
      {
        $addFields: {
          _priceAdult: toNumberExpr("$priceAdult"),
          _priceNewAdult: toNumberExpr("$priceNewAdult"),
          seatsRemainingEff: toNumberExpr("$seatsRemaining"),
        },
      },
    ];

    if (price && /^\d+-\d+$/.test(price)) {
      const [min, max] = price.split("-").map(Number);
      pipeline.push({ $match: { _priceNewAdult: { $gte: min, $lte: max } } });
    }

    const needSeats = Number(minSeats) || 0;
    if (needSeats > 0) {
      pipeline.push({ $match: { seatsRemainingEff: { $gte: needSeats } } });
    }

    // sort mặc định theo position
    pipeline.push({ $sort: { position: 1 } });

    // 4) Lấy & decorate
    const toursAgg = await Tour.aggregate(pipeline);
    let tourList = toursAgg.map((t) => decorateTour(t, company));

    // Gắn tên điểm khởi hành cho danh sách chính
    await attachDepartureCities(tourList);

    /* ========= C. TÍNH RATING CHO CẢ 2 DANH SÁCH ========= */
    const allIds = [
      ...new Set([
        ...tourList.map((t) => t._id.toString()),
        ...discountTourList.map((t) => t._id.toString()),
      ]),
    ].map((id) => new mongoose.Types.ObjectId(id));

    if (allIds.length) {
      const ratingAgg = await Review.aggregate([
        { $match: { deleted: false, tourId: { $in: allIds } } },
        {
          $group: {
            _id: "$tourId",
            ratingAvg: { $avg: "$rating" },
            ratingCount: { $sum: 1 },
          },
        },
      ]);
      const rmap = Object.fromEntries(
        ratingAgg.map((r) => [
          String(r._id),
          {
            ratingAvg: Number((r.ratingAvg || 0).toFixed(1)),
            ratingCount: r.ratingCount || 0,
          },
        ])
      );

      tourList.forEach((t) =>
        Object.assign(
          t,
          rmap[String(t._id)] || { ratingAvg: 0, ratingCount: 0 }
        )
      );
      discountTourList.forEach((t) =>
        Object.assign(
          t,
          rmap[String(t._id)] || { ratingAvg: 0, ratingCount: 0 }
        )
      );
    }

    /* ========= D. SẮP XẾP DANH SÁCH CHÍNH + PHÂN TRANG ========= */
    switch (sortKey) {
      case "price_asc":
        tourList.sort(
          (a, b) =>
            Number(a._priceNewAdult ?? a.priceNewAdult ?? 0) -
            Number(b._priceNewAdult ?? b.priceNewAdult ?? 0)
        );
        break;
      case "price_desc":
        tourList.sort(
          (a, b) =>
            Number(b._priceNewAdult ?? b.priceNewAdult ?? 0) -
            Number(a._priceNewAdult ?? a.priceNewAdult ?? 0)
        );
        break;
      case "rating":
      default:
        tourList.sort(
          (a, b) =>
            (b.ratingAvg || 0) - (a.ratingAvg || 0) ||
            (b.ratingCount || 0) - (a.ratingCount || 0)
        );
        break;
    }

    const limitItems = 12;
    let page = 1;
    if (req.query.page && parseInt(req.query.page) > 0) {
      page = parseInt(req.query.page);
    }

    const totalRecord = tourList.length;
    const totalPage = Math.ceil(totalRecord / limitItems) || 1;
    if (page > totalPage) page = totalPage;

    const skip = (page - 1) * limitItems;
    const tourListPaged = tourList.slice(skip, skip + limitItems);

    const pagination = {
      page,
      skip,
      limitItems,
      totalRecord,
      totalPage,
    };

    /* ========= E. cityList + sortHrefs + breadcrumb ========= */
    const cityList = await City.find({ deleted: false, status: "active" })
      .select("name")
      .sort({ name: 1 })
      .lean();

    const params = new URLSearchParams(req.query);
    params.delete("sort");
    params.delete("page");
    const base = params.toString();
    const makeHref = (k) => (base ? `?${base}&sort=${k}` : `?sort=${k}`);

    const breadcrumb = [
      { name: "Công ty", url: "/company" },
      {
        name: company.name,
        slug: company.slug,
        type: "company",
        avatar: company.banner || company.logo || "",
      },
    ];

    /* ========= F. RENDER SANG company-tour-list.pug ========= */
    // Tính thống kê cho tab
    const [hotelsCount, flightsCount] = await Promise.all([
      Hotel.countDocuments({
        companyId: company._id,
        deleted: false,
        status: "active",
      }),
      // TODO: Đếm chuyến bay khi có model Flight
      Promise.resolve(0), // Flight.countDocuments({ companyId: company._id, ... })
    ]);

    return res.render("client/pages/company-tour-list", {
      pageTitle: `Tour của ${company.name}`,
      company: {
        ...company,
        toursCount: totalRecord,
        hotelsCount,
        flightsCount,
      },
      breadcrumb,
      cityList,
      tourList: tourListPaged,
      discountTourList, // dùng cho section-2
      pagination,
      sort: sortKey,
      sortHrefs: {
        priceAsc: makeHref("price_asc"),
        priceDesc: makeHref("price_desc"),
        rating: makeHref("rating"),
      },
      query: req.query,
    });
  } catch (err) {
    console.error("company.toursByCompany error:", err);
    return res
      .status(500)
      .render("client/pages/500", { pageTitle: "Lỗi hệ thống" });
  }
};

// ========= DANH SÁCH TẤT CẢ TOUR ĐANG KHUYẾN MÃI CỦA MỘT CÔNG TY =========
// GET /company/:slug/discount
module.exports.discountTourList = async (req, res) => {
  try {
    const { slug } = req.params;

    // 1) Lấy thông tin công ty (NHỚ LẤY BANNER)
    const company = await Company.findOne({ slug, status: "active" })
      .select("name slug logo banner hotline address")
      .lean();

    if (!company) {
      return res
        .status(404)
        .render("client/pages/404", { pageTitle: "Không tìm thấy công ty" });
    }

    // 2) Sort + phân trang
    const sortKey = (req.query.sort || "rating").trim(); // price_asc | price_desc | rating
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = 12;
    const skip = (page - 1) * limit;

    const nowMoment = moment();
    const now = nowMoment.toDate();

    // 3) Điều kiện chỉ lấy tour đang trong thời gian khuyến mãi của công ty này
    //  - Bao gồm cả tour giảm theo % lẫn tour giảm theo số tiền cố định
    const filter = {
      companyId: company._id,
      deleted: false,
      status: "active",
      discountFrom: { $lte: now }, // đã bắt đầu KM
      discountTo: { $gte: now }, // chưa hết hạn
      $or: [
        { discountPercent: { $gt: 0 } },
        { priceAdult: { $gt: 0 } },
        { priceChildren: { $gt: 0 } },
        { priceBaby: { $gt: 0 } },
      ],
    };

    let [totalRecord, tourList] = await Promise.all([
      Tour.countDocuments(filter),
      Tour.find(filter)
        // ưu tiên tour sắp hết khuyến mãi, mới cập nhật
        .sort({ discountTo: 1, discountFrom: -1, updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    const totalPage = Math.max(Math.ceil(totalRecord / limit), 1);

    // 4) Enrich từng tour cho product.pug + countdown
    for (const t of tourList) {
      const oldP = Number(t.priceAdult || 0);
      const newP = Number(t.priceNewAdult || 0);

      // % giảm: ưu tiên discountPercent trong DB
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
        // dùng cho JS countdown (tính tới cuối ngày)
        t.discountExpireISO = moment(t.discountTo).endOf("day").toISOString();
      }

      // Số chỗ còn
      t.seatsRemaining = Number(t.seatsRemaining) || 0;

      // Thông tin công ty để product-item hiển thị logo/tên
      t.company = {
        _id: company._id,
        name: company.name,
        slug: company.slug,
        logo: company.logo || "",
        hotline: company.hotline || "",
        address: company.address || "",
      };
    }

    // Gắn tên điểm khởi hành cho list tour khuyến mãi
    await attachDepartureCities(tourList);

    // 5) Gắn rating cho list
    const ids = tourList.map((t) => new mongoose.Types.ObjectId(t._id));
    if (ids.length) {
      const ratingAgg = await Review.aggregate([
        { $match: { deleted: false, tourId: { $in: ids } } },
        {
          $group: {
            _id: "$tourId",
            ratingAvg: { $avg: "$rating" },
            ratingCount: { $sum: 1 },
          },
        },
      ]);

      const rmap = Object.fromEntries(
        ratingAgg.map((r) => [
          String(r._id),
          {
            ratingAvg: Number((r.ratingAvg || 0).toFixed(1)),
            ratingCount: r.ratingCount || 0,
          },
        ])
      );

      tourList.forEach((t) =>
        Object.assign(
          t,
          rmap[String(t._id)] || { ratingAvg: 0, ratingCount: 0 }
        )
      );
    }

    // 6) Áp dụng sắp xếp theo sortKey (giá / đánh giá)
    switch (sortKey) {
      case "price_asc":
        tourList.sort(
          (a, b) =>
            Number(a.priceNewAdult || a.priceAdult || 0) -
            Number(b.priceNewAdult || b.priceAdult || 0)
        );
        break;
      case "price_desc":
        tourList.sort(
          (a, b) =>
            Number(b.priceNewAdult || b.priceAdult || 0) -
            Number(a.priceNewAdult || a.priceAdult || 0)
        );
        break;
      case "rating":
      default:
        tourList.sort(
          (a, b) =>
            (b.ratingAvg || 0) - (a.ratingAvg || 0) ||
            (b.ratingCount || 0) - (a.ratingCount || 0)
        );
        break;
    }

    // 7) Chuẩn bị pagination + sortHrefs dùng cho Pug
    const pagination = {
      page,
      limit,
      skip,
      totalRecord,
      totalPage,
    };

    const params = new URLSearchParams(req.query);
    params.delete("sort");
    params.delete("page");
    const base = params.toString();
    const makeSortHref = (k) => (base ? `?${base}&sort=${k}` : `?sort=${k}`);

    const sortHrefs = {
      priceAsc: makeSortHref("price_asc"),
      priceDesc: makeSortHref("price_desc"),
      rating: makeSortHref("rating"),
    };

    // 8) Breadcrumb riêng cho trang discount của công ty
    const breadcrumb = [
      { name: "Công ty", url: "/company" },
      {
        name: company.name,
        slug: company.slug,
        type: "company",
        avatar: company.banner || company.logo || "",
      },
      {
        name: "Tour đang khuyến mãi",
        slug: `/company/${company.slug}/discount`,
      },
    ];

    // 9) Render dùng lại view tour-discount-list.pug
    return res.render("client/pages/tour-discount-list", {
      pageTitle: `Tour khuyến mãi - ${company.name}`,
      breadcrumb,
      tourList,
      pagination,
      sort: sortKey,
      sortHrefs,
    });
  } catch (err) {
    console.error("company.discountTourList error:", err);
    return res.status(500).render("client/pages/500", {
      pageTitle: "Lỗi hệ thống",
    });
  }
};

/* ----------------- GET /company/:slug/hotels (hotels by company) ----------------- */
module.exports.hotelsByCompany = async (req, res) => {
  try {
    const { slug } = req.params;
    const { checkInDate, checkOutDate, adults, children, rooms, roomsData } = req.query || {};

    // 1) Công ty
    const company = await Company.findOne({ slug, status: "active" })
      .select("name slug logo banner hotline address description email website createdAt")
      .lean();
    if (!company) {
      return res
        .status(404)
        .render("client/pages/404", { pageTitle: "Không tìm thấy công ty" });
    }

    // Parse query parameters
    const effectiveCheckIn = checkInDate || null;
    const effectiveCheckOut = checkOutDate || null;
    
    let parsedRoomsData = null;
    if (roomsData) {
      try {
        parsedRoomsData = JSON.parse(decodeURIComponent(roomsData));
      } catch (e) {
        console.warn("Failed to parse roomsData:", e);
      }
    }
    
    let numRooms = Number(rooms) || 1;
    let numAdults = Number(adults) || 1;
    let numChildren = Number(children) || 0;
    
    if (parsedRoomsData && Array.isArray(parsedRoomsData) && parsedRoomsData.length > 0) {
      numRooms = parsedRoomsData.length;
      numAdults = parsedRoomsData.reduce((sum, r) => sum + (r.adults || 1), 0);
      numChildren = parsedRoomsData.reduce((sum, r) => sum + (r.children?.length || 0), 0);
    }

    // 2) Lấy danh sách khách sạn của công ty
    const hotels = await Hotel.find({
      companyId: company._id,
      deleted: false,
      status: "active",
    })
      .populate('province', 'name')
      .sort({ isFeatured: -1, starRating: -1, basePrice: 1 })
      .lean();

    // 3) Lấy bookings để kiểm tra availability (nếu có dates)
    let checkInMoment = null;
    let checkOutMoment = null;
    let shouldCheckAvailability = false;
    
    if (effectiveCheckIn && effectiveCheckOut) {
      checkInMoment = moment(effectiveCheckIn);
      checkOutMoment = moment(effectiveCheckOut);
      shouldCheckAvailability = checkInMoment.isValid() && checkOutMoment.isValid();
    }
    
    // Group bookings by hotel
    let bookingsByHotel = {};
    if (shouldCheckAvailability) {
      const hotelIds = hotels.map(h => h._id);
      
      const allBookings = await HotelBooking.find({
        'hotel.hotelId': { $in: hotelIds },
        deleted: { $ne: true },
        status: { $nin: ['cancelled', 'checked_out'] },
        checkIn: { $lt: checkOutMoment.toDate() },
        checkOut: { $gt: checkInMoment.toDate() },
      }).lean();
      
      // Group bookings by hotel
      allBookings.forEach(booking => {
        const hId = String(booking.hotel?.hotelId);
        if (!bookingsByHotel[hId]) {
          bookingsByHotel[hId] = [];
        }
        bookingsByHotel[hId].push(booking);
      });
    }

    // 4) Transform hotels data giống /hotel/search
    const { getAvailableRoomsForType } = require("../../helpers/hotel-availability.helper");
    const hotelList = [];
    
    for (const h of hotels) {
      const thumb = h.avatar || (Array.isArray(h.images) && h.images[0]) || "/images/no-image.jpg";
      const price = Number(h.basePrice || 0);
      
      // Transform amenities
      let tags = [];
      if (Array.isArray(h.amenities) && h.amenities.length > 0) {
        tags = h.amenities.slice(0, 4).map(a => (typeof a === 'string' ? a : (a.name || ''))).filter(a => a);
      }
      
      // Count room types
      const roomTypesCount = Array.isArray(h.roomTypes) ? h.roomTypes.length : 0;
      
      // Count rooms
      const totalRooms = Array.isArray(h.rooms) ? h.rooms.length : 0;
      
      // Calculate vacant rooms - Tính theo từng loại phòng rồi cộng lại
      let vacantRooms = 0;
      if (Array.isArray(h.rooms) && Array.isArray(h.roomTypes)) {
        if (shouldCheckAvailability) {
          // Lấy bookings của hotel này
          const hotelBookings = bookingsByHotel[String(h._id)] || [];
          
          // Tính số phòng trống cho mỗi loại phòng
          h.roomTypes.forEach(roomType => {
            const availableRooms = getAvailableRoomsForType(
              h.rooms,
              roomType._id,
              hotelBookings,
              checkInMoment.toDate(),
              checkOutMoment.toDate()
            );
            vacantRooms += availableRooms.length;
          });
        } else {
          // Không có dates: đếm phòng có status = vacant
          vacantRooms = h.rooms.filter(r => r && r.status === 'vacant').length;
        }
      }

      hotelList.push({
        id: String(h._id),
        name: h.name || '',
        cityName: (h.province && h.province.name) || h.cityName || '',
        address: h.address || '',
        starRating: h.starRating || 0,
        rating: h.ratingOverall || null,
        thumbnail: thumb,
        pricePerNight: price,
        currency: h.currency || "VND",
        tags,
        roomTypesCount,
        totalRooms,
        vacantRooms,
        shortDescription: h.shortDescription || '',
        companyName: company.name,
        checkInDate: effectiveCheckIn,
        checkOutDate: effectiveCheckOut,
        rooms: numRooms,
        adults: numAdults,
        children: numChildren,
        roomsData: roomsData || '',
      });
    }

    // 5) Tính thống kê cho tab
    const [toursCount, flightsCount] = await Promise.all([
      Tour.countDocuments({
        companyId: company._id,
        deleted: false,
        status: "active",
      }),
      Promise.resolve(0),
    ]);

    // 6) Breadcrumb
    const breadcrumb = [
      { name: "Công ty", url: "/company" },
      {
        name: company.name,
        slug: company.slug,
        type: "company",
        avatar: company.banner || company.logo || "",
      },
    ];

    return res.render("client/pages/company-hotel-list", {
      pageTitle: `Khách sạn của ${company.name}`,
      company: {
        ...company,
        hotelsCount: hotels.length,
        toursCount,
        flightsCount,
      },
      breadcrumb,
      hotelList,
      query: {
        checkInDate: effectiveCheckIn,
        checkOutDate: effectiveCheckOut,
        rooms: numRooms,
        adults: numAdults,
        children: numChildren,
        roomsData,
      },
    });
  } catch (err) {
    console.error("company.hotelsByCompany error:", err);
    return res
      .status(500)
      .render("client/pages/500", { pageTitle: "Lỗi hệ thống" });
  }
};

/* ----------------- GET /company/:slug/flights (flights by company) ----------------- */
module.exports.flightsByCompany = async (req, res) => {
  try {
    const { slug } = req.params;

    // 1) Công ty
    const company = await Company.findOne({ slug, status: "active" })
      .select("name slug logo banner hotline address description email website createdAt")
      .lean();
    if (!company) {
      return res
        .status(404)
        .render("client/pages/404", { pageTitle: "Không tìm thấy công ty" });
    }

    // 2) TODO: Lấy danh sách chuyến bay của công ty khi có model Flight
    const flights = [];

    // 3) Tính thống kê cho tab
    const [toursCount, hotelsCount] = await Promise.all([
      Tour.countDocuments({
        companyId: company._id,
        deleted: false,
        status: "active",
      }),
      Hotel.countDocuments({
        companyId: company._id,
        deleted: false,
        status: "active",
      }),
    ]);

    // 4) Breadcrumb
    const breadcrumb = [
      { name: "Công ty", url: "/company" },
      {
        name: company.name,
        slug: company.slug,
        type: "company",
        avatar: company.banner || company.logo || "",
      },
    ];

    return res.render("client/pages/company-flight-list", {
      pageTitle: `Vé máy bay của ${company.name}`,
      company: {
        ...company,
        flightsCount: flights.length,
        toursCount,
        hotelsCount,
      },
      breadcrumb,
      flightList: flights,
    });
  } catch (err) {
    console.error("company.flightsByCompany error:", err);
    return res
      .status(500)
      .render("client/pages/500", { pageTitle: "Lỗi hệ thống" });
  }
};
