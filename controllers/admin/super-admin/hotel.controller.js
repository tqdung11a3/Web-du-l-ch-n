// controllers/admin/super-admin/hotel.controller.js
const Hotel = require("../../../models/hotel.model");
const Company = require("../../../models/company.model");
const City = require("../../../models/city.model");
const SettingWebsiteInfo = require("../../../models/setting-website-info.model");
const moment = require("moment");

/**
 * GET: Xem tất cả hotels từ mọi công ty
 */
module.exports.list = async (req, res) => {
  try {
    const filter = { deleted: { $ne: true } };

    // Search
    if (req.query.keyword) {
      const regex = new RegExp(req.query.keyword, "i");
      filter.name = regex;
    }

    // Filter by status
    if (req.query.status) {
      filter.status = req.query.status;
    }

    // Filter by company
    if (req.query.companyId) {
      filter.companyId = req.query.companyId;
    }

    // Phân trang
    const limitItems = 10;
    let page = 1;
    if (req.query.page && parseInt(req.query.page) > 0) {
      page = parseInt(req.query.page);
    }
    const skip = (page - 1) * limitItems;

    const totalRecord = await Hotel.countDocuments(filter);
    const totalPage = Math.ceil(totalRecord / limitItems);
    const pagination = {
      currentPage: page,
      skip: skip,
      totalRecord: totalRecord,
      totalPage: totalPage,
    };

    const hotels = await Hotel.find(filter)
      .populate("companyId", "name logo")
      .sort({ createdAt: -1 })
      .limit(limitItems)
      .skip(skip)
      .lean();

    // Lấy danh sách công ty để filter
    const companies = await Company.find({ deleted: { $ne: true } })
      .select("name")
      .sort({ name: 1 })
      .lean();

    // Lấy ảnh breadcrumb hiện tại từ setting
    const setting = await SettingWebsiteInfo.findOne({}).lean();
    const hotelSearchBreadcrumbImage = setting?.hotelSearchBreadcrumbImage || "";

    res.render("admin/pages/super-admin/hotel-list", {
      pageTitle: "Tất cả Hotels",
      hotels,
      companies,
      pagination,
      keyword: req.query.keyword || "",
      statusFilter: req.query.status || "",
      companyFilter: req.query.companyId || "",
      hotelSearchBreadcrumbImage,
    });
  } catch (error) {
    console.error("Super Admin - Hotel List Error:", error);
    res.status(500).send("Có lỗi xảy ra!");
  }
};

/**
 * GET: Xem chi tiết hotel
 */
module.exports.detail = async (req, res) => {
  try {
    const hotel = await Hotel.findOne({
      _id: req.params.id,
      deleted: { $ne: true },
    })
      .populate("companyId", "name logo hotline email")
      .lean();

    if (!hotel) {
      return res.redirect(`/${req.app.locals.pathAdmin}/super-admin/hotels`);
    }

    // Format dates
    hotel.createdAtFormat = moment(hotel.createdAt).format("HH:mm - DD/MM/YYYY");
    hotel.updatedAtFormat = moment(hotel.updatedAt).format("HH:mm - DD/MM/YYYY");

    res.render("admin/pages/super-admin/hotel-detail", {
      pageTitle: `Hotel: ${hotel.name}`,
      hotel,
    });
  } catch (error) {
    console.error("Super Admin - Hotel Detail Error:", error);
    res.status(500).send("Có lỗi xảy ra!");
  }
};

/**
 * PATCH: Cập nhật ảnh breadcrumb cho trang /hotel/search
 */
module.exports.updateHotelSearchBreadcrumb = async (req, res) => {
  try {
    // Kiểm tra quyền super admin (middleware đã kiểm tra, nhưng giữ lại để an toàn)
    if (!req.account || !req.account.isSuperAdmin) {
      return res.json({
        code: "error",
        message: "Không có quyền thực hiện thao tác này!",
      });
    }

    // Xử lý upload ảnh (multer với upload.single() sẽ đưa file vào req.file)
    if (!req.file) {
      return res.json({
        code: "error",
        message: "Vui lòng chọn ảnh để upload!",
      });
    }

    const imagePath = req.file.path || req.file.secure_url;

    if (!imagePath) {
      return res.json({
        code: "error",
        message: "Không thể lấy đường dẫn ảnh sau khi upload!",
      });
    }

    // Cập nhật hoặc tạo mới setting
    const countRecord = await SettingWebsiteInfo.countDocuments({});
    if (countRecord > 0) {
      await SettingWebsiteInfo.updateOne({}, { hotelSearchBreadcrumbImage: imagePath });
    } else {
      const newRecord = new SettingWebsiteInfo({ hotelSearchBreadcrumbImage: imagePath });
      await newRecord.save();
    }

    return res.json({
      code: "success",
      message: "Cập nhật ảnh breadcrumb thành công!",
      imagePath,
    });
  } catch (error) {
    console.error("Update Hotel Search Breadcrumb Error:", error);
    return res.json({
      code: "error",
      message: "Có lỗi xảy ra khi cập nhật ảnh breadcrumb!",
    });
  }
};

