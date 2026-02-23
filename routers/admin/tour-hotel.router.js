const express    = require("express");
const router     = express.Router();
const controller = require("../../controllers/admin/tour-hotel.controller");

// Trang danh sách tour để chọn
router.get("/list", controller.list);

// Trang cấu hình segment: ?departure=YYYY-MM-DD
router.get("/detail/:tourId", controller.detail);

// API endpoints (AJAX)
router.get ("/api/hotel-availability",  controller.hotelAvailability);
router.get ("/api/suggest-allocation",  controller.suggestAllocation);
router.post("/api/save-segments",       controller.saveSegments);
router.post("/api/confirm-segments",    controller.confirmSegments);
router.post("/api/cancel-segments",     controller.cancelSegments);

module.exports = router;
