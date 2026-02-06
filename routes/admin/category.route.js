const router = require("express").Router();
const categoryViewController = require("../../controllers/admin/category-view.controller");

// Company Admin chỉ được xem danh mục (read-only)
router.get("/view", categoryViewController.view);
router.get("/detail/:id", categoryViewController.detail);

module.exports = router;
