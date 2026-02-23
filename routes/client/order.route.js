const router = require("express").Router();
const orderController = require("../../controllers/client/order.controller");

router.post("/create", orderController.createPost);

router.get("/pending", orderController.pending);

router.get("/cancel-hold",  orderController.cancelHold);
router.post("/cancel-hold", orderController.cancelHold); // sendBeacon dùng POST

router.get("/success", orderController.success);

router.get("/payment-vnpay", orderController.paymentVNPay);

router.get("/payment-vnpay-result", orderController.paymentVNPayResult);

module.exports = router;
