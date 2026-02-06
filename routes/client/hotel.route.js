const router = require("express").Router();
const auth = require("../../middlewares/client/auth.middleware");

const hotelController = require("../../controllers/client/hotel.controller");
const hotelReviewController = require("../../controllers/client/hotel-review.controller");

// /hotel/search?cityCode=HAN&checkInDate=2025-12-01&checkOutDate=2025-12-03&adults=2
router.get("/search", hotelController.search);

// So sánh khách sạn
router.get("/compare", hotelController.compare);

// THÊM MỚI: Trang chi tiết + danh sách phòng theo hotelId
router.get("/detail/:id", hotelController.detail);

router.get("/room-select", hotelController.roomSelect);

router.get("/booking", hotelController.bookingGet);

// Hotel reviews
router.get("/:hotelId/reviews", hotelReviewController.list);
router.post(
  "/:hotelId/reviews",
  auth.verifyTokenApi,
  hotelReviewController.createOrUpdate
);

module.exports = router;
