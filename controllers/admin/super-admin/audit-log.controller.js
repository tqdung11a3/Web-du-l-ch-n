// controllers/admin/super-admin/audit-log.controller.js
const mongoose = require("mongoose");
const AuditLog = require("../../../models/audit-log.model");
const Company = require("../../../models/company.model");
const moment = require("moment");
const metadataHumanHelper = require("../../../helpers/audit-log-metadata-human.helper");

/* ──────────────────────────────────────────────────────────────
 * Danh sách hành động "biết trước" để render filter & label.
 * Các hành động mới sẽ tự động hiện khi có dữ liệu (xem DISTINCT ở dưới),
 * nhưng những action ở đây luôn xuất hiện cùng nhãn tiếng Việt.
 * ────────────────────────────────────────────────────────────── */
const KNOWN_ACTIONS = [
  // Super admin
  "company.change-status",
  "company.delete",
  "admin.approve",
  "admin.reject",
  "admin.create",
  "admin.update",
  "admin.delete",
  "role.create",
  "role.update",
  "role.delete",
  "setting.website-info.update",
  "contact.mark-handled",
  "contact.mark-unhandled",
  "contact.delete",
  "review.hide",
  "review.unhide",
  "review.delete",
  "notification.broadcast",
  "notification.delete",
  "hotel-link-request.force-cancel",
  "override.tour.update",
  "override.hotel.update",
  "override.order.update",
  "override.hotel-booking.update",

  // Company admin — Tour
  "tour.create",
  "tour.update",
  "tour.change-status",
  "tour.delete",

  // Company admin — Hotel / Room
  "hotel.create",
  "hotel.update",
  "hotel.delete",
  "hotel.room-type.update",
  "hotel-booking.update-status",

  // Company admin — Order
  "order.update",
  "order.cancel",
  "order.delete",

  // Company admin — Hotel link request
  "hotel-link-request.create",
  "hotel-link-request.accept",
  "hotel-link-request.reject",
  "hotel-link-request.cancel",

  // Customer
  "customer.order.create",
  "customer.hotel-booking.create",
  "customer.hotel-booking.cancel",
  "customer.review.create",
  "customer.hotel-review.create",
  "customer.contact.create",
];

const KNOWN_RESOURCES = [
  "Company",
  "AccountAdmin",
  "AccountUser",
  "Role",
  "SettingWebsiteInfo",
  "Contact",
  "Review",
  "HotelReview",
  "Notification",
  "HotelLinkRequest",
  "Tour",
  "Hotel",
  "Order",
  "HotelBooking",
];

/** Nhãn hiển thị tiếng Việt cho filter & bảng (value kỹ thuật giữ nguyên khi lọc). */
const ACTION_LABELS_VI = {
  // Super admin
  "company.change-status": "Đổi trạng thái công ty",
  "company.delete": "Xóa công ty",
  "admin.approve": "Duyệt tài khoản admin công ty",
  "admin.reject": "Từ chối tài khoản admin công ty",
  "admin.create": "Tạo tài khoản admin công ty",
  "admin.update": "Cập nhật tài khoản admin công ty",
  "admin.delete": "Xóa tài khoản admin công ty",
  "role.create": "Tạo vai trò (phân quyền)",
  "role.update": "Cập nhật vai trò",
  "role.delete": "Xóa vai trò",
  "setting.website-info.update": "Cập nhật thông tin website toàn hệ thống",
  "contact.mark-handled": "Liên hệ: đánh dấu đã xử lý",
  "contact.mark-unhandled": "Liên hệ: đánh dấu chưa xử lý",
  "contact.delete": "Xóa liên hệ",
  "review.hide": "Ẩn đánh giá (kiểm duyệt)",
  "review.unhide": "Bỏ ẩn đánh giá",
  "review.delete": "Xóa đánh giá",
  "notification.broadcast": "Gửi thông báo hàng loạt",
  "notification.delete": "Xóa thông báo",
  "hotel-link-request.force-cancel": "Liên kết tour–KS: hủy cưỡng chế",
  "override.tour.update": "Super Admin — sửa tour (thay công ty)",
  "override.hotel.update": "Super Admin — sửa khách sạn (thay công ty)",
  "override.order.update": "Super Admin — sửa đơn tour (thay công ty)",
  "override.hotel-booking.update":
    "Super Admin — cập nhật đặt phòng (thay công ty)",

  // Company admin
  "tour.create": "Tạo tour mới",
  "tour.update": "Cập nhật tour",
  "tour.change-status": "Đổi trạng thái tour",
  "tour.delete": "Xóa tour",
  "hotel.create": "Tạo khách sạn",
  "hotel.update": "Cập nhật khách sạn",
  "hotel.delete": "Xóa khách sạn",
  "hotel.room-type.update": "Cập nhật loại phòng / giá phòng",
  "hotel-booking.update-status": "Cập nhật trạng thái đặt phòng",
  "order.update": "Cập nhật đơn hàng tour",
  "order.cancel": "Hủy đơn hàng tour",
  "order.delete": "Xóa đơn hàng tour",
  "hotel-link-request.create": "Gửi yêu cầu liên kết tour–khách sạn",
  "hotel-link-request.accept": "Chấp nhận yêu cầu liên kết",
  "hotel-link-request.reject": "Từ chối yêu cầu liên kết",
  "hotel-link-request.cancel": "Hủy yêu cầu liên kết",

  // Customer
  "customer.order.create": "Khách đặt tour",
  "customer.hotel-booking.create": "Khách đặt phòng khách sạn",
  "customer.hotel-booking.cancel": "Khách hủy đặt phòng",
  "customer.review.create": "Khách viết đánh giá tour",
  "customer.hotel-review.create": "Khách viết đánh giá khách sạn",
  "customer.contact.create": "Khách gửi liên hệ",
};

const RESOURCE_LABELS_VI = {
  Company: "Công ty",
  AccountAdmin: "Tài khoản admin",
  AccountUser: "Tài khoản khách",
  Role: "Vai trò (phân quyền)",
  SettingWebsiteInfo: "Cài đặt thông tin website",
  Contact: "Liên hệ khách",
  Review: "Đánh giá tour",
  HotelReview: "Đánh giá khách sạn",
  Notification: "Thông báo",
  HotelLinkRequest: "Yêu cầu liên kết tour–khách sạn",
  Tour: "Tour",
  Hotel: "Khách sạn",
  Order: "Đơn hàng tour",
  HotelBooking: "Đặt phòng khách sạn",
};

const ROLE_LABELS_VI = {
  super_admin: "Super Admin",
  company_admin: "Company Admin",
  customer: "Khách hàng",
  system: "Hệ thống",
};

function actionLabelVi(action) {
  if (!action) return "";
  return ACTION_LABELS_VI[action] || action;
}
function resourceLabelVi(type) {
  if (!type) return "";
  return RESOURCE_LABELS_VI[type] || type;
}
function roleLabelVi(role) {
  if (!role) return "";
  return ROLE_LABELS_VI[role] || role;
}

/**
 * GET .../super-admin/audit  (alias: .../super-admin/audit-logs)
 */
module.exports.list = async (req, res) => {
  try {
    const filter = {};

    if (req.query.action) filter.action = req.query.action;
    if (req.query.resourceType) filter.resourceType = req.query.resourceType;
    if (req.query.actorRole) filter.actorRole = req.query.actorRole;

    if (req.query.actorId && mongoose.Types.ObjectId.isValid(req.query.actorId)) {
      filter.actorId = new mongoose.Types.ObjectId(req.query.actorId);
    }
    if (
      req.query.actorCompanyId &&
      mongoose.Types.ObjectId.isValid(req.query.actorCompanyId)
    ) {
      filter.actorCompanyId = new mongoose.Types.ObjectId(
        req.query.actorCompanyId
      );
    }
    if (
      req.query.asCompanyId &&
      mongoose.Types.ObjectId.isValid(req.query.asCompanyId)
    ) {
      filter.asCompanyId = new mongoose.Types.ObjectId(req.query.asCompanyId);
    }

    if (req.query.startDate || req.query.endDate) {
      filter.createdAt = {};
      if (req.query.startDate)
        filter.createdAt.$gte = moment(req.query.startDate)
          .startOf("day")
          .toDate();
      if (req.query.endDate)
        filter.createdAt.$lte = moment(req.query.endDate).endOf("day").toDate();
    }

    if (req.query.keyword) {
      const kw = String(req.query.keyword).trim();
      if (kw) {
        const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const rx = new RegExp(escaped, "i");
        filter.$or = [
          { actorName: rx },
          { actorEmail: rx },
          { resourceLabel: rx },
          { resourceId: rx },
          { summary: rx },
        ];
      }
    }

    const limitItems = 15;
    const page =
      req.query.page && parseInt(req.query.page, 10) > 0
        ? parseInt(req.query.page, 10)
        : 1;
    const skip = (page - 1) * limitItems;

    const totalRecord = await AuditLog.countDocuments(filter);
    const items = await AuditLog.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitItems)
      .lean();

    for (const it of items) {
      it.createdAtFormat = moment(it.createdAt).format("HH:mm:ss - DD/MM/YYYY");
    }

    // Lấy tên công ty (của actor & của "as")
    const companyIds = [
      ...new Set(
        items
          .flatMap((it) => [
            String(it.asCompanyId || ""),
            String(it.actorCompanyId || ""),
          ])
          .filter(Boolean)
      ),
    ];
    const cos = companyIds.length
      ? await Company.find({ _id: { $in: companyIds } })
          .select("_id name")
          .lean()
      : [];
    const coMap = Object.fromEntries(cos.map((c) => [String(c._id), c.name]));

    for (const it of items) {
      if (it.asCompanyId) it.asCompanyName = coMap[String(it.asCompanyId)];
      if (it.actorCompanyId)
        it.actorCompanyName = coMap[String(it.actorCompanyId)];
      it.actionLabelVi = actionLabelVi(it.action);
      it.resourceTypeLabelVi = resourceLabelVi(it.resourceType);
      it.actorRoleLabelVi = roleLabelVi(it.actorRole);
      it.metadataHuman = metadataHumanHelper.metadataToHumanLines(
        it.action,
        it.metadata
      );

      // Build tóm tắt khi summary trống
      if (!it.summary) {
        const who =
          it.actorName +
          (it.actorRole ? ` (${roleLabelVi(it.actorRole)})` : "");
        const what = actionLabelVi(it.action);
        const obj = it.resourceLabel
          ? ` — ${it.resourceLabel}`
          : it.resourceType
          ? ` — ${resourceLabelVi(it.resourceType)}`
          : "";
        it._autoSummary = `${who} → ${what}${obj}`;
      }
    }

    const allCompanies = await Company.find({ deleted: false })
      .select("_id name")
      .sort({ name: 1 })
      .lean();

    // Distinct các action đã có trong DB (để filter đầy đủ kể cả action mới)
    const dbActions = await AuditLog.distinct("action");
    const dbResources = await AuditLog.distinct("resourceType");
    const mergedActions = Array.from(
      new Set([...KNOWN_ACTIONS, ...dbActions.filter(Boolean)])
    );
    const mergedResources = Array.from(
      new Set([...KNOWN_RESOURCES, ...dbResources.filter(Boolean)])
    );

    const totalPage = Math.ceil(totalRecord / limitItems) || 1;
    const pagination = {
      currentPage: page,
      limitItems,
      skip,
      totalRecord,
      totalPage,
    };

    res.render("admin/pages/super-admin/audit-log", {
      pageTitle: "Nhật ký thao tác (Audit log)",
      items,
      pagination,
      allCompanies,
      knownActions: mergedActions,
      knownResources: mergedResources,
      knownRoles: ["super_admin", "company_admin", "customer"],
      actionLabelsVi: ACTION_LABELS_VI,
      resourceLabelsVi: RESOURCE_LABELS_VI,
      roleLabelsVi: ROLE_LABELS_VI,
      filters: {
        action: req.query.action || "",
        resourceType: req.query.resourceType || "",
        actorRole: req.query.actorRole || "",
        actorId: req.query.actorId || "",
        actorCompanyId: req.query.actorCompanyId || "",
        asCompanyId: req.query.asCompanyId || "",
        startDate: req.query.startDate || "",
        endDate: req.query.endDate || "",
        keyword: req.query.keyword || "",
      },
    });
  } catch (error) {
    console.error("Super Admin Audit Log Error:", error);
    res.status(500).send("Có lỗi xảy ra!");
  }
};
