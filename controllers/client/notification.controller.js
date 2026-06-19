const moment = require("moment");
const UserNotification = require("../../models/user-notification.model");

function iconForType(type) {
  if (type === "hotel_booking") {
    return { icon: "fa-hotel", iconColor: "#10B981" };
  }
  if (type === "tour_assignment") {
    return { icon: "fa-bed", iconColor: "#6366F1" };
  }
  return { icon: "fa-suitcase-rolling", iconColor: "#F59E0B" };
}

function formatNotification(n) {
  const { icon, iconColor } = iconForType(n.type);
  return {
    _id: n._id,
    title: n.title,
    content: n.content,
    link: n.link,
    type: n.type,
    isRead: n.isRead,
    timeAgo: moment(n.createdAt).fromNow(),
    createdAt: moment(n.createdAt).format("DD/MM/YYYY HH:mm"),
    icon,
    iconColor,
    metadata: n.metadata || {},
  };
}

module.exports.listPage = async (req, res) => {
  try {
    return res.render("client/pages/notifications", {
      pageTitle: "Thông báo của bạn",
    });
  } catch (err) {
    console.error("[notification.listPage]", err);
    return res.redirect("/account/profile");
  }
};

module.exports.getList = async (req, res) => {
  try {
    const userId = req.account?._id;
    if (!userId) {
      return res.status(401).json({
        code: "error",
        message: "Vui lòng đăng nhập!",
        notifications: [],
      });
    }

    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    const notifications = await UserNotification.find({
      userId,
      deleted: false,
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return res.json({
      code: "success",
      notifications: notifications.map(formatNotification),
    });
  } catch (err) {
    console.error("[notification.getList]", err);
    return res.json({
      code: "error",
      message: "Có lỗi xảy ra!",
      notifications: [],
    });
  }
};

module.exports.getUnreadCount = async (req, res) => {
  try {
    const userId = req.account?._id;
    if (!userId) {
      return res.json({ code: "success", count: 0 });
    }
    const count = await UserNotification.countDocuments({
      userId,
      isRead: false,
      deleted: false,
    });
    return res.json({ code: "success", count });
  } catch (err) {
    console.error("[notification.getUnreadCount]", err);
    return res.json({ code: "error", count: 0 });
  }
};

module.exports.markAsRead = async (req, res) => {
  try {
    const userId = req.account?._id;
    if (!userId) {
      return res.status(401).json({ code: "error", message: "Vui lòng đăng nhập!" });
    }

    const { id, all } = req.body || {};

    if (all) {
      await UserNotification.updateMany(
        { userId, deleted: false, isRead: false },
        { $set: { isRead: true } }
      );
      return res.json({ code: "success", message: "Đã đánh dấu tất cả đã đọc!" });
    }

    if (!id) {
      return res.json({ code: "error", message: "Thiếu id thông báo!" });
    }

    await UserNotification.updateOne(
      { _id: id, userId, deleted: false },
      { $set: { isRead: true } }
    );

    return res.json({ code: "success", message: "Đã đánh dấu đã đọc!" });
  } catch (err) {
    console.error("[notification.markAsRead]", err);
    return res.json({ code: "error", message: "Có lỗi xảy ra!" });
  }
};
