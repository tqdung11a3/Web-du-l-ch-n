// controllers/client/tour.controller.js
const mongoose = require("mongoose");
const Tour = require("../../models/tour.model");
const City = require("../../models/city.model");
const categoryHelper = require("../../helpers/category.helper");
const moment = require("moment");

const Company = require("../../models/company.model");
const Review = require("../../models/review.model");
const AmadeusActivity = require("../../models/amadeus-activity.model");

// ========= HELPER: gắn ratingAvg + ratingCount =========
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

// ========= CHI TIẾT TOUR =========
module.exports.detail = async (req, res) => {
  // Nếu có slug và tourSlug -> route mới /company/:slug/tour/detail/:tourSlug
  // Nếu chỉ có slug -> route cũ /tour/detail/:slug (redirect đến route mới)
  const { slug, tourSlug } = req.params;
  const companySlug = slug; // Trong route /company/:slug/tour/detail/:tourSlug, slug là companySlug
  const finalSlug = tourSlug || slug;

  console.log(`[Tour Detail] Request params:`, { companySlug, tourSlug, slug, finalSlug, url: req.url });

  let company = null;
  let tourDetailDoc = null;

  if (companySlug && tourSlug) {
    // Route mới: /company/:slug/tour/detail/:tourSlug
    company = await Company.findOne({
      slug: companySlug,
      status: "active",
      deleted: { $ne: true },
    }).lean();

    if (!company) {
      console.log(`[Tour Detail] Company not found: ${companySlug}`);
      return res
        .status(404)
        .render("client/pages/404", { pageTitle: "Không tìm thấy công ty" });
    }

    // Tìm tour với slug (không cần kiểm tra companyId chặt chẽ vì URL đã có company slug)
    // Nếu tour có companyId khác, vẫn hiển thị (có thể là dữ liệu cũ hoặc tour đã chuyển công ty)
    tourDetailDoc = await Tour.findOne({
      slug: tourSlug,
      deleted: false,
      status: "active",
    });

    if (!tourDetailDoc) {
      console.log(`[Tour Detail] Tour not found: slug=${tourSlug}, companySlug=${companySlug}`);
      // Thử tìm tour với các điều kiện khác để debug
      const tourWithoutStatus = await Tour.findOne({
        slug: tourSlug,
        deleted: false,
      });
      if (tourWithoutStatus) {
        console.log(`[Tour Detail] Tour exists but status is: ${tourWithoutStatus.status}`);
      } else {
        const tourWithDeleted = await Tour.findOne({ slug: tourSlug });
        if (tourWithDeleted) {
          console.log(`[Tour Detail] Tour exists but deleted: ${tourWithDeleted.deleted}`);
        } else {
          console.log(`[Tour Detail] Tour does not exist in database`);
        }
      }
    }
  } else if (slug) {
    // Route cũ: /tour/detail/:slug -> redirect đến route mới
    tourDetailDoc = await Tour.findOne({
      slug: slug,
      deleted: false,
      status: "active",
    })
      .populate("companyId", "slug")
      .lean();

    if (!tourDetailDoc) {
      return res
        .status(404)
        .render("client/pages/404", { pageTitle: "Không tìm thấy tour" });
    }

    // Redirect đến route mới
    const companySlugFromTour = tourDetailDoc.companyId?.slug;
    if (companySlugFromTour) {
      return res.redirect(
        `/company/${companySlugFromTour}/tour/detail/${slug}`
      );
    } else {
      // Nếu không có company, vẫn hiển thị nhưng với route cũ (fallback)
      company = null;
      // tourDetailDoc đã là lean object, không cần toObject()
    }
  }

  if (!tourDetailDoc) {
    return res
      .status(404)
      .render("client/pages/404", { pageTitle: "Không tìm thấy tour" });
  }

  // Convert to object nếu là Mongoose document
  let tourDetail;
  if (tourDetailDoc && tourDetailDoc.toObject) {
    tourDetail = tourDetailDoc.toObject();
  } else {
    tourDetail = tourDetailDoc;
  }

  // Gắn thông tin công ty tổ chức cho tourDetail để view hiển thị
  try {
    if (company) {
      // Đã có company từ slug trong URL (company đã được fetch đầy đủ ở trên)
      // Cần fetch lại với tourAgeBands nếu company chỉ có một số field
      const companyFull = await Company.findById(company._id)
        .select("name slug logo hotline address tourAgeBands")
        .lean();
      tourDetail.company = {
        _id: company._id,
        name: company.name,
        slug: company.slug,
        logo: company.logo || "",
        hotline: company.hotline || "",
        address: company.address || "",
      };
      tourDetail.tourAgeBands = companyFull?.tourAgeBands || { babyMaxAge: 3, childrenMaxAge: 11 };
    } else if (tourDetail.companyId) {
      // Fallback: lấy theo companyId của tour (phòng trường hợp dùng route cũ)
      const companyDoc = await Company.findById(tourDetail.companyId)
        .select("name slug logo hotline address tourAgeBands")
        .lean();
      if (companyDoc) {
        tourDetail.company = {
          _id: companyDoc._id,
          name: companyDoc.name,
          slug: companyDoc.slug,
          logo: companyDoc.logo || "",
          hotline: companyDoc.hotline || "",
          address: companyDoc.address || "",
        };
        tourDetail.tourAgeBands = companyDoc.tourAgeBands || { babyMaxAge: 3, childrenMaxAge: 11 };
      }
    }
    // Đảm bảo luôn có giá trị mặc định
    if (!tourDetail.tourAgeBands) {
      tourDetail.tourAgeBands = { babyMaxAge: 3, childrenMaxAge: 11 };
    }
  } catch (e) {
    console.error("tour.detail attach company error:", e);
  }

  // Breadcrumb
  const breadcrumb = [];

  if (tourDetail.category) {
    const categoryList = await categoryHelper.getCategoryParent(
      tourDetail.category
    );
    for (const item of categoryList) {
      breadcrumb.push(item);
    }
  }

  breadcrumb.push({
    id: tourDetailDoc.id, // virtual id
    name: tourDetail.name,
    avatar: tourDetail.avatar,
    slug: tourDetail.slug,
  });

  // Ngày khởi hành format
  if (tourDetail.departureDate) {
    tourDetail.departureDateFormat = moment(tourDetail.departureDate).format(
      "DD/MM/YYYY"
    );
  }

  // Format mảng departures (cặp ngày khởi hành - kết thúc) để view hiển thị
  if (Array.isArray(tourDetail.departures) && tourDetail.departures.length > 0) {
    const validDeps = tourDetail.departures.filter((d) => d && d.departureDate);

    tourDetail.departureDatesFormatted = validDeps.map((d) =>
      moment(d.departureDate).format("DD/MM/YYYY")
    );

    // Map date string -> { seatsTotal, seatsRemaining } để hiển thị số chỗ khi chọn ngày
    tourDetail.departureSeatsByDate = {};
    for (const d of validDeps) {
      const key = moment(d.departureDate).format("DD/MM/YYYY");
      tourDetail.departureSeatsByDate[key] = {
        seatsTotal: d.seatsTotal ?? 0,
        seatsRemaining: d.seatsRemaining ?? 0,
      };
    }

    // Nếu chưa có departureDateFormat thì lấy ngày đầu tiên
    if (
      (!tourDetail.departureDateFormat ||
        String(tourDetail.departureDateFormat).trim() === "") &&
      tourDetail.departureDatesFormatted.length > 0
    ) {
      tourDetail.departureDateFormat = tourDetail.departureDatesFormatted[0];
    }
  }

  // ====== ĐIỂM KHỞI HÀNH (departureCity) ======
  if (tourDetail.departureCity) {
    try {
      const depCity = await City.findById(tourDetail.departureCity).lean();
      if (depCity) {
        tourDetail.departureCity = String(depCity._id);
        tourDetail.departureCityName = depCity.name;
      }
    } catch (e) {
      // ignore
    }
  }

  // ====== CHUẨN HOÁ LOCATIONS + CITYLIST ======
  let cityList = [];
  const normalizedLocations = [];
  const cityIdSet = new Set();

  if (Array.isArray(tourDetail.locations) && tourDetail.locations.length > 0) {
    tourDetail.locations.forEach((loc) => {
      if (!loc) return;

      // loc có thể là subdocument/POJO
      const cityIdRaw = loc.cityId || loc.city || loc._id || null;
      const cityIdStr = cityIdRaw ? String(cityIdRaw) : null;

      // spots: mảng hoặc string nhiều dòng
      let spotsArr = [];
      if (Array.isArray(loc.spots)) {
        spotsArr = loc.spots;
      } else if (typeof loc.spots === "string") {
        spotsArr = loc.spots
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean);
      }

      if (cityIdStr && mongoose.Types.ObjectId.isValid(cityIdStr)) {
        cityIdSet.add(cityIdStr);
      }

      normalizedLocations.push({
        cityId: cityIdStr,
        cityName: loc.cityName || loc.cityLabel || null,
        spots: spotsArr,
      });
    });

    const cityIds = Array.from(cityIdSet);
    if (cityIds.length > 0) {
      cityList = await City.find({ _id: { $in: cityIds } })
        .sort({ name: "asc" })
        .lean();

      const cityNameMap = {};
      cityList.forEach((c) => {
        cityNameMap[String(c._id)] = c.name;
      });

      normalizedLocations.forEach((loc) => {
        if (!loc.cityName && loc.cityId && cityNameMap[loc.cityId]) {
          loc.cityName = cityNameMap[loc.cityId];
        }
      });
    }
  }

  // Gán lại cho object tourDetail để view sử dụng
  tourDetail.locations = normalizedLocations;
  tourDetail.cityList = cityList;

  // ⬇️ PHẦN: Lấy hoạt động gợi ý từ DB đã sync Amadeus
  let activities = [];

  if (tourDetail.cityList && tourDetail.cityList.length > 0) {
    const cityNames = tourDetail.cityList.map((c) => c.name);

    activities = await AmadeusActivity.find({
      cityName: { $in: cityNames },
    })
      .sort({ rating: -1, lastSyncedAt: -1 })
      .limit(6)
      .lean();
  }

  res.render("client/pages/tour-detail", {
    pageTitle: tourDetail.name,
    breadcrumb: breadcrumb,
    tourDetail: tourDetail,
    activities: activities,
  });
};

// ========= DANH SÁCH TẤT CẢ TOUR ĐANG KHUYẾN MÃI =========
// /tour/discount?page=1&sort=price_asc|price_desc|rating
module.exports.listDiscount = async (req, res) => {
  try {
    const breadcrumb = [
      { name: "Trang chủ", slug: "/" },
      { name: "Tour đang khuyến mãi", slug: "/tour/discount" },
    ];

    const sort = req.query.sort || "default";
    const basePath = "/tour/discount";
    const sortHrefs = {
      priceAsc: `${basePath}?sort=price_asc`,
      priceDesc: `${basePath}?sort=price_desc`,
      rating: `${basePath}?sort=rating`,
    };

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = 12;
    const skip = (page - 1) * limit;

    const nowMoment = moment();
    const now = nowMoment.toDate();

    const filter = {
      deleted: false,
      status: "active",
      discountFrom: { $lte: now },
      discountTo: { $gte: now },
      $or: [
        { discountPercent: { $gt: 0 } },
        { priceAdult: { $gt: 0 } },
        { priceChildren: { $gt: 0 } },
        { priceBaby: { $gt: 0 } },
      ],
    };

    // Cho phép lọc thêm theo tags nếu có query.tags (dùng chung box-filter)
    const { tags } = req.query;
    if (tags) {
      let tagArray = Array.isArray(tags) ? tags : [tags];
      tagArray = tagArray.filter((t) => t && typeof t === "string");
      if (tagArray.length > 0) {
        filter.tags = { $in: tagArray };
      }
    }

    let sortMongo = { discountTo: 1, discountFrom: -1, updatedAt: -1 };

    if (sort === "price_asc") {
      sortMongo = { priceNewAdult: 1, priceAdult: 1, discountTo: 1 };
    } else if (sort === "price_desc") {
      sortMongo = { priceNewAdult: -1, priceAdult: -1, discountTo: 1 };
    }

    const [totalRecord, tourListRaw] = await Promise.all([
      Tour.countDocuments(filter),
      Tour.find(filter).sort(sortMongo).skip(skip).limit(limit).lean(),
    ]);

    const totalPage = Math.max(Math.ceil(totalRecord / limit), 1);

    const tourList = tourListRaw.map((t) => {
      const clone = { ...t };

      const oldP = Number(clone.priceAdult || 0);
      const newP = Number(clone.priceNewAdult || 0);

      clone.discount =
        clone.discountPercent && clone.discountPercent > 0
          ? clone.discountPercent
          : oldP > 0
          ? Math.floor(((oldP - newP) / oldP) * 100)
          : 0;

      if (clone.departureDate) {
        clone.departureDateFormat = moment(clone.departureDate).format(
          "DD/MM/YYYY"
        );
      }

      // Danh sách ghế theo từng lịch khởi hành
      if (Array.isArray(clone.departures) && clone.departures.length > 0) {
        clone.departuresWithSeats = clone.departures
          .filter((d) => d && d.departureDate)
          .map((d) => ({
            dateFormatted: moment(d.departureDate).format("DD/MM/YYYY"),
            seatsTotal: d.seatsTotal ?? 0,
            seatsRemaining: d.seatsRemaining ?? 0,
          }));
      } else {
        clone.departuresWithSeats = [];
      }

      if (clone.discountFrom) {
        clone.discountFromFormat = moment(clone.discountFrom).format(
          "DD/MM/YYYY"
        );
      }
      if (clone.discountTo) {
        clone.discountToFormat = moment(clone.discountTo).format("DD/MM/YYYY");
        clone.discountExpireISO = moment(clone.discountTo)
          .endOf("day")
          .toISOString();
      }

      if (typeof clone.seatsRemaining === "number") {
        clone.seatsRemaining = clone.seatsRemaining;
      } else {
        const a = Number(clone.stockAdult || 0);
        const c = Number(clone.stockChildren || 0);
        const b = Number(clone.stockBaby || 0);
        clone.seatsRemaining = a + c + b;
      }

      return clone;
    });

    const rawIds = tourList.map((t) => t.companyId);
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
      companyById = Object.fromEntries(
        companies.map((c) => [String(c._id), c])
      );
    }

    for (const t of tourList) {
      const key = mongoose.Types.ObjectId.isValid(t.companyId)
        ? String(t.companyId)
        : null;
      t.company = key ? companyById[key] || null : null;
    }

    await attachRatings(tourList);

    if (sort === "rating") {
      tourList.sort(
        (a, b) => (Number(b.ratingAvg) || 0) - (Number(a.ratingAvg) || 0)
      );
    }

    const pagination = {
      page,
      limit,
      skip,
      totalRecord,
      totalPage,
    };

    return res.render("client/pages/tour-discount-list", {
      pageTitle: "Tour đang khuyến mãi",
      breadcrumb,
      tourList,
      pagination,
      sort,
      sortHrefs,
    });
  } catch (err) {
    console.error("tour.listDiscount (client) error:", err);
    const sort = req.query.sort || "default";
    const basePath = "/tour/discount";
    const sortHrefs = {
      priceAsc: `${basePath}?sort=price_asc`,
      priceDesc: `${basePath}?sort=price_desc`,
      rating: `${basePath}?sort=rating`,
    };

    return res.render("client/pages/tour-discount-list", {
      pageTitle: "Tour đang khuyến mãi",
      breadcrumb: [
        { name: "Trang chủ", slug: "/" },
        { name: "Tour đang khuyến mãi", slug: "/tour/discount" },
      ],
      tourList: [],
      pagination: {
        page: 1,
        limit: 12,
        skip: 0,
        totalRecord: 0,
        totalPage: 1,
      },
      sort,
      sortHrefs,
    });
  }
};

// ========= SO SÁNH TOUR =========
// GET /tour/compare?ids=id1,id2,id3
module.exports.compare = async (req, res) => {
  try {
    const { ids } = req.query;
    
    if (!ids) {
      return res.render("client/pages/tour-compare", {
        pageTitle: "So sánh tour du lịch",
        tours: [],
      });
    }

    // Parse tour IDs từ query string
    const tourIds = String(ids)
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id && mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));

    if (tourIds.length === 0) {
      return res.render("client/pages/tour-compare", {
        pageTitle: "So sánh tour du lịch",
        tours: [],
      });
    }

    // Lấy thông tin tour từ database
    const tours = await Tour.find({
      _id: { $in: tourIds },
      deleted: false,
      status: "active",
    })
      .populate("companyId", "name slug logo")
      .populate("departureCity", "name")
      .populate("locations.city", "name")
      .lean();

    // Sắp xếp theo thứ tự trong query
    const tourMap = new Map(tours.map((t) => [String(t._id), t]));
    const orderedTours = tourIds
      .map((id) => tourMap.get(String(id)))
      .filter(Boolean);

    // Gắn rating cho tours
    await attachRatings(orderedTours);

    // Gắn tên điểm khởi hành và normalize locations
    const cityIdSet = new Set();
    
    // Bước 1: Normalize locations và thu thập city IDs
    orderedTours.forEach((tour) => {
      if (tour.departureCity && tour.departureCity.name) {
        tour.departureCityName = tour.departureCity.name;
      }

      // Normalize locations giống như tour detail
      if (Array.isArray(tour.locations) && tour.locations.length > 0) {
        const normalizedLocations = [];
        tour.locations.forEach((loc) => {
          if (!loc) return;

          const cityIdRaw = loc.city?._id || loc.city || loc.cityId || null;
          const cityIdStr = cityIdRaw ? String(cityIdRaw) : null;

          // spots: mảng hoặc string nhiều dòng
          let spotsArr = [];
          if (Array.isArray(loc.spots)) {
            spotsArr = loc.spots;
          } else if (typeof loc.spots === "string") {
            spotsArr = loc.spots
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean);
          }

          if (cityIdStr && mongoose.Types.ObjectId.isValid(cityIdStr)) {
            cityIdSet.add(cityIdStr);
          }

          normalizedLocations.push({
            cityId: cityIdStr,
            cityName: loc.city?.name || loc.cityName || loc.cityLabel || null,
            spots: spotsArr,
          });
        });

        tour.locations = normalizedLocations;
      }
    });

    // Bước 2: Lấy tên city từ database nếu chưa có
    if (cityIdSet.size > 0) {
      const cityIds = Array.from(cityIdSet)
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));
      
      if (cityIds.length > 0) {
        const cityList = await City.find({ _id: { $in: cityIds } })
          .select("name")
          .lean();

        const cityNameMap = {};
        cityList.forEach((c) => {
          cityNameMap[String(c._id)] = c.name;
        });

        // Cập nhật cityName cho các location chưa có
        orderedTours.forEach((tour) => {
          if (tour.locations && Array.isArray(tour.locations)) {
            tour.locations.forEach((loc) => {
              if (!loc.cityName && loc.cityId && cityNameMap[loc.cityId]) {
                loc.cityName = cityNameMap[loc.cityId];
              }
            });
          }
        });
      }
    }

    // Format giá và thông tin khác
    orderedTours.forEach((tour) => {
      tour.priceAdultFormatted = Number(tour.priceAdult || 0).toLocaleString("vi-VN");
      tour.priceNewAdultFormatted = Number(tour.priceNewAdult || tour.priceAdult || 0).toLocaleString("vi-VN");
      tour.discount = tour.priceAdult && tour.priceNewAdult && tour.priceAdult > tour.priceNewAdult
        ? Math.round(((tour.priceAdult - tour.priceNewAdult) / tour.priceAdult) * 100)
        : 0;
      if (tour.departureDate) {
        tour.departureDateFormat = moment(tour.departureDate).format("DD/MM/YYYY");
      }

      // Tính departuresWithSeats để hiển thị số chỗ theo từng ngày khởi hành
      tour.departuresWithSeats =
        Array.isArray(tour.departures) && tour.departures.length > 0
          ? tour.departures
              .filter((d) => d && d.departureDate)
              .map((d) => ({
                dateFormatted: moment(d.departureDate).format("DD/MM/YYYY"),
                seatsTotal: d.seatsTotal ?? 0,
                seatsRemaining: d.seatsRemaining ?? 0,
              }))
          : [];
    });

    return res.render("client/pages/tour-compare", {
      pageTitle: "So sánh tour du lịch",
      tours: orderedTours,
    });
  } catch (err) {
    console.error("tour.compare error:", err);
    return res
      .status(500)
      .render("client/pages/500", { pageTitle: "Lỗi hệ thống" });
  }
};
