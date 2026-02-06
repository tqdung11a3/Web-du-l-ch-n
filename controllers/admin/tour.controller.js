const Category = require("../../models/category.model");
const categoryHelper = require("../../helpers/category.helper");
const City = require("../../models/city.model");
const Country = require("../../models/country.model");
const Tour = require("../../models/tour.model");
const AccountAdmin = require("../../models/account-admin.model");
const { pathAdmin } = require("../../config/variable.config");
const moment = require("moment");
const mongoose = require("mongoose");
const slugify = require("slugify");

function escapeRegex(str = "") {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Chuẩn hoá payload locations từ client về dạng:
 *   [{ city: ObjectId|string, spots: [String] }, ...]
 * Hỗ trợ cả dữ liệu cũ (mảng cityId thuần, không có spots).
 */
function parseLocationsPayload(raw) {
  if (!raw) return [];

  let arr;
  try {
    arr = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return [];
  }

  if (!Array.isArray(arr)) return [];

  const result = [];
  for (const item of arr) {
    if (!item) continue;

    // 1) Lấy city id
    let city =
      item.city ||
      item.cityId ||
      item._id ||
      item.id ||
      (typeof item === "string" || typeof item === "number" ? item : null);

    if (!city) continue;

    // 2) Lấy danh sách địa điểm (spots)
    let spots = item.spots;

    // Cho phép gửi lên dạng text (spotsText) -> tách theo dòng
    if (!spots && typeof item.spotsText === "string") {
      spots = item.spotsText;
    }

    if (typeof spots === "string") {
      spots = spots
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (Array.isArray(spots)) {
      spots = spots.map((s) => String(s).trim()).filter(Boolean);
    } else {
      spots = [];
    }

    result.push({ city, spots });
  }

  return result;
}

// Lấy "giá gốc" để dùng làm cơ sở tính khuyến mãi (%)
function getBasePrices(tour) {
  const baseAdult =
    tour.backupPriceNewAdult && tour.backupPriceNewAdult > 0
      ? tour.backupPriceNewAdult
      : tour.priceNewAdult && tour.priceNewAdult > 0
      ? tour.priceNewAdult
      : tour.priceAdult || 0;

  const baseChildren =
    tour.backupPriceNewChildren && tour.backupPriceNewChildren > 0
      ? tour.backupPriceNewChildren
      : tour.priceNewChildren && tour.priceNewChildren > 0
      ? tour.priceNewChildren
      : tour.priceChildren || 0;

  const baseBaby =
    tour.backupPriceNewBaby && tour.backupPriceNewBaby > 0
      ? tour.backupPriceNewBaby
      : tour.priceNewBaby && tour.priceNewBaby > 0
      ? tour.priceNewBaby
      : tour.priceBaby || 0;

  return { baseAdult, baseChildren, baseBaby };
}

// Hủy khuyến mãi theo % trên 1 tour: giá mới quay về gốc, giá cũ = 0, xoá thông tin giảm giá
function cancelDiscountOnDoc(tour) {
  const { baseAdult, baseChildren, baseBaby } = getBasePrices(tour);

  // giá đang bán = giá gốc
  tour.priceNewAdult = baseAdult;
  tour.priceNewChildren = baseChildren;
  tour.priceNewBaby = tour.babyPricingMode === "fixed" ? baseBaby : 0;

  // cột "giá cũ" không còn
  tour.priceAdult = 0;
  tour.priceChildren = 0;
  tour.priceBaby = 0;

  // xoá cấu hình khuyến mãi
  tour.discountPercent = 0;
  tour.discountFrom = null;
  tour.discountTo = null;

  // xoá backup
  tour.backupPriceNewAdult = 0;
  tour.backupPriceNewChildren = 0;
  tour.backupPriceNewBaby = 0;

  // *** QUAN TRỌNG: đánh dấu là chưa áp dụng khuyến mãi
  tour.discountApplied = false;
}

/**
 * Làm mới trạng thái khuyến mãi:
 *  - Kích hoạt giảm giá cho các tour đang trong khoảng thời gian khuyến mãi mà chưa apply
 *  - Hủy giảm giá cho các tour đã hết hạn / ra khỏi khoảng khuyến mãi
 * (chỉ áp dụng cho KHUYẾN MÃI THEO %, không đụng tới giảm theo số tiền cố định)
 */
async function refreshDiscounts(companyId) {
  if (!companyId) return;

  const now = new Date();

  // ===== 1) KÍCH HOẠT KHUYẾN MÃI THEO % (apply giá giảm) =====
  await Tour.updateMany(
    {
      companyId,
      deleted: false,
      discountPercent: { $gt: 0 },
      discountFrom: { $lte: now },
      discountTo: { $gte: now },
      discountApplied: { $ne: true },
    },
    [
      {
        $set: {
          // Giá gốc để làm cơ sở giảm
          _baseAdult: {
            $cond: [
              { $gt: ["$backupPriceNewAdult", 0] },
              "$backupPriceNewAdult",
              {
                $cond: [
                  { $gt: ["$priceNewAdult", 0] },
                  "$priceNewAdult",
                  "$priceAdult",
                ],
              },
            ],
          },
          _baseChildren: {
            $cond: [
              { $gt: ["$backupPriceNewChildren", 0] },
              "$backupPriceNewChildren",
              {
                $cond: [
                  { $gt: ["$priceNewChildren", 0] },
                  "$priceNewChildren",
                  "$priceChildren",
                ],
              },
            ],
          },
          _baseBaby: {
            $cond: [
              { $gt: ["$backupPriceNewBaby", 0] },
              "$backupPriceNewBaby",
              {
                $cond: [
                  { $gt: ["$priceNewBaby", 0] },
                  "$priceNewBaby",
                  "$priceBaby",
                ],
              },
            ],
          },
        },
      },
      {
        $set: {
          // Giá cũ hiển thị trên form
          priceAdult: "$_baseAdult",
          priceChildren: "$_baseChildren",
          priceBaby: {
            $cond: [{ $eq: ["$babyPricingMode", "fixed"] }, "$_baseBaby", 0],
          },

          // Hệ số giảm giá: (100 - discountPercent) / 100
          priceNewAdult: {
            $round: [
              {
                $multiply: [
                  "$_baseAdult",
                  {
                    $divide: [{ $subtract: [100, "$discountPercent"] }, 100],
                  },
                ],
              },
              0,
            ],
          },
          priceNewChildren: {
            $round: [
              {
                $multiply: [
                  "$_baseChildren",
                  {
                    $divide: [{ $subtract: [100, "$discountPercent"] }, 100],
                  },
                ],
              },
              0,
            ],
          },
          priceNewBaby: {
            $cond: [
              { $eq: ["$babyPricingMode", "fixed"] },
              {
                $round: [
                  {
                    $multiply: [
                      "$_baseBaby",
                      {
                        $divide: [
                          { $subtract: [100, "$discountPercent"] },
                          100,
                        ],
                      },
                    ],
                  },
                  0,
                ],
              },
              0,
            ],
          },

          discountApplied: true,
        },
      },
      {
        $unset: ["_baseAdult", "_baseChildren", "_baseBaby"],
      },
    ]
  );

  // ===== 2) HẾT HẠN / KHÔNG CÒN ACTIVE → TRẢ GIÁ VỀ GỐC (THEO %) =====
  await Tour.updateMany(
    {
      companyId,
      deleted: false,
      discountApplied: true,
      $or: [
        { discountPercent: { $lte: 0 } },
        { discountTo: { $lt: now } },
        { discountFrom: { $gt: now } }, // trường hợp đổi ngày
      ],
    },
    [
      {
        $set: {
          // Giá mới trở lại giá gốc
          priceNewAdult: {
            $cond: [
              { $gt: ["$backupPriceNewAdult", 0] },
              "$backupPriceNewAdult",
              {
                $cond: [
                  { $gt: ["$priceNewAdult", 0] },
                  "$priceNewAdult",
                  "$priceAdult",
                ],
              },
            ],
          },
          priceNewChildren: {
            $cond: [
              { $gt: ["$backupPriceNewChildren", 0] },
              "$backupPriceNewChildren",
              {
                $cond: [
                  { $gt: ["$priceNewChildren", 0] },
                  "$priceNewChildren",
                  "$priceChildren",
                ],
              },
            ],
          },
          priceNewBaby: {
            $cond: [
              { $gt: ["$backupPriceNewBaby", 0] },
              "$backupPriceNewBaby",
              {
                $cond: [
                  { $gt: ["$priceNewBaby", 0] },
                  "$priceNewBaby",
                  "$priceBaby",
                ],
              },
            ],
          },

          // Giá cũ reset về 0
          priceAdult: 0,
          priceChildren: 0,
          priceBaby: 0,

          // Xoá thông tin khuyến mãi + backup + applied flag
          discountPercent: 0,
          discountFrom: null,
          discountTo: null,
          backupPriceNewAdult: 0,
          backupPriceNewChildren: 0,
          backupPriceNewBaby: 0,
          discountApplied: false,
        },
      },
    ]
  );
}

/**
 * Dọn sạch các khuyến mãi GIẢM LINH HOẠT (không dùng %) đã hết hạn
 * - Dùng priceAdult/Children/Baby làm "giá gốc" nếu có
 * - Trả priceNew* về giá gốc, xoá giá cũ & thời gian khuyến mãi
 */
async function cleanExpiredFixedDiscounts(companyId) {
  if (!companyId) return;

  const now = new Date();

  await Tour.updateMany(
    {
      companyId,
      deleted: false,
      // Giảm linh hoạt: không dùng % hoặc % <= 0
      $or: [
        { discountPercent: { $exists: false } },
        { discountPercent: { $lte: 0 } },
      ],
      // Có thời gian KM và đã hết hạn
      discountFrom: { $ne: null },
      discountTo: { $lt: now },
    },
    [
      {
        $set: {
          // Sau khi hết hạn: bán theo GIÁ GỐC
          // Giá gốc = cột price* nếu > 0, nếu không thì giữ nguyên priceNew*
          priceNewAdult: {
            $cond: [
              { $gt: ["$priceAdult", 0] },
              "$priceAdult",
              "$priceNewAdult",
            ],
          },
          priceNewChildren: {
            $cond: [
              { $gt: ["$priceChildren", 0] },
              "$priceChildren",
              "$priceNewChildren",
            ],
          },
          priceNewBaby: {
            $cond: [
              { $eq: ["$babyPricingMode", "fixed"] },
              {
                $cond: [
                  { $gt: ["$priceBaby", 0] },
                  "$priceBaby",
                  "$priceNewBaby",
                ],
              },
              0, // tiered: không dùng priceNewBaby
            ],
          },

          // Cột giá cũ reset về 0
          priceAdult: 0,
          priceChildren: 0,
          priceBaby: 0,

          // Xoá cấu hình khuyến mãi & backup
          discountFrom: null,
          discountTo: null,
          discountPercent: 0,
          discountApplied: false,
          backupPriceNewAdult: 0,
          backupPriceNewChildren: 0,
          backupPriceNewBaby: 0,
        },
      },
    ]
  );
}

module.exports.list = async (req, res) => {
  try {
    const companyId = req.account.companyId;

    // Mỗi lần vào danh sách tour thì reset các khuyến mãi đã hết hạn
    await refreshDiscounts(companyId); // xử lý khuyến mãi %
    await cleanExpiredFixedDiscounts(companyId); // dọn giảm linh hoạt hết hạn

    const find = { deleted: false, companyId };

    // Lọc theo tab: Tour trong nước hoặc Tour nước ngoài
    const tab = req.query.tab || "domestic"; // mặc định là "domestic" (tour trong nước)
    let categoryIds = [];

    if (tab === "domestic" || tab === "international") {
      try {
        // Tìm category cha theo tên hoặc slug
        const parentCategoryName = tab === "domestic" ? "tour trong nước" : "tour nước ngoài";
        const parentCategorySlug = tab === "domestic" ? "tour-trong-nuoc" : "tour-nuoc-ngoai";
        
        // Tìm category cha theo tên hoặc slug
        const parentCategory = await Category.findOne({
          $or: [
            { name: { $regex: new RegExp(parentCategoryName, "i") } },
            { slug: { $regex: new RegExp(parentCategorySlug, "i") } }
          ],
          deleted: false,
          status: "active"
        });

        if (parentCategory) {
          const parentId = String(parentCategory._id);
          // Lấy tất cả category con (bao gồm cả chính nó)
          const categoryChild = await categoryHelper.getCategoryChild(parentId);
          categoryIds = [parentId, ...categoryChild.map((item) => item.id)];
          
          // Lọc tour theo category
          if (categoryIds.length > 0) {
            find.category = { $in: categoryIds };
          }
        }
      } catch (categoryError) {
        console.error("Error filtering by category:", categoryError);
        // Nếu có lỗi khi tìm category, bỏ qua filter và hiển thị tất cả tour
      }
    }

  // Phân trang
  const limitItems = 10;
  let page = 1;
  if (req.query.page && parseInt(req.query.page) > 0) {
    page = parseInt(req.query.page);
  }
  const skip = (page - 1) * limitItems;
  const totalRecord = await Tour.countDocuments(find);
  const totalPage = Math.ceil(totalRecord / limitItems);
  const pagination = {
    skip: skip,
    totalRecord: totalRecord,
    totalPage: totalPage,
  };
  // Hết Phân trang

  // Tìm kiếm
  if (req.query.keyword) {
    const rawKeyword = req.query.keyword.trim();

    // search theo slug (không dấu)
    const keywordSlug = slugify(rawKeyword, { lower: true });
    const slugRegex = new RegExp(keywordSlug, "i");

    // search thêm theo name (có dấu) để bắt cả trường hợp đổi tên mà không đổi slug
    const nameRegex = new RegExp(escapeRegex(rawKeyword), "i");

    // tour phải thuộc công ty & chưa xóa (find đã có sẵn),
    // đồng thời thỏa 1 trong 2 điều kiện: slug chứa keywordSlug HOẶC name chứa rawKeyword
    find.$or = [{ slug: slugRegex }, { name: nameRegex }];
  }
  // Hết Tìm kiếm

  const tourList = await Tour.find(find)
    .sort({
      position: "asc",
    })
    .limit(limitItems)
    .skip(skip);

  for (const item of tourList) {
    if (item.createdBy) {
      const infoAccount = await AccountAdmin.findOne({
        _id: item.createdBy,
      });
      if (infoAccount) {
        item.createdByFullName = infoAccount.fullName;
      }
    }

    if (item.updatedBy) {
      const infoAccount = await AccountAdmin.findOne({
        _id: item.updatedBy,
      });
      if (infoAccount) {
        item.updatedByFullName = infoAccount.fullName;
      }
    }

    item.createdAtFormat = moment(item.createdAt).format("HH:mm - DD/MM/YYYY");
    item.updatedAtFormat = moment(item.updatedAt).format("HH:mm - DD/MM/YYYY");

    // Format thời gian khuyến mãi (nếu có) để hiển thị
    if (item.discountFrom) {
      item.discountFromFormat = moment(item.discountFrom).format("DD/MM/YYYY");
    }
    if (item.discountTo) {
      item.discountToFormat = moment(item.discountTo).format("DD/MM/YYYY");
    }
  }

    res.render("admin/pages/tour-list", {
      pageTitle: "Quản lý tour",
      tourList: tourList,
      pagination: pagination,
      currentTab: tab,
    });
  } catch (error) {
    console.error("Tour list error:", error);
    res.status(500).render("admin/pages/500", { pageTitle: "Lỗi hệ thống" });
  }
};

module.exports.listDiscounts = async (req, res) => {
  try {
    const companyId = req.account.companyId;

    // Cập nhật trạng thái khuyến mãi trước (kích hoạt / hủy nếu hết hạn)
    await refreshDiscounts(companyId); // % giảm
    await cleanExpiredFixedDiscounts(companyId); // giảm linh hoạt hết hạn

    const now = new Date();

    // Lấy các tour:
    //  - thuộc công ty
    //  - chưa bị xóa
    //  - có thông tin thời gian khuyến mãi (dùng chung cho cả % và giảm theo số tiền cố định)
    const find = {
      companyId,
      deleted: false,
      discountFrom: { $ne: null },
      discountTo: { $ne: null },
    };

    const tourList = await Tour.find(find)
      .sort({ discountFrom: 1, name: 1 })
      .lean();

    // Chuẩn hoá thông tin hiển thị
    for (const item of tourList) {
      if (item.discountFrom && item.discountTo) {
        if (item.discountFrom <= now && item.discountTo >= now) {
          item.discountStatus = "active";
        } else if (item.discountFrom > now) {
          item.discountStatus = "upcoming";
        } else {
          item.discountStatus = "expired";
        }

        // dùng cho hiển thị text
        item.discountFromFormat = moment(item.discountFrom).format(
          "DD/MM/YYYY"
        );
        item.discountToFormat = moment(item.discountTo).format("DD/MM/YYYY");

        // dùng cho input[type=date]
        item.discountFromInput = moment(item.discountFrom).format("YYYY-MM-DD");
        item.discountToInput = moment(item.discountTo).format("YYYY-MM-DD");
      } else {
        item.discountStatus = "none";
        item.discountFromInput = "";
        item.discountToInput = "";
      }

      // Hiển thị cột % giảm: với tour giảm theo số tiền cố định thì để chuỗi rỗng
      item.discountPercentDisplay =
        item.discountPercent && item.discountPercent > 0
          ? item.discountPercent
          : "";

      // mấy dòng format giá nếu muốn giữ lại thì ok
      item.priceNewAdultFormat = item.priceNewAdult?.toLocaleString("vi-VN");
      item.priceNewChildrenFormat =
        item.priceNewChildren?.toLocaleString("vi-VN");
      item.priceNewBabyFormat = item.priceNewBaby?.toLocaleString("vi-VN");
    }

    return res.render("admin/pages/tour-discount-list", {
      pageTitle: "Tour khuyến mãi",
      tourList,
    });
  } catch (err) {
    console.error("tour.listDiscounts error:", err);
    return res.render("admin/pages/tour-discount-list", {
      pageTitle: "Tour khuyến mãi",
      tourList: [],
    });
  }
};

module.exports.create = async (req, res) => {
  const categoryList = await Category.find({});

  const categoryTree = categoryHelper.buildCategoryTree(categoryList, "");

  // Lấy danh sách thành phố Việt Nam (không có countryId hoặc countryName không phải Châu Âu)
  const vietnamCities = await City.find({
    $or: [
      { countryId: null },
      { countryName: { $exists: false } },
      { countryName: "" },
    ],
    deleted: { $ne: true },
  }).sort({ name: 1 });

  // Lấy danh sách quốc gia Châu Âu
  const europeanCountriesRaw = await Country.find({
    continent: "Europe",
    deleted: { $ne: true },
    status: "active",
  }).sort({ name: 1 }).lean();

  // Chuyển đổi _id thành string
  const europeanCountries = europeanCountriesRaw.map((country) => ({
    _id: String(country._id),
    id: String(country._id),
    name: country.name || "",
    nameEn: country.nameEn || "",
    code: country.code || "",
  }));

  // Lấy danh sách thành phố Châu Âu (có countryId)
  const europeanCitiesRaw = await City.find({
    countryId: { $exists: true, $ne: null },
    deleted: { $ne: true },
  })
    .populate("countryId", "name code")
    .sort({ countryName: 1, name: 1 })
    .lean(); // Sử dụng lean() để trả về plain object

  // Chuyển đổi countryId thành string để dễ xử lý ở client
  const europeanCities = europeanCitiesRaw.map((city) => {
    let countryIdStr = null;
    if (city.countryId) {
      if (typeof city.countryId === 'object' && city.countryId._id) {
        countryIdStr = String(city.countryId._id);
      } else {
        countryIdStr = String(city.countryId);
      }
    }
    return {
      _id: String(city._id),
      id: String(city._id),
      name: city.name || "",
      nameEn: city.nameEn || "",
      countryId: countryIdStr,
      countryName: city.countryName || "",
    };
  });

  // Kiểm tra query param để xác định loại tour (trong nước / nước ngoài)
  const tourType = req.query.type; // 'domestic' hoặc 'international'
  const isInternationalTour = tourType === 'international';

  res.render("admin/pages/tour-create", {
    pageTitle: isInternationalTour ? "Tạo tour nước ngoài" : "Tạo tour trong nước",
    categoryList: categoryTree,
    cityList: vietnamCities, // Mặc định hiển thị thành phố Việt Nam
    europeanCountries,
    europeanCities,
    isInternationalTour, // Truyền vào view để hiển thị đúng form
  });
};

module.exports.trash = async (req, res) => {
  try {
    const companyId = req.account.companyId; // đã có từ auth middleware

    // cũng reset các khuyến mãi đã hết hạn (phòng khi chưa vào list)
    await refreshDiscounts(companyId);
    await cleanExpiredFixedDiscounts(companyId);

    // Chỉ lấy tour thuộc công ty của admin và đã xóa
    const find = {
      deleted: true,
      companyId, // quan trọng!
    };

    // Lấy các trường đủ dùng, dùng lean để render nhanh và dễ gắn field phụ
    const tourList = await Tour.find(find)
      .select(
        "_id name avatar priceNewAdult priceNewChildren priceNewBaby seatsTotal seatsRemaining babyPricingMode deletedAt createdAt createdBy deletedBy"
      )
      .sort({ deletedAt: -1, _id: -1 })
      .lean();

    // Gom ID admin để tránh N+1
    const adminIds = new Set();
    for (const t of tourList) {
      if (t.createdBy) adminIds.add(t.createdBy);
      if (t.deletedBy) adminIds.add(t.deletedBy);
    }

    let adminMap = {};
    if (adminIds.size > 0) {
      const admins = await AccountAdmin.find({
        _id: { $in: Array.from(adminIds) },
      })
        .select("_id fullName")
        .lean();
      adminMap = admins.reduce((acc, a) => {
        acc[String(a._id)] = a.fullName;
        return acc;
      }, {});
    }

    // Bổ sung các field hiển thị
    for (const item of tourList) {
      item.createdByFullName = item.createdBy
        ? adminMap[item.createdBy] || "—"
        : "—";
      item.deletedByFullName = item.deletedBy
        ? adminMap[item.deletedBy] || "—"
        : "—";
      item.createdAtFormat = item.createdAt
        ? moment(item.createdAt).format("HH:mm - DD/MM/YYYY")
        : "—";
      item.deletedAtFormat = item.deletedAt
        ? moment(item.deletedAt).format("HH:mm - DD/MM/YYYY")
        : "—";
    }

    return res.render("admin/pages/tour-trash", {
      pageTitle: "Thùng rác tour",
      tourList,
    });
  } catch (err) {
    // Có thể chuyển hướng hoặc báo lỗi tuỳ ý
    return res.render("admin/pages/tour-trash", {
      pageTitle: "Thùng rác tour",
      tourList: [],
    });
  }
};

module.exports.createPost = async (req, res) => {
  try {
    // --- scope theo công ty ---
    const companyId = req.account.companyId;
    if (!companyId) {
      return res.json({
        code: "error",
        message: "Không xác định được công ty!",
      });
    }

    // --- position đếm theo công ty ---
    if (req.body.position) {
      req.body.position = parseInt(req.body.position, 10) || 0;
    } else {
      const totalRecord = await Tour.countDocuments({ companyId });
      req.body.position = totalRecord + 1;
    }

    // --- chuẩn hoá giá ---
    const toInt = (v, d = 0) =>
      v !== undefined && v !== null && v !== "" ? parseInt(v, 10) || d : d;

    req.body.priceAdult = toInt(req.body.priceAdult);
    req.body.priceChildren = toInt(req.body.priceChildren);
    req.body.priceBaby = toInt(req.body.priceBaby);

    req.body.priceNewAdult = toInt(req.body.priceNewAdult, req.body.priceAdult);
    req.body.priceNewChildren = toInt(
      req.body.priceNewChildren,
      req.body.priceChildren
    );
    req.body.priceNewBaby = toInt(req.body.priceNewBaby, req.body.priceBaby);

    // --- điểm khởi hành ---
    req.body.departureCity = req.body.departureCity || null;

    // --- mảng & ngày ---
    // locations: JSON từ client -> chuẩn hoá
    req.body.locations = parseLocationsPayload(req.body.locations);

    req.body.schedules = req.body.schedules
      ? JSON.parse(req.body.schedules)
      : [];
    
    // Xử lý departureDates (mảng ngày khởi hành)
    if (req.body.departureDates) {
      try {
        const datesRaw = typeof req.body.departureDates === "string" 
          ? JSON.parse(req.body.departureDates) 
          : req.body.departureDates;
        if (Array.isArray(datesRaw)) {
          req.body.departureDates = datesRaw
            .map((d) => {
              if (!d) return null;
              const date = typeof d === "string" ? new Date(d) : d;
              return date instanceof Date && !isNaN(date) ? date : null;
            })
            .filter((d) => d !== null)
            .sort((a, b) => a - b); // Sắp xếp theo thứ tự tăng dần
        } else {
          req.body.departureDates = [];
        }
      } catch {
        req.body.departureDates = [];
      }
    } else {
      req.body.departureDates = [];
    }
    
    // Giữ lại departureDate để tương thích (lấy ngày đầu tiên nếu có)
    req.body.departureDate = req.body.departureDates.length > 0 
      ? req.body.departureDates[0] 
      : null;

    // --- Điểm nổi bật, bao gồm, không bao gồm ---
    // Chuyển đổi textarea (mỗi dòng một mục) thành mảng
    const parseTextareaToArray = (text) => {
      if (!text || typeof text !== "string") return [];
      return text
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    };

    req.body.highlights = parseTextareaToArray(req.body.highlights);
    req.body.includes = parseTextareaToArray(req.body.includes);
    req.body.excludes = parseTextareaToArray(req.body.excludes);

    // --- THỜI HẠN KHUYẾN MÃI (GIẢM THEO SỐ TIỀN CỐ ĐỊNH, NẾU CÓ) ---
    if (req.body.discountFrom || req.body.discountTo) {
      const fromRaw = req.body.discountFrom;
      const toRaw = req.body.discountTo;

      if (fromRaw && toRaw) {
        const fromM = moment(fromRaw, "YYYY-MM-DD").startOf("day");
        const toM = moment(toRaw, "YYYY-MM-DD").endOf("day");

        if (fromM.isValid() && toM.isValid() && toM.isAfter(fromM)) {
          req.body.discountFrom = fromM.toDate();
          req.body.discountTo = toM.toDate();
        } else {
          req.body.discountFrom = null;
          req.body.discountTo = null;
        }
      } else {
        req.body.discountFrom = null;
        req.body.discountTo = null;
      }

      // Đây là khuyến mãi theo giá cố định -> không dùng % giảm
      if (!req.body.discountPercent) {
        req.body.discountPercent = 0;
      }
      req.body.discountApplied = false;
      req.body.backupPriceNewAdult = 0;
      req.body.backupPriceNewChildren = 0;
      req.body.backupPriceNewBaby = 0;
    } else {
      // không cấu hình khuyến mãi
      req.body.discountFrom = null;
      req.body.discountTo = null;
      if (!req.body.discountPercent) {
        req.body.discountPercent = 0;
      }
    }

    // --- cấu hình giá em bé ---
    const babyPricingMode = (req.body.babyPricingMode || "fixed").trim();
    req.body.babyPricingMode =
      babyPricingMode === "tiered" ? "tiered" : "fixed";

    req.body.babyPricingRules = [];
    if (
      req.body.babyPricingMode === "tiered" &&
      req.body.babyPricingRulesJson
    ) {
      try {
        const raw = JSON.parse(req.body.babyPricingRulesJson);
        if (Array.isArray(raw)) {
          req.body.babyPricingRules = raw
            .map((r) => ({
              from: Number(r.from),
              to: r.to === "inf" ? "inf" : Number(r.to),
              percent: Number(r.percent),
              ref: r.ref === "adult" ? "adult" : "children",
            }))
            .filter(
              (r) =>
                Number.isFinite(r.from) &&
                (r.to === "inf" || Number.isFinite(r.to)) &&
                Number.isFinite(r.percent) &&
                r.percent >= 0 &&
                r.percent <= 100
            );
        }
      } catch (_) {
        /* JSON rules không hợp lệ -> bỏ qua */
      }
      // tiered => không dùng priceNewBaby
      req.body.priceNewBaby = 0;
    }

    // --- QUẢN LÝ GHẾ: seatsTotal / seatsRemaining ---
    const seatsTotal = toInt(req.body.seatsTotal, 0);
    let seatsRemaining =
      req.body.seatsRemaining !== undefined
        ? toInt(req.body.seatsRemaining, seatsTotal)
        : seatsTotal;

    // chuẩn hoá ràng buộc
    if (seatsRemaining < 0) seatsRemaining = 0;
    if (seatsRemaining > seatsTotal) seatsRemaining = seatsTotal;

    req.body.seatsTotal = seatsTotal;
    req.body.seatsRemaining = seatsRemaining;

    // bỏ các field stock cũ nếu client còn gửi lên
    delete req.body.stockAdult;
    delete req.body.stockChildren;
    delete req.body.stockBaby;

    // --- audit & file & company ---
    req.body.createdBy = req.account.id;
    req.body.updatedBy = req.account.id;
    req.body.companyId = companyId;
    if (req.files && req.files.avatar && req.files.avatar.length > 0) {
      req.body.avatar = req.files.avatar[0].path;
    } else {
      req.body.avatar = "";
    }

    if (req.files && req.files.images && req.files.images.length > 0) {
      req.body.images = req.files.images.map((item) => item.path);
    } else {
      req.body.images = [];
    }

    // Lưu
    const newRecord = new Tour(req.body);
    await newRecord.save();

    return res.json({ code: "success", message: "Tạo tour thành công!" });
  } catch (error) {
    console.error("tour.createPost error:", error);
    return res.json({ code: "error", message: "Dữ liệu không hợp lệ!" });
  }
};

module.exports.edit = async (req, res) => {
  try {
    const id = req.params.id;
    const companyId = req.account.companyId;

    // Chỉ cho phép sửa tour thuộc công ty của admin
    const tourDoc = await Tour.findOne({
      _id: id,
      deleted: false,
      companyId,
    });

    if (!tourDoc) {
      return res.redirect(`/${pathAdmin}/tour/list`);
    }

    // Ép về plain object để thêm field phụ trợ thoải mái
    const tourDetail = tourDoc.toObject();
    // Gán thêm id dạng string cho form dùng
    tourDetail.id = tourDoc._id.toString();

    // Chuẩn hoá departureCity thành string để bind vào select
    if (tourDetail.departureCity) {
      tourDetail.departureCity = String(tourDetail.departureCity);
    }

    // Chuẩn hoá locations cho form:
    //   locationBlocks: [{ city: cityId, spots: ['...'] }]
    const locs = Array.isArray(tourDetail.locations)
      ? tourDetail.locations
      : [];
    tourDetail.locationBlocks = locs.map((loc) => {
      // dữ liệu cũ: chỉ lưu cityId (string/ObjectId)
      if (
        !loc ||
        typeof loc === "string" ||
        mongoose.Types.ObjectId.isValid(String(loc))
      ) {
        return {
          city: String(loc),
          spots: [],
        };
      }

      // dữ liệu mới: { city, spots }
      const cityId = loc.city ? String(loc.city) : "";
      let spots = [];
      
      if (Array.isArray(loc.spots)) {
        spots = loc.spots;
      } else if (typeof loc.spots === "string" && loc.spots.trim()) {
        // Nếu là string, split thành array
        spots = loc.spots.split("\n").map(s => s.trim()).filter(Boolean);
      }

      return { city: cityId, spots };
    });

    // Format ngày khởi hành cho input[type=date]
    if (tourDetail.departureDate) {
      tourDetail.departureDateFormat = moment(tourDetail.departureDate).format(
        "YYYY-MM-DD"
      );
    }

    // Chuẩn hoá departureDates cho form:
    //   departureDatesBlocks: [{ dateFormat: 'YYYY-MM-DD' }]
    const dates = Array.isArray(tourDetail.departureDates)
      ? tourDetail.departureDates
      : tourDetail.departureDate
      ? [tourDetail.departureDate]
      : [];
    tourDetail.departureDatesBlocks = dates
      .filter((d) => d)
      .map((d) => ({
        dateFormat: moment(d).format("YYYY-MM-DD"),
      }));

    // ===== THỜI HẠN KHUYẾN MÃI (prefill cho input date) =====
    tourDetail.discountFromInput = tourDetail.discountFrom
      ? moment(tourDetail.discountFrom).format("YYYY-MM-DD")
      : "";

    tourDetail.discountToInput = tourDetail.discountTo
      ? moment(tourDetail.discountTo).format("YYYY-MM-DD")
      : "";
    // ===== HẾT THỜI HẠN KHUYẾN MÃI =====

    // Đưa rules ra JSON string để bind lại form (nếu chế độ 'tiered')
    tourDetail.babyPricingRulesJson = JSON.stringify(
      tourDetail.babyPricingRules || []
    );

    const categoryList = await Category.find({});
    const categoryTree = categoryHelper.buildCategoryTree(categoryList, "");

    // Lấy danh sách thành phố Việt Nam (không có countryId hoặc countryName không phải Châu Âu)
    const vietnamCities = await City.find({
      $or: [
        { countryId: null },
        { countryName: { $exists: false } },
        { countryName: "" },
      ],
      deleted: { $ne: true },
    }).sort({ name: 1 });

    // Lấy danh sách quốc gia Châu Âu
    const europeanCountriesRaw = await Country.find({
      continent: "Europe",
      deleted: { $ne: true },
      status: "active",
    }).sort({ name: 1 }).lean();

    // Chuyển đổi _id thành string
    const europeanCountries = europeanCountriesRaw.map((country) => ({
      _id: String(country._id),
      id: String(country._id),
      name: country.name || "",
      nameEn: country.nameEn || "",
      code: country.code || "",
    }));

    // Lấy danh sách thành phố Châu Âu (có countryId)
    const europeanCitiesRaw = await City.find({
      countryId: { $exists: true, $ne: null },
      deleted: { $ne: true },
    })
      .populate("countryId", "name code")
      .sort({ countryName: 1, name: 1 })
      .lean(); // Sử dụng lean() để trả về plain object

    // Chuyển đổi countryId thành string để dễ xử lý ở client
    const europeanCities = europeanCitiesRaw.map((city) => {
      let countryIdStr = null;
      if (city.countryId) {
        if (typeof city.countryId === 'object' && city.countryId._id) {
          countryIdStr = String(city.countryId._id);
        } else {
          countryIdStr = String(city.countryId);
        }
      }
      return {
        _id: String(city._id),
        id: String(city._id),
        name: city.name || "",
        nameEn: city.nameEn || "",
        countryId: countryIdStr,
        countryName: city.countryName || "",
      };
    });

    // Xác định tour là trong nước hay nước ngoài dựa trên category
    let isInternationalTour = false;
    if (tourDetail.category) {
      const category = await Category.findById(tourDetail.category);
      if (category && category.parent) {
        const parentCategory = await Category.findById(category.parent);
        if (parentCategory) {
          const parentName = parentCategory.name.toLowerCase();
          const parentSlug = parentCategory.slug?.toLowerCase() || "";
          isInternationalTour =
            parentName.includes("nước ngoài") ||
            parentSlug.includes("nuoc-ngoai") ||
            parentName.includes("international") ||
            parentSlug.includes("international");
        }
      }
    }

    // Nếu là tour nước ngoài, cần xác định các quốc gia và group locations theo quốc gia
    let tourCountries = []; // Danh sách countryId mà tour này có
    let locationsByCountry = {}; // { countryId: [{ city, spots: [...] }] }
    
    if (isInternationalTour && tourDetail.locationBlocks && tourDetail.locationBlocks.length > 0) {
      // Populate cityId để lấy countryId
      const cityIds = tourDetail.locationBlocks.map(loc => loc.city).filter(Boolean);
      if (cityIds.length > 0) {
        const citiesWithCountry = await City.find({
          _id: { $in: cityIds },
          countryId: { $exists: true, $ne: null }
        }).populate('countryId').lean();
        
        // Tạo map cityId -> countryId
        const cityToCountry = {};
        citiesWithCountry.forEach(city => {
          if (city.countryId) {
            const countryId = String(city.countryId._id || city.countryId);
            cityToCountry[String(city._id)] = countryId;
            
            // Thu thập danh sách quốc gia
            if (!tourCountries.includes(countryId)) {
              tourCountries.push(countryId);
            }
          }
        });
        
        // Group locations theo countryId
        tourDetail.locationBlocks.forEach(loc => {
          const countryId = cityToCountry[loc.city];
          if (countryId) {
            if (!locationsByCountry[countryId]) {
              locationsByCountry[countryId] = [];
            }
            locationsByCountry[countryId].push(loc);
          }
        });
      }
    }
    
    tourDetail.tourCountries = tourCountries;
    tourDetail.locationsByCountry = locationsByCountry;

    return res.render("admin/pages/tour-edit", {
      pageTitle: "Chỉnh sửa tour",
      categoryList: categoryTree,
      tourDetail,
      cityList: vietnamCities, // Mặc định hiển thị thành phố Việt Nam
      europeanCountries,
      europeanCities,
      isInternationalTour,
      pathAdmin,
    });
  } catch (error) {
    console.error("tour.edit error:", error);
    return res.redirect(`/${pathAdmin}/tour/list`);
  }
};

module.exports.editPatch = async (req, res) => {
  try {
    const id = req.params.id;

    // Tìm tour đúng công ty (tránh sửa chéo công ty)
    const existed = await Tour.findOne({
      _id: id,
      deleted: false,
      companyId: req.account.companyId,
    });
    if (!existed) {
      return res.json({ code: "error", message: "Tour không tồn tại!" });
    }

    // position: nếu không gửi lên thì tái tính theo công ty
    if (req.body.position) {
      req.body.position = parseInt(req.body.position, 10) || 0;
    } else {
      const totalRecord = await Tour.countDocuments({
        companyId: req.account.companyId,
      });
      req.body.position = totalRecord; // hoặc existed.position giữ nguyên nếu muốn
    }

    // --- Chuẩn hoá giá ---
    const toInt = (v, d = 0) =>
      v !== undefined && v !== null && v !== "" ? parseInt(v, 10) || d : d;

    req.body.priceAdult = toInt(req.body.priceAdult);
    req.body.priceChildren = toInt(req.body.priceChildren);
    req.body.priceBaby = toInt(req.body.priceBaby);

    req.body.priceNewAdult = toInt(req.body.priceNewAdult, req.body.priceAdult);
    req.body.priceNewChildren = toInt(
      req.body.priceNewChildren,
      req.body.priceChildren
    );
    req.body.priceNewBaby = toInt(req.body.priceNewBaby, req.body.priceBaby);

    // --- Điểm khởi hành ---
    req.body.departureCity = req.body.departureCity || null;

    // --- Mảng & ngày ---
    // locations: JSON từ client -> chuẩn hoá
    req.body.locations = parseLocationsPayload(req.body.locations);

    req.body.schedules = req.body.schedules
      ? JSON.parse(req.body.schedules)
      : [];
    
    // Xử lý departureDates (mảng ngày khởi hành)
    if (req.body.departureDates) {
      try {
        const datesRaw = typeof req.body.departureDates === "string" 
          ? JSON.parse(req.body.departureDates) 
          : req.body.departureDates;
        if (Array.isArray(datesRaw)) {
          req.body.departureDates = datesRaw
            .map((d) => {
              if (!d) return null;
              const date = typeof d === "string" ? new Date(d) : d;
              return date instanceof Date && !isNaN(date) ? date : null;
            })
            .filter((d) => d !== null)
            .sort((a, b) => a - b); // Sắp xếp theo thứ tự tăng dần
        } else {
          req.body.departureDates = [];
        }
      } catch {
        req.body.departureDates = [];
      }
    } else {
      req.body.departureDates = [];
    }
    
    // Giữ lại departureDate để tương thích (lấy ngày đầu tiên nếu có)
    req.body.departureDate = req.body.departureDates.length > 0 
      ? req.body.departureDates[0] 
      : null;

    // --- Điểm nổi bật, bao gồm, không bao gồm ---
    // Chuyển đổi textarea (mỗi dòng một mục) thành mảng
    const parseTextareaToArray = (text) => {
      if (!text || typeof text !== "string") return [];
      return text
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    };

    req.body.highlights = parseTextareaToArray(req.body.highlights);
    req.body.includes = parseTextareaToArray(req.body.includes);
    req.body.excludes = parseTextareaToArray(req.body.excludes);

    // --- Tags (loại hình trải nghiệm) ---
    // req.body.tags có thể là mảng hoặc undefined
    if (Array.isArray(req.body.tags)) {
      // Lọc các tag hợp lệ (chỉ cho phép các tag đã định nghĩa)
      const validTags = ["phiêu lưu", "biển", "văn hóa", "leo núi", "tham quan thành phố"];
      req.body.tags = req.body.tags
        .filter((tag) => tag && typeof tag === "string" && validTags.includes(tag.trim()))
        .map((tag) => tag.trim());
    } else {
      req.body.tags = [];
    }

    // --- THỜI HẠN KHUYẾN MÃI (GIẢM THEO SỐ TIỀN CỐ ĐỊNH, NẾU CÓ) ---
    if (req.body.discountFrom || req.body.discountTo) {
      // Chỉ xử lý ở đây nếu tour không dùng khuyến mãi theo %
      const existedPercent = Number(existed.discountPercent || 0);
      if (existedPercent <= 0) {
        const fromRaw = req.body.discountFrom;
        const toRaw = req.body.discountTo;

        if (fromRaw && toRaw) {
          const fromM = moment(fromRaw, "YYYY-MM-DD").startOf("day");
          const toM = moment(toRaw, "YYYY-MM-DD").endOf("day");

          if (fromM.isValid() && toM.isValid() && toM.isAfter(fromM)) {
            req.body.discountFrom = fromM.toDate();
            req.body.discountTo = toM.toDate();
          } else {
            req.body.discountFrom = null;
            req.body.discountTo = null;
          }
        } else {
          req.body.discountFrom = null;
          req.body.discountTo = null;
        }

        req.body.discountPercent = 0;
        req.body.discountApplied = false;
        req.body.backupPriceNewAdult = 0;
        req.body.backupPriceNewChildren = 0;
        req.body.backupPriceNewBaby = 0;
      } else {
        // đang dùng giảm theo % -> không chỉnh thời hạn ở luồng này
        delete req.body.discountFrom;
        delete req.body.discountTo;
      }
    } else {
      // không gửi field từ form -> giữ nguyên trong DB
      delete req.body.discountFrom;
      delete req.body.discountTo;
    }

    // --- Cấu hình giá em bé ---
    const mode = (
      req.body.babyPricingMode ||
      existed.babyPricingMode ||
      "fixed"
    ).trim();
    req.body.babyPricingMode = mode === "tiered" ? "tiered" : "fixed";

    req.body.babyPricingRules = [];
    if (
      req.body.babyPricingMode === "tiered" &&
      req.body.babyPricingRulesJson
    ) {
      try {
        const raw = JSON.parse(req.body.babyPricingRulesJson);
        if (Array.isArray(raw)) {
          req.body.babyPricingRules = raw
            .map((r) => ({
              from: Number(r.from),
              to: r.to === "inf" ? "inf" : Number(r.to),
              percent: Number(r.percent),
              ref: r.ref === "adult" ? "adult" : "children",
            }))
            .filter(
              (r) =>
                Number.isFinite(r.from) &&
                (r.to === "inf" || Number.isFinite(r.to)) &&
                Number.isFinite(r.percent) &&
                r.percent >= 0 &&
                r.percent <= 100
            );
        }
      } catch (_) {
        // JSON rules lỗi -> giữ rỗng
      }
      // tiered => không dùng priceNewBaby
      req.body.priceNewBaby = 0;
    } else {
      // fixed => không cần rules
      req.body.babyPricingRules = [];
    }

    // --- QUẢN LÝ GHẾ ---
    const seatsTotal = toInt(req.body.seatsTotal, existed.seatsTotal || 0);
    let seatsRemaining =
      req.body.seatsRemaining !== undefined
        ? toInt(req.body.seatsRemaining, seatsTotal)
        : existed.seatsRemaining ?? seatsTotal;

    // Ràng buộc hợp lệ
    if (seatsRemaining < 0) seatsRemaining = 0;
    if (seatsRemaining > seatsTotal) seatsRemaining = seatsTotal;

    req.body.seatsTotal = seatsTotal;
    req.body.seatsRemaining = seatsRemaining;

    // BỎ các field stock cũ nếu client còn gửi
    delete req.body.stockAdult;
    delete req.body.stockChildren;
    delete req.body.stockBaby;

    // --- Audit & avatar ---
    req.body.updatedBy = req.account.id;
    if (req.files && req.files.avatar && req.files.avatar.length > 0) {
      req.body.avatar = req.files.avatar[0].path;
    } else {
      delete req.body.avatar; // không thay đổi avatar nếu không upload mới
    }

    if (req.files && req.files.images && req.files.images.length > 0) {
      req.body.images = req.files.images.map((item) => item.path);
    } else {
      delete req.body.images;
    }

    // Sử dụng $set để đảm bảo các trường mới được cập nhật đúng cách
    await Tour.updateOne(
      { _id: id, deleted: false, companyId: req.account.companyId },
      { $set: req.body }
    );

    return res.json({ code: "success", message: "Cập nhật thành công!" });
  } catch (error) {
    console.error("tour.editPatch error:", error);
    return res.json({ code: "error", message: "Dữ liệu không hợp lệ!" });
  }
};

module.exports.deletePatch = async (req, res) => {
  try {
    const { id } = req.params;

    // 1) ID hợp lệ?
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.json({ code: "error", message: "ID không hợp lệ!" });
    }

    // 2) Chỉ cho xóa tour thuộc công ty của admin hiện tại và chưa bị xóa
    const filter = {
      _id: id,
      companyId: req.account.companyId,
      deleted: false,
    };

    const update = {
      $set: {
        deleted: true,
        deletedAt: new Date(),
        deletedBy: req.account.id,
      },
    };

    const result = await Tour.updateOne(filter, update);

    // 3) Kết quả
    if (result.matchedCount === 0) {
      return res.json({
        code: "error",
        message: "Tour không tồn tại hoặc không thuộc công ty của bạn!",
      });
    }

    if (result.modifiedCount === 0) {
      // matched nhưng không thay đổi -> có thể đã xóa rồi
      return res.json({
        code: "success",
        message: "Tour đã được xóa trước đó.",
      });
    }

    return res.json({ code: "success", message: "Xóa tour thành công!" });
  } catch (error) {
    console.error("tour.deletePatch error:", error);
    return res.json({ code: "error", message: "Dữ liệu không hợp lệ!" });
  }
};

module.exports.undoPatch = async (req, res) => {
  try {
    const { id } = req.params;

    // 1) ID hợp lệ?
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.json({ code: "error", message: "ID không hợp lệ!" });
    }

    // 2) Chỉ khôi phục tour thuộc công ty của admin hiện tại & đang bị xóa
    const filter = {
      _id: id,
      companyId: req.account.companyId,
      deleted: true,
    };

    const update = {
      $set: {
        deleted: false,
        deletedAt: null,
        deletedBy: null,
        updatedBy: req.account.id,
      },
    };

    const result = await Tour.updateOne(filter, update);

    if (result.matchedCount === 0) {
      return res.json({
        code: "error",
        message:
          "Tour không tồn tại, không thuộc công ty của bạn, hoặc chưa bị xóa!",
      });
    }

    if (result.modifiedCount === 0) {
      // matched nhưng không thay đổi gì (đã khôi phục trước đó?)
      return res.json({
        code: "success",
        message: "Tour đã được khôi phục trước đó.",
      });
    }

    return res.json({ code: "success", message: "Đã khôi phục!" });
  } catch (error) {
    console.error("tour.undoPatch error:", error);
    return res.json({ code: "error", message: "Dữ liệu không hợp lệ!" });
  }
};

module.exports.destroyDelete = async (req, res) => {
  try {
    const { id } = req.params;

    // 1) ID hợp lệ?
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.json({ code: "error", message: "ID không hợp lệ!" });
    }

    // 2) Chỉ cho xoá vĩnh viễn tour thuộc công ty hiện tại và đang ở thùng rác
    const filter = {
      _id: id,
      companyId: req.account.companyId,
      deleted: true,
    };

    const result = await Tour.deleteOne(filter);

    // 3) Phản hồi theo kết quả
    if (result.deletedCount === 0) {
      return res.json({
        code: "error",
        message:
          "Tour không tồn tại, không thuộc công ty của bạn, hoặc chưa bị xoá tạm!",
      });
    }

    return res.json({ code: "success", message: "Đã xoá vĩnh viễn!" });
  } catch (error) {
    console.error("tour.destroyDelete error:", error);
    return res.json({ code: "error", message: "Dữ liệu không hợp lệ!" });
  }
};

module.exports.changeMultiPatch = async (req, res) => {
  try {
    const { value } = req.body;
    let { ids } = req.body;

    // Chuẩn hóa danh sách ID
    if (!Array.isArray(ids)) {
      ids = String(ids || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    // Lọc ID hợp lệ
    ids = ids.filter(mongoose.Types.ObjectId.isValid);

    if (ids.length === 0) {
      return res.json({
        code: "error",
        message: "Danh sách ID trống hoặc không hợp lệ!",
      });
    }

    const companyId = req.account.companyId;
    const baseFilter = { _id: { $in: ids }, companyId };

    let result;

    switch (value) {
      case "active":
      case "inactive": {
        // Chỉ đổi trạng thái cho bản ghi chưa bị xóa
        const filter = { ...baseFilter, deleted: false };
        result = await Tour.updateMany(filter, {
          $set: {
            status: value,
            updatedBy: req.account.id,
            updatedAt: new Date(),
          },
        });
        return res.json({
          code: "success",
          message: `Đổi trạng thái thành công (${result.modifiedCount}/${result.matchedCount})!`,
        });
      }

      case "delete": {
        // Đưa vào thùng rác
        const filter = { ...baseFilter, deleted: false };
        result = await Tour.updateMany(filter, {
          $set: {
            deleted: true,
            deletedAt: new Date(),
            deletedBy: req.account.id,
          },
        });
        return res.json({
          code: "success",
          message: `Đã đưa vào thùng rác (${result.modifiedCount}/${result.matchedCount})!`,
        });
      }

      case "undo": {
        // Khôi phục từ thùng rác
        const filter = { ...baseFilter, deleted: true };
        result = await Tour.updateMany(filter, {
          $set: {
            deleted: false,
            updatedBy: req.account.id,
            updatedAt: new Date(),
          },
          $unset: {
            deletedAt: 1,
            deletedBy: 1,
          },
        });
        return res.json({
          code: "success",
          message: `Đã khôi phục (${result.modifiedCount}/${result.matchedCount})!`,
        });
      }

      case "destroy": {
        // Xóa vĩnh viễn: chỉ xóa các bản ghi đang ở thùng rác
        const filter = { ...baseFilter, deleted: true };
        result = await Tour.deleteMany(filter);
        return res.json({
          code: "success",
          message: `Đã xóa vĩnh viễn (${result.deletedCount})!`,
        });
      }

      default:
        return res.json({
          code: "error",
          message: "Giá trị hành động không hợp lệ!",
        });
    }
  } catch (error) {
    console.error("tour.changeMultiPatch error:", error);
    return res.json({ code: "error", message: "Dữ liệu không hợp lệ!" });
  }
};

/**
 * Áp dụng giảm giá theo % cho các tour được chọn (trong 1 công ty)
 *  - Chỉ "lên lịch" khuyến mãi (discountPercent, discountFrom, discountTo, backup)
 *  - Không giảm giá ngay, mà để refreshDiscounts tự kích hoạt khi đến ngày
 */
module.exports.applyCompanyDiscount = async (req, res) => {
  try {
    const companyId = req.account?.companyId;
    if (!companyId) {
      return res.json({
        code: "error",
        message: "Không xác định được công ty!",
      });
    }

    // Làm sạch lại trạng thái cũ (hết hạn / lệch ngày) trước khi cấu hình mới
    await refreshDiscounts(companyId);
    await cleanExpiredFixedDiscounts(companyId);

    // Lấy & chuẩn hoá danh sách ID tour được chọn
    let { ids } = req.body;
    if (!Array.isArray(ids)) {
      ids = String(ids || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    ids = ids.filter((id) => mongoose.Types.ObjectId.isValid(id));
    if (ids.length === 0) {
      return res.json({
        code: "error",
        message: "Vui lòng chọn ít nhất 1 tour để áp dụng khuyến mãi!",
      });
    }
    const objectIds = ids.map((id) => new mongoose.Types.ObjectId(id));

    // Validate %
    const percent = Number(req.body.percent);
    if (!Number.isFinite(percent) || percent <= 0 || percent >= 100) {
      return res.json({
        code: "error",
        message: "Phần trăm giảm không hợp lệ!",
      });
    }

    // Validate thời gian
    const { discountFrom, discountTo } = req.body;

    let fromDate = discountFrom
      ? moment(discountFrom, "YYYY-MM-DD").startOf("day").toDate()
      : new Date();

    let toDate = discountTo
      ? moment(discountTo, "YYYY-MM-DD").endOf("day").toDate()
      : null;

    if (!toDate || toDate <= fromDate) {
      return res.json({
        code: "error",
        message: "Khoảng thời gian khuyến mãi không hợp lệ!",
      });
    }

    const baseFilter = {
      _id: { $in: objectIds },
      companyId,
      deleted: false,
    };

    // B1: đảm bảo đã có backupPriceNew* = giá mới gốc
    const baseAdult = {
      $cond: [{ $gt: ["$priceNewAdult", 0] }, "$priceNewAdult", "$priceAdult"],
    };
    const baseChildren = {
      $cond: [
        { $gt: ["$priceNewChildren", 0] },
        "$priceNewChildren",
        "$priceChildren",
      ],
    };
    const baseBaby = {
      $cond: [{ $gt: ["$priceNewBaby", 0] }, "$priceNewBaby", "$priceBaby"],
    };

    const result = await Tour.updateMany(baseFilter, [
      {
        $set: {
          backupPriceNewAdult: {
            $cond: [
              { $gt: ["$backupPriceNewAdult", 0] },
              "$backupPriceNewAdult",
              baseAdult,
            ],
          },
          backupPriceNewChildren: {
            $cond: [
              { $gt: ["$backupPriceNewChildren", 0] },
              "$backupPriceNewChildren",
              baseChildren,
            ],
          },
          backupPriceNewBaby: {
            $cond: [
              { $gt: ["$backupPriceNewBaby", 0] },
              "$backupPriceNewBaby",
              baseBaby,
            ],
          },

          // Ghi thông tin khuyến mãi, đánh dấu chưa áp dụng
          discountPercent: percent,
          discountFrom: fromDate,
          discountTo: toDate,
          discountApplied: false,
        },
      },
    ]);

    // B2: Gọi lại refreshDiscounts để:
    //  - Nếu discountFrom <= hôm nay: áp dụng giảm ngay
    //  - Nếu discountFrom > hôm nay: chỉ lưu lịch, chưa giảm
    await refreshDiscounts(companyId);

    return res.json({
      code: "success",
      message: `Đã cấu hình khuyến mãi -${percent}% cho ${
        result.matchedCount || 0
      } tour từ ${moment(fromDate).format("DD/MM/YYYY")} đến ${moment(
        toDate
      ).format("DD/MM/YYYY")}.`,
    });
  } catch (err) {
    console.error("applyCompanyDiscount error:", err);
    return res.json({
      code: "error",
      message: "Có lỗi khi áp dụng giảm giá!",
    });
  }
};

// Hủy khuyến mãi cho 1 tour (dùng ở trang Tour khuyến mãi)
module.exports.cancelDiscount = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.account?.companyId;

    if (!companyId) {
      return res.json({
        code: "error",
        message: "Không xác định được công ty!",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.json({ code: "error", message: "ID không hợp lệ!" });
    }

    const tour = await Tour.findOne({
      _id: id,
      companyId,
      deleted: false,
    });

    if (!tour) {
      return res.json({ code: "error", message: "Tour không tồn tại!" });
    }

    const hasPercent = tour.discountPercent && tour.discountPercent > 0;
    const hasDate = tour.discountFrom && tour.discountTo;

    if (!hasPercent && !hasDate) {
      // Không có cấu hình khuyến mãi nào
      return res.json({
        code: "success",
        message: "Tour hiện không có khuyến mãi.",
      });
    }

    if (hasPercent) {
      // Khuyến mãi theo %
      cancelDiscountOnDoc(tour);
    } else {
      // === Khuyến mãi theo SỐ TIỀN CỐ ĐỊNH: dùng priceAdult/Children/Baby làm giá gốc ===
      const baseAdult = tour.priceAdult || tour.priceNewAdult || 0;
      const baseChildren = tour.priceChildren || tour.priceNewChildren || 0;
      const baseBaby =
        tour.babyPricingMode === "fixed"
          ? tour.priceBaby || tour.priceNewBaby || 0
          : 0;

      // Sau khi hủy KM: bán trở lại theo "giá gốc", bỏ cột giá cũ
      tour.priceNewAdult = baseAdult;
      tour.priceNewChildren = baseChildren;
      tour.priceNewBaby = baseBaby;

      tour.priceAdult = 0;
      tour.priceChildren = 0;
      tour.priceBaby = 0;

      tour.discountFrom = null;
      tour.discountTo = null;
      tour.discountPercent = 0;
      tour.discountApplied = false;
      tour.backupPriceNewAdult = 0;
      tour.backupPriceNewChildren = 0;
      tour.backupPriceNewBaby = 0;
    }

    await tour.save();

    return res.json({
      code: "success",
      message: "Đã hủy khuyến mãi cho tour!",
    });
  } catch (err) {
    console.error("cancelDiscount error:", err);
    return res.json({
      code: "error",
      message: "Có lỗi khi hủy khuyến mãi!",
    });
  }
};

module.exports.updateDiscount = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.account?.companyId;

    if (!companyId) {
      return res.json({
        code: "error",
        message: "Không xác định được công ty!",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.json({ code: "error", message: "ID không hợp lệ!" });
    }

    // ---- Phần mới: phân biệt có / không có percent ----
    const rawPercent = req.body.percent;
    const hasPercent =
      rawPercent !== undefined &&
      rawPercent !== null &&
      String(rawPercent).trim() !== "";

    let percent = null;
    let factor = null;

    if (hasPercent) {
      percent = Number(rawPercent);
      if (!Number.isFinite(percent) || percent <= 0 || percent >= 100) {
        return res.json({
          code: "error",
          message: "Phần trăm giảm không hợp lệ!",
        });
      }
      factor = (100 - percent) / 100;
    }

    const { discountFrom, discountTo } = req.body;

    let fromDate = discountFrom
      ? moment(discountFrom, "YYYY-MM-DD").startOf("day").toDate()
      : null;

    let toDate = discountTo
      ? moment(discountTo, "YYYY-MM-DD").endOf("day").toDate()
      : null;

    if (!fromDate || !toDate || toDate <= fromDate) {
      return res.json({
        code: "error",
        message: "Khoảng thời gian khuyến mãi không hợp lệ!",
      });
    }

    const tour = await Tour.findOne({
      _id: id,
      companyId,
      deleted: false,
    });

    if (!tour) {
      return res.json({ code: "error", message: "Tour không tồn tại!" });
    }

    const now = new Date();

    // === TRƯỜNG HỢP KHÔNG CÓ PERCENT: chỉ cập nhật ngày, giữ nguyên giá ===
    if (!hasPercent) {
      tour.discountFrom = fromDate;
      tour.discountTo = toDate;

      // Không thay đổi discountPercent, backupPriceNew* hay giá
      // Chỉ cập nhật trạng thái discountApplied nếu cần
      if (now < fromDate || now > toDate) {
        // ngoài khoảng -> coi như chưa áp dụng
        tour.discountApplied = false;
      }

      await tour.save();
      return res.json({
        code: "success",
        message: "Đã cập nhật thời gian khuyến mãi cho tour!",
      });
    }

    // === TRƯỜNG HỢP CÓ PERCENT: giữ nguyên logic cũ ===
    const { baseAdult, baseChildren, baseBaby } = getBasePrices(tour);

    // Luôn lưu lại base vào backup để sau này có thể hoàn trả
    tour.backupPriceNewAdult = baseAdult;
    tour.backupPriceNewChildren = baseChildren;
    tour.backupPriceNewBaby = baseBaby;

    // Lưu cấu hình khuyến mãi mới
    tour.discountPercent = percent;
    tour.discountFrom = fromDate;
    tour.discountTo = toDate;

    if (now < fromDate) {
      // === SẮP GIẢM GIÁ ===
      tour.priceNewAdult = baseAdult;
      tour.priceNewChildren = baseChildren;
      tour.priceNewBaby = tour.babyPricingMode === "fixed" ? baseBaby : 0;

      tour.priceAdult = 0;
      tour.priceChildren = 0;
      tour.priceBaby = 0;

      tour.discountApplied = false;
    } else if (now <= toDate) {
      // === ĐANG GIẢM GIÁ ===
      tour.priceAdult = baseAdult;
      tour.priceChildren = baseChildren;
      tour.priceBaby = tour.babyPricingMode === "fixed" ? baseBaby : 0;

      tour.priceNewAdult = Math.round(baseAdult * factor);
      tour.priceNewChildren = Math.round(baseChildren * factor);
      tour.priceNewBaby =
        tour.babyPricingMode === "fixed" ? Math.round(baseBaby * factor) : 0;

      tour.discountApplied = true;
    } else {
      // Quá hạn -> hủy khuyến mãi
      cancelDiscountOnDoc(tour);
    }

    await tour.save();

    return res.json({
      code: "success",
      message: "Đã cập nhật khuyến mãi cho tour!",
    });
  } catch (err) {
    console.error("updateDiscount error:", err);
    return res.json({
      code: "error",
      message: "Có lỗi khi cập nhật khuyến mãi!",
    });
  }
};
