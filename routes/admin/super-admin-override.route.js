// routes/admin/super-admin-override.route.js
//
// Các endpoint cho phép Super Admin thao tác "với tư cách công ty X".
// Mọi route ở đây giả định request đã đi qua `requireSuperAdmin` từ router cha,
// và bắt buộc phải có `:companyId` trong URL. Trước khi gọi controller gốc,
// middleware sẽ gán `req.account.companyId = companyId`.
//
// LƯU Ý: Các controller bên dưới (`tourController.editPatch`,
// `hotelController.editPatch`, `orderController.editPatch`,
// `hotelController.updateBookingStatus`) đều đã tự gọi `auditLogHelper.log`
// với before/after đầy đủ. Do middleware override set `req.overrideContext`,
// helper tự nhận diện actor = super_admin và gán `asCompanyId` — vì vậy ở đây
// KHÔNG ghi log thêm (tránh trùng 2 dòng).

const mongoose = require("mongoose");
const router = require("express").Router({ mergeParams: true });
const Company = require("../../models/company.model");
const orderController = require("../../controllers/admin/order.controller");
const hotelController = require("../../controllers/admin/hotel.controller");
const tourController = require("../../controllers/admin/tour.controller");
const multer = require("multer");
const cloudinaryHelper = require("../../helpers/cloudinary.helper");
const upload = multer({ storage: cloudinaryHelper.storage });

/**
 * Middleware: gắn override context và tạm thời "trở thành" công ty X.
 *
 * Lưu ý: `items.companyId` trong Order được lưu dạng ObjectId nhưng field
 * `items` là Array tự do nên Mongoose không auto-cast khi query. Vì vậy phải
 * gán `req.account.companyId` dưới dạng ObjectId (giống luồng company admin
 * thường — `req.account.companyId` cũng là ObjectId từ `AccountAdmin`).
 */
function enforceCompanyFromParam(req, res, next) {
  const rawId = req.params.companyId;
  if (!rawId || !mongoose.Types.ObjectId.isValid(String(rawId))) {
    return res.status(400).json({
      code: "error",
      message: "companyId không hợp lệ.",
    });
  }
  const companyObjectId = new mongoose.Types.ObjectId(String(rawId));
  req.overrideContext = {
    actAsCompanyId: String(rawId),
    actor: req.account,
    isSuperAdminOverride: true,
  };
  req.account = Object.assign({}, req.account, {
    companyId: companyObjectId,
    _isSuperAdminOverride: true,
  });
  next();
}

router.use(enforceCompanyFromParam);

/**
 * Gắn `res.locals.superAdminOverrideBanner` có tên công ty (để UI không chỉ hiện ObjectId).
 */
async function attachSuperAdminOverrideBanner(req, res, next) {
  const rawId = req.params.companyId;
  try {
    const c = await Company.findOne({
      _id: rawId,
      deleted: { $ne: true },
    })
      .select("name")
      .lean();
    const name = c && c.name ? String(c.name).trim() : "";
    res.locals.superAdminOverrideBanner = {
      companyId: String(rawId),
      companyName: name || null,
    };
  } catch (err) {
    console.error("[attachSuperAdminOverrideBanner]", err);
    res.locals.superAdminOverrideBanner = {
      companyId: String(rawId),
      companyName: null,
    };
  }
  next();
}

// ── Order override ──────────────────────────────────────────────────────────
router.get("/orders/:id", attachSuperAdminOverrideBanner, orderController.edit);
router.patch("/orders/:id", orderController.editPatch);

// ── Tour override ───────────────────────────────────────────────────────────
router.get("/tours/:id", attachSuperAdminOverrideBanner, tourController.edit);

router.patch(
  "/tours/:id",
  upload.fields([
    { name: "avatar", maxCount: 1 },
    { name: "images", maxCount: 10 },
  ]),
  tourController.editPatch
);

// ── Hotel override ──────────────────────────────────────────────────────────
router.get("/hotels/:id", attachSuperAdminOverrideBanner, hotelController.edit);

router.patch(
  "/hotels/:id",
  upload.fields([
    { name: "avatar", maxCount: 1 },
    { name: "images", maxCount: 10 },
    { name: "highlightImages", maxCount: 20 },
    { name: "facilityImages", maxCount: 30 },
  ]),
  hotelController.editPatch
);

// ── Hotel booking override: chỉ đổi trạng thái là đủ ───────────────────────
router.post(
  "/hotel-bookings/update-status",
  hotelController.updateBookingStatus
);

module.exports = router;
