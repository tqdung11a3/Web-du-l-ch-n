const router = require("express").Router();
const tourController = require("../../controllers/client/tour.controller");


router.post("/check-shared-feasibility", tourController.checkSharedFeasibility);
router.get("/detail/:slug", tourController.detail);

router.get("/discount", tourController.listDiscount);

router.get("/compare", tourController.compare);

module.exports = router;
