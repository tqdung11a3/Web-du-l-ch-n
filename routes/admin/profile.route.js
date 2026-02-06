const router = require("express").Router();
const profileController = require("../../controllers/admin/profile.controller");
const multer = require("multer");
const cloudinaryHelper = require("../../helpers/cloudinary.helper");
const upload = multer({ storage: cloudinaryHelper.storage });
const auth = require("../../middlewares/admin/auth.middleware");

router.get("/edit", profileController.edit);

router.patch(
  "/edit",
  auth.verifyToken,
  upload.single("avatar"),
  profileController.editPatch
);

router.get("/change-password", profileController.changePassword);

module.exports = router;
