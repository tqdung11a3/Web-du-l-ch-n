const SettingWebsiteInfo = require("../../models/setting-website-info.model");
const { permissionList } = require("../../config/variable.config");
const Role = require("../../models/role.model");
const bcrypt = require("bcryptjs");
const AccountAdmin = require("../../models/account-admin.model");
const mongoose = require("mongoose");
const Category = require("../../models/category.model");
const categoryHelper = require("../../helpers/category.helper");
const {
  normalizeSection4CategoryIds,
  MAX_SECTION4_CATEGORIES,
} = require("../../helpers/website-setting-section4.helper");

const TAB_ACCESS_SCOPES = ["inherit", "full", "tour_only", "hotel_only"];

module.exports.TAB_ACCESS_SCOPE_OPTIONS = [
  { value: "inherit", label: "Theo nhóm quyền (mặc định)" },
  { value: "full", label: "Truy cập cả hai tab (Tour & Khách sạn)" },
  { value: "tour_only", label: "Chỉ tab Tour du lịch" },
  { value: "hotel_only", label: "Chỉ tab Khách sạn" },
];

function normalizeTabAccessScope(v) {
  const s = String(v || "inherit");
  return TAB_ACCESS_SCOPES.includes(s) ? s : "inherit";
}

function tabAccessScopeLabel(scope) {
  const map = {
    inherit: "Theo nhóm quyền",
    full: "Cả hai tab",
    tour_only: "Chỉ Tour",
    hotel_only: "Chỉ KS",
  };
  return map[scope] || map.inherit;
}

module.exports.list = async (req, res) => {
  res.render("admin/pages/setting-list", {
    pageTitle: "Cài đặt chung",
  });
};

module.exports.websiteInfo = async (req, res) => {
  const isSuperAdmin = !!(req.account && req.account.isSuperAdmin);
  if (isSuperAdmin) {
    const pathOnly = (req.originalUrl || "").split("?")[0];
    if (!pathOnly.includes("/super-admin/")) {
      const { pathAdmin } = require("../../config/variable.config");
      const qs = (req.originalUrl || "").includes("?")
        ? "?" + (req.originalUrl || "").split("?").slice(1).join("?")
        : "";
      return res.redirect(
        302,
        `/${pathAdmin}/super-admin/setting/website-info${qs}`
      );
    }
  }

  const record = await SettingWebsiteInfo.findOne({});

  const categoryList = await Category.find({});
  const categoryTree = categoryHelper.buildCategoryTree(categoryList, "");
  const categoryActiveRows = categoryList.filter(
    (c) => c.status === "active" && c.deleted !== true
  );
  const categoryTreeSection4Active = categoryHelper.buildCategoryTree(
    categoryActiveRows,
    ""
  );
  const section4CategoryIds = normalizeSection4CategoryIds(record || {});

  // Flat list với prefix '--' cho dropdown Section 4
  function flattenCatTree(nodes, level) {
    const result = [];
    for (const node of nodes) {
      result.push({
        id: node.id,
        displayName: "--".repeat(level) + (level ? " " : "") + node.name,
        name: node.name,
      });
      if (node.children && node.children.length) {
        result.push(...flattenCatTree(node.children, level + 1));
      }
    }
    return result;
  }
  const categoryFlatSection4Active = flattenCatTree(categoryTreeSection4Active, 0);
  const section4CategoryMap = Object.fromEntries(
    categoryFlatSection4Active.map((c) => [c.id, c.name])
  );

  res.render("admin/pages/setting-website-info", {
    pageTitle: "Thông tin website",
    record: record,
    categoryList: categoryTree,
    categoryFlatSection4Active,
    section4CategoryMap,
    section4CategoryIds,
    maxSection4Categories: MAX_SECTION4_CATEGORIES,
    readOnly: !isSuperAdmin,
    isSuperAdmin,
  });
};

module.exports.websiteInfoPatch = async (req, res) => {
  try {
    if (!req.account || !req.account.isSuperAdmin) {
      return res.json({ code: "error", message: "Không có quyền cập nhật." });
    }

    const update = {};
    const textFields = ["websiteName", "phone", "email", "address"];
    for (const k of textFields) {
      if (req.body[k] !== undefined) update[k] = String(req.body[k] ?? "");
    }

    if (req.files && req.files.logo && req.files.logo[0]) {
      update.logo = req.files.logo[0].path;
    }

    let rawCat = req.body.categoryIdsSection4;
    if (rawCat === undefined) rawCat = [];
    if (!Array.isArray(rawCat)) rawCat = rawCat ? [rawCat] : [];
    const uniq = [
      ...new Set(
        rawCat
          .map((id) => (id != null ? String(id) : ""))
          .filter((id) => mongoose.Types.ObjectId.isValid(id))
      ),
    ];
    let finalIds = [];
    if (uniq.length) {
      const activeCats = await Category.find({
        _id: { $in: uniq },
        deleted: { $ne: true },
        status: "active",
      })
        .select("_id")
        .lean();
      const allowed = new Set(activeCats.map((a) => String(a._id)));
      finalIds = uniq
        .filter((id) => allowed.has(id))
        .slice(0, MAX_SECTION4_CATEGORIES);
    }
    update.categoryIdsSection4 = finalIds;
    update.categoryIdSection4 = finalIds[0] || "";

    const countRecord = await SettingWebsiteInfo.countDocuments({});
    if (countRecord > 0) {
      await SettingWebsiteInfo.updateOne({}, { $set: update });
    } else {
      const newRecord = new SettingWebsiteInfo(update);
      await newRecord.save();
    }

    try {
      const auditLogHelper = require("../../helpers/audit-log.helper");
      await auditLogHelper.log(req, {
        action: "setting.website-info.update",
        resourceType: "SettingWebsiteInfo",
        metadata: { fields: Object.keys(update) },
      });
    } catch (e) {}

    return res.json({
      code: "success",
      message: "Cập nhật thành công!",
    });
  } catch (error) {
    console.error("websiteInfoPatch error:", error);
    return res.json({ code: "error", message: "Có lỗi xảy ra khi cập nhật!" });
  }
};

/**
 * Company Admin: ghép thêm danh mục Section 4 (chỉ danh mục active).
 * PATCH /admin/setting/website-info/section4-categories
 * body: { categoryIds: string[] }
 */
module.exports.mergeSection4Categories = async (req, res) => {
  try {
    let ids = req.body && req.body.categoryIds;
    if (!Array.isArray(ids)) ids = ids != null && ids !== "" ? [ids] : [];
    ids = [
      ...new Set(
        ids
          .map((id) => (id != null ? String(id) : ""))
          .filter((id) => mongoose.Types.ObjectId.isValid(id))
      ),
    ];
    if (!ids.length) {
      return res.json({
        code: "error",
        message: "Vui lòng chọn ít nhất một danh mục.",
      });
    }

    const activeCats = await Category.find({
      _id: { $in: ids },
      deleted: { $ne: true },
      status: "active",
    })
      .select("_id")
      .lean();
    const allowed = new Set(activeCats.map((a) => String(a._id)));
    const validNew = ids.filter((id) => allowed.has(id));
    if (!validNew.length) {
      return res.json({
        code: "error",
        message: "Không có danh mục hợp lệ (chỉ danh mục đang Hoạt động).",
      });
    }

    const doc = await SettingWebsiteInfo.findOne({}).lean();
    const current = normalizeSection4CategoryIds(doc);
    const merged = [...new Set([...current, ...validNew])].slice(
      0,
      MAX_SECTION4_CATEGORIES
    );

    await SettingWebsiteInfo.updateOne(
      {},
      {
        $set: {
          categoryIdsSection4: merged,
          categoryIdSection4: merged[0] || "",
        },
      }
    );

    return res.json({
      code: "success",
      message: `Đã cập nhật. Hiện có ${merged.length} danh mục trên Section 4 (tối đa ${MAX_SECTION4_CATEGORIES}).`,
    });
  } catch (e) {
    console.error("mergeSection4Categories:", e);
    return res.json({ code: "error", message: "Có lỗi xảy ra!" });
  }
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
        "fullName email phone role positionCompany status avatar companyId createdAt tabAccessScope"
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
      item.tabAccessScopeLabel = tabAccessScopeLabel(
        item.tabAccessScope || "inherit"
      );
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
    tabAccessScopeOptions: module.exports.TAB_ACCESS_SCOPE_OPTIONS,
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

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(req.body.password, salt);

    const tabAccessScope = normalizeTabAccessScope(req.body.tabAccessScope);

    const payload = {
      fullName: req.body.fullName,
      email: req.body.email,
      phone: req.body.phone,
      role: req.body.role || undefined,
      positionCompany: req.body.positionCompany,
      status: req.body.status || "active",
      password: hashedPassword,
      avatar: req.file ? req.file.path : "",
      createdBy: String(req.account.id),
      updatedBy: String(req.account.id),
      isSuperAdmin: false,
      tabAccessScope,
    };

    if (req.account.companyId) {
      const cid = mongoose.Types.ObjectId.isValid(String(req.account.companyId))
        ? new mongoose.Types.ObjectId(String(req.account.companyId))
        : req.account.companyId;
      payload.companyId = cid;
    }

    await AccountAdmin.create(payload);

    res.json({
      code: "success",
      message: "Tạo tài khoản thành công!",
    });
  } catch (error) {
    console.error("accountAdminCreatePost", error);
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
      tabAccessScopeOptions: module.exports.TAB_ACCESS_SCOPE_OPTIONS,
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
    delete req.body.isSuperAdmin;

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

    if (req.body.tabAccessScope !== undefined) {
      req.body.tabAccessScope = normalizeTabAccessScope(req.body.tabAccessScope);
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
