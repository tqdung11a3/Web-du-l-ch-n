// controllers/admin/user.controller.js
const mongoose = require("mongoose");
const AccountUser = require("../../models/account-user.model");
const Order = require("../../models/order.model");

module.exports.list = async (req, res) => {
  try {
    const account = req.account || {};
    const companyId = account.companyId || null;

    let users = [];

    if (companyId) {
      // Đảm bảo companyId ở dạng ObjectId
      const cId = mongoose.Types.ObjectId.isValid(String(companyId))
        ? new mongoose.Types.ObjectId(String(companyId))
        : companyId;

      // Lấy danh sách userId đã có đơn thuộc công ty này
      const agg = await Order.aggregate([
        {
          $match: {
            deleted: false,
            userId: { $ne: null },
            "items.companyId": cId,
          },
        },
        {
          $group: {
            _id: "$userId",
            totalOrders: { $sum: 1 },
            totalSpent: { $sum: "$total" },
            lastOrderAt: { $max: "$createdAt" },
          },
        },
      ]);

      const userIds = agg.map((item) => item._id);
      const statsMap = {};
      agg.forEach((item) => {
        statsMap[String(item._id)] = {
          totalOrders: item.totalOrders || 0,
          totalSpent: item.totalSpent || 0,
          lastOrderAt: item.lastOrderAt || null,
        };
      });

      if (userIds.length) {
        const rawUsers = await AccountUser.find({
          _id: { $in: userIds },
        })
          .sort({ createdAt: -1 })
          .lean();

        users = rawUsers.map((u) => ({
          ...u,
          stats: statsMap[String(u._id)] || {},
        }));
      }
    } else {
      // Trường hợp admin không gắn companyId (super admin) => xem toàn bộ
      users = await AccountUser.find({}).sort({ createdAt: -1 }).lean();
    }

    res.render("admin/pages/user-list", {
      pageTitle: "Quản lý người dùng",
      users,
    });
  } catch (error) {
    console.error("admin/user.controller.list error:", error);
    res.render("admin/pages/user-list", {
      pageTitle: "Quản lý người dùng",
      users: [],
      error: "Không tải được danh sách người dùng!",
    });
  }
};
