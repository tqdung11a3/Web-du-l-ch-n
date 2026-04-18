// controllers/admin/super-admin/hotel.controller.js
const mongoose = require("mongoose");
const Hotel = require("../../../models/hotel.model");
const Company = require("../../../models/company.model");
const City = require("../../../models/city.model");
const SettingWebsiteInfo = require("../../../models/setting-website-info.model");
const { pathAdmin } = require("../../../config/variable.config");

/**
 * Bước 1: Danh sách công ty (vào từ /super-admin/hotels)
 */
module.exports.companyList = async (req, res) => {
  try {
    const find = { deleted: { $ne: true } };
    if (req.query.keyword) {
      find.name = new RegExp(req.query.keyword.trim(), "i");
    }
    if (req.query.status) {
      find.status = req.query.status;
    }

    const companies = await Company.find(find)
      .select("name logo status email hotline")
      .sort({ name: 1 })
      .lean();

    const hotelCounts = await Hotel.aggregate([
      { $match: { deleted: { $ne: true } } },
      { $group: { _id: "$companyId", count: { $sum: 1 } } },
    ]);
    const countMap = new Map(
      hotelCounts.map((x) => [String(x._id), x.count])
    );

    companies.forEach((c) => {
      c.hotelCount = countMap.get(String(c._id)) || 0;
    });

    const setting = await SettingWebsiteInfo.findOne({}).lean();
    const hotelSearchBreadcrumbImage =
      setting?.hotelSearchBreadcrumbImage || "";

    res.render("admin/pages/super-admin/hotel-companies", {
      pageTitle: "Khách sạn theo công ty",
      companies,
      keyword: req.query.keyword || "",
      statusFilter: req.query.status || "",
      hotelSearchBreadcrumbImage,
    });
  } catch (error) {
    console.error("Super Admin - Hotel Company List Error:", error);
    res.status(500).send("Có lỗi xảy ra!");
  }
};

/**
 * Bước 2: Danh sách khách sạn theo công ty
 */
module.exports.listByCompany = async (req, res) => {
  try {
    const companyId = req.params.companyId;
    if (!mongoose.Types.ObjectId.isValid(String(companyId))) {
      return res.redirect(`/${pathAdmin}/super-admin/hotels`);
    }

    const company = await Company.findOne({
      _id: companyId,
      deleted: { $ne: true },
    })
      .select("name logo status")
      .lean();

    if (!company) {
      return res.redirect(`/${pathAdmin}/super-admin/hotels`);
    }

    const filter = {
      deleted: { $ne: true },
      companyId: new mongoose.Types.ObjectId(String(companyId)),
    };

    if (req.query.keyword) {
      filter.name = new RegExp(req.query.keyword.trim(), "i");
    }
    if (req.query.status) {
      filter.status = req.query.status;
    }

    const limitItems = 10;
    let page = 1;
    if (req.query.page && parseInt(req.query.page, 10) > 0) {
      page = parseInt(req.query.page, 10);
    }
    const skip = (page - 1) * limitItems;

    const totalRecord = await Hotel.countDocuments(filter);
    const totalPage = Math.ceil(totalRecord / limitItems) || 1;
    const pagination = {
      currentPage: page,
      skip,
      totalRecord,
      totalPage,
    };

    const hotels = await Hotel.find(filter)
      .populate("companyId", "name logo")
      .sort({ createdAt: -1 })
      .limit(limitItems)
      .skip(skip)
      .lean();

    res.render("admin/pages/super-admin/hotel-list", {
      pageTitle: `Khách sạn — ${company.name}`,
      hotels,
      companyContext: company,
      pagination,
      keyword: req.query.keyword || "",
      statusFilter: req.query.status || "",
    });
  } catch (error) {
    console.error("Super Admin - Hotel List By Company Error:", error);
    res.status(500).send("Có lỗi xảy ra!");
  }
};

/**
 * Bước 3: Chi tiết khách sạn — cùng view /admin/hotel/edit (read-only)
 */
module.exports.detail = async (req, res) => {
  try {
    const id = req.params.id;
    const hotelDetail = await Hotel.findOne({
      _id: id,
      deleted: false,
    }).populate("province", "name");

    if (!hotelDetail) {
      return res.redirect(`/${pathAdmin}/super-admin/hotels`);
    }

    const cityList = await City.find({
      $or: [
        { countryId: null },
        { countryName: { $exists: false } },
        { countryName: "" },
      ],
      deleted: { $ne: true },
    })
      .sort({ name: 1 })
      .lean();

    const plain = hotelDetail.toObject();
    plain.id = hotelDetail._id.toString();

    const rawCid = plain.companyId;
    const cid = rawCid
      ? String(rawCid._id != null ? rawCid._id : rawCid)
      : null;
    const hotelsListBackUrl = cid
      ? `/${pathAdmin}/super-admin/hotels/company/${cid}`
      : `/${pathAdmin}/super-admin/hotels`;

    return res.render("admin/pages/hotel-edit", {
      pageTitle: "Chi tiết khách sạn",
      hotelDetail: plain,
      cityList,
      readOnly: true,
      hotelsListBackUrl,
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
    if (!req.account || !req.account.isSuperAdmin) {
      return res.json({
        code: "error",
        message: "Không có quyền thực hiện thao tác này!",
      });
    }

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

    const countRecord = await SettingWebsiteInfo.countDocuments({});
    if (countRecord > 0) {
      await SettingWebsiteInfo.updateOne(
        {},
        { hotelSearchBreadcrumbImage: imagePath }
      );
    } else {
      const newRecord = new SettingWebsiteInfo({
        hotelSearchBreadcrumbImage: imagePath,
      });
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
