// middlewares/admin/notification.middleware.js
const Notification = require("../../models/notification.model");

module.exports.getUnreadCount = async (req, res, next) => {
  try {
    const account = req.account;
    
    if (!account || !account.companyId) {
      res.locals.unreadNotificationCount = 0;
      return next();
    }
    
    // Đếm số thông báo chưa đọc của company
    const unreadCount = await Notification.countDocuments({
      companyId: account.companyId,
      isRead: false,
      deleted: false,
    });
    
    res.locals.unreadNotificationCount = unreadCount;
    next();
  } catch (error) {
    console.error("notification.middleware error:", error);
    res.locals.unreadNotificationCount = 0;
    next();
  }
};

