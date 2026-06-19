const router = require("express").Router();
const controller = require("../../controllers/client/notification.controller");
const clientAuth = require("../../middlewares/client/auth.middleware");

router.get("/", clientAuth.verifyToken, controller.listPage);
router.get("/api/list", clientAuth.verifyTokenApi, controller.getList);
router.get("/api/unread-count", clientAuth.verifyTokenApi, controller.getUnreadCount);
router.post("/api/mark-read", clientAuth.verifyTokenApi, controller.markAsRead);

module.exports = router;
