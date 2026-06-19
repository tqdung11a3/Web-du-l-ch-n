const UserNotification = require("../../models/user-notification.model");

/**
 * Gắn số thông báo chưa đọc vào res.locals (chỉ khi khách đã đăng nhập).
 */
module.exports.attachUnreadCount = async (req, res, next) => {
  res.locals.unreadNotificationCount = 0;
  try {
    const user = req.account;
    if (!user || !user._id) return next();

    const count = await UserNotification.countDocuments({
      userId: user._id,
      isRead: false,
      deleted: false,
    });
    res.locals.unreadNotificationCount = count;
  } catch (err) {
    console.error("[attachUnreadCount]", err);
  }
  return next();
};
