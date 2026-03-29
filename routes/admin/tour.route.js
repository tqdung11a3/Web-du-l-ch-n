const router = require("express").Router();
const tourController = require("../../controllers/admin/tour.controller");
const tourValidate = require("../../validates/admin/tour.validate");
const multer = require("multer");
const cloudinaryHelper = require("../../helpers/cloudinary.helper");
const upload = multer({ storage: cloudinaryHelper.storage });

router.get("/", tourController.list);
router.get("/list", tourController.list);

router.get("/create", tourController.create);

router.post(
  "/create",
  upload.fields([
    { name: "avatar", maxCount: 1 },
    { name: "images", maxCount: 10 },
  ]),
  tourValidate.createPost,
  tourController.createPost
);

router.get("/discounts", tourController.listDiscounts);

router.patch("/discount/:id", tourController.updateDiscount);
router.patch(
  "/discount/:id/cancel",
  tourController.cancelDiscount
);

router.get("/trash", tourController.trash);

router.get("/edit/:id", tourController.edit);

router.patch(
  "/edit/:id",
  upload.fields([
    { name: "avatar", maxCount: 1 },
    { name: "images", maxCount: 10 },
  ]),
  tourValidate.createPost, // xem mục 2
  tourController.editPatch
);

// Cấu hình mức tuổi hành khách (áp dụng toàn bộ tour công ty)
router.patch("/age-bands", tourController.saveAgeBands);

router.patch("/delete/:id", tourController.deletePatch);

router.patch("/undo/:id", tourController.undoPatch);

router.delete("/destroy/:id", tourController.destroyDelete);

router.patch(
  "/change-multi",
  tourController.changeMultiPatch
);

router.post(
  "/bulk-discount",
  tourController.applyCompanyDiscount
);

module.exports = router;
