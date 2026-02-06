// routes/client/review.route.js
const router = require("express").Router();
const auth = require("../../middlewares/client/auth.middleware");
const reviewController = require("../../controllers/client/review.controller");

// Lấy danh sách review của 1 tour (public)
router.get("/tour/:tourId/reviews", reviewController.list);

// Tạo/sửa review (yêu cầu đăng nhập) — nếu bạn có middleware auth, gắn vào đây
// ví dụ: router.post("/tour/:tourId/reviews", authRequired, reviewController.createOrUpdate);
router.post(
  "/tour/:tourId/reviews",
  auth.verifyTokenApi,
  reviewController.createOrUpdate
);

module.exports = router;
