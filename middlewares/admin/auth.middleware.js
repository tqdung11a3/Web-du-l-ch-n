const jwt = require("jsonwebtoken");
const AccountAdmin = require("../../models/account-admin.model");
const { pathAdmin } = require("../../config/variable.config");
const Role = require("../../models/role.model");

module.exports.verifyToken = async (req, res, next) => {
  try {
    const token = req.cookies?.token;
    if (!token) {
      return handleUnauthed(req, res);
    }

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      res.clearCookie("token");
      return handleUnauthed(req, res);
    }

    const { id, email } = payload || {};
    if (!id || !email) {
      res.clearCookie("token");
      return handleUnauthed(req, res);
    }

    // CHỌN THÊM role ở đây
    const existAccount = await AccountAdmin.findOne({ _id: id, email })
      .select(
        "_id email fullName phone positionCompany avatar role companyId status isSuperAdmin tabAccessScope assignedHotelId"
      )
      .exec();

    if (!existAccount || existAccount.status !== "active") {
      res.clearCookie("token");
      return handleUnauthed(req, res);
    }

    // Lấy tên role nếu có, do bảng account-admin có field role là ObjectId của bảng role
    if (existAccount.role) {
      const roleInfo = await Role.findOne({ _id: existAccount.role })
        .select("name")
        .lean();
      if (roleInfo) {
        // gắn tạm để render (không persist DB)
        existAccount.roleName = roleInfo.name;
      }
    }

    req.account = existAccount; // Document (không lean)
    res.locals.account = existAccount; // dùng thẳng trong Pug

    return next();
  } catch (error) {
    res.clearCookie("token");
    return handleUnauthed(req, res);
  }
};

// Trả về redirect cho request HTML, còn AJAX thì trả JSON 401
function handleUnauthed(req, res) {
  const wantsJSON =
    req.xhr ||
    (req.headers.accept && req.headers.accept.includes("application/json"));
  if (wantsJSON) {
    return res.status(401).json({ code: "error", message: "Unauthorized" });
  }
  return res.redirect(`/${pathAdmin}/account/login`);
}
