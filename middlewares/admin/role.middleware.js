// middlewares/admin/role.middleware.js

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
 * Middleware: Cho phép Super Admin thao tác với tư cách một công ty (override).
 *
 * Sử dụng khi route base ở phía company admin nhưng cần mở cửa cho Super Admin
 * khi họ bấm "Chỉnh sửa với tư cách công ty X" từ UI super admin.
 *
 * Yêu cầu request có header `x-act-as-company-id` hoặc query `asCompanyId`.
 * Nếu có đủ (và người dùng là Super Admin), middleware sẽ:
 *  - Đặt `req.overrideContext = { actAsCompanyId, actor, isSuperAdminOverride: true }`
 *  - "Gán tạm" `req.account.companyId = actAsCompanyId` trong phạm vi request,
 *    để các controller cũ (vốn đọc `req.account.companyId`) vẫn chạy đúng.
 *
 * Sau đó tiếp tục gọi `requireCompanyAdmin` để đồng nhất hành vi
 * với company admin, trừ việc kiểm tra ownership (đã được vượt qua).
 */
module.exports.allowSuperAdminOverride = (req, res, next) => {
  const account = req.account;
  if (!account) {
    return res.status(401).json({ code: "error", message: "Unauthorized" });
  }

  const headerId = req.headers["x-act-as-company-id"];
  const queryId = req.query.asCompanyId;
  const bodyId = req.body && req.body.asCompanyId;
  const actAsCompanyId = headerId || queryId || bodyId;

  if (account.isSuperAdmin && actAsCompanyId) {
    req.overrideContext = {
      actAsCompanyId: String(actAsCompanyId),
      actor: account,
      isSuperAdminOverride: true,
    };
    // Bản gốc của account chỉ tồn tại trong phạm vi request.
    // Ta gán tạm companyId để các controller cũ đọc được.
    req.account = Object.assign({}, account, {
      companyId: String(actAsCompanyId),
      _isSuperAdminOverride: true,
    });
    return next();
  }

  // Không có override → rơi về hành vi mặc định.
  if (account.isSuperAdmin) {
    return res.status(403).json({
      code: "error",
      message:
        "Super Admin cần chọn công ty để thao tác (thiếu header x-act-as-company-id).",
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

/**
 * Loads Role permissions for company admin sidebar / tab UI and sets req.tabAccess
 * for requirePermission (must run after verifyToken, before requirePermission).
 */
module.exports.loadRolePermissions = async (req, res, next) => {
  res.locals.isTourOnlyAdmin = false;
  res.locals.isHotelOnlyAdmin = false;
  res.locals.isTourStaffAdmin = false;
  res.locals.isHotelStaffAdmin = false;
  req.tabAccess = {
    hasTour: false,
    hasHotel: false,
    restricted: false,
    isTourStaff: false,
    isHotelStaff: false,
  };

  const account = req.account;
  if (!account || account.isSuperAdmin) {
    return next();
  }

  const scope = account.tabAccessScope || "full";

  if (scope === "full") {
    req.tabAccess = { hasTour: true, hasHotel: true, restricted: false };
    return next();
  }
  if (scope === "tour_only") {
    req.tabAccess = { hasTour: true, hasHotel: false, restricted: true };
    res.locals.isTourOnlyAdmin = true;
    res.locals.isHotelOnlyAdmin = false;
    return next();
  }
  if (scope === "hotel_only") {
    req.tabAccess = { hasTour: false, hasHotel: true, restricted: true };
    res.locals.isTourOnlyAdmin = false;
    res.locals.isHotelOnlyAdmin = true;
    return next();
  }
  if (scope === "tour_staff") {
    req.tabAccess = { hasTour: true, hasHotel: false, restricted: true, isTourStaff: true };
    res.locals.isTourOnlyAdmin = true;
    res.locals.isHotelOnlyAdmin = false;
    res.locals.isTourStaffAdmin = true;
    return next();
  }
  if (scope === "hotel_staff") {
    req.tabAccess = {
      hasTour: false,
      hasHotel: true,
      restricted: true,
      isHotelStaff: true,
    };
    res.locals.isTourOnlyAdmin = false;
    res.locals.isHotelOnlyAdmin = true;
    res.locals.isHotelStaffAdmin = true;
    return next();
  }

  // mặc định: toàn quyền
  req.tabAccess = { hasTour: true, hasHotel: true, restricted: false };
  return next();
};

/**
 * Protects route groups: only enforced when Role includes at least one tab access perm.
 * Super admin, no role, or roles without tour-access/hotel-access → full access (backward compat).
 */
module.exports.requirePermission = (requiredPerm) => {
  return (req, res, next) => {
    const account = req.account;
    if (!account || account.isSuperAdmin) {
      return next();
    }

    const ta = req.tabAccess;
    if (!ta || !ta.restricted) {
      return next();
    }

    if (requiredPerm === "tour-access" && ta.hasTour) {
      return next();
    }
    if (requiredPerm === "hotel-access" && ta.hasHotel) {
      return next();
    }

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
      message: "Bạn không có quyền truy cập khu vực này!",
    });
  };
};

