// controllers/admin/super-admin/role.controller.js
const Role = require("../../../models/role.model");
const AccountAdmin = require("../../../models/account-admin.model");
const { permissionList } = require("../../../config/variable.config");
const auditLogHelper = require("../../../helpers/audit-log.helper");

/**
 * GET /admin/super-admin/roles
 */
module.exports.list = async (req, res) => {
  try {
    const roles = await Role.find({ deleted: false })
      .sort({ createdAt: -1 })
      .lean();

    // Đếm số admin đang dùng từng role (để cảnh báo khi xoá)
    for (const r of roles) {
      r.usedBy = await AccountAdmin.countDocuments({
        role: r._id,
        deleted: false,
      });
    }

    res.render("admin/pages/super-admin/role-list", {
      pageTitle: "Quản lý vai trò & quyền",
      roles,
    });
  } catch (error) {
    console.error("Super Admin Role List Error:", error);
    res.status(500).send("Có lỗi xảy ra!");
  }
};

/**
 * GET /admin/super-admin/roles/create
 */
module.exports.createGet = async (req, res) => {
  res.render("admin/pages/super-admin/role-create", {
    pageTitle: "Tạo nhóm quyền",
    permissionList,
  });
};

/**
 * POST /admin/super-admin/roles/create
 */
module.exports.createPost = async (req, res) => {
  try {
    req.body.createdBy = req.account.id;
    req.body.updatedBy = req.account.id;
    if (req.body.permissions && !Array.isArray(req.body.permissions)) {
      req.body.permissions = [req.body.permissions];
    }
    const doc = await Role.create(req.body);
    await auditLogHelper.log(req, {
      action: "role.create",
      resourceType: "Role",
      resourceId: doc._id,
      metadata: { name: doc.name },
    });
    res.json({ code: "success", message: "Tạo nhóm quyền thành công!" });
  } catch (error) {
    console.error("Super Admin Role Create Error:", error);
    res.json({ code: "error", message: "Dữ liệu không hợp lệ!" });
  }
};

/**
 * GET /admin/super-admin/roles/edit/:id
 */
module.exports.editGet = async (req, res) => {
  try {
    const roleDetail = await Role.findOne({
      _id: req.params.id,
      deleted: false,
    }).lean();
    if (!roleDetail) {
      return res.redirect(`/admin/super-admin/roles`);
    }
    res.render("admin/pages/super-admin/role-edit", {
      pageTitle: "Chỉnh sửa nhóm quyền",
      permissionList,
      roleDetail,
    });
  } catch (error) {
    console.error("Super Admin Role EditGet Error:", error);
    res.redirect(`/admin/super-admin/roles`);
  }
};

/**
 * PATCH /admin/super-admin/roles/edit/:id
 */
module.exports.editPatch = async (req, res) => {
  try {
    const id = req.params.id;
    const role = await Role.findOne({ _id: id, deleted: false });
    if (!role) {
      return res.json({ code: "error", message: "Không tìm thấy vai trò" });
    }
    req.body.updatedBy = req.account.id;
    if (req.body.permissions && !Array.isArray(req.body.permissions)) {
      req.body.permissions = [req.body.permissions];
    }
    await Role.updateOne({ _id: id }, req.body);
    await auditLogHelper.log(req, {
      action: "role.update",
      resourceType: "Role",
      resourceId: id,
      metadata: { name: req.body.name },
    });
    res.json({ code: "success", message: "Cập nhật thành công!" });
  } catch (error) {
    console.error("Super Admin Role EditPatch Error:", error);
    res.json({ code: "error", message: "Dữ liệu không hợp lệ!" });
  }
};

/**
 * DELETE /admin/super-admin/roles/:id
 */
module.exports.remove = async (req, res) => {
  try {
    const id = req.params.id;
    const usedBy = await AccountAdmin.countDocuments({
      role: id,
      deleted: false,
    });
    if (usedBy > 0) {
      return res.json({
        code: "error",
        message: `Đang có ${usedBy} tài khoản dùng vai trò này. Hãy gán vai trò khác trước.`,
      });
    }
    await Role.updateOne(
      { _id: id },
      {
        deleted: true,
        deletedAt: new Date(),
        deletedBy: req.account.id,
      }
    );
    await auditLogHelper.log(req, {
      action: "role.delete",
      resourceType: "Role",
      resourceId: id,
    });
    res.json({ code: "success", message: "Đã xoá vai trò!" });
  } catch (error) {
    console.error("Super Admin Role Delete Error:", error);
    res.json({ code: "error", message: "Có lỗi xảy ra!" });
  }
};
