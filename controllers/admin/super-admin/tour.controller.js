// controllers/admin/super-admin/tour.controller.js
const Tour = require("../../../models/tour.model");
const Company = require("../../../models/company.model");

/**
 * Xem tất cả tours từ mọi công ty
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
    const totalRecord = await Tour.countDocuments(filter);
    const totalPage = Math.ceil(totalRecord / limitItems);
    const pagination = {
      currentPage: page,
      skip: skip,
      totalRecord: totalRecord,
      totalPage: totalPage,
    };

    // Lấy tất cả tours để sort theo giá
    let tours = await Tour.find(filter)
      .populate("companyId", "name logo")
      .lean();

    // Sort theo giá giảm dần (ưu tiên priceNewAdult, nếu không có thì dùng priceAdult)
    tours.sort((a, b) => {
      const priceA = a.priceNewAdult || a.priceAdult || 0;
      const priceB = b.priceNewAdult || b.priceAdult || 0;
      return priceB - priceA; // Giảm dần
    });

    // Áp dụng phân trang sau khi sort
    tours = tours.slice(skip, skip + limitItems);

    // Lấy danh sách công ty để filter
    const companies = await Company.find({ deleted: { $ne: true } })
      .select("name")
      .sort({ name: 1 })
      .lean();

    res.render("admin/pages/super-admin/tour-list", {
      pageTitle: "Tất cả Tours",
      tours,
      companies,
      pagination,
      keyword: req.query.keyword || "",
      statusFilter: req.query.status || "",
      companyFilter: req.query.companyId || "",
    });
  } catch (error) {
    console.error("Super Admin - Tour List Error:", error);
    res.status(500).send("Có lỗi xảy ra!");
  }
};

/**
 * Xem chi tiết tour
 */
module.exports.detail = async (req, res) => {
  try {
    const tour = await Tour.findOne({
      _id: req.params.id,
      deleted: { $ne: true },
    })
      .populate("companyId", "name logo hotline email")
      .populate("departureCity", "name")
      .lean();

    // Populate category nếu có
    if (tour.category) {
      const Category = require("../../../models/category.model");
      const category = await Category.findOne({
        _id: tour.category,
        deleted: { $ne: true },
      }).select("name").lean();
      if (category) {
        tour.categoryName = category.name;
      }
    }

    if (!tour) {
      return res.redirect(`/${req.app.locals.pathAdmin}/super-admin/tours`);
    }

    res.render("admin/pages/super-admin/tour-detail", {
      pageTitle: `Tour: ${tour.name}`,
      tour,
    });
  } catch (error) {
    console.error("Super Admin - Tour Detail Error:", error);
    res.status(500).send("Có lỗi xảy ra!");
  }
};

