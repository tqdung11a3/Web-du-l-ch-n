const SettingWebsiteInfo = require("../../models/setting-website-info.model");
const { pathAdmin } = require("../../config/variable.config");
const bcrypt = require("bcryptjs");
const AccountAdmin = require("../../models/account-admin.model");
const mongoose = require("mongoose");
const Category = require("../../models/category.model");
const Hotel = require("../../models/hotel.model");
const categoryHelper = require("../../helpers/category.helper");
const {
  normalizeSection4CategoryIds,
  MAX_SECTION4_CATEGORIES,
} = require("../../helpers/website-setting-section4.helper");

const TAB_ACCESS_SCOPES = [
  "inherit",
  "full",
  "tour_only",
  "hotel_only",
  "tour_staff",
  "hotel_staff",
];

module.exports.TAB_ACCESS_SCOPE_OPTIONS = [
  { value: "inherit", label: "Toàn quyền" },
  { value: "tour_only", label: "Quản trị viên tour" },
  { value: "hotel_only", label: "Quản trị viên khách sạn" },
  { value: "tour_staff", label: "Nhân viên Tour" },
  { value: "hotel_staff", label: "Nhân viên Khách sạn" },
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
    tour_staff: "Nhân viên Tour",
    hotel_staff: "Nhân viên KS",
  };
  return map[scope] || map.inherit;
}

function isTourAdminScope(account) {
  return (
    account &&
    !account.isSuperAdmin &&
    (account.tabAccessScope || "inherit") === "tour_only"
  );
}

function isHotelAdminScope(account) {
  return (
    account &&
    !account.isSuperAdmin &&
    (account.tabAccessScope || "inherit") === "hotel_only"
  );
}

function isStaffTabScope(account) {
  const s = account?.tabAccessScope || "inherit";
  return s === "tour_staff" || s === "hotel_staff";
}

/** Quản trị viên tour/KS: chỉ quản lý chính mình + nhân viên tương ứng */
function canManageAccountAdminRecord(actor, target) {
  if (!actor || !target) return false;
  if (actor.isSuperAdmin) return true;
  const targetScope = target.tabAccessScope || "inherit";
  const actorId = String(actor._id || actor.id);
  const targetId = String(target._id || target.id);
  if (isTourAdminScope(actor)) {
    return actorId === targetId || targetScope === "tour_staff";
  }
  if (isHotelAdminScope(actor)) {
    return actorId === targetId || targetScope === "hotel_staff";
  }
  return true;
}

function tabAccessScopeOptionsForActor(actor, targetAccount) {
  const all = module.exports.TAB_ACCESS_SCOPE_OPTIONS;
  if (!actor || actor.isSuperAdmin) return all;
  if (isTourAdminScope(actor)) {
    const tid = String(actor._id || actor.id);
    const targetId = String(targetAccount._id || targetAccount.id);
    if (tid === targetId) {
      return all.filter((o) => o.value === "tour_only");
    }
    return all.filter((o) => o.value === "tour_staff");
  }
  if (isHotelAdminScope(actor)) {
    const tid = String(actor._id || actor.id);
    const targetId = String(targetAccount._id || targetAccount.id);
    if (tid === targetId) {
      return all.filter((o) => o.value === "hotel_only");
    }
    return all.filter((o) => o.value === "hotel_staff");
  }
  return all;
}

function defaultSelectedScopeForCreate(actor) {
  if (isTourAdminScope(actor)) return "tour_staff";
  if (isHotelAdminScope(actor)) return "hotel_staff";
  return "inherit";
}

function respondAccountAdminForbidden(req, res) {
  const wantsJSON =
    req.xhr ||
    (req.headers.accept && req.headers.accept.includes("application/json"));
  if (wantsJSON) {
    return res.status(403).json({
      code: "error",
      message: "Bạn không có quyền truy cập chức năng này!",
    });
  }
  return res.status(403).render("admin/pages/error-403", {
    pageTitle: "403 Forbidden",
    message: "Bạn không có quyền truy cập chức năng này!",
  });
}

module.exports.list = async (req, res) => {
  const hideAccountAdminTile =
    req.account &&
    !req.account.isSuperAdmin &&
    isStaffTabScope(req.account);

  res.render("admin/pages/setting-list", {
    pageTitle: "Cài đặt chung",
    hideAccountAdminTile,
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
    const actor = req.account;
    if (actor && !actor.isSuperAdmin && isStaffTabScope(actor)) {
      return respondAccountAdminForbidden(req, res);
    }

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

    const listQuery = {
      deleted: false,
      companyId,
    };

    // Quản trị viên tour / KS: chỉ thấy chính họ + nhân viên tương ứng
    if (actor && !actor.isSuperAdmin) {
      const s = actor.tabAccessScope || "inherit";
      if (s === "tour_only") {
        listQuery.$or = [
          { _id: actor._id },
          { tabAccessScope: "tour_staff" },
        ];
      } else if (s === "hotel_only") {
        listQuery.$or = [
          { _id: actor._id },
          { tabAccessScope: "hotel_staff" },
        ];
      }
    }

    // Chỉ lấy admin thuộc công ty của người đang đăng nhập
    const accountAdminList = await AccountAdmin.find(listQuery)
      .sort({ createdAt: "desc" })
      .select(
        "fullName email phone positionCompany status avatar companyId createdAt tabAccessScope assignedHotelId"
      )
      .lean();

    const assignHotelIds = [
      ...new Set(
        accountAdminList
          .filter((a) => a.tabAccessScope === "hotel_staff" && a.assignedHotelId)
          .map((a) => String(a.assignedHotelId))
      ),
    ];
    let hotelNameMap = {};
    if (assignHotelIds.length) {
      const hotels = await Hotel.find({ _id: { $in: assignHotelIds } })
        .select("_id name")
        .lean();
      hotelNameMap = Object.fromEntries(
        hotels.map((h) => [String(h._id), h.name || ""])
      );
    }

    for (const item of accountAdminList) {
      item.tabAccessScopeLabel = tabAccessScopeLabel(
        item.tabAccessScope || "inherit"
      );
      if (
        item.tabAccessScope === "hotel_staff" &&
        item.assignedHotelId &&
        hotelNameMap[String(item.assignedHotelId)]
      ) {
        item.tabAccessScopeLabel += ` → ${hotelNameMap[String(item.assignedHotelId)]}`;
      }
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
  if (req.account && !req.account.isSuperAdmin && isStaffTabScope(req.account)) {
    return respondAccountAdminForbidden(req, res);
  }

  let companyHotels = [];
  if (req.account?.companyId) {
    companyHotels = await Hotel.find({
      companyId: req.account.companyId,
      deleted: { $ne: true },
    })
      .select("_id name")
      .sort({ name: 1 })
      .lean();
  }

  let tabAccessScopeOptions = module.exports.TAB_ACCESS_SCOPE_OPTIONS;
  if (isTourAdminScope(req.account)) {
    tabAccessScopeOptions = module.exports.TAB_ACCESS_SCOPE_OPTIONS.filter(
      (o) => o.value === "tour_staff"
    );
  } else if (isHotelAdminScope(req.account)) {
    tabAccessScopeOptions = module.exports.TAB_ACCESS_SCOPE_OPTIONS.filter(
      (o) => o.value === "hotel_staff"
    );
  }

  res.render("admin/pages/setting-account-admin-create", {
    pageTitle: "Tạo tài khoản quản trị",
    tabAccessScopeOptions,
    tabAccessScopeDefault: defaultSelectedScopeForCreate(req.account),
    companyHotels,
  });
};

module.exports.accountAdminCreatePost = async (req, res) => {
  try {
    if (req.account && !req.account.isSuperAdmin && isStaffTabScope(req.account)) {
      return res.json({
        code: "error",
        message: "Bạn không có quyền thực hiện thao tác này!",
      });
    }

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

    if (isTourAdminScope(req.account) && tabAccessScope !== "tour_staff") {
      return res.json({
        code: "error",
        message: "Bạn chỉ được tạo tài khoản Nhân viên Tour.",
      });
    }
    if (isHotelAdminScope(req.account) && tabAccessScope !== "hotel_staff") {
      return res.json({
        code: "error",
        message: "Bạn chỉ được tạo tài khoản Nhân viên Khách sạn.",
      });
    }

    let assignedHotelId = null;
    if (tabAccessScope === "hotel_staff") {
      const hid = req.body.assignedHotelId;
      if (!hid || !mongoose.Types.ObjectId.isValid(String(hid))) {
        return res.json({
          code: "error",
          message: "Vui lòng chọn khách sạn cho nhân viên khách sạn.",
        });
      }
      const cid = mongoose.Types.ObjectId.isValid(String(req.account.companyId))
        ? new mongoose.Types.ObjectId(String(req.account.companyId))
        : req.account.companyId;
      const hotelOk = await Hotel.findOne({
        _id: hid,
        companyId: cid,
        deleted: { $ne: true },
      })
        .select("_id")
        .lean();
      if (!hotelOk) {
        return res.json({
          code: "error",
          message: "Khách sạn không thuộc công ty của bạn hoặc không hợp lệ.",
        });
      }
      assignedHotelId = new mongoose.Types.ObjectId(String(hid));
    }

    const payload = {
      fullName: req.body.fullName,
      email: req.body.email,
      phone: req.body.phone,
      positionCompany: req.body.positionCompany,
      status: req.body.status || "active",
      password: hashedPassword,
      avatar: req.file ? req.file.path : "",
      createdBy: String(req.account.id),
      updatedBy: String(req.account.id),
      isSuperAdmin: false,
      tabAccessScope,
      assignedHotelId,
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

module.exports.accountAdminEdit = async (req, res) => {
  try {
    if (req.account && !req.account.isSuperAdmin && isStaffTabScope(req.account)) {
      return respondAccountAdminForbidden(req, res);
    }

    const id = req.params.id;
    const rawCid = req.account?.companyId;

    // ép kiểu companyId (ObjectId hoặc String tuỳ schema hiện tại)
    const companyId = mongoose.Types.ObjectId.isValid(String(rawCid))
      ? new mongoose.Types.ObjectId(String(rawCid))
      : String(rawCid);

    const baseFind = { _id: id, deleted: false, companyId };

    const accountDetail = await AccountAdmin.findOne(baseFind);
    if (!accountDetail) {
      return res.redirect(`/${pathAdmin}/setting/account-admin/list`);
    }

    if (!canManageAccountAdminRecord(req.account, accountDetail)) {
      return res.redirect(`/${pathAdmin}/setting/account-admin/list`);
    }

    let companyHotels = [];
    if (req.account?.companyId) {
      companyHotels = await Hotel.find({
        companyId: req.account.companyId,
        deleted: { $ne: true },
      })
        .select("_id name")
        .sort({ name: 1 })
        .lean();
    }

    const tabAccessScopeOptions = tabAccessScopeOptionsForActor(
      req.account,
      accountDetail
    );

    return res.render("admin/pages/setting-account-admin-edit", {
      pageTitle: "Chỉnh sửa tài khoản quản trị",
      accountDetail,
      tabAccessScopeOptions,
      companyHotels,
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

    const baseFind = { _id: id, deleted: false, companyId };

    const accountDetail = await AccountAdmin.findOne(baseFind);
    if (!accountDetail) {
      return res.json({ code: "error", message: "Bản ghi không tồn tại!" });
    }

    if (req.account && !req.account.isSuperAdmin && isStaffTabScope(req.account)) {
      return res.json({
        code: "error",
        message: "Bạn không có quyền thực hiện thao tác này!",
      });
    }
    if (!canManageAccountAdminRecord(req.account, accountDetail)) {
      return res.json({
        code: "error",
        message: "Bạn không có quyền chỉnh sửa tài khoản này!",
      });
    }

    // Không cho sửa companyId từ client
    delete req.body.companyId;
    delete req.body.isSuperAdmin;
    delete req.body.id;

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

    const nextScope =
      req.body.tabAccessScope !== undefined
        ? req.body.tabAccessScope
        : String(accountDetail.tabAccessScope || "inherit");

    if (!req.account.isSuperAdmin) {
      if (isTourAdminScope(req.account)) {
        const isSelf = String(id) === String(req.account._id);
        if (isSelf) {
          if (nextScope !== "tour_only") {
            return res.json({
              code: "error",
              message: "Không thể đổi phân quyền của tài khoản này.",
            });
          }
        } else if (nextScope !== "tour_staff") {
          return res.json({
            code: "error",
            message: "Chỉ được phân quyền Nhân viên Tour cho tài khoản này.",
          });
        }
      } else if (isHotelAdminScope(req.account)) {
        const isSelf = String(id) === String(req.account._id);
        if (isSelf) {
          if (nextScope !== "hotel_only") {
            return res.json({
              code: "error",
              message: "Không thể đổi phân quyền của tài khoản này.",
            });
          }
        } else if (nextScope !== "hotel_staff") {
          return res.json({
            code: "error",
            message: "Chỉ được phân quyền Nhân viên Khách sạn cho tài khoản này.",
          });
        }
      }
    }

    if (nextScope === "hotel_staff") {
      let hid = req.body.assignedHotelId;
      if (hid === undefined || hid === "" || hid === null) {
        hid = accountDetail.assignedHotelId;
      }
      if (!hid || !mongoose.Types.ObjectId.isValid(String(hid))) {
        return res.json({
          code: "error",
          message: "Vui lòng chọn khách sạn cho nhân viên khách sạn.",
        });
      }
      const hotelOk = await Hotel.findOne({
        _id: hid,
        companyId: accountDetail.companyId,
        deleted: { $ne: true },
      })
        .select("_id")
        .lean();
      if (!hotelOk) {
        return res.json({
          code: "error",
          message: "Khách sạn không thuộc công ty hoặc không hợp lệ.",
        });
      }
      req.body.assignedHotelId = new mongoose.Types.ObjectId(String(hid));
    } else {
      req.body.assignedHotelId = null;
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
