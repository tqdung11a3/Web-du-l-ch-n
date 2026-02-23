// routes/client/hotel-cart.route.js
const express = require("express");
const router = express.Router();
const controller = require("../../controllers/client/hotel-cart.controller");

router.get("/", controller.index);

router.post("/add", controller.addToCart);

router.patch("/update-quantity", controller.updateQuantity);

router.delete("/remove", controller.removeItem);

router.delete("/clear", controller.clearCart);

router.get("/count", controller.getCount);

router.get("/check-availability", controller.checkAvailability);

module.exports = router;
