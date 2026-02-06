// controllers/admin/company.controller.js
const mongoose = require("mongoose");
const Company = require("../../models/company.model");
const Tour = require("../../models/tour.model");

/**
 * GET /admin/company/info
 * Hiển thị trang thông tin công ty của admin đang đăng nhập
 */
module.exports.getInfo = async (req, res) => {
  try {
    const rawCid = req.account?.companyId;
    const companyId = mongoose.Types.ObjectId.isValid(String(rawCid))
      ? new mongoose.Types.ObjectId(String(rawCid))
      : rawCid;

    const company = await Company.findById(companyId).lean();

    if (!company) {
      return res.render("admin/pages/company-info", {
        pageTitle: "Thông tin công ty",
        company: null,
        stats: null,
      });
    }

    // Thống kê nhanh các tour thuộc công ty này
    const [agg] = await Tour.aggregate([
      { $match: { companyId, deleted: false } },
      {
        $group: {
          _id: "$companyId",
          totalTours: { $sum: 1 },
          activeTours: {
            $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] },
          },
          inactiveTours: {
            $sum: { $cond: [{ $eq: ["$status", "inactive"] }, 1, 0] },
          },
          seatsTotal: { $sum: { $ifNull: ["$seatsTotal", 0] } },
          seatsRemaining: { $sum: { $ifNull: ["$seatsRemaining", 0] } },
          lastUpdated: { $max: "$updatedAt" },
        },
      },
    ]);

    const stats = agg || {
      totalTours: 0,
      activeTours: 0,
      inactiveTours: 0,
      seatsTotal: 0,
      seatsRemaining: 0,
      lastUpdated: null,
    };

    // Chuẩn hoá thêm một số field phục vụ hiển thị
    if (company && company.foundedAt) {
      const d = new Date(company.foundedAt);
      company.foundedYear = d.getFullYear();
    }

    return res.render("admin/pages/company-info", {
      pageTitle: "Thông tin công ty",
      company,
      stats,
    });
  } catch (e) {
    console.error("company.getInfo error:", e);
    return res.render("admin/pages/company-info", {
      pageTitle: "Thông tin công ty",
      company: null,
      stats: null,
    });
  }
};

/**
 * POST /admin/company/info
 * Cập nhật 2 trường: logo (ảnh đại diện) & banner (ảnh breadcrumb)
 * Nhận từ multipart với upload.fields([{name:'banner'},{name:'logo'}])
 */
module.exports.updateInfo = async (req, res) => {
  try {
    const rawCid = req.account?.companyId;
    const companyId = mongoose.Types.ObjectId.isValid(String(rawCid))
      ? new mongoose.Types.ObjectId(String(rawCid))
      : rawCid;

    const company = await Company.findById(companyId).select("_id");
    if (!company) {
      return res.json({ code: "error", message: "Không tìm thấy công ty!" });
    }

    // files từ multer+cloudinary
    const files = req.files || {};
    const logoFile = Array.isArray(files.logo) && files.logo[0];
    const bannerFile = Array.isArray(files.banner) && files.banner[0];

    const $set = {};
    if (logoFile?.path || logoFile?.secure_url) {
      $set.logo = logoFile.path || logoFile.secure_url;
    }
    if (bannerFile?.path || bannerFile?.secure_url) {
      // tên trường lưu ảnh breadcrumb của công ty
      $set.banner = bannerFile.path || bannerFile.secure_url;
    }

    // Thông tin tổng quan & các trường bổ sung
    if (typeof req.body.overview === "string") {
      $set.overview = req.body.overview;
    }
    if (typeof req.body.address === "string") {
      $set.address = req.body.address;
    }
    if (typeof req.body.email === "string") {
      $set.email = req.body.email;
    }
    if (typeof req.body.hotline === "string") {
      $set.hotline = req.body.hotline;
    }
    if (typeof req.body.cancelPolicyTour === "string") {
      $set.cancelPolicyTour = req.body.cancelPolicyTour;
    }
    if (typeof req.body.cancelPolicyHotel === "string") {
      $set.cancelPolicyHotel = req.body.cancelPolicyHotel;
    }
    if (req.body.foundedYear) {
      const year = parseInt(req.body.foundedYear, 10);
      if (!Number.isNaN(year) && year > 1900 && year < 3000) {
        $set.foundedAt = new Date(year, 0, 1);
      }
    }

    if (!Object.keys($set).length) {
      return res.json({
        code: "error",
        message: "Vui lòng nhập thông tin để cập nhật!",
      });
    }

    await Company.updateOne(
      { _id: companyId },
      { $set },
      // strict:false để ghi được trường mới nếu schema của bạn chưa khai báo
      { strict: false, runValidators: false }
    );

    return res.json({
      code: "success",
      message: "Cập nhật thông tin công ty thành công!",
      data: $set,
    });
  } catch (e) {
    console.error("company.updateInfo error:", e);
    return res.json({
      code: "error",
      message: "Có lỗi khi cập nhật thông tin công ty!",
    });
  }
};
