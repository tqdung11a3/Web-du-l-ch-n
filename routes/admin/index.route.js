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

router.use("/account", accountRoutes);

// ⭐ SUPER ADMIN ROUTES - Phải đặt trước các routes khác
router.use("/super-admin", authMiddleware.verifyToken, superAdminRoutes);

// COMPANY ADMIN ROUTES (apply notification middleware sau verify token)
router.use("/dashboard", authMiddleware.verifyToken, notificationMiddleware.getUnreadCount, dashboardRoutes);
router.use("/category", authMiddleware.verifyToken, notificationMiddleware.getUnreadCount, categoryRoutes);
router.use("/tour", authMiddleware.verifyToken, notificationMiddleware.getUnreadCount, tourRoutes);
router.use("/order", authMiddleware.verifyToken, notificationMiddleware.getUnreadCount, orderRoutes);
router.use("/user", authMiddleware.verifyToken, notificationMiddleware.getUnreadCount, userRoutes);
router.use("/contact", authMiddleware.verifyToken, notificationMiddleware.getUnreadCount, contactRoutes);
router.use("/setting", authMiddleware.verifyToken, notificationMiddleware.getUnreadCount, settingRoutes);
router.use("/profile", authMiddleware.verifyToken, notificationMiddleware.getUnreadCount, profileRoutes);
router.use("/upload", authMiddleware.verifyToken, notificationMiddleware.getUnreadCount, uploadRoutes);
router.use("/company", authMiddleware.verifyToken, notificationMiddleware.getUnreadCount, companyRoutes);
router.use("/hotel/link-requests", authMiddleware.verifyToken, notificationMiddleware.getUnreadCount, hotelListMiddleware.getHotelList, hotelLinkRequestRoutes);
router.use("/hotel/tour-assignments", authMiddleware.verifyToken, notificationMiddleware.getUnreadCount, hotelListMiddleware.getHotelList, hotelTourAssignmentRoutes);
router.use("/hotel", authMiddleware.verifyToken, notificationMiddleware.getUnreadCount, hotelRoutes);
router.use("/tour-hotel", authMiddleware.verifyToken, notificationMiddleware.getUnreadCount, tourHotelRoutes);
router.use("/notifications", authMiddleware.verifyToken, notificationRoutes);

router.use(authMiddleware.verifyToken, (req, res) => {
  res.render("admin/pages/error-404", {
    pageTitle: "404 Not Found",
  });
});

module.exports = router;
