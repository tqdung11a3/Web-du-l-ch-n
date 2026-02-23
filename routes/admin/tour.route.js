const router = require("express").Router();
const tourController = require("../../controllers/admin/tour.controller");
const tourValidate = require("../../validates/admin/tour.validate");
const multer = require("multer");
const cloudinaryHelper = require("../../helpers/cloudinary.helper");
const upload = multer({ storage: cloudinaryHelper.storage });
const auth = require("../../middlewares/admin/auth.middleware");

router.get("/", auth.verifyToken, tourController.list);
router.get("/list", auth.verifyToken, tourController.list);

router.get("/create", auth.verifyToken, tourController.create);

router.post(
  "/create",
  auth.verifyToken,
  upload.fields([
    { name: "avatar", maxCount: 1 },
    { name: "images", maxCount: 10 },
  ]),
  tourValidate.createPost,
  tourController.createPost
);

router.get("/discounts", auth.verifyToken, tourController.listDiscounts);

router.patch("/discount/:id", auth.verifyToken, tourController.updateDiscount);
router.patch(
  "/discount/:id/cancel",
  auth.verifyToken,
  tourController.cancelDiscount
);

router.get("/trash", auth.verifyToken, tourController.trash);

router.get("/edit/:id", auth.verifyToken, tourController.edit);

router.patch(
  "/edit/:id",
  auth.verifyToken,
  upload.fields([
    { name: "avatar", maxCount: 1 },
    { name: "images", maxCount: 10 },
  ]),
  tourValidate.createPost, // xem mục 2
  tourController.editPatch
);

// Cấu hình mức tuổi hành khách (áp dụng toàn bộ tour công ty)
router.patch("/age-bands", auth.verifyToken, tourController.saveAgeBands);

router.patch("/delete/:id", auth.verifyToken, tourController.deletePatch);

router.patch("/undo/:id", auth.verifyToken, tourController.undoPatch);

router.delete("/destroy/:id", auth.verifyToken, tourController.destroyDelete);

router.patch(
  "/change-multi",
  auth.verifyToken,
  tourController.changeMultiPatch
);

router.post(
  "/bulk-discount",
  auth.verifyToken,
  tourController.applyCompanyDiscount
);

module.exports = router;
