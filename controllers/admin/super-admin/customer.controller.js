// controllers/admin/super-admin/customer.controller.js
const AccountUser = require("../../../models/account-user.model");
const Order = require("../../../models/order.model");

/**
 * Danh sách tất cả khách hàng
 */
module.exports.list = async (req, res) => {
  try {
    const filter = {};

    // Search
    if (req.query.keyword) {
      const regex = new RegExp(req.query.keyword, "i");
      filter.$or = [{ fullName: regex }, { email: regex }, { phone: regex }];
    }

    // Phân trang
    const limitItems = 10;
    let page = 1;
    if (req.query.page && parseInt(req.query.page) > 0) {
      page = parseInt(req.query.page);
    }
    const skip = (page - 1) * limitItems;
    const totalRecord = await AccountUser.countDocuments(filter);
    const totalPage = Math.ceil(totalRecord / limitItems);
    const pagination = {
      currentPage: page,
      skip: skip,
      totalRecord: totalRecord,
      totalPage: totalPage,
    };

    const customers = await AccountUser.find(filter)
      .sort({ createdAt: -1 })
      .limit(limitItems)
      .skip(skip)
      .lean();

    // Đếm số đơn hàng của mỗi customer
    for (const customer of customers) {
      customer.orderCount = await Order.countDocuments({
        userId: customer._id,
        deleted: { $ne: true },
      });

      // Tính tổng chi tiêu từ các đơn hàng đã hoàn thành
      const orders = await Order.find({
        userId: customer._id,
        deleted: { $ne: true },
        paymentStatus: "paid",
        status: "done",
      })
        .select("total")
        .lean();

      customer.totalSpent = orders.reduce(
        (sum, order) => sum + (order.total || 0),
        0
      );
    }

    res.render("admin/pages/super-admin/customer-list", {
      pageTitle: "Quản lý Khách hàng",
      customers,
      pagination,
      keyword: req.query.keyword || "",
    });
  } catch (error) {
    console.error("Super Admin - Customer List Error:", error);
    res.status(500).send("Có lỗi xảy ra!");
  }
};

/**
 * Chi tiết khách hàng
 */
module.exports.detail = async (req, res) => {
  try {
    const customer = await AccountUser.findById(req.params.id).lean();

    if (!customer) {
      return res.redirect(`/${req.app.locals.pathAdmin}/super-admin/customers`);
    }

    // Lấy lịch sử đơn hàng
    const orders = await Order.find({
      userId: customer._id,
      deleted: { $ne: true },
    })
      .sort({ createdAt: -1 })
      .lean();

    res.render("admin/pages/super-admin/customer-detail", {
      pageTitle: `Khách hàng: ${customer.fullName || "N/A"}`,
      customer,
      orders,
    });
  } catch (error) {
    console.error("Super Admin - Customer Detail Error:", error);
    res.status(500).send("Có lỗi xảy ra!");
  }
};

