const router = require("express").Router();
const hotelBookingController = require("../../controllers/client/hotel-booking.controller");

router.post("/create", hotelBookingController.createPost);

router.get("/payment-vnpay", hotelBookingController.paymentVNPay);

router.get("/payment-vnpay-result", hotelBookingController.paymentVNPayResult);

router.get("/pending", hotelBookingController.pending);

router.get("/success", hotelBookingController.success);

module.exports = router;

