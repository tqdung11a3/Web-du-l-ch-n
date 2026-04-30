const express = require("express");
const path = require("path");
require("dotenv").config();
const cookieParser = require("cookie-parser");
const databaseConfig = require("./config/database.config");
const adminRoutes = require("./routes/admin/index.route");
const clientRoutes = require("./routes/client/index.route");
const variableConfig = require("./config/variable.config");
const {
  startReminderScheduler,
  runReminderJobOnce,
} = require("./scripts/remind-upcoming-tours");
const { startExpiredOrdersCleanup } = require("./scripts/cleanup-expired-orders");
const { startExpiredHotelBookingsCleanup } = require("./scripts/cleanup-expired-hotel-bookings");

// ⬇️ import middleware client để gắn user vào res.locals
const clientAuth = require("./middlewares/client/auth.middleware");

const app = express();
const port = 5000;

databaseConfig.connect();

// Thiết lập thư mục views chứ code giao diện
app.set("views", path.join(__dirname, "views"));
// Thiết lập template engines
app.set("view engine", "pug");

// Thiết lập thư mục chứa file tĩnh
app.use(express.static(path.join(__dirname, "public")));

// Tạo biến toàn cục trong file PUG
app.locals.pathAdmin = variableConfig.pathAdmin;

// Tạo biến toàn cục trong các file backend
global.pathAdmin = variableConfig.pathAdmin;

// Cho phép gửi dữ liệu lên dạng JSON
app.use(express.json());
// Cho phép đọc body text/plain (sendBeacon từ pending page)
app.use(express.text());

// Lấy biến trong cookie
app.use(cookieParser());

app.use(`/${variableConfig.pathAdmin}`, adminRoutes);
app.use(clientAuth.attachUser); // chỉ gắn trước clientRoutes
app.use("/", clientRoutes);

// ONLY FOR DEV / TEST: chạy thử job bằng tay
app.get("/dev/test-remind", async (req, res) => {
  await runReminderJobOnce();
  res.send("Đã chạy job remind 1 lần, xem log console + hộp thư.");
});

// Global error logger để bắt mọi lỗi rơi xuống Express default handler
app.use((err, req, res, next) => {
  console.error(">>> [GLOBAL ERROR HANDLER]", req.method, req.originalUrl);
  console.error(err && err.stack ? err.stack : err);
  if (res.headersSent) return next(err);
  const wantsJSON =
    req.xhr ||
    (req.headers.accept && req.headers.accept.includes("application/json")) ||
    (req.headers["content-type"] || "").includes("multipart/form-data");
  if (wantsJSON) {
    return res
      .status(500)
      .json({ code: "error", message: err && err.message ? err.message : "Internal Server Error" });
  }
  return res.status(500).send("Internal Server Error");
});

app.listen(port, () => {
  console.log(`Website đang chạy ở cổng ${port}`);
  startReminderScheduler();
  startExpiredOrdersCleanup();        // tự động hủy đơn tour tạm hết hạn
  startExpiredHotelBookingsCleanup(); // tự động hủy đặt phòng khách sạn tạm hết hạn
});
