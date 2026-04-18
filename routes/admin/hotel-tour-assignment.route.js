// routes/admin/hotel-tour-assignment.route.js
const express = require("express");
const router = express.Router();
const controller = require("../../controllers/admin/hotel-tour-assignment.controller");

router.get("/", controller.list);
router.get("/:segmentId", controller.detail);
router.post("/:segmentId/save", controller.save);

module.exports = router;
