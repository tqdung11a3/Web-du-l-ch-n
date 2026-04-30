// routes/admin/super-admin.route.js
const router = require("express").Router();
const dashboardController = require("../../controllers/admin/super-admin/dashboard.controller");
const companyController = require("../../controllers/admin/super-admin/company.controller");
const adminAccountController = require("../../controllers/admin/super-admin/admin-account.controller");
const tourController = require("../../controllers/admin/super-admin/tour.controller");
const customerController = require("../../controllers/admin/super-admin/customer.controller");
const categoryController = require("../../controllers/admin/super-admin/category.controller");
const roleMiddleware = require("../../middlewares/admin/role.middleware");
const profileController = require("../../controllers/admin/profile.controller");
const multer = require("multer");
const cloudinaryHelper = require("../../helpers/cloudinary.helper");
const upload = multer({ storage: cloudinaryHelper.storage });

// Tất cả routes dưới đây đều yêu cầu Super Admin
router.use(roleMiddleware.requireSuperAdmin);

// Hồ sơ Super Admin (URL riêng, không sửa chức vụ / nhóm quyền)
router.get("/profile/edit", profileController.editSuperAdmin);
router.patch(
  "/profile/edit",
  upload.single("avatar"),
  profileController.editPatchSuperAdmin
);
router.get(
  "/profile/change-password",
  profileController.changePasswordSuperAdmin
);

// Dashboard
router.get("/", dashboardController.index);
router.get("/dashboard", dashboardController.index);

// Quản lý công ty
router.get("/company", companyController.list);
router.get("/company/:id", companyController.detail);
router.patch("/company/change-status", companyController.changeStatus);
router.delete("/company/:id", companyController.deleteCompany);

// Quản lý company admin
router.get("/admin", adminAccountController.list);
router.get("/admin/create", adminAccountController.createGet);
router.post("/admin/create", upload.single("avatar"), adminAccountController.createPost);
router.get("/admin/edit/:id", adminAccountController.editGet);
router.patch("/admin/edit/:id", upload.single("avatar"), adminAccountController.editPatch);
router.patch("/admin/approve", adminAccountController.approve);
router.patch("/admin/reject", adminAccountController.reject);
router.delete("/admin/:id", adminAccountController.deleteAdmin);

// Quản lý danh mục
router.get("/category", categoryController.list);
router.get("/category/create", categoryController.create);
router.post("/category/create", upload.single("avatar"), categoryController.createPost);
router.get("/category/edit/:id", categoryController.edit);
router.patch("/category/edit/:id", upload.single("avatar"), categoryController.editPatch);
router.patch("/category/delete/:id", categoryController.deletePatch);
router.patch("/category/change-status", categoryController.changeStatus);
router.patch("/category/change-multi", categoryController.changeMultiPatch);
router.patch("/category/change-position", categoryController.changePosition);
router.delete("/category/:id", categoryController.deleteItem);
router.get("/category/detail/:id", categoryController.detail);

// Quản lý tin tức
const newsController = require("../../controllers/admin/super-admin/news.controller");
router.get("/news", newsController.list);
router.get("/news/create", newsController.create);
router.post("/news/create", upload.single("avatar"), newsController.createPost);
router.get("/news/edit/:id", newsController.edit);
router.patch("/news/edit/:id", upload.single("avatar"), newsController.editPatch);
router.get("/news/detail/:id", newsController.detail);
router.patch("/news/change-status", newsController.changeStatus);
router.delete("/news/:id", newsController.deleteItem);

// Tours: danh sách công ty → tour theo công ty → chi tiết tour (thứ tự route quan trọng)
router.get("/tours/company/:companyId", tourController.listByCompany);
router.get("/tours", tourController.companyList);
router.get("/tours/:id", tourController.detail);

// Hotels: danh sách công ty → khách sạn theo công ty → chi tiết (giống tour; PATCH breadcrumb đặt trước :id)
const hotelController = require("../../controllers/admin/super-admin/hotel.controller");
router.patch(
  "/hotels/breadcrumb-image",
  upload.single("breadcrumbImage"),
  hotelController.updateHotelSearchBreadcrumb
);
router.get("/hotels/company/:companyId", hotelController.listByCompany);
router.get("/hotels", hotelController.companyList);
router.get("/hotels/:id", hotelController.detail);

// Xem tất cả đơn hàng
// Đơn hàng: công ty → hub (tour / đặt phòng) → danh sách → chi tiết (giống company admin)
const orderController = require("../../controllers/admin/super-admin/order.controller");
router.get(
  "/orders/company/:companyId/tour/:orderId",
  orderController.tourOrderDetail
);
router.get(
  "/orders/company/:companyId/hotel-booking/:bookingId",
  orderController.hotelBookingDetail
);
router.get(
  "/orders/company/:companyId/tours",
  orderController.tourOrdersList
);
router.get(
  "/orders/company/:companyId/hotel-bookings",
  orderController.hotelBookingsList
);
router.get("/orders/company/:companyId", orderController.companyHub);
router.get("/orders", orderController.companyList);

// Quản lý khách hàng
router.get("/customers", customerController.list);
router.get("/customers/:id", customerController.detail);

// Trung tâm liên hệ
const contactController = require("../../controllers/admin/super-admin/contact.controller");
router.get("/contacts", contactController.list);
router.patch("/contacts/mark-handled", contactController.markHandled);
router.delete("/contacts/:id", contactController.remove);

// Kiểm duyệt đánh giá
const reviewController = require("../../controllers/admin/super-admin/review.controller");
router.get("/reviews", reviewController.list);
router.patch("/reviews/toggle-hidden", reviewController.toggleHidden);
router.delete("/reviews/:tab/:id", reviewController.remove);

// Trung tâm thông báo
const notifController = require("../../controllers/admin/super-admin/notification.controller");
router.get("/notifications", notifController.list);
router.get("/notifications/broadcast", notifController.broadcastForm);
router.post("/notifications/broadcast", notifController.broadcast);
router.delete("/notifications/:id", notifController.remove);

// Yêu cầu liên kết khách sạn (giữa các công ty)
const hotelLinkReqController = require("../../controllers/admin/super-admin/hotel-link-request.controller");
router.get("/hotel-link-requests", hotelLinkReqController.list);
router.get("/hotel-link-requests/:id", hotelLinkReqController.detail);
router.patch(
  "/hotel-link-requests/:id/force-cancel",
  hotelLinkReqController.forceCancel
);

// Báo cáo tài chính
const financeController = require("../../controllers/admin/super-admin/finance.controller");
router.get("/finance", financeController.index);

// Cấu hình website toàn hệ thống (chỉ Super Admin — URL có prefix super-admin)
const settingController = require("../../controllers/admin/setting.controller");
router.get("/setting/website-info", settingController.websiteInfo);
router.patch(
  "/setting/website-info",
  upload.fields([{ name: "logo", maxCount: 1 }]),
  settingController.websiteInfoPatch
);

// Quản lý vai trò (toàn hệ thống)
const roleController = require("../../controllers/admin/super-admin/role.controller");
router.get("/roles", roleController.list);
router.get("/roles/create", roleController.createGet);
router.post("/roles/create", roleController.createPost);
router.get("/roles/edit/:id", roleController.editGet);
router.patch("/roles/edit/:id", roleController.editPatch);
router.delete("/roles/:id", roleController.remove);

// Nhật ký thao tác (audit log)
const auditLogController = require("../../controllers/admin/super-admin/audit-log.controller");
router.get("/audit", auditLogController.list);
// Alias: menu / bookmark cũ dùng `audit-logs` — router thực tế là `/audit`
router.get("/audit-logs", auditLogController.list);

// Super Admin override "act as company X"
const superAdminOverrideRoutes = require("./super-admin-override.route");
router.use("/as-company/:companyId", superAdminOverrideRoutes);

module.exports = router;

