// routes/admin/super-admin.route.js
const router = require("express").Router();
const dashboardController = require("../../controllers/admin/super-admin/dashboard.controller");
const companyController = require("../../controllers/admin/super-admin/company.controller");
const adminAccountController = require("../../controllers/admin/super-admin/admin-account.controller");
const tourController = require("../../controllers/admin/super-admin/tour.controller");
const customerController = require("../../controllers/admin/super-admin/customer.controller");
const categoryController = require("../../controllers/admin/super-admin/category.controller");
const roleMiddleware = require("../../middlewares/admin/role.middleware");
const multer = require("multer");
const cloudinaryHelper = require("../../helpers/cloudinary.helper");
const upload = multer({ storage: cloudinaryHelper.storage });

// Tất cả routes dưới đây đều yêu cầu Super Admin
router.use(roleMiddleware.requireSuperAdmin);

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

module.exports = router;

