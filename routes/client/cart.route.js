// routes/client/cart.route.js
// Route cho giỏ hàng TOUR (chỉ cần render trang, logic ở client-side)
const express = require("express");
const router = express.Router();
const controller = require("../../controllers/client/cart.controller");

// Route GET để hiển thị trang giỏ hàng
router.get("/", controller.index);

// Route POST để lấy chi tiết tour cart (cho JavaScript client-side)
router.post("/detail", controller.getCartDetail);

module.exports = router;
