const router = require("express").Router();
const accountRoutes = require("./account.route");
const tourRoutes = require("./tour.route");

// ── TEMPORARY: bắt buộc đăng nhập mới vào toàn bộ trang client ───────────────
// Để gỡ: xoá khối từ đây đến // ── END TEMPORARY ──
// const { verifyToken } = require("../../middlewares/client/auth.middleware");
// router.use((req, res, next) => {
//   if (req.path.startsWith("/account")) return next();
//   return verifyToken(req, res, next);
// });
// ── END TEMPORARY ─────────────────────────────────────────────────────────────

const homeRoutes = require("./home.route");
const hotelCartRoutes = require("./hotel-cart.route"); // Cart cho hotel
const cartRoutes = require("./cart.route"); // Cart cho tour
const hotelBookingRoutes = require("./hotel-booking.route"); // Booking cho hotel
const categoryRoutes = require("./category.route");
const searchRoutes = require("./search.route");
const orderRoutes = require("./order.route");
const companyRoutes = require("./company.route");
const reviewRoutes = require("./review.route");
const hotelRoutes = require("./hotel.route");
const newsRoutes = require("./news.route");
const uploadRoutes = require("./upload.route");
const notificationRoutes = require("./notification.route");
const settingMiddleware = require("../../middlewares/client/setting.middleware");
const categoryMiddleware = require("../../middlewares/client/category.middleware");
const cityMiddleware = require("../../middlewares/client/city.middleware");
const clientNotificationMiddleware = require("../../middlewares/client/notification.middleware");
router.use(settingMiddleware.websiteInfo);
router.use(categoryMiddleware.list);
router.use(cityMiddleware.list);
router.use(clientNotificationMiddleware.attachUnreadCount);

router.use("/account", accountRoutes);
router.use("/", homeRoutes);
router.use("/tour", tourRoutes);
router.use("/hotel-cart", hotelCartRoutes); // Cart cho hotel
router.use("/cart", cartRoutes); // Cart cho tour
router.use("/hotel-booking", hotelBookingRoutes); // Booking cho hotel
router.use("/company", companyRoutes);
router.use("/category", categoryRoutes);
router.use("/search", searchRoutes);
router.use("/order", orderRoutes);
router.use("/review", reviewRoutes);
router.use("/hotel", hotelRoutes);
router.use("/news", newsRoutes);
router.use("/upload", uploadRoutes);
router.use("/notifications", notificationRoutes);

module.exports = router;
