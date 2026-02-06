// routes/admin/company.route.js
const express = require("express");
const router = express.Router();

const auth = require("../../middlewares/admin/auth.middleware");
const companyController = require("../../controllers/admin/company.controller");

const multer = require("multer");
const cloudinaryHelper = require("../../helpers/cloudinary.helper");

// Multer dùng Cloudinary storage
const upload = multer({ storage: cloudinaryHelper.storage });

// GET: Trang thông tin công ty (admin đang đăng nhập)
router.get("/info", auth.verifyToken, companyController.getInfo);

// POST: Cập nhật banner & logo (multipart/form-data)
router.post(
  "/info",
  auth.verifyToken,
  upload.fields([
    { name: "banner", maxCount: 1 },
    { name: "logo", maxCount: 1 },
  ]),
  companyController.updateInfo
);

module.exports = router;
