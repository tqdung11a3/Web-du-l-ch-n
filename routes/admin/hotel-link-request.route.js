const router = require("express").Router();
const controller = require("../../controllers/admin/hotel-link-request.controller");

router.get("/", controller.listReceived);
router.post("/approve", controller.approve);
router.post("/reject", controller.reject);
router.post("/cancel", controller.cancel);

module.exports = router;
