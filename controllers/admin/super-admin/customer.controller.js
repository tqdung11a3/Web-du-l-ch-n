// controllers/admin/super-admin/customer.controller.js
const mongoose = require("mongoose");
const AccountUser = require("../../../models/account-user.model");
const Order = require("../../../models/order.model");
const { pathAdmin } = require("../../../config/variable.config");

/**
 * Đường dẫn xem chi tiết đơn tour (Super Admin): /orders/company/:companyId/tour/:orderId
 * Lấy companyId từ item đầu tiên có `items.companyId` (đúng với buildOrderEditLocals).
 */
function superAdminTourOrderDetailPath(order) {
  if (!order || !order._id) return null;
  const items = order.items || [];
  const row = items.find(
    (it) => it && it.companyId != null && String(it.companyId).trim() !== ""
  );
  if (!row) return null;
  const cid = String(row.companyId);
  const oid = String(order._id);
  if (
    !mongoose.Types.ObjectId.isValid(cid) ||
    !mongoose.Types.ObjectId.isValid(oid)
  ) {
    return null;
  }
  return `/${pathAdmin}/super-admin/orders/company/${cid}/tour/${oid}`;
}

/**
 * Ngày đăng ký thực tế: `createdAt` (Mongoose timestamps) hoặc thời điểm tạo ObjectId
 * (tài khoản cũ trước khi bật timestamps).
 */
function getAccountUserRegistrationDate(doc) {
  if (!doc) return null;
  if (doc.createdAt) {
    const d = new Date(doc.createdAt);
    if (!isNaN(d.getTime())) return d;
  }
  const id = doc._id;
  if (!id) return null;
  try {
    const oid =
      id instanceof mongoose.Types.ObjectId
        ? id
        : new mongoose.Types.ObjectId(String(id));
    return oid.getTimestamp();
  } catch {
    return null;
  }
}

function attachRegistrationDisplay(customer) {
  const d = getAccountUserRegistrationDate(customer);
  customer.registrationDateDisplay =
    d && !isNaN(d.getTime()) ? d.toLocaleDateString("vi-VN") : "—";
  customer.registrationDateTimeDisplay =
    d && !isNaN(d.getTime())
      ? `${d.toLocaleDateString("vi-VN")} ${d.toLocaleTimeString("vi-VN")}`
      : "N/A";
  return customer;
}

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

    customers.forEach(attachRegistrationDisplay);

    // Đếm số đơn hàng của mỗi customer
    for (const customer of customers) {
      customer.orderCount = await Order.countDocuments({
        userId: customer._id,
        deleted: { $ne: true },
      });

      // Tổng chi tiêu: đơn đã thanh toán, chưa hủy (không bắt buộc status "done" —
      // đơn có thể vẫn "initial"/đang xử lý nhưng khách đã trả tiền, trùng với cách hiển thị chi tiết)
      const spendAgg = await Order.aggregate([
        {
          $match: {
            userId: customer._id,
            deleted: { $ne: true },
            paymentStatus: "paid",
            status: { $ne: "cancel" },
          },
        },
        { $group: { _id: null, total: { $sum: { $ifNull: ["$total", 0] } } } },
      ]);
      customer.totalSpent =
        spendAgg.length && spendAgg[0].total != null ? spendAgg[0].total : 0;
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

    attachRegistrationDisplay(customer);

    // Lấy lịch sử đơn hàng
    const orders = await Order.find({
      userId: customer._id,
      deleted: { $ne: true },
    })
      .sort({ createdAt: -1 })
      .lean();

    for (const order of orders) {
      order.superAdminTourDetailUrl =
        superAdminTourOrderDetailPath(order) ||
        `/${pathAdmin}/super-admin/orders`;
    }

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

