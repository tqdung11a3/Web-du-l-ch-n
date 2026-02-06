// scripts/remind-upcoming-tours.js
const moment = require("moment");
const Order = require("../models/order.model");
const AccountUser = require("../models/account-user.model");
const mailHelper = require("../helpers/mail.helper");

/**
 * Chạy 1 lần: quét toàn bộ orders, tìm các tour
 * có departureDate cách hôm nay đúng 7 ngày, đơn không bị hủy,
 * rồi gửi mail cho user tương ứng.
 */
async function runReminderJobOnce() {
  try {
    const now = moment().startOf("day");
    console.log("[remind-job] Start at", now.format("YYYY-MM-DD"));

    // Lấy toàn bộ đơn (hoặc bạn giới hạn theo thời gian cũng được)
    const orders = await Order.find({ deleted: false }).lean();
    console.log("[remind-job] Total orders:", orders.length);

    // Gom tour cần nhắc theo từng userId
    const userToursMap = new Map();

    for (const o of orders) {
      // Đơn bị hủy thì bỏ qua
      if (o.status === "cancel") continue;
      if (!o.userId) continue;

      for (const it of o.items || []) {
        if (!it.departureDate) continue;

        const dep = moment(it.departureDate).startOf("day");
        const diffDays = dep.diff(now, "days");

        // Chỉ quan tâm tour khởi hành sau đúng 7 ngày
        if (diffDays === 7) {
          const arr = userToursMap.get(String(o.userId)) || [];
          arr.push({
            orderCode: o.code,
            name: it.name,
            slug: it.slug,
            departureDate: dep,
            paymentStatus: o.paymentStatus,
            total: it.total || o.total || 0,
          });
          userToursMap.set(String(o.userId), arr);
        }
      }
    }

    console.log("[remind-job] Users to remind:", userToursMap.size);

    // Nếu không có tour nào thì thôi
    if (userToursMap.size === 0) return;

    // Lấy thông tin user 1 lần
    const userIds = Array.from(userToursMap.keys());
    const users = await AccountUser.find({ _id: { $in: userIds } }).lean();
    const userMap = new Map(users.map((u) => [String(u._id), u]));

    for (const [userId, tours] of userToursMap.entries()) {
      const user = userMap.get(userId);
      if (!user || !user.email) continue;

      const toursHtml = tours
        .map((t) => {
          return `<li>
            <b>${t.name || "Tour du lịch"}</b> 
            – Khởi hành: <b>${t.departureDate.format("DD/MM/YYYY")}</b> 
            – Mã đơn: <b>${t.orderCode}</b>
            – Thanh toán: <b>${
              t.paymentStatus === "paid" ? "Đã thanh toán" : "Chưa thanh toán"
            }</b>
          </li>`;
        })
        .join("");

      const title = "Nhắc bạn về chuyến đi sắp tới";
      const content = `
        <p>Chào ${user.fullName || user.email},</p>
        <p>Bạn đang có chuyến đi sẽ khởi hành sau <b>7 ngày nữa</b>:</p>
        <ul>
          ${toursHtml}
        </ul>
        <p>Bạn vui lòng kiểm tra lại thông tin đặt tour, chuẩn bị hành lý và các giấy tờ cần thiết trước chuyến đi.</p>
        <p>Cảm ơn bạn đã sử dụng dịch vụ của chúng tôi!</p>
      `;

      console.log(
        `[remind-job] Sending email to ${user.email} with ${tours.length} tour(s)`
      );
      mailHelper.sendMail(user.email, title, content);
    }
  } catch (err) {
    console.error("[remind-job] Error:", err);
  }
}

/**
 * Scheduler: chạy khi server khởi động và lặp lại mỗi 24h
 */
function startReminderScheduler() {
  runReminderJobOnce(); // chạy ngay 1 lần khi start
  const ONE_DAY = 24 * 60 * 60 * 1000;
  setInterval(runReminderJobOnce, ONE_DAY);
}

module.exports = {
  startReminderScheduler,
  runReminderJobOnce, // để tạo route test
};
