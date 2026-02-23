const router = require("express").Router();
const multer = require("multer");
const cloudinaryHelper = require("../../helpers/cloudinary.helper");
const uploadController = require("../../controllers/client/upload.controller");

const upload = multer({ storage: cloudinaryHelper.storage });

router.post("/images", upload.array("files", 10), uploadController.imagesPost);

module.exports = router;
