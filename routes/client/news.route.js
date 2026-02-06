// routes/client/news.route.js
const router = require("express").Router();
const newsController = require("../../controllers/client/news.controller");

router.get("/", newsController.list);
router.get("/:slug", newsController.detail);

module.exports = router;

