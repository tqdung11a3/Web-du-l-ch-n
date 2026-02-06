const AccountAdmin = require("../../models/account-admin.model");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
module.exports.edit = async (req, res) => {
  res.render("admin/pages/profile-edit", {
    pageTitle: "Thông tin cá nhân",
  });
};

module.exports.editPatch = async (req, res) => {
  try {
    const accountId = req.account.id; // Document -> có virtual id

    // 1) Lấy và chuẩn hoá các field cho phép sửa trong "Hồ sơ"
    //    (KHÔNG cho phép đổi role/status/companyId ở trang hồ sơ)
    const {
      fullName = "",
      email = "",
      phone = "",
      positionCompany = "",
      password = "",
    } = req.body;

    const emailNorm = String(email).trim().toLowerCase();

    // 2) Kiểm tra email trùng (toàn cục; nếu muốn theo công ty,
    //    thêm điều kiện companyId: req.account.companyId)
    if (emailNorm) {
      const existEmail = await AccountAdmin.findOne({
        _id: { $ne: accountId },
        email: emailNorm,
        deleted: false,
      }).select("_id");
      if (existEmail) {
        return res.json({
          code: "error",
          message: "Email đã tồn tại trong hệ thống!",
        });
      }
    }

    // 3) Xây dựng payload cập nhật (whitelist)
    const update = {
      fullName: String(fullName).trim(),
      email: emailNorm,
      phone: String(phone).trim(),
      positionCompany: String(positionCompany).trim(),
      updatedBy: accountId,
    };

    // 4) Mật khẩu: chỉ cập nhật khi người dùng thực sự nhập
    if (password && String(password).trim().length > 0) {
      // (tuỳ bạn: thêm validate mạnh phía server nếu cần)
      const salt = await bcrypt.genSalt(10);
      update.password = await bcrypt.hash(String(password).trim(), salt);
    }

    // 5) Avatar: chỉ set khi có file mới, tránh xoá ảnh cũ
    if (req.file && req.file.path) {
      update.avatar = req.file.path;
    }

    // 6) Cập nhật bản ghi
    const before = await AccountAdmin.findById(accountId).select("email");
    await AccountAdmin.updateOne({ _id: accountId }, update);

    // 7) Nếu đổi email, nên xoay (rotate) lại JWT để token đang dùng không bị “lệch email”
    //    (middleware verifyToken đang check {id, email} trong token)
    if (before && emailNorm && emailNorm !== before.email) {
      const jwt = require("jsonwebtoken");
      const payload = { id: accountId, email: emailNorm };
      const token = jwt.sign(payload, process.env.JWT_SECRET, {
        expiresIn: "7d", // tuỳ policy
      });
      // set cookie lại
      res.cookie("token", token, {
        httpOnly: true,
        sameSite: "lax",
        // secure: true, // bật ở production với HTTPS
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });
    }

    return res.json({
      code: "success",
      message: "Cập nhật tài khoản thành công!",
    });
  } catch (error) {
    console.error("profile.editPatch error:", error);
    return res.json({
      code: "error",
      message: "Dữ liệu không hợp lệ!",
    });
  }
};

module.exports.changePassword = async (req, res) => {
  res.render("admin/pages/profile-change-password", {
    pageTitle: "Đổi mật khẩu",
  });
};
