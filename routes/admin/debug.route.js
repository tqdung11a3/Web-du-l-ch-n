// routes/admin/debug.route.js (TEMPORARY - for debugging)
const router = require("express").Router();
const AccountAdmin = require("../../models/account-admin.model");
const authMiddleware = require("../../middlewares/admin/auth.middleware");

// Route debug - kiểm tra account hiện tại (CÓ AUTH)
router.get("/check-account", authMiddleware.verifyToken, async (req, res) => {
  try {
    const token = req.cookies?.token;
    
    if (!token) {
      return res.json({
        message: "Không có token trong cookie",
        hasCookie: false,
      });
    }

    const jwt = require("jsonwebtoken");
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (e) {
      return res.json({
        message: "Token không hợp lệ",
        error: e.message,
      });
    }

    const account = await AccountAdmin.findOne({ _id: decoded.id })
      .select("fullName email isSuperAdmin status companyId")
      .lean();

    res.json({
      message: "Thông tin account",
      decoded: decoded,
      account: account,
      reqAccount: req.account ? {
        id: req.account.id,
        email: req.account.email,
        isSuperAdmin: req.account.isSuperAdmin,
      } : "No req.account",
    });
  } catch (error) {
    res.json({
      message: "Lỗi",
      error: error.message,
    });
  }
});

// Route logout force - xóa cookie và redirect
router.get("/force-logout", (req, res) => {
  res.clearCookie("token", { path: "/" });
  res.send(`
    <html>
      <body>
        <h2>✅ Đã xóa cookie!</h2>
        <p>Vui lòng đăng nhập lại:</p>
        <a href="/${global.pathAdmin}/account/login">Đăng nhập</a>
        <script>
          setTimeout(() => {
            window.location.href = "/${global.pathAdmin}/account/login";
          }, 2000);
        </script>
      </body>
    </html>
  `);
});

module.exports = router;

