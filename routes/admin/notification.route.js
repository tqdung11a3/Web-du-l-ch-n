// routes/admin/notification.route.js
const router = require("express").Router();
const notificationController = require("../../controllers/admin/notification.controller");

// Lấy danh sách thông báo
router.get("/list", notificationController.getNotifications);

// Đánh dấu đã đọc
router.post("/mark-as-read/:id", notificationController.markAsRead);

// Đánh dấu tất cả đã đọc
router.post("/mark-all-as-read", notificationController.markAllAsRead);

module.exports = router;

