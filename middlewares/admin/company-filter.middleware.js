// middlewares/admin/company-filter.middleware.js
/**
 * Middleware: Tự động gắn companyId filter cho Company Admin
 * Super Admin sẽ thấy tất cả
 */
module.exports.applyCompanyFilter = (req, res, next) => {
  const account = req.account;

  if (!account) {
    return res.status(401).json({
      code: "error",
      message: "Unauthorized",
    });
  }

  // Nếu là Super Admin → không filter
  if (account.isSuperAdmin) {
    req.companyFilter = {}; // Không filter gì
    req.isSuperAdmin = true;
  } else {
    // Company Admin → chỉ thấy data của công ty mình
    if (!account.companyId) {
      return res.status(403).json({
        code: "error",
        message: "Tài khoản chưa được gán công ty!",
      });
    }
    req.companyFilter = { companyId: account.companyId };
    req.isSuperAdmin = false;
    req.userCompanyId = account.companyId;
  }

  next();
};

