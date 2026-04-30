const router = require("express").Router();
const settingController = require("../../controllers/admin/setting.controller");
const multer = require("multer");
const cloudinaryHelper = require("../../helpers/cloudinary.helper");
const roleMiddleware = require("../../middlewares/admin/role.middleware");
const upload = multer({ storage: cloudinaryHelper.storage });

router.get("/list", settingController.list);

router.get("/website-info", settingController.websiteInfo);

// Company Admin: ghép thêm danh mục Section 4 (JSON body)
router.patch(
  "/website-info/section4-categories",
  roleMiddleware.requireCompanyAdmin,
  settingController.mergeSection4Categories
);

// PATCH cập nhật website: chỉ còn tại /admin/super-admin/setting/website-info

router.get(
  "/account-admin/list",
  settingController.accountAdminList
);

router.get(
  "/account-admin/create",
  settingController.accountAdminCreate
);

router.post(
  "/account-admin/create",
  upload.single("avatar"),
  settingController.accountAdminCreatePost
);

router.get(
  "/account-admin/edit/:id",
  settingController.accountAdminEdit
);

router.patch(
  "/account-admin/edit/:id",
  upload.single("avatar"),
  settingController.accountAdminEditPatch
);

router.get("/role/list", settingController.roleList);

// Role CRUD giờ chỉ dành cho Super Admin (route company admin chỉ xem)
router.get("/role/create", roleMiddleware.requireSuperAdmin, settingController.roleCreate);

router.post("/role/create", roleMiddleware.requireSuperAdmin, settingController.roleCreatePost);

router.get("/role/edit/:id", roleMiddleware.requireSuperAdmin, settingController.roleEdit);

router.patch("/role/edit/:id", roleMiddleware.requireSuperAdmin, settingController.roleEditPatch);

module.exports = router;
