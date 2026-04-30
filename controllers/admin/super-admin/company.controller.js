// controllers/admin/super-admin/company.controller.js
const Company = require("../../../models/company.model");
const AccountAdmin = require("../../../models/account-admin.model");
const Tour = require("../../../models/tour.model");
const Hotel = require("../../../models/hotel.model");
const auditLogHelper = require("../../../helpers/audit-log.helper");

/**
 * Danh sách tất cả công ty
 */
module.exports.list = async (req, res) => {
  try {
    // Filter: chỉ lấy các công ty chưa bị xóa (deleted !== true)
    // Dùng $ne: true để lấy cả deleted: false, null, undefined
    const filter = {
      deleted: { $ne: true }
    };

    // Search
    if (req.query.keyword) {
      const regex = new RegExp(req.query.keyword, "i");
      filter.$or = [{ name: regex }, { email: regex }, { taxCode: regex }];
    }

    // Filter by status
    if (req.query.status) {
      filter.status = req.query.status;
    }

    const companies = await Company.find(filter)
      .sort({ createdAt: -1 })
      .lean();

    // Đếm số admin & tour/hotel của mỗi công ty
    for (const company of companies) {
      company.adminCount = await AccountAdmin.countDocuments({
        companyId: company._id,
        deleted: false,
      });
      company.tourCount = await Tour.countDocuments({
        companyId: company._id,
        deleted: false,
      });
      company.hotelCount = await Hotel.countDocuments({
        companyId: company._id,
        deleted: false,
      });
    }

    res.render("admin/pages/super-admin/company-list", {
      pageTitle: "Quản lý công ty",
      companies,
      keyword: req.query.keyword || "",
      statusFilter: req.query.status || "",
    });
  } catch (error) {
    console.error("Super Admin Company List Error:", error);
    res.status(500).send("Có lỗi xảy ra!");
  }
};

/**
 * Chi tiết công ty
 */
module.exports.detail = async (req, res) => {
  try {
    const companyId = req.params.id;

    const company = await Company.findOne({
      _id: companyId,
      deleted: false,
    }).lean();

    if (!company) {
      return res.redirect("/admin/super-admin/company");
    }

    // Lấy danh sách admin của công ty
    const admins = await AccountAdmin.find({
      companyId: company._id,
      deleted: false,
    })
      .select("fullName email phone status positionCompany createdAt")
      .sort({ createdAt: -1 })
      .lean();

    // Thống kê
    const stats = {
      totalTours: await Tour.countDocuments({
        companyId: company._id,
        deleted: false,
      }),
      activeTours: await Tour.countDocuments({
        companyId: company._id,
        deleted: false,
        status: "active",
      }),
      totalHotels: await Hotel.countDocuments({
        companyId: company._id,
        deleted: false,
      }),
      activeHotels: await Hotel.countDocuments({
        companyId: company._id,
        deleted: false,
        status: "active",
      }),
    };

    res.render("admin/pages/super-admin/company-detail", {
      pageTitle: `Công ty: ${company.name}`,
      company,
      admins,
      stats,
    });
  } catch (error) {
    console.error("Super Admin Company Detail Error:", error);
    res.status(500).send("Có lỗi xảy ra!");
  }
};

/**
 * Cập nhật trạng thái công ty
 */
module.exports.changeStatus = async (req, res) => {
  try {
    const { id, status } = req.body;

    await Company.updateOne(
      { _id: id },
      {
        status: status,
        updatedBy: req.account.id,
      }
    );

    await auditLogHelper.log(req, {
      action: "company.change-status",
      resourceType: "Company",
      resourceId: id,
      metadata: { status },
    });

    res.json({
      code: "success",
      message: "Cập nhật trạng thái thành công!",
    });
  } catch (error) {
    console.error("Change Company Status Error:", error);
    res.json({
      code: "error",
      message: "Có lỗi xảy ra!",
    });
  }
};

/**
 * Xóa công ty (soft delete)
 */
module.exports.deleteCompany = async (req, res) => {
  try {
    const id = req.params.id;

    await Company.updateOne(
      { _id: id },
      {
        deleted: true,
        deletedAt: new Date(),
        deletedBy: req.account.id,
      }
    );

    await auditLogHelper.log(req, {
      action: "company.delete",
      resourceType: "Company",
      resourceId: id,
    });

    res.json({
      code: "success",
      message: "Xóa công ty thành công!",
    });
  } catch (error) {
    console.error("Delete Company Error:", error);
    res.json({
      code: "error",
      message: "Có lỗi xảy ra!",
    });
  }
};

