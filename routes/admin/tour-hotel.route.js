const express    = require("express");
const router     = express.Router();
const controller = require("../../controllers/admin/tour-hotel.controller");
const linkRequestController = require("../../controllers/admin/hotel-link-request.controller");

// Trang danh sách tour để chọn
router.get("/list", controller.list);

// Yêu cầu liên kết đã gửi
router.get("/link-requests", linkRequestController.listSent);

// Trang cấu hình segment: ?departure=YYYY-MM-DD
router.get("/detail/:tourId", controller.detail);

// Trang phân công phòng cho khách hàng (chỉ hiển thị khi status = confirmed)
// Chế độ read-only: hotel-admin là người ghi tại /admin/hotel/tour-assignments/:segmentId/save.
router.get ("/assign/:segmentId",       controller.assign);

// API endpoints (AJAX)
router.get ("/api/hotel-availability",  controller.hotelAvailability);
router.get ("/api/suggest-allocation",  controller.suggestAllocation);
router.post("/api/save-segments",       controller.saveSegments);
router.post("/api/confirm-segments",       controller.confirmSegments);
router.post("/api/cancel-segments",        controller.cancelSegments);
router.post("/api/request-additional-rooms", controller.requestAdditionalRooms);

module.exports = router;
