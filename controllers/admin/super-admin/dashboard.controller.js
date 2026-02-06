// controllers/admin/super-admin/dashboard.controller.js
const Company = require("../../../models/company.model");
const Tour = require("../../../models/tour.model");
const Hotel = require("../../../models/hotel.model");
const Order = require("../../../models/order.model");
const AccountAdmin = require("../../../models/account-admin.model");
const AccountUser = require("../../../models/account-user.model");

/**
 * Super Admin Dashboard - Tổng quan toàn hệ thống
 */
module.exports.index = async (req, res) => {
  try {
    // Thống kê tổng quan
    const stats = {
      // Sửa: dùng { $ne: true } thay vì false
      totalCompanies: await Company.countDocuments({ deleted: { $ne: true } }),
      activeCompanies: await Company.countDocuments({
        deleted: { $ne: true },
        status: "active",
      }),
      totalTours: await Tour.countDocuments({ deleted: { $ne: true } }),
      activeTours: await Tour.countDocuments({
        deleted: { $ne: true },
        status: "active",
      }),
      totalHotels: await Hotel.countDocuments({ deleted: { $ne: true } }),
      activeHotels: await Hotel.countDocuments({
        deleted: { $ne: true },
        status: "active",
      }),
      totalOrders: await Order.countDocuments({ deleted: { $ne: true } }),
      // Sửa: đơn hàng hoàn thành = paymentStatus: "paid" VÀ status: "finish"
      completedOrders: await Order.countDocuments({
        deleted: { $ne: true },
        paymentStatus: "paid",
        status: "done",
      }),
      totalRevenue: 0, // Sẽ tính bên dưới
      // Sửa: dùng { $ne: true } cho deleted và isSuperAdmin
      totalCompanyAdmins: await AccountAdmin.countDocuments({
        deleted: { $ne: true },
        isSuperAdmin: { $ne: true },
      }),
      activeCompanyAdmins: await AccountAdmin.countDocuments({
        deleted: { $ne: true },
        isSuperAdmin: { $ne: true },
        status: "active",
      }),
      pendingCompanyAdmins: await AccountAdmin.countDocuments({
        deleted: { $ne: true },
        isSuperAdmin: { $ne: true },
        status: "initial",
      }),
      totalCustomers: await AccountUser.countDocuments({}),
    };

    // Tính tổng doanh thu từ các đơn hàng đã hoàn thành
    const revenueResult = await Order.aggregate([
      {
        $match: {
          deleted: { $ne: true },
          paymentStatus: "paid",
          status: "done"
        }
      },
      { $group: { _id: null, total: { $sum: "$total" } } },
    ]);
    stats.totalRevenue = revenueResult[0]?.total || 0;

    // Doanh thu theo từng công ty (không gộp chung)
    // Mỗi order chỉ có items từ một công ty duy nhất, lấy companyId từ item đầu tiên
    const revenueByCompany = await Order.aggregate([
      { 
        $match: { 
          deleted: { $ne: true }, 
          paymentStatus: "paid",
          status: "done"
        } 
      },
      // Lấy companyId từ item đầu tiên (vì mỗi order chỉ có items từ một công ty)
      {
        $addFields: {
          companyId: { $arrayElemAt: ["$items.companyId", 0] }
        }
      },
      // Lọc bỏ các order không có companyId
      { $match: { companyId: { $exists: true, $ne: null } } },
      // Convert companyId sang ObjectId nếu là string (an toàn với onError)
      {
        $addFields: {
          companyId: {
            $convert: {
              input: "$companyId",
              to: "objectId",
              onError: null,
              onNull: null
            }
          }
        }
      },
      // Lọc lại để bỏ các companyId không hợp lệ sau khi convert
      { $match: { companyId: { $ne: null } } },
      // Group theo companyId để tổng hợp doanh thu
      {
        $group: {
          _id: "$companyId",
          revenue: { $sum: "$total" },
          orderCount: { $sum: 1 },
        },
      },
      {
        $lookup: {
          from: "companies",
          localField: "_id",
          foreignField: "_id",
          as: "company",
        },
      },
      { $unwind: { path: "$company", preserveNullAndEmptyArrays: true } },
      { $sort: { revenue: -1 } },
      {
        $project: {
          companyName: "$company.name",
          companyLogo: "$company.logo",
          revenue: 1,
          orderCount: 1,
        },
      },
    ]);

    // Pending company admins (cần approve)
    const pendingAdmins = await AccountAdmin.find({
      deleted: { $ne: true },
      isSuperAdmin: { $ne: true },
      status: "initial",
    })
      .populate("companyId", "name logo")
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    res.render("admin/pages/super-admin/dashboard", {
      pageTitle: "Super Admin Dashboard",
      stats,
      revenueByCompany,
      pendingAdmins,
    });
    
    // Gắn số admin pending vào locals để hiển thị badge trên sidebar
    res.locals.pendingAdminCount = stats.pendingCompanyAdmins;
  } catch (error) {
    console.error("Super Admin Dashboard Error:", error);
    res.status(500).send("Có lỗi xảy ra!");
  }
};

