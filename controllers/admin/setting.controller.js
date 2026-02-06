const SettingWebsiteInfo = require("../../models/setting-website-info.model");
const { permissionList } = require("../../config/variable.config");
const Role = require("../../models/role.model");
const bcrypt = require("bcryptjs");
const AccountAdmin = require("../../models/account-admin.model");
const mongoose = require("mongoose");
const Category = require("../../models/category.model");
const categoryHelper = require("../../helpers/category.helper");

module.exports.list = async (req, res) => {
  res.render("admin/pages/setting-list", {
    pageTitle: "Cài đặt chung",
  });
};

module.exports.websiteInfo = async (req, res) => {
  const record = await SettingWebsiteInfo.findOne({});

  // Danh sách danh mục
  const categoryList = await Category.find({});
  const categoryTree = categoryHelper.buildCategoryTree(categoryList, "");
  // Hết Danh sách danh mục

  res.render("admin/pages/setting-website-info", {
    pageTitle: "Thông tin website",
    record: record,
    categoryList: categoryTree,
  });
};

module.exports.websiteInfoPatch = async (req, res) => {
  if (req.files && req.files.logo) {
    req.body.logo = req.files.logo[0].path;
  }

  if (req.files && req.files.favicon) {
    req.body.favicon = req.files.favicon[0].path;
  }

  const countRecord = await SettingWebsiteInfo.countDocuments({});
  if (countRecord > 0) {
    await SettingWebsiteInfo.updateOne({}, req.body);
  } else {
    const newRecord = new SettingWebsiteInfo(req.body);
    await newRecord.save();
  }

  res.json({
    code: "success",
    message: "Cập nhật thành công!",
  });
};

module.exports.accountAdminList = async (req, res) => {
  try {
    // Lấy companyId từ middleware auth
    const rawCid = req.account?.companyId;
    if (!rawCid) {
      return res.render("admin/pages/setting-account-admin-list", {
        pageTitle: "Tài khoản quản trị",
        accountAdminList: [],
      });
    }

    // Cast về ObjectId nếu phù hợp, để khớp với schema AccountAdmin.companyId (ObjectId)
    const companyId = mongoose.Types.ObjectId.isValid(String(rawCid))
      ? new mongoose.Types.ObjectId(String(rawCid))
      : String(rawCid);

    // Chỉ lấy admin thuộc công ty của người đang đăng nhập
    const accountAdminList = await AccountAdmin.find({
      deleted: false,
      companyId, // <— bộ lọc theo công ty
    })
      .sort({ createdAt: "desc" })
      .select(
        "fullName email phone role positionCompany status avatar companyId createdAt"
      )
      .lean();

    // Tránh N+1: gom roleId rồi truy một lần
    const roleIds = accountAdminList.map((a) => a.role).filter(Boolean);
    let roleMap = {};
    if (roleIds.length) {
      const roles = await Role.find({ _id: { $in: roleIds } })
        .select("name")
        .lean();
      roleMap = Object.fromEntries(roles.map((r) => [String(r._id), r.name]));
    }
    for (const item of accountAdminList) {
      item.roleName = roleMap[String(item.role)] || "";
    }

    return res.render("admin/pages/setting-account-admin-list", {
      pageTitle: "Tài khoản quản trị",
      accountAdminList,
    });
  } catch (e) {
    return res.render("admin/pages/setting-account-admin-list", {
      pageTitle: "Tài khoản quản trị",
      accountAdminList: [],
    });
  }
};

module.exports.accountAdminCreate = async (req, res) => {
  const roleList = await Role.find({
    deleted: false,
  }).sort({
    createdAt: "desc",
  });

  res.render("admin/pages/setting-account-admin-create", {
    pageTitle: "Tạo tài khoản quản trị",
    roleList: roleList,
  });
};

module.exports.accountAdminCreatePost = async (req, res) => {
  try {
    const existAccount = await AccountAdmin.findOne({
      email: req.body.email,
    });

    if (existAccount) {
      res.json({
        code: "error",
        message: "Email đã tồn tại trong hệ thống!",
      });
      return;
    }

    // Mã hóa mật khẩu
    const salt = await bcrypt.genSalt(10);
    req.body.password = await bcrypt.hash(req.body.password, salt);

    req.body.createdBy = req.account.id;
    req.body.updatedBy = req.account.id;
    req.body.avatar = req.file ? req.file.path : "";

    const newRecord = new AccountAdmin(req.body);
    await newRecord.save();

    res.json({
      code: "success",
      message: "Tạo tài khoản thành công!",
    });
  } catch (error) {
    res.json({
      code: "error",
      message: "Dữ liệu không hợp lệ!",
    });
  }
};

module.exports.roleList = async (req, res) => {
  const roleList = await Role.find({
    deleted: false,
  }).sort({
    createdAt: "desc",
  });

  res.render("admin/pages/setting-role-list", {
    pageTitle: "Nhóm quyền",
    roleList: roleList,
  });
};

module.exports.roleCreate = async (req, res) => {
  res.render("admin/pages/setting-role-create", {
    pageTitle: "Tạo nhóm quyền",
    permissionList: permissionList,
  });
};

module.exports.roleCreatePost = async (req, res) => {
  try {
    req.body.createdBy = req.account.id;
    req.body.updatedBy = req.account.id;

    const newRecord = new Role(req.body);
    await newRecord.save();

    res.json({
      code: "success",
      message: "Tạo nhóm quyền thành công!",
    });
  } catch (error) {
    res.json({
      code: "error",
      message: "Dữ liệu không hợp lệ!",
    });
  }
};

module.exports.roleEdit = async (req, res) => {
  try {
    const id = req.params.id;

    const roleDetail = await Role.findOne({
      _id: id,
      deleted: false,
    });

    if (!roleDetail) {
      res.redirect(`/${pathAdmin}/setting/role/list`);
      return;
    }

    res.render("admin/pages/setting-role-edit", {
      pageTitle: "Chỉnh sửa nhóm quyền",
      permissionList: permissionList,
      roleDetail: roleDetail,
    });
  } catch (error) {
    res.redirect(`/${pathAdmin}/setting/role/list`);
  }
};

module.exports.roleEditPatch = async (req, res) => {
  try {
    const id = req.params.id;

    const roleDetail = await Role.findOne({
      _id: id,
      deleted: false,
    });

    if (!roleDetail) {
      res.json({
        code: "error",
        message: "Bản ghi không tồn tại!",
      });
      return;
    }

    req.body.updatedBy = req.account.id;

    await Role.updateOne(
      {
        _id: id,
        deleted: false,
      },
      req.body
    );

    res.json({
      code: "success",
      message: "Cập nhật nhóm quyền thành công!",
    });
  } catch (error) {
    res.json({
      code: "error",
      message: "Dữ liệu không hợp lệ!",
    });
  }
};

module.exports.accountAdminEdit = async (req, res) => {
  try {
    const id = req.params.id;
    const rawCid = req.account?.companyId;

    // ép kiểu companyId (ObjectId hoặc String tuỳ schema hiện tại)
    const companyId = mongoose.Types.ObjectId.isValid(String(rawCid))
      ? new mongoose.Types.ObjectId(String(rawCid))
      : String(rawCid);

    // nếu có superadmin thì cho phép bỏ lọc company
    const baseFind = { _id: id, deleted: false };
    if (req.account?.role !== "superadmin") baseFind.companyId = companyId;

    const accountDetail = await AccountAdmin.findOne(baseFind);
    if (!accountDetail) {
      return res.redirect(`/${pathAdmin}/setting/account-admin/list`);
    }

    const roleList = await Role.find({ deleted: false }).sort({
      createdAt: "desc",
    });

    return res.render("admin/pages/setting-account-admin-edit", {
      pageTitle: "Chỉnh sửa tài khoản quản trị",
      roleList,
      accountDetail,
    });
  } catch (error) {
    return res.redirect(`/${pathAdmin}/setting/account-admin/list`);
  }
};

module.exports.accountAdminEditPatch = async (req, res) => {
  try {
    const id = req.params.id;
    const rawCid = req.account?.companyId;

    const companyId = mongoose.Types.ObjectId.isValid(String(rawCid))
      ? new mongoose.Types.ObjectId(String(rawCid))
      : String(rawCid);

    // chỉ được sửa admin thuộc công ty mình (trừ superadmin)
    const baseFind = { _id: id, deleted: false };
    if (req.account?.role !== "superadmin") baseFind.companyId = companyId;

    const accountDetail = await AccountAdmin.findOne(baseFind);
    if (!accountDetail) {
      return res.json({ code: "error", message: "Bản ghi không tồn tại!" });
    }

    // Không cho sửa companyId từ client
    delete req.body.companyId;

    // Check email trùng
    // (tuỳ chính sách: toàn cục hay theo công ty. Giữ nguyên “toàn cục” như hiện tại)
    if (req.body.email) {
      const existEmail = await AccountAdmin.findOne({
        _id: { $ne: id },
        email: req.body.email,
        deleted: false,
      });
      if (existEmail) {
        return res.json({
          code: "error",
          message: "Email đã tồn tại trong hệ thống!",
        });
      }
    }

    // Hash mật khẩu nếu có nhập
    if (req.body.password) {
      const salt = await bcrypt.genSalt(10);
      req.body.password = await bcrypt.hash(req.body.password, salt);
    } else {
      delete req.body.password;
    }

    // Giới hạn một số field theo enum (tránh ghi rác)
    if (
      req.body.status &&
      !["initial", "active", "inactive"].includes(req.body.status)
    ) {
      delete req.body.status;
    }

    // Avatar: chỉ set khi có file, tránh xoá ảnh cũ
    if (req.file) {
      req.body.avatar = req.file.path;
    } else {
      delete req.body.avatar;
    }

    req.body.updatedBy = req.account.id;

    await AccountAdmin.updateOne({ _id: id }, req.body);

    return res.json({
      code: "success",
      message: "Cập nhật tài khoản thành công!",
    });
  } catch (error) {
    return res.json({ code: "error", message: "Dữ liệu không hợp lệ!" });
  }
};
