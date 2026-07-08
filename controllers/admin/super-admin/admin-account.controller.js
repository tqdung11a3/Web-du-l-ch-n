// controllers/admin/super-admin/admin-account.controller.js
const AccountAdmin = require("../../../models/account-admin.model");
const Company = require("../../../models/company.model");
const bcrypt = require("bcrypt");
const auditLogHelper = require("../../../helpers/audit-log.helper");

/**
 * Danh sách tất cả company admin (chờ duyệt & đã duyệt)
 */
module.exports.list = async (req, res) => {
  try {
    // Filter: chỉ lấy company admin (isSuperAdmin !== true) và chưa bị xóa (deleted !== true)
    const filter = {
      deleted: { $ne: true },
      isSuperAdmin: { $ne: true }, // Chỉ lấy company admin
    };

    // Filter by status
    if (req.query.status) {
      filter.status = req.query.status;
    }

    // Search
    if (req.query.keyword) {
      const regex = new RegExp(req.query.keyword, "i");
      filter.$or = [{ fullName: regex }, { email: regex }];
    }

    const admins = await AccountAdmin.find(filter)
      .populate("companyId", "name logo status")
      .sort({ createdAt: -1 })
      .lean();

    res.render("admin/pages/super-admin/admin-list", {
      pageTitle: "Quản lý Company Admin",
      admins,
      keyword: req.query.keyword || "",
      statusFilter: req.query.status || "",
    });
  } catch (error) {
    console.error("Super Admin - Admin List Error:", error);
    res.status(500).send("Có lỗi xảy ra!");
  }
};

/**
 * Approve company admin (chuyển từ initial → active)
 */
module.exports.approve = async (req, res) => {
  try {
    const { id } = req.body;

    const admin = await AccountAdmin.findOne({ _id: id, deleted: false });

    if (!admin) {
      return res.json({
        code: "error",
        message: "Không tìm thấy tài khoản!",
      });
    }

    if (admin.isSuperAdmin) {
      return res.json({
        code: "error",
        message: "Không thể thao tác trên Super Admin!",
      });
    }

    await AccountAdmin.updateOne(
      { _id: id },
      {
        status: "active",
        updatedBy: req.account.id,
      }
    );

    await auditLogHelper.log(req, {
      action: "admin.approve",
      resourceType: "AccountAdmin",
      resourceId: id,
      metadata: { email: admin.email },
    });

    res.json({
      code: "success",
      message: "Đã phê duyệt tài khoản thành công!",
    });
  } catch (error) {
    console.error("Approve Admin Error:", error);
    res.json({
      code: "error",
      message: "Có lỗi xảy ra!",
    });
  }
};

/**
 * Reject/Deactivate company admin
 */
module.exports.reject = async (req, res) => {
  try {
    const { id } = req.body;

    const admin = await AccountAdmin.findOne({ _id: id, deleted: false });

    if (!admin) {
      return res.json({
        code: "error",
        message: "Không tìm thấy tài khoản!",
      });
    }

    if (admin.isSuperAdmin) {
      return res.json({
        code: "error",
        message: "Không thể thao tác trên Super Admin!",
      });
    }

    await AccountAdmin.updateOne(
      { _id: id },
      {
        status: "inactive",
        updatedBy: req.account.id,
      }
    );

    await auditLogHelper.log(req, {
      action: "admin.reject",
      resourceType: "AccountAdmin",
      resourceId: id,
      metadata: { email: admin.email },
    });

    res.json({
      code: "success",
      message: "Đã từ chối/vô hiệu hóa tài khoản!",
    });
  } catch (error) {
    console.error("Reject Admin Error:", error);
    res.json({
      code: "error",
      message: "Có lỗi xảy ra!",
    });
  }
};

/**
 * Xóa company admin (hard delete - xóa hẳn khỏi database)
 */
module.exports.deleteAdmin = async (req, res) => {
  try {
    const id = req.params.id;

    const admin = await AccountAdmin.findOne({ _id: id, deleted: { $ne: true } });

    if (!admin) {
      return res.json({
        code: "error",
        message: "Không tìm thấy tài khoản!",
      });
    }

    if (admin.isSuperAdmin) {
      return res.json({
        code: "error",
        message: "Không thể xóa Super Admin!",
      });
    }

    // Hard delete - xóa hẳn khỏi database
    await AccountAdmin.deleteOne({ _id: id });

    await auditLogHelper.log(req, {
      action: "admin.delete",
      resourceType: "AccountAdmin",
      resourceId: id,
      metadata: { email: admin.email },
    });

    res.json({
      code: "success",
      message: "Xóa tài khoản thành công!",
    });
  } catch (error) {
    console.error("Delete Admin Error:", error);
    res.json({
      code: "error",
      message: "Có lỗi xảy ra!",
    });
  }
};

/**
 * GET: Trang tạo company admin mới
 */
module.exports.createGet = async (req, res) => {
  try {
    // Lấy danh sách công ty để chọn
    const companies = await Company.find({
      deleted: { $ne: true },
      status: "active",
    })
      .select("name")
      .sort({ name: 1 })
      .lean();

    res.render("admin/pages/super-admin/admin-create", {
      pageTitle: "Tạo Company Admin",
      companies,
    });
  } catch (error) {
    console.error("Create Admin Get Error:", error);
    res.status(500).send("Có lỗi xảy ra!");
  }
};

/**
 * POST: Tạo company admin mới
 */
module.exports.createPost = async (req, res) => {
  try {
    const { fullName, email, phone, companyId, role, positionCompany, password, status, newCompanyName } = req.body;

    // Kiểm tra email đã tồn tại
    const existingAdmin = await AccountAdmin.findOne({
      email: email,
      deleted: { $ne: true },
    });

    if (existingAdmin) {
      return res.json({
        code: "error",
        message: "Email đã được sử dụng!",
      });
    }

    let finalCompanyId = companyId;

    // Nếu chọn "Tạo công ty mới"
    if (companyId === "new") {
      if (!newCompanyName || newCompanyName.trim() === "") {
        return res.json({
          code: "error",
          message: "Vui lòng nhập tên công ty mới!",
        });
      }

      // Kiểm tra tên công ty đã tồn tại chưa
      const existingCompany = await Company.findOne({
        name: newCompanyName.trim(),
        deleted: { $ne: true },
      });

      if (existingCompany) {
        return res.json({
          code: "error",
          message: "Tên công ty đã tồn tại!",
        });
      }

      // Tạo công ty mới
      const newCompany = new Company({
        name: newCompanyName.trim(),
        status: "active",
        createdBy: req.account.id,
      });

      await newCompany.save();
      finalCompanyId = newCompany._id;
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Xử lý avatar nếu có (multer + cloudinary đã upload tự động)
    let avatarUrl = "";
    if (req.file) {
      avatarUrl = req.file.path; // Cloudinary trả về path trong req.file.path
    }

    // Tạo admin mới
    const newAdmin = new AccountAdmin({
      fullName,
      email,
      phone,
      companyId: finalCompanyId,
      positionCompany,
      password: hashedPassword,
      avatar: avatarUrl,
      status: status || "active",
      isSuperAdmin: false,
      createdBy: req.account.id,
    });

    await newAdmin.save();

    await auditLogHelper.log(req, {
      action: "admin.create",
      resourceType: "AccountAdmin",
      resourceId: newAdmin._id,
      metadata: { email: newAdmin.email, companyId: String(finalCompanyId) },
    });

    res.json({
      code: "success",
      message: companyId === "new" 
        ? "Tạo công ty mới và tài khoản thành công!" 
        : "Tạo tài khoản thành công!",
    });
  } catch (error) {
    console.error("Create Admin Post Error:", error);
    res.json({
      code: "error",
      message: "Có lỗi xảy ra!",
    });
  }
};

/**
 * GET: Trang chỉnh sửa company admin
 */
module.exports.editGet = async (req, res) => {
  try {
    const id = req.params.id;

    const admin = await AccountAdmin.findOne({
      _id: id,
      deleted: { $ne: true },
    })
      .populate("companyId", "name")
      .lean();

    if (!admin) {
      return res.redirect(`/${req.app.locals.pathAdmin}/super-admin/admin`);
    }

    if (admin.isSuperAdmin) {
      return res.redirect(`/${req.app.locals.pathAdmin}/super-admin/admin`);
    }

    // Lấy danh sách công ty
    const companies = await Company.find({
      deleted: { $ne: true },
      status: "active",
    })
      .select("name")
      .sort({ name: 1 })
      .lean();

    res.render("admin/pages/super-admin/admin-edit", {
      pageTitle: `Chỉnh sửa: ${admin.fullName}`,
      admin,
      companies,
    });
  } catch (error) {
    console.error("Edit Admin Get Error:", error);
    res.status(500).send("Có lỗi xảy ra!");
  }
};

/**
 * PATCH: Cập nhật thông tin company admin
 */
module.exports.editPatch = async (req, res) => {
  try {
    const id = req.params.id;
    const { fullName, email, phone, companyId, positionCompany, password, status } = req.body;

    console.log("=== EDIT ADMIN DEBUG ===");
    console.log("Admin ID:", id);
    console.log("Body data:", req.body);
    console.log("File:", req.file);

    const admin = await AccountAdmin.findOne({
      _id: id,
      deleted: { $ne: true },
    });

    if (!admin) {
      return res.json({
        code: "error",
        message: "Không tìm thấy tài khoản!",
      });
    }

    if (admin.isSuperAdmin) {
      return res.json({
        code: "error",
        message: "Không thể chỉnh sửa Super Admin!",
      });
    }

    // Kiểm tra email trùng (nếu thay đổi email)
    if (email !== admin.email) {
      const existingAdmin = await AccountAdmin.findOne({
        email: email,
        _id: { $ne: id },
        deleted: { $ne: true },
      });

      if (existingAdmin) {
        return res.json({
          code: "error",
          message: "Email đã được sử dụng!",
        });
      }
    }

    // Cập nhật thông tin
    const updateData = {
      fullName,
      email,
      phone,
      companyId,
      positionCompany,
      status,
      updatedBy: req.account.id,
    };

    console.log("Update data:", updateData);

    // Xử lý avatar nếu có (multer + cloudinary đã upload tự động)
    if (req.file) {
      updateData.avatar = req.file.path; // Cloudinary trả về path trong req.file.path
    }

    // Xử lý password nếu có
    if (password && password.trim() !== "") {
      updateData.password = await bcrypt.hash(password, 10);
    }

    await AccountAdmin.updateOne({ _id: id }, updateData);

    await auditLogHelper.log(req, {
      action: "admin.update",
      resourceType: "AccountAdmin",
      resourceId: id,
      metadata: { email, companyId: String(companyId) },
    });

    console.log("=== UPDATE SUCCESS ===");

    res.json({
      code: "success",
      message: "Cập nhật thông tin thành công!",
    });
  } catch (error) {
    console.error("Edit Admin Patch Error:", error);
    res.json({
      code: "error",
      message: "Có lỗi xảy ra!",
    });
  }
};

