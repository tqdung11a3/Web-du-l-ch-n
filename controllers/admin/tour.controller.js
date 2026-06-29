const Category = require("../../models/category.model");
const categoryHelper = require("../../helpers/category.helper");
const City = require("../../models/city.model");
const Country = require("../../models/country.model");
const Tour = require("../../models/tour.model");
const Hotel = require("../../models/hotel.model");
const AccountAdmin = require("../../models/account-admin.model");
const Company = require("../../models/company.model");
const { pathAdmin } = require("../../config/variable.config");
const moment = require("moment");
const mongoose = require("mongoose");
const slugify = require("slugify");
const {
  canPublishTour,
  canPublishToursBulk,
} = require("../../helpers/tour-publishable.helper");
const auditLogHelper = require("../../helpers/audit-log.helper");

/**
 * Audit snapshot cho Tour: bao phủ mọi field trên form /admin/tour/edit.
 * - Dùng nhãn tiếng Việt cho dễ đọc.
 * - Giải nghĩa ObjectId (category, departureCity, locations.city) → tên thật.
 * - Gom các mảng (highlights, includes, schedules, departures, locations…) thành chuỗi.
 * - Bỏ `slug` và các audit field (createdBy/updatedBy/images base64 v.v.).
 */
async function buildTourAuditSnapshot(doc) {
  if (!doc) return {};
  const raw = doc.toObject ? doc.toObject() : doc;
  const out = {};

  const fmtDate = (d) => (d instanceof Date ? moment(d).format("DD/MM/YYYY") : d);

  // Scalar có nhãn tiếng Việt
  const scalarMap = [
    ["name", "tên tour"],
    ["status", "trạng thái"],
    ["position", "vị trí"],
    ["time", "thời gian"],
    ["vehicle", "phương tiện"],
    ["duration", "thời lượng"],
    ["information", "thông tin tour"],
    ["avatar", "ảnh đại diện"],
    ["babyPricingMode", "cách tính giá em bé"],
    ["priceAdult", "giá cũ — người lớn"],
    ["priceChildren", "giá cũ — trẻ em"],
    ["priceBaby", "giá cũ — em bé"],
    ["priceNewAdult", "giá mới — người lớn"],
    ["priceNewChildren", "giá mới — trẻ em"],
    ["priceNewBaby", "giá mới — em bé"],
    ["discountPercent", "% giảm giá"],
    ["discountFrom", "KM từ ngày"],
    ["discountTo", "KM đến ngày"],
  ];
  for (const [k, label] of scalarMap) {
    const v = raw[k];
    if (v !== undefined && v !== null && v !== "") {
      out[label] = v instanceof Date ? fmtDate(v) : v;
    }
  }

  // category → tên (hỗ trợ nhiều danh mục)
  const assignedCatIds = categoryHelper.getTourAssignedCategoryIds(raw);
  if (assignedCatIds.length) {
    try {
      const cats = await Category.find({ _id: { $in: assignedCatIds } })
        .select("name")
        .lean();
      const nameById = Object.fromEntries(
        cats.map((c) => [String(c._id), c.name])
      );
      out["danh mục"] = assignedCatIds
        .map((id) => nameById[id] || id)
        .join(", ");
    } catch {
      out["danh mục"] = assignedCatIds.join(", ");
    }
  } else if (raw.category) {
    try {
      const cat = await Category.findById(raw.category).select("name").lean();
      out["danh mục"] = (cat && cat.name) ? cat.name : String(raw.category);
    } catch { out["danh mục"] = String(raw.category); }
  }

  // departureCity → tên
  if (raw.departureCity) {
    try {
      const city = await City.findById(raw.departureCity).select("name").lean();
      out["điểm khởi hành"] = (city && city.name) ? city.name : String(raw.departureCity);
    } catch { out["điểm khởi hành"] = String(raw.departureCity); }
  }

  // Mảng chuỗi đơn giản
  if (Array.isArray(raw.tags) && raw.tags.length) {
    out["tags"] = raw.tags.join(", ");
  }
  if (Array.isArray(raw.highlights) && raw.highlights.length) {
    out["điểm nổi bật"] = raw.highlights.join(" | ");
  }
  if (Array.isArray(raw.includes) && raw.includes.length) {
    out["bao gồm"] = raw.includes.join(" | ");
  }
  if (Array.isArray(raw.excludes) && raw.excludes.length) {
    out["không bao gồm"] = raw.excludes.join(" | ");
  }
  if (Array.isArray(raw.images) && raw.images.length) {
    out["danh sách ảnh"] = `${raw.images.length} ảnh`;
  }

  // Lịch trình
  if (Array.isArray(raw.schedules) && raw.schedules.length) {
    out["lịch trình"] = raw.schedules
      .map((s, i) => `${i + 1}. ${s.title || "(chưa có tiêu đề)"}`)
      .join(" | ");
  }

  // Ngày khởi hành
  if (Array.isArray(raw.departures) && raw.departures.length) {
    out["ngày khởi hành"] = raw.departures
      .map((d) => {
        const from = d.departureDate ? moment(d.departureDate).format("DD/MM/YYYY") : "?";
        const to = d.endDate ? moment(d.endDate).format("DD/MM/YYYY") : "?";
        const total = d.seatsTotal ?? "?";
        const remain = d.seatsRemaining ?? "?";
        return `${from} → ${to} (ghế: ${remain}/${total})`;
      })
      .join(" | ");
  }

  // Địa điểm trong tour (giải nghĩa city ObjectId → tên)
  if (Array.isArray(raw.locations) && raw.locations.length) {
    const cityIds = raw.locations.map((l) => l && l.city).filter(Boolean);
    let cityMap = {};
    try {
      const cities = await City.find({ _id: { $in: cityIds } })
        .select("_id name")
        .lean();
      cityMap = Object.fromEntries(cities.map((c) => [String(c._id), c.name]));
    } catch {}
    out["địa điểm"] = raw.locations
      .map((l) => {
        const name = cityMap[String(l.city)] || String(l.city || "");
        const spots =
          Array.isArray(l.spots) && l.spots.length
            ? ` [${l.spots.join(", ")}]`
            : "";
        return `${name}${spots}`;
      })
      .filter(Boolean)
      .join(" | ");
  }

  // Quy tắc bậc giá em bé
  if (Array.isArray(raw.babyPricingRules) && raw.babyPricingRules.length) {
    out["quy tắc giá em bé"] = raw.babyPricingRules
      .map((r) => {
        const from = r.fromIndex ?? "?";
        const to = r.toIndex ?? "?";
        const pct = r.percent ?? r.percentage ?? "?";
        const ref = r.referencePrice || r.reference || "";
        return `bé ${from}-${to}: ${pct}%${ref ? ` (${ref})` : ""}`;
      })
      .join(" | ");
  }

  return out;
}

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
          
          // Lọc tour theo category (hỗ trợ categories[] + cascade)
          if (categoryIds.length > 0) {
            const catFilter =
              categoryHelper.buildTourCategoryMatchFilter(categoryIds);
            if (catFilter) Object.assign(find, catFilter);
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

    // Lấy cấu hình mức tuổi của công ty
    const company = companyId
      ? await Company.findById(companyId).select("tourAgeBands").lean()
      : null;
    const tourAgeBands = company?.tourAgeBands || { babyMaxAge: 3, childrenMaxAge: 11 };

    // Tính publishableMap cho tất cả tour trên trang để view hiển thị
    // badge "Chưa xuất bản" cho các tour inactive còn thiếu điều kiện.
    const tourIdList = tourList.map((t) => String(t._id));
    const publishableMap = companyId
      ? await canPublishToursBulk(tourIdList, companyId)
      : {};

    res.render("admin/pages/tour-list", {
      pageTitle: "Quản lý tour",
      tourList: tourList,
      pagination: pagination,
      currentTab: tab,
      tourAgeBands,
      pathAdmin,
      publishableMap,
    });
  } catch (error) {
    console.error("Tour list error:", error);
    res.status(500).render("admin/pages/500", { pageTitle: "Lỗi hệ thống" });
  }
};

// ── Lưu cấu hình mức tuổi hành khách ────────────────────────────────────────
module.exports.saveAgeBands = async (req, res) => {
  try {
    const companyId = req.account.companyId;
    if (!companyId) {
      return res.json({ success: false, message: "Không xác định được công ty" });
    }

    const babyMaxAge     = parseInt(req.body.babyMaxAge, 10);
    const childrenMaxAge = parseInt(req.body.childrenMaxAge, 10);

    if (
      isNaN(babyMaxAge) || isNaN(childrenMaxAge) ||
      babyMaxAge < 0 || childrenMaxAge <= babyMaxAge
    ) {
      return res.json({
        success: false,
        message: "Mức tuổi không hợp lệ. Cần: babyMaxAge ≥ 0 và childrenMaxAge > babyMaxAge",
      });
    }

    await Company.findByIdAndUpdate(companyId, {
      "tourAgeBands.babyMaxAge":     babyMaxAge,
      "tourAgeBands.childrenMaxAge": childrenMaxAge,
    });

    return res.json({
      success: true,
      message: "Đã lưu cấu hình mức tuổi thành công",
      tourAgeBands: { babyMaxAge, childrenMaxAge },
    });
  } catch (err) {
    console.error("[saveAgeBands]", err);
    return res.json({ success: false, message: "Lỗi server" });
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
  const companyId = req.account.companyId;
  const categoryList =
    await categoryHelper.getCategoriesForCompanyTourSelect();
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
    cityList: vietnamCities,
    europeanCountries,
    europeanCities,
    isInternationalTour,
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
    // verifyToken đã gán req.account, nên companyId lấy từ admin đang đăng nhập, ở file auth.middleware.js
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
    const toInt = (v, d = 0) => {
      if (v === undefined || v === null || v === "") return d;
      const n = parseInt(v, 10);
      return Number.isFinite(n) ? n : d;
    };

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
    
    // Xử lý departures: mảng cặp { departureDate, endDate, seatsTotal, seatsRemaining }
    // Client gửi lên JSON string
    if (req.body.departures) {
      try {
        const raw = typeof req.body.departures === "string"
          ? JSON.parse(req.body.departures)
          : req.body.departures;
        if (Array.isArray(raw)) {
          req.body.departures = raw
            .map((item) => {
              if (!item || !item.departureDate) return null;
              const depDate = new Date(item.departureDate);
              if (isNaN(depDate)) return null;
              const endDate = item.endDate ? new Date(item.endDate) : null;
              const sTotal = Math.max(0, toInt(item.seatsTotal, 0));
              let sRem = item.seatsRemaining !== undefined
                ? Math.max(0, toInt(item.seatsRemaining, sTotal))
                : sTotal;
              if (sRem > sTotal) sRem = sTotal;
              return {
                departureDate: depDate,
                endDate: endDate && !isNaN(endDate) ? endDate : null,
                seatsTotal: sTotal,
                seatsRemaining: sRem,
              };
            })
            .filter(Boolean)
            .sort((a, b) => a.departureDate - b.departureDate);
        } else {
          req.body.departures = [];
        }
      } catch {
        req.body.departures = [];
      }
    } else {
      req.body.departures = [];
    }

    // Giữ lại departureDate để tương thích (= ngày khởi hành đầu tiên)
    req.body.departureDate = req.body.departures.length > 0
      ? req.body.departures[0].departureDate
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

    // Tour mới chưa gán KS
    req.body.accommodations = [];

    // --- cấu hình giá em bé ---: fixed: mặc định, tiered: theo bậc
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

    // --- Cấu hình chỗ ngồi em bé ---
    const parsedMaxBabies = parseInt(req.body.maxBabiesPerAdult, 10);

    // Mỗi Người lớn tối đa bao nhiêu em bé ngồi cùng
    req.body.maxBabiesPerAdult = Number.isFinite(parsedMaxBabies)
      ? Math.max(0, parsedMaxBabies)
      : 1;
    const parsedBabySeatFee = parseInt(req.body.babySeatFee, 10);

    // Phí ghế riêng em bé
    req.body.babySeatFee =
      req.body.maxBabiesPerAdult === 0
        ? 0
        : Number.isFinite(parsedBabySeatFee)
        ? Math.max(0, parsedBabySeatFee)
        : 0;

    // Ghế đã chuyển sang từng departure; giữ top-level = tổng tất cả departures (backward compat)
    const depArr = req.body.departures || [];
    req.body.seatsTotal = depArr.reduce((s, d) => s + (d.seatsTotal || 0), 0);
    req.body.seatsRemaining = depArr.reduce((s, d) => s + (d.seatsRemaining || 0), 0);

    // bỏ các field stock cũ nếu client còn gửi lên
    delete req.body.stockAdult;
    delete req.body.stockChildren;
    delete req.body.stockBaby;

    // --- customId ---
    const rawCustomId = String(req.body.customId || "").trim();
    req.body.customId = rawCustomId;
    if (rawCustomId) {
      const existed = await Tour.findOne({
        customId: rawCustomId,
        deleted: false,
      }).select("_id").lean();
      if (existed) {
        return res.json({ code: "error", message: `ID tour "${rawCustomId}" đã được sử dụng bởi tour khác. Vui lòng chọn ID khác.` });
      }
    }

    // --- Danh mục (nhiều + đồng bộ category legacy) ---
    categoryHelper.applyTourCategoryFields(
      req.body,
      categoryHelper.parseTourCategoriesFromBody(req.body)
    );

    // --- audit & file & company ---
    req.body.createdBy = req.account.id;
    req.body.updatedBy = req.account.id;
    req.body.companyId = companyId;

    // Tour mới luôn ẩn khỏi client cho tới khi admin đã liên kết khách sạn,
    // được duyệt cross-company và chủ động bật hiển thị ở trang chỉnh sửa.
    req.body.status = "inactive";
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

    // Lưu DB
    const newRecord = new Tour(req.body);
    await newRecord.save();

    buildTourAuditSnapshot(newRecord).then((afterSnap) => {
      auditLogHelper.log(req, {
        action: "tour.create",
        resourceType: "Tour",
        resourceId: newRecord._id,
        resourceLabel: newRecord.name || "",
        after: afterSnap,
        summary: `Tạo tour "${newRecord.name || ""}"`,
      });
    }).catch(() => {});

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

    // Chuẩn hoá departures cho form:
    //   departuresBlocks: [{ departureDateFormat, endDateFormat }]
    const departuresArr = Array.isArray(tourDetail.departures) && tourDetail.departures.length > 0
      ? tourDetail.departures
      : tourDetail.departureDate
      ? [{ departureDate: tourDetail.departureDate, endDate: null }]
      : [];
    tourDetail.departuresBlocks = departuresArr.map((d) => ({
      departureDateFormat: d.departureDate ? moment(d.departureDate).format("YYYY-MM-DD") : "",
      endDateFormat: d.endDate ? moment(d.endDate).format("YYYY-MM-DD") : "",
      seatsTotal: d.seatsTotal ?? 0,
      seatsRemaining: d.seatsRemaining ?? 0,
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

    tourDetail.categoryIds = categoryHelper.getTourAssignedCategoryIds(tourDetail);
    const categoryList = await categoryHelper.getCategoriesForCompanyTourSelect({
      includeCategoryIds: tourDetail.categoryIds,
    });
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

    // Xác định tour là trong nước hay nước ngoài dựa trên danh mục đã gán
    let isInternationalTour = false;
    const assignedCatIds = tourDetail.categoryIds || [];
    for (const catId of assignedCatIds) {
      const category = await Category.findById(catId);
      if (!category || !category.parent) continue;
      const parentCategory = await Category.findById(category.parent);
      if (!parentCategory) continue;
      const parentName = parentCategory.name.toLowerCase();
      const parentSlug = parentCategory.slug?.toLowerCase() || "";
      if (
        parentName.includes("nước ngoài") ||
        parentSlug.includes("nuoc-ngoai") ||
        parentName.includes("international") ||
        parentSlug.includes("international")
      ) {
        isInternationalTour = true;
        break;
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

    // Kiểm tra điều kiện hiển thị (publish gate) để view render checklist
    const publishCheck = await canPublishTour(id, companyId);

    return res.render("admin/pages/tour-edit", {
      pageTitle: "Chỉnh sửa tour",
      categoryList: categoryTree,
      tourDetail,
      cityList: vietnamCities,
      europeanCountries,
      europeanCities,
      isInternationalTour,
      pathAdmin,
      publishCheck,
      tourScheduleReadOnly: !!(
        req.overrideContext && req.overrideContext.isSuperAdminOverride
      ),
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

    // ── Gate xuất bản: chỉ cho chuyển sang "active" khi tour đủ điều kiện ──
    // (đủ departure + segment + tất cả HotelLinkRequest đã approved/partially_approved)
    const wantsActive =
      req.body.status === "active" && existed.status !== "active";
    if (wantsActive) {
      const publishCheck = await canPublishTour(id, req.account.companyId);
      if (!publishCheck.ok) {
        return res.json({
          code: "error",
          message:
            "Chưa thể bật hiển thị tour ở client. Vui lòng hoàn tất các điều kiện sau trước.",
          reasons: publishCheck.reasons,
        });
      }
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
    const toInt = (v, d = 0) => {
      if (v === undefined || v === null || v === "") return d;
      const n = parseInt(v, 10);
      return Number.isFinite(n) ? n : d;
    };

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

    if (req.overrideContext && req.overrideContext.isSuperAdminOverride) {
      const ex = existed.toObject ? existed.toObject() : {};
      req.body.schedules = Array.isArray(ex.schedules)
        ? JSON.parse(JSON.stringify(ex.schedules))
        : [];
    } else {
      req.body.schedules = req.body.schedules
        ? JSON.parse(req.body.schedules)
        : [];
    }

    // Xử lý departures: mảng cặp { departureDate, endDate, seatsTotal, seatsRemaining }
    if (req.body.departures) {
      try {
        const raw = typeof req.body.departures === "string"
          ? JSON.parse(req.body.departures)
          : req.body.departures;
        if (Array.isArray(raw)) {
          req.body.departures = raw
            .map((item) => {
              if (!item || !item.departureDate) return null;
              const depDate = new Date(item.departureDate);
              if (isNaN(depDate)) return null;
              const endDate = item.endDate ? new Date(item.endDate) : null;
              const sTotal = Math.max(0, toInt(item.seatsTotal, 0));
              let sRem = item.seatsRemaining !== undefined
                ? Math.max(0, toInt(item.seatsRemaining, sTotal))
                : sTotal;
              if (sRem > sTotal) sRem = sTotal;
              return {
                departureDate: depDate,
                endDate: endDate && !isNaN(endDate) ? endDate : null,
                seatsTotal: sTotal,
                seatsRemaining: sRem,
              };
            })
            .filter(Boolean)
            .sort((a, b) => a.departureDate - b.departureDate);
        } else {
          req.body.departures = [];
        }
      } catch {
        req.body.departures = [];
      }
    } else {
      req.body.departures = [];
    }

    // Giữ lại departureDate để tương thích
    req.body.departureDate = req.body.departures.length > 0
      ? req.body.departures[0].departureDate
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

    // --- Khách sạn trong tour đã bỏ; luôn lưu rỗng ---
    req.body.accommodations = [];

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

    // --- Cấu hình chỗ ngồi em bé ---
    const rawMaxBabies = req.body.maxBabiesPerAdult;
    if (rawMaxBabies !== undefined && rawMaxBabies !== "") {
      req.body.maxBabiesPerAdult = Math.max(0, parseInt(rawMaxBabies, 10) || 0);
    } else {
      req.body.maxBabiesPerAdult =
        existed.maxBabiesPerAdult != null ? existed.maxBabiesPerAdult : 1;
    }
    if (req.body.maxBabiesPerAdult === 0) {
      req.body.babySeatFee = 0;
    } else {
      const rawSeatFee = req.body.babySeatFee;
      if (rawSeatFee !== undefined && rawSeatFee !== "") {
        req.body.babySeatFee = Math.max(0, parseInt(rawSeatFee, 10) || 0);
      } else {
        req.body.babySeatFee =
          existed.babySeatFee != null ? existed.babySeatFee : 0;
      }
    }

    // Ghế đã chuyển sang từng departure; giữ top-level = tổng tất cả departures (backward compat)
    const depArrE = req.body.departures || [];
    req.body.seatsTotal = depArrE.reduce((s, d) => s + (d.seatsTotal || 0), 0);
    req.body.seatsRemaining = depArrE.reduce((s, d) => s + (d.seatsRemaining || 0), 0);

    // BỎ các field stock cũ nếu client còn gửi
    delete req.body.stockAdult;
    delete req.body.stockChildren;
    delete req.body.stockBaby;

    // --- customId ---
    const rawCustomIdE = String(req.body.customId || "").trim();
    req.body.customId = rawCustomIdE;
    if (rawCustomIdE) {
      const conflict = await Tour.findOne({
        customId: rawCustomIdE,
        deleted: false,
        _id: { $ne: existed._id },
      }).select("_id").lean();
      if (conflict) {
        return res.json({ code: "error", message: `ID tour "${rawCustomIdE}" đã được sử dụng bởi tour khác. Vui lòng chọn ID khác.` });
      }
    }

    // --- Danh mục (nhiều + đồng bộ category legacy) ---
    categoryHelper.applyTourCategoryFields(
      req.body,
      categoryHelper.parseTourCategoriesFromBody(req.body)
    );

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

    const afterDoc = await Tour.findById(id).lean();
    const [beforeSnap, afterSnap] = await Promise.all([
      buildTourAuditSnapshot(existed),
      buildTourAuditSnapshot(afterDoc || {}),
    ]);
    const isStatusChange =
      beforeSnap.status !== afterSnap.status && afterSnap.status !== undefined;
    auditLogHelper.log(req, {
      action: isStatusChange ? "tour.change-status" : "tour.update",
      resourceType: "Tour",
      resourceId: id,
      resourceLabel: (afterDoc && afterDoc.name) || existed.name || "",
      before: beforeSnap,
      after: afterSnap,
      summary: isStatusChange
        ? `Đổi trạng thái tour "${afterDoc?.name || existed.name || ""}" từ "${beforeSnap.status || "-"}" sang "${afterSnap.status || "-"}"`
        : `Cập nhật tour "${afterDoc?.name || existed.name || ""}"`,
    });

    return res.json({ code: "success", message: "Cập nhật thành công!" });
  } catch (error) {
    console.error("tour.editPatch error:", error);
    return res.json({ code: "error", message: "Dữ liệu không hợp lệ!" });
  }
};

/**
 * Kiểm tra xem một tour có còn dữ liệu liên quan đang hoạt động hay không.
 * Chặn xóa (mềm hoặc vĩnh viễn) khi tour vẫn còn:
 *   - Đơn đặt tour còn hiệu lực: Order tham chiếu tourId, chưa xóa, status
 *     khác "cancel", và (không phải đơn giữ chỗ tạm hết hạn).
 *   - Liên kết tour–khách sạn còn hiệu lực: HotelLinkRequest theo tourId với
 *     status khác "cancelled"/"rejected".
 *
 * @returns {Promise<{ blocked: boolean, orderCount: number, linkCount: number, message: string }>}
 */
async function _checkTourDeletable(id) {
  const Order = require("../../models/order.model");
  const HotelLinkRequest = require("../../models/hotel-link-request.model");

  const now = new Date();

  // Đơn đặt tour chưa kết thúc: chỉ đếm đơn status = "initial" (đang xử lý).
  // Đơn "done" (Hoàn thành) không chặn xóa vì tour đã kết thúc với những
  // đơn đó. Đơn "cancel" và đơn đã xóa cũng không chặn.
  // Đơn giữ chỗ tạm (isTemporaryHold) đã hết hạn cũng không tính.
  const orderCount = await Order.countDocuments({
    deleted: { $ne: true },
    status: "initial",
    "items.tourId": String(id),
    $or: [
      { isTemporaryHold: { $ne: true } },
      { holdExpiresAt: null },
      { holdExpiresAt: { $gt: now } },
    ],
  });

  // Tour đã kết thúc hay chưa: chỉ coi là đã kết thúc khi TẤT CẢ đơn hàng của
  // tour (chưa xóa) đều ở trạng thái "done" (Hoàn thành) và phải có ít nhất 1
  // đơn. Admin chỉ đánh dấu Hoàn thành sau khi tour kết thúc, nên khi mọi đơn
  // đều Hoàn thành thì liên kết tour–khách sạn không còn ý nghĩa chặn xóa.
  const totalOrderCount = await Order.countDocuments({
    deleted: { $ne: true },
    "items.tourId": String(id),
  });
  const doneOrderCount = await Order.countDocuments({
    deleted: { $ne: true },
    status: "done",
    "items.tourId": String(id),
  });
  const tourEnded = totalOrderCount > 0 && doneOrderCount === totalOrderCount;

  // Liên kết tour–khách sạn còn hiệu lực (bỏ qua đã hủy / đã từ chối).
  // Chỉ kiểm tra khi tour CHƯA kết thúc.
  const linkCount = tourEnded
    ? 0
    : await HotelLinkRequest.countDocuments({
        tourId: id,
        status: { $nin: ["cancelled", "rejected"] },
      });

  const blocked = orderCount > 0 || linkCount > 0;

  let message = "";
  if (blocked) {
    const parts = [];
    if (orderCount > 0) {
      parts.push(`${orderCount} đơn đặt tour đang xử lý`);
    }
    if (linkCount > 0) {
      parts.push(`${linkCount} liên kết tour–khách sạn`);
    }
    message =
      `Không thể xóa tour vì vẫn còn ${parts.join(" và ")} đang hoạt động. ` +
      `Vui lòng hủy hoặc xóa các đơn đặt tour đang xử lý, và hủy các liên kết ` +
      `tour–khách sạn của tour này trước khi xóa.`;
  }

  return { blocked, orderCount, linkCount, tourEnded, message };
}

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

    const tourBefore = await Tour.findOne(filter).select("name status").lean();

    // 2b) CHẶN xóa khi tour còn đơn đặt tour hoặc liên kết tour–khách sạn.
    if (tourBefore) {
      const guard = await _checkTourDeletable(id);
      if (guard.blocked) {
        return res.json({ code: "error", message: guard.message });
      }
    }

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

    // 4) Cascade: GIẢI PHÓNG các phòng tour đang giữ cho tour này.
    //   - Tìm tất cả TourSegment thuộc tour vừa xoá.
    //   - Với mỗi HotelBooking có tourSegmentId nằm trong đó và status hiện
    //     tại KHÁC 'cancelled' → lưu status cũ vào statusBeforeTourDelete,
    //     đặt status = 'cancelled', tourDeletedAt = now. Phòng sẽ tự được trả
    //     lại lịch (vì helpers/hotel-availability.helper.js bỏ qua booking
    //     'cancelled'). undoPatch sẽ khôi phục lại theo các cờ này.
    let releasedCount = 0;
    try {
      const TourSegment = require("../../models/tour-segment.model");
      const HotelBooking = require("../../models/hotel-booking.model");
      const segments = await TourSegment.find({ tourId: id })
        .select("_id")
        .lean();
      const segmentIds = segments.map((s) => s._id);
      if (segmentIds.length > 0) {
        const releaseRes = await HotelBooking.updateMany(
          {
            tourSegmentId: { $in: segmentIds },
            status: { $ne: "cancelled" },
            tourDeletedAt: null,
          },
          [
            {
              $set: {
                statusBeforeTourDelete: "$status",
                status: "cancelled",
                tourDeletedAt: new Date(),
              },
            },
          ]
        );
        releasedCount = releaseRes.modifiedCount || 0;
      }
    } catch (cascadeErr) {
      console.error("tour.deletePatch cascade release error:", cascadeErr);
    }

    auditLogHelper.log(req, {
      action: "tour.delete",
      resourceType: "Tour",
      resourceId: id,
      resourceLabel: (tourBefore && tourBefore.name) || "",
      summary:
        `Xóa tour "${(tourBefore && tourBefore.name) || ""}"` +
        (releasedCount > 0
          ? ` (đã giải phóng ${releasedCount} phòng giữ cho tour)`
          : ""),
    });

    return res.json({
      code: "success",
      message:
        releasedCount > 0
          ? `Xóa tour thành công! Đã giải phóng ${releasedCount} phòng giữ cho tour.`
          : "Xóa tour thành công!",
    });
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

    // Cascade: KHÔI PHỤC các HotelBooking đã bị tự huỷ khi xoá tour.
    //   - Lấy danh sách booking có tourDeletedAt set + tourSegmentId thuộc
    //     các segment của tour này.
    //   - Với MỖI booking: kiểm tra xem trong khoảng [checkIn, checkOut)
    //     phòng đó (roomId) đã bị booking khác (status != 'cancelled' &&
    //     tourDeletedAt = null) chiếm chưa.
    //     + Nếu CHƯA: khôi phục status = statusBeforeTourDelete, clear cờ.
    //     + Nếu RỒI: để nguyên 'cancelled' (đã có khách khác đặt mất), trả
    //       về cho admin biết để xử lý thủ công.
    let restoredCount = 0;
    let conflictCount = 0;
    try {
      const TourSegment = require("../../models/tour-segment.model");
      const HotelBooking = require("../../models/hotel-booking.model");
      const {
        hasTimeOverlap,
      } = require("../../helpers/hotel-availability.helper");

      const segments = await TourSegment.find({ tourId: id })
        .select("_id")
        .lean();
      const segmentIds = segments.map((s) => s._id);
      if (segmentIds.length > 0) {
        const heldBookings = await HotelBooking.find({
          tourSegmentId: { $in: segmentIds },
          tourDeletedAt: { $ne: null },
          status: "cancelled",
        }).lean();

        // Gom mọi booking hiện hành (KHÔNG do tour-delete gây ra) có
        // overlap với roomId tương ứng để check xung đột.
        const roomIds = [
          ...new Set(
            heldBookings.map((b) => String(b.roomId)).filter(Boolean)
          ),
        ];
        const activeOthers = roomIds.length
          ? await HotelBooking.find({
              roomId: {
                $in: roomIds.map(
                  (rid) => new mongoose.Types.ObjectId(rid)
                ),
              },
              status: { $nin: ["cancelled", "checked_out"] },
              tourDeletedAt: null,
            })
              .select("_id roomId checkIn checkOut")
              .lean()
          : [];

        for (const b of heldBookings) {
          const hasConflict =
            b.roomId &&
            activeOthers.some(
              (o) =>
                String(o.roomId) === String(b.roomId) &&
                hasTimeOverlap(b.checkIn, b.checkOut, o.checkIn, o.checkOut)
            );
          if (hasConflict) {
            conflictCount++;
            continue;
          }
          await HotelBooking.updateOne(
            { _id: b._id },
            {
              $set: {
                status: b.statusBeforeTourDelete || "confirmed",
                statusBeforeTourDelete: null,
                tourDeletedAt: null,
              },
            }
          );
          restoredCount++;
        }
      }
    } catch (cascadeErr) {
      console.error("tour.undoPatch cascade restore error:", cascadeErr);
    }

    let msg = "Đã khôi phục!";
    if (restoredCount > 0) {
      msg += ` Đã khôi phục ${restoredCount} phòng giữ cho tour.`;
    }
    if (conflictCount > 0) {
      msg += ` ${conflictCount} phòng KHÔNG khôi phục được do đã có khách khác đặt mất — cần xếp lại thủ công.`;
    }
    return res.json({ code: "success", message: msg });
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

    // 2b) CHẶN xóa vĩnh viễn khi tour còn đơn đặt tour hoặc liên kết tour–KS.
    const tourExists = await Tour.findOne(filter).select("_id").lean();
    if (tourExists) {
      const guard = await _checkTourDeletable(id);
      if (guard.blocked) {
        return res.json({ code: "error", message: guard.message });
      }
    }

    const result = await Tour.deleteOne(filter);

    // 3) Phản hồi theo kết quả
    if (result.deletedCount === 0) {
      return res.json({
        code: "error",
        message:
          "Tour không tồn tại, không thuộc công ty của bạn, hoặc chưa bị xoá tạm!",
      });
    }

    // 4) Cascade: xoá vĩnh viễn các HotelBooking giữ phòng cho tour này.
    //   Lúc này tour đã không còn khả năng khôi phục, nên cũng không cần giữ
    //   lại các bản ghi 'cancelled' do tour-delete tạo ra; đồng thời để
    //   trang /admin/hotel/booking/tour-holds/... không còn rác.
    try {
      const TourSegment = require("../../models/tour-segment.model");
      const HotelBooking = require("../../models/hotel-booking.model");
      const segments = await TourSegment.find({ tourId: id })
        .select("_id")
        .lean();
      const segmentIds = segments.map((s) => s._id);
      if (segmentIds.length > 0) {
        await HotelBooking.deleteMany({
          tourSegmentId: { $in: segmentIds },
        });
      }
    } catch (cascadeErr) {
      console.error("tour.destroyDelete cascade cleanup error:", cascadeErr);
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
      case "active": {
        // Bật hiển thị: phải gate từng tour (đủ KS + link request đã duyệt)
        const filter = { ...baseFilter, deleted: false };
        const tours = await Tour.find(filter).select("_id name status").lean();

        if (tours.length === 0) {
          return res.json({
            code: "error",
            message: "Không có tour hợp lệ để cập nhật!",
          });
        }

        const tourIds = tours.map((t) => String(t._id));
        const checkMap = await canPublishToursBulk(tourIds, companyId);

        const allowedIds = [];
        const blocked = [];
        for (const t of tours) {
          const tid = String(t._id);
          const chk = checkMap[tid];
          if (chk && chk.ok) {
            allowedIds.push(t._id);
          } else {
            blocked.push({
              id: tid,
              name: t.name || "(không tên)",
              reasons: (chk && chk.reasons) || [
                "Tour chưa đủ điều kiện hiển thị.",
              ],
            });
          }
        }

        let modifiedCount = 0;
        if (allowedIds.length > 0) {
          const upd = await Tour.updateMany(
            { _id: { $in: allowedIds }, companyId, deleted: false },
            {
              $set: {
                status: "active",
                updatedBy: req.account.id,
                updatedAt: new Date(),
              },
            }
          );
          modifiedCount = upd.modifiedCount || 0;
        }

        if (blocked.length > 0) {
          // Có tour bị chặn → trả "partial" để client hiển thị chi tiết
          return res.json({
            code: allowedIds.length > 0 ? "partial" : "error",
            message:
              allowedIds.length > 0
                ? `Đã bật hiển thị ${modifiedCount} tour. ${blocked.length} tour bị chặn vì chưa đủ điều kiện.`
                : `Tất cả ${blocked.length} tour đều chưa đủ điều kiện hiển thị.`,
            modifiedCount,
            blocked,
          });
        }

        return res.json({
          code: "success",
          message: `Đã bật hiển thị ${modifiedCount}/${tours.length} tour!`,
        });
      }

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
