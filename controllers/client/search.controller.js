// controllers/client/search.controller.js
const moment = require("moment");
const mongoose = require("mongoose");
const Tour = require("../../models/tour.model");
const Company = require("../../models/company.model");

/* ------------------- helpers giống category/company ------------------- */
function escapeRegex(str = "") {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Tạo điều kiện tìm theo các token trong q trong trường name (tiêu đề tour)
 * q: "Điện Biên" -> token ["Điện", "Biên"]
 * => { $and: [ { name: /Điện/i }, { name: /Biên/i } ] }
 */
function nameContainsTokens(q) {
  const raw = String(q || "").trim();
  if (!raw) return null;

  const tokens = raw
    .split(/\s*-\s*|\s+/) // tách theo "-" và khoảng trắng
    .map((t) => t.trim())
    .filter(Boolean);

  if (!tokens.length) return null;

  return {
    $and: tokens.map((t) => {
      const regex = new RegExp(escapeRegex(t), "i");
      return {
        $or: [
          // 1) Tiêu đề tour
          { name: regex },

          // 2) Tên tỉnh/thành trong locations
          { "locations.cityName": regex },
          { "locations.cityLabel": regex },

          // 3) Các điểm nổi tiếng — mảng spots trong từng phần tử locations
          { "locations.spots": regex },
        ],
      };
    }),
  };
}

/* ----------------------------- /search list ---------------------------- */
module.exports.list = async (req, res) => {
  try {
    const {
      q, // nơi muốn đi? (địa điểm tự do)
      departureDate,
      price, // "min-max"
      minSeats, // số chỗ trống tối thiểu
      sort, // key sort: price_asc | price_desc | rating
      tags,
    } = req.query;

    const sortKey = sort || "rating";

    // Điều kiện chung
    const find = {
      deleted: false,
      status: "active",
    };

    // 1. Tìm theo tiêu đề tour (name)
    const nameCond = nameContainsTokens(q);
    if (nameCond) Object.assign(find, nameCond); // gắn điều kiện vào find

    // 2. Ngày khởi hành
    if (departureDate) {
      find.departureDate = new Date(departureDate);
    }

    // 3. Số chỗ trống tối thiểu: tìm tour có ÍT NHẤT 1 ngày khởi hành còn đủ chỗ
    const seats = Number(minSeats) || 0;
    if (seats > 0) {
      find.departures = { $elemMatch: { seatsRemaining: { $gte: seats } } };
    }

    // 4. Khoảng giá priceNewAdult: "min-max"
    if (price && /^\d+-\d+$/.test(price)) {
      const [priceMin, priceMax] = price.split("-").map(Number);
      find.priceNewAdult = { $gte: priceMin, $lte: priceMax };
    }

    // 5. Lọc theo tags (loại hình trải nghiệm)
    let tagArray = [];
    if (tags) {
      tagArray = Array.isArray(tags) ? tags : [tags];
      tagArray = tagArray.filter((t) => t && typeof t === "string");
    }
    if (tagArray.length > 0) {
      find.tags = { $in: tagArray };
    }

    // 5. Phân trang (tính limitItems, skip TRƯỚC khi dùng)
    const limitItems = 12;
    let page = 1;
    if (req.query.page && parseInt(req.query.page) > 0) {
      page = parseInt(req.query.page);
    }
    const skip = (page - 1) * limitItems;
    const totalRecord = await Tour.countDocuments(find);
    const totalPage = Math.ceil(totalRecord / limitItems);
    const pagination = {
      skip,
      totalRecord,
      totalPage,
    };

    // 6. Lấy danh sách tour
    const tourList = await Tour.find(find)
      .sort({ position: "asc" })
      .limit(limitItems)
      .skip(skip)
      .lean();

    // 7. Decorate: % giảm, ngày, seatsRemaining fallback
    for (const item of tourList) {
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
    }

    // 8. Gắn thông tin công ty để product.pug hiển thị
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

    // 9. Áp dụng sắp xếp theo sortKey (trên mảng tourList)
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

    // 10. sortHrefs để đổi sort mà không mất filter hiện tại
    const params = new URLSearchParams(req.query);
    params.delete("sort");
    params.delete("page"); // đổi sort thì về trang 1
    const base = params.toString();
    const makeSortHref = (k) => (base ? `?${base}&sort=${k}` : `?sort=${k}`);

    return res.render("client/pages/search", {
      pageTitle: q ? `Kết quả cho "${q}"` : "Kết quả tìm kiếm",
      tourList,
      pagination,
      sort: sortKey,
      sortHrefs: {
        priceAsc: makeSortHref("price_asc"),
        priceDesc: makeSortHref("price_desc"),
        rating: makeSortHref("rating"),
      },
      query: req.query,
    });
  } catch (error) {
    console.error("search.list error:", error);
    return res.redirect("/");
  }
};
