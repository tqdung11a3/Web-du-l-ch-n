// controllers/client/category.controller.js
const Category = require("../../models/category.model");
const categoryHelper = require("../../helpers/category.helper");
const moment = require("moment");
const mongoose = require("mongoose");
const Company = require("../../models/company.model");
const Tour = require("../../models/tour.model");
const Review = require("../../models/review.model");
const City = require("../../models/city.model");

/* ----------------- Helpers: tìm theo tiêu đề + địa điểm ----------------- */
function escapeRegex(str = "") {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Tạo điều kiện $and các token, mỗi token phải xuất hiện trong
 *  - name (tiêu đề tour)
 *  - locations.cityName / locations.cityLabel
 *  - locations.spots (mảng string: các điểm nổi tiếng trong tỉnh/thành)
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
          { name: regex },
          { "locations.cityName": regex },
          { "locations.cityLabel": regex },
          { "locations.spots": regex },
        ],
      };
    }),
  };
}

/** ép về number an toàn trong pipeline */
function toNumberExpr(pathOrExpr) {
  // $convert sẽ cố gắng chuyển chuỗi -> số, nếu lỗi trả 0
  return {
    $convert: {
      input: pathOrExpr,
      to: "double",
      onError: 0,
      onNull: 0,
    },
  };
}

module.exports.list = async (req, res) => {
  try {
    const slug = req.params.slug;

    // 1) Thông tin danh mục
    const categoryDetail = await Category.findOne({
      slug,
      deleted: false,
      status: "active",
    }).lean();
    if (!categoryDetail) return res.redirect("/");

    // 2) Breadcrumb
    const breadcrumb = [];
    if (categoryDetail.parent) {
      const parentList = await categoryHelper.getCategoryParent(
        categoryDetail.parent
      );
      for (const item of parentList) breadcrumb.push(item);
    }
    breadcrumb.push({
      id: categoryDetail._id,
      name: categoryDetail.name,
      avatar: categoryDetail.avatar,
      slug: categoryDetail.slug,
    });

    // 3) Chuẩn bị ID danh mục (gồm con)
    const categoryId = String(categoryDetail._id);
    const categoryChild = await categoryHelper.getCategoryChild(categoryId);
    const categoryChildId = categoryChild.map((item) => item.id);

    // 4) Query params (filter + sort)
    const {
      q,
      locationFrom,
      locationTo,
      departureDate, // yyyy-mm-dd
      price, // "min-max"
      minSeats, // số chỗ trống tối thiểu
      tags,
    } = req.query;
    const sortKey = (req.query.sort || "rating").trim(); // default: rating

    // 5) Pipeline filter
    const matchBase = {
      category: { $in: [categoryId, ...categoryChildId] },
      deleted: false,
      status: "active",
    };

    const keywordCond = nameOrLocationContainsTokens(q);
    if (keywordCond) Object.assign(matchBase, keywordCond);
    if (locationFrom) matchBase.locationFrom = locationFrom;
    if (locationTo) matchBase.locationTo = locationTo;

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

    let priceCond = null;
    if (price && /^\d+-\d+$/.test(price)) {
      const [min, max] = price.split("-").map(Number);
      priceCond = { $gte: min, $lte: max };
    }

    const pipeline = [
      { $match: matchBase },
      {
        $addFields: {
          _priceAdult: toNumberExpr("$priceAdult"),
          _priceNewAdult: toNumberExpr("$priceNewAdult"),
          _stockAdult: toNumberExpr("$stockAdult"),
          _stockChildren: toNumberExpr("$stockChildren"),
          _seatsRemaining: toNumberExpr("$seatsRemaining"),
        },
      },
      {
        $addFields: {
          seatsRemainingEff: {
            $cond: [
              { $gt: ["$_seatsRemaining", 0] },
              "$_seatsRemaining",
              { $add: ["$_stockAdult", "$_stockChildren"] },
            ],
          },
        },
      },
    ];

    if (priceCond) {
      pipeline.push({ $match: { _priceNewAdult: priceCond } });
    }

    const needSeats = Number(minSeats) || 0;
    if (needSeats > 0) {
      pipeline.push({
        $match: { departures: { $elemMatch: { seatsRemaining: { $gte: needSeats } } } },
      });
    }

    // sort ổn định trước
    pipeline.push({ $sort: { position: 1 } });

    // 6) Lấy dữ liệu thô
    const tourListRaw = await Tour.aggregate(pipeline);

    // 7) Decorate: format + discount + NGÀY KHUYẾN MÃI
    let tourList = tourListRaw.map((t) => {
      const oldP = Number(t._priceAdult ?? t.priceAdult ?? 0);
      const newP = Number(t._priceNewAdult ?? t.priceNewAdult ?? 0);
      const discount = oldP > 0 ? Math.floor(((oldP - newP) / oldP) * 100) : 0;

      const departureDateFormat = t.departureDate
        ? moment(t.departureDate).format("DD/MM/YYYY")
        : "";

      const discountFromFormat = t.discountFrom
        ? moment(t.discountFrom).format("DD/MM/YYYY")
        : "";
      const discountToFormat = t.discountTo
        ? moment(t.discountTo).format("DD/MM/YYYY")
        : "";

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
        departuresWithSeats,
        seatsRemaining:
          typeof t.seatsRemainingEff === "number"
            ? t.seatsRemainingEff
            : Number(t.seatsRemaining || 0),
      };
    });

    // 8) Tính ratingAvg & ratingCount
    const tourIds = tourList.map((t) => t._id);
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
    const ratingMap = Object.fromEntries(
      ratingAgg.map((r) => [
        String(r._id),
        {
          ratingAvg: Number((r.ratingAvg || 0).toFixed(1)),
          ratingCount: r.ratingCount || 0,
        },
      ])
    );
    tourList.forEach((t) => {
      const r = ratingMap[String(t._id)] || { ratingAvg: 0, ratingCount: 0 };
      t.ratingAvg = r.ratingAvg;
      t.ratingCount = r.ratingCount;
    });

    // 9) Gắn tên điểm khởi hành (departureCityName) cho từng tour
    const departureIds = Array.from(
      new Set(
        tourList
          .map((t) => (t && t.departureCity ? String(t.departureCity) : ""))
          .filter((id) => id && mongoose.Types.ObjectId.isValid(id))
      )
    ).map((id) => new mongoose.Types.ObjectId(id));

    if (departureIds.length) {
      const cities = await City.find({ _id: { $in: departureIds } })
        .select("name")
        .lean();

      const depMap = new Map(cities.map((c) => [String(c._id), c.name]));

      tourList.forEach((t) => {
        const cid = t && t.departureCity ? String(t.departureCity) : "";
        if (cid && depMap.has(cid)) {
          t.departureCityName = depMap.get(cid);
        }
      });
    }

    // 10) Gắn thông tin công ty
    const validCompanyIds = Array.from(
      new Set(
        tourList
          .map((t) => (t && t.companyId ? String(t.companyId) : ""))
          .filter((id) => id && mongoose.Types.ObjectId.isValid(id))
      )
    ).map((id) => new mongoose.Types.ObjectId(id));

    if (validCompanyIds.length) {
      const companies = await Company.find({ _id: { $in: validCompanyIds } })
        .select("name slug logo hotline address")
        .lean();
      const cmap = new Map(companies.map((c) => [String(c._id), c]));
      tourList.forEach((t) => {
        const c = cmap.get(String(t.companyId));
        if (c) t.company = c;
      });
    }

    // 11) Áp dụng sắp xếp theo sortKey
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

    // 12) Phân trang (sau khi đã sort)
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

    // 13) sortHrefs để đổi sort mà không mất các filter hiện tại
    const params = new URLSearchParams(req.query);
    params.delete("sort");
    params.delete("page"); // đổi sort thì về trang 1
    const base = params.toString();
    const makeSortHref = (k) => (base ? `?${base}&sort=${k}` : `?sort=${k}`);

    return res.render("client/pages/tour-list", {
      pageTitle: "Danh sách tour",
      categoryDetail,
      breadcrumb,
      pagination,
      tourList: tourListPaged,
      sort: sortKey,
      sortHrefs: {
        priceAsc: makeSortHref("price_asc"),
        priceDesc: makeSortHref("price_desc"),
        rating: makeSortHref("rating"),
      },
      query: req.query,
    });
  } catch (err) {
    console.error("category.list error:", err);
    return res.status(500).send("Lỗi hệ thống, vui lòng thử lại sau.");
  }
};
