// middlewares/admin/role.middleware.js
const { pathAdmin } = require("../../config/variable.config");

/**
 * Middleware: Chỉ cho phép Super Admin truy cập
 */
module.exports.requireSuperAdmin = (req, res, next) => {
  const account = req.account;

  if (!account || !account.isSuperAdmin) {
    const wantsJSON =
      req.xhr ||
      (req.headers.accept && req.headers.accept.includes("application/json"));

    if (wantsJSON) {
      return res.status(403).json({
        code: "error",
        message: "Bạn không có quyền truy cập chức năng này!",
      });
    }

    return res.render("admin/pages/error-403", {
      pageTitle: "403 Forbidden",
      message: "Chỉ Super Admin mới có quyền truy cập!",
    });
  }

  next();
};

/**
 * Middleware: Chỉ cho phép Company Admin (không phải Super Admin)
 */
module.exports.requireCompanyAdmin = (req, res, next) => {
  const account = req.account;

  if (!account || account.isSuperAdmin) {
    const wantsJSON =
      req.xhr ||
      (req.headers.accept && req.headers.accept.includes("application/json"));

    if (wantsJSON) {
      return res.status(403).json({
        code: "error",
        message: "Chức năng này dành cho Company Admin!",
      });
    }

    return res.render("admin/pages/error-403", {
      pageTitle: "403 Forbidden",
      message: "Chức năng này dành cho Company Admin!",
    });
  }

  if (!account.companyId) {
    return res.status(403).json({
      code: "error",
      message: "Tài khoản chưa được gán công ty!",
    });
  }

  next();
};

/**
 * Middleware: Cho phép cả Super Admin và Company Admin
 * Nhưng gắn thêm flag để controller xử lý logic
 */
module.exports.allowBoth = (req, res, next) => {
  const account = req.account;

  if (!account) {
    return res.status(401).json({
      code: "error",
      message: "Unauthorized",
    });
  }

  // Gắn flag để controller biết
  req.isSuperAdmin = Boolean(account.isSuperAdmin);
  req.userCompanyId = account.companyId || null;

  next();
};

