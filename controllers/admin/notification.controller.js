// controllers/admin/notification.controller.js
const Notification = require("../../models/notification.model");
const moment = require("moment");

/**
 * GET /admin/notifications/list
 * Lấy danh sách thông báo của company
 */
module.exports.getNotifications = async (req, res) => {
  try {
    const companyId = req.account?.companyId;
    
    if (!companyId) {
      return res.json({
        code: "error",
        message: "Không tìm thấy thông tin company!",
        notifications: [],
      });
    }
    
    // Lấy 20 thông báo mới nhất
    const notifications = await Notification.find({
      companyId,
      deleted: false,
    })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();
    
    // Format data
    const formattedNotifications = notifications.map(n => {
      const timeAgo = moment(n.createdAt).fromNow();
      
      let icon = "fa-bell";
      let iconColor = "#3B82F6";
      
      if (n.type === "hotel_booking") {
        icon = "fa-hotel";
        iconColor = "#10B981";
      } else if (n.type === "order") {
        icon = "fa-shopping-cart";
        iconColor = "#F59E0B";
      } else if (n.type === "review") {
        icon = "fa-star";
        iconColor = "#EF4444";
      } else if (n.type === "tour_hotel_quota") {
        icon = n.metadata?.pressureLevel === "exhausted"
          ? "fa-circle-exclamation"
          : "fa-triangle-exclamation";
        iconColor = n.metadata?.pressureLevel === "exhausted" ? "#DC2626" : "#F59E0B";
      }
      
      return {
        _id: n._id,
        title: n.title,
        content: n.content,
        link: n.link,
        isRead: n.isRead,
        timeAgo,
        icon,
        iconColor,
        metadata: n.metadata,
        createdAt: moment(n.createdAt).format("DD/MM/YYYY HH:mm"),
      };
    });
    
    return res.json({
      code: "success",
      notifications: formattedNotifications,
    });
  } catch (error) {
    console.error("getNotifications error:", error);
    return res.json({
      code: "error",
      message: "Có lỗi xảy ra khi lấy thông báo!",
      notifications: [],
    });
  }
};

/**
 * POST /admin/notifications/mark-as-read/:id
 * Đánh dấu thông báo đã đọc
 */
module.exports.markAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.account?.companyId;
    
    if (!id || !companyId) {
      return res.json({
        code: "error",
        message: "Thiếu thông tin!",
      });
    }
    
    // Tìm và update notification
    const notification = await Notification.findOne({
      _id: id,
      companyId,
      deleted: false,
    });
    
    if (!notification) {
      return res.json({
        code: "error",
        message: "Không tìm thấy thông báo!",
      });
    }
    
    notification.isRead = true;
    await notification.save();
    
    // Đếm lại số thông báo chưa đọc
    const unreadCount = await Notification.countDocuments({
      companyId,
      isRead: false,
      deleted: false,
    });
    
    return res.json({
      code: "success",
      message: "Đã đánh dấu đã đọc!",
      unreadCount,
    });
  } catch (error) {
    console.error("markAsRead error:", error);
    return res.json({
      code: "error",
      message: "Có lỗi xảy ra!",
    });
  }
};

/**
 * POST /admin/notifications/mark-all-as-read
 * Đánh dấu tất cả thông báo đã đọc
 */
module.exports.markAllAsRead = async (req, res) => {
  try {
    const companyId = req.account?.companyId;
    
    if (!companyId) {
      return res.json({
        code: "error",
        message: "Không tìm thấy thông tin company!",
      });
    }
    
    // Update tất cả notifications
    await Notification.updateMany(
      {
        companyId,
        isRead: false,
        deleted: false,
      },
      {
        isRead: true,
      }
    );
    
    return res.json({
      code: "success",
      message: "Đã đánh dấu tất cả đã đọc!",
      unreadCount: 0,
    });
  } catch (error) {
    console.error("markAllAsRead error:", error);
    return res.json({
      code: "error",
      message: "Có lỗi xảy ra!",
    });
  }
};

