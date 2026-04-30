const mongoose = require("mongoose");
const AccountAdmin = require("../../models/account-admin.model");
const Role = require("../../models/role.model");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

module.exports.edit = async (req, res) => {
  let roleList = [];
  try {
    roleList = await Role.find({ deleted: { $ne: true } })
      .select("name")
      .sort({ name: 1 })
      .lean();
  } catch (e) {
    console.error("[profile.edit] roleList", e);
  }

  res.render("admin/pages/profile-edit", {
    pageTitle: "Thông tin cá nhân",
    roleList,
  });
};

module.exports.editPatch = async (req, res) => {
  try {
    const accountId = req.account.id; // Document -> có virtual id

    // 1) Lấy và chuẩn hoá các field cho phép sửa trong "Hồ sơ"
    //    (không đổi status/companyId/isSuperAdmin từ trang này)
    const {
      fullName = "",
      email = "",
      phone = "",
      positionCompany = "",
      password = "",
      role: roleBody = "",
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

    const roleId = String(roleBody || "").trim();
    if (roleId) {
      if (!mongoose.Types.ObjectId.isValid(roleId)) {
        return res.json({
          code: "error",
          message: "Nhóm quyền không hợp lệ!",
        });
      }
      const roleOk = await Role.findOne({
        _id: roleId,
        deleted: { $ne: true },
      })
        .select("_id")
        .lean();
      if (!roleOk) {
        return res.json({
          code: "error",
          message: "Nhóm quyền không tồn tại!",
        });
      }
      update.role = roleId;
    }

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

module.exports.changePasswordSuperAdmin = async (req, res) => {
  res.render("admin/pages/super-admin/profile-change-password", {
    pageTitle: "Đổi mật khẩu",
  });
};

/** GET /admin/super-admin/profile/edit — layout Super Admin, không tải danh sách role */
module.exports.editSuperAdmin = async (req, res) => {
  res.render("admin/pages/super-admin/profile-edit", {
    pageTitle: "Thông tin cá nhân",
  });
};

/**
 * PATCH /admin/super-admin/profile/edit — chỉ cập nhật họ tên, email, SĐT, mật khẩu, avatar.
 * Không nhận / không ghi `positionCompany` và `role` từ body.
 */
module.exports.editPatchSuperAdmin = async (req, res) => {
  try {
    const accountId = req.account.id;

    const { fullName = "", email = "", phone = "", password = "" } = req.body;

    const emailNorm = String(email).trim().toLowerCase();

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

    const update = {
      fullName: String(fullName).trim(),
      email: emailNorm,
      phone: String(phone).trim(),
      updatedBy: accountId,
    };

    if (password && String(password).trim().length > 0) {
      const salt = await bcrypt.genSalt(10);
      update.password = await bcrypt.hash(String(password).trim(), salt);
    }

    if (req.file && req.file.path) {
      update.avatar = req.file.path;
    }

    const before = await AccountAdmin.findById(accountId).select("email");
    await AccountAdmin.updateOne({ _id: accountId }, update);

    if (before && emailNorm && emailNorm !== before.email) {
      const payload = { id: accountId, email: emailNorm };
      const token = jwt.sign(payload, process.env.JWT_SECRET, {
        expiresIn: "7d",
      });
      res.cookie("token", token, {
        httpOnly: true,
        sameSite: "lax",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });
    }

    return res.json({
      code: "success",
      message: "Cập nhật tài khoản thành công!",
    });
  } catch (error) {
    console.error("profile.editPatchSuperAdmin error:", error);
    return res.json({
      code: "error",
      message: "Dữ liệu không hợp lệ!",
    });
  }
};
