const router = require("express").Router();
const accountRoutes = require("./account.route");
const dashboardRoutes = require("./dashboard.route");
const categoryRoutes = require("./category.route");
const tourRoutes = require("./tour.route");
const orderRoutes = require("./order.route");
const userRoutes = require("./user.route");
const contactRoutes = require("./contact.route");
const settingRoutes = require("./setting.route");
const profileRoutes = require("./profile.route");
const uploadRoutes = require("./upload.route");
const companyRoutes = require("./company.route");
const hotelRoutes = require("./hotel.route");
const tourHotelRoutes = require("./tour-hotel.route");
const superAdminRoutes = require("./super-admin.route");
const notificationRoutes = require("./notification.route");
const hotelLinkRequestRoutes = require("./hotel-link-request.route");
const hotelTourAssignmentRoutes = require("./hotel-tour-assignment.route");

const authMiddleware = require("../../middlewares/admin/auth.middleware");
const notificationMiddleware = require("../../middlewares/admin/notification.middleware");
const hotelListMiddleware = require("../../middlewares/admin/hotel-list.middleware");
const roleMiddleware = require("../../middlewares/admin/role.middleware");

router.use("/account", accountRoutes);

// ⭐ SUPER ADMIN ROUTES - Phải đặt trước các routes khác
router.use(
  "/super-admin",
  authMiddleware.verifyToken,
  roleMiddleware.loadRolePermissions,
  superAdminRoutes
);

// COMPANY ADMIN ROUTES (apply notification middleware sau verify token)
router.use(
  "/dashboard",
  authMiddleware.verifyToken,
  roleMiddleware.loadRolePermissions,
  notificationMiddleware.getUnreadCount,
  roleMiddleware.requirePermission("tour-access"),
  dashboardRoutes
);
router.use(
  "/category",
  authMiddleware.verifyToken,
  roleMiddleware.loadRolePermissions,
  notificationMiddleware.getUnreadCount,
  roleMiddleware.requirePermission("tour-access"),
  categoryRoutes
);
router.use(
  "/tour",
  authMiddleware.verifyToken,
  roleMiddleware.loadRolePermissions,
  notificationMiddleware.getUnreadCount,
  roleMiddleware.requirePermission("tour-access"),
  tourRoutes
);
router.use(
  "/order",
  authMiddleware.verifyToken,
  roleMiddleware.loadRolePermissions,
  notificationMiddleware.getUnreadCount,
  roleMiddleware.requirePermission("tour-access"),
  orderRoutes
);
router.use(
  "/user",
  authMiddleware.verifyToken,
  roleMiddleware.loadRolePermissions,
  notificationMiddleware.getUnreadCount,
  roleMiddleware.requirePermission("tour-access"),
  userRoutes
);
router.use(
  "/contact",
  authMiddleware.verifyToken,
  roleMiddleware.loadRolePermissions,
  notificationMiddleware.getUnreadCount,
  hotelListMiddleware.getHotelList,
  contactRoutes
);
router.use(
  "/setting",
  authMiddleware.verifyToken,
  roleMiddleware.loadRolePermissions,
  notificationMiddleware.getUnreadCount,
  hotelListMiddleware.getHotelList,
  settingRoutes
);
router.use(
  "/profile",
  authMiddleware.verifyToken,
  roleMiddleware.loadRolePermissions,
  notificationMiddleware.getUnreadCount,
  hotelListMiddleware.getHotelList,
  profileRoutes
);
router.use(
  "/upload",
  authMiddleware.verifyToken,
  roleMiddleware.loadRolePermissions,
  notificationMiddleware.getUnreadCount,
  hotelListMiddleware.getHotelList,
  uploadRoutes
);
router.use(
  "/company",
  authMiddleware.verifyToken,
  roleMiddleware.loadRolePermissions,
  notificationMiddleware.getUnreadCount,
  hotelListMiddleware.getHotelList,
  companyRoutes
);
router.use(
  "/hotel/link-requests",
  authMiddleware.verifyToken,
  roleMiddleware.loadRolePermissions,
  notificationMiddleware.getUnreadCount,
  hotelListMiddleware.getHotelList,
  roleMiddleware.requirePermission("hotel-access"),
  hotelLinkRequestRoutes
);
router.use(
  "/hotel/tour-assignments",
  authMiddleware.verifyToken,
  roleMiddleware.loadRolePermissions,
  notificationMiddleware.getUnreadCount,
  hotelListMiddleware.getHotelList,
  roleMiddleware.requirePermission("hotel-access"),
  hotelTourAssignmentRoutes
);
router.use(
  "/hotel",
  authMiddleware.verifyToken,
  roleMiddleware.loadRolePermissions,
  notificationMiddleware.getUnreadCount,
  roleMiddleware.requirePermission("hotel-access"),
  hotelRoutes
);
router.use(
  "/tour-hotel",
  authMiddleware.verifyToken,
  roleMiddleware.loadRolePermissions,
  notificationMiddleware.getUnreadCount,
  hotelListMiddleware.getHotelList,
  roleMiddleware.requirePermission("tour-access"),
  tourHotelRoutes
);
router.use(
  "/notifications",
  authMiddleware.verifyToken,
  roleMiddleware.loadRolePermissions,
  hotelListMiddleware.getHotelList,
  notificationRoutes
);

router.use(
  authMiddleware.verifyToken,
  roleMiddleware.loadRolePermissions,
  (req, res) => {
    res.render("admin/pages/error-404", {
      pageTitle: "404 Not Found",
    });
  }
);

module.exports = router;
