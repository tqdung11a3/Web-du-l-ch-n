// controllers/admin/super-admin/notification.controller.js
const Notification = require("../../../models/notification.model");
const Company = require("../../../models/company.model");
const moment = require("moment");
const auditLogHelper = require("../../../helpers/audit-log.helper");

/**
 * GET /admin/super-admin/notifications
 */
module.exports.list = async (req, res) => {
  try {
    const companyFilter = req.query.companyId || "";
    const typeFilter = req.query.type || "";
    const keyword = req.query.keyword || "";

    const filter = { deleted: false };
    if (companyFilter) filter.companyId = companyFilter;
    if (typeFilter) filter.type = typeFilter;
    if (keyword) {
      filter.$or = [
        { title: new RegExp(keyword, "i") },
        { content: new RegExp(keyword, "i") },
      ];
    }

    const limitItems = 20;
    const page =
      req.query.page && parseInt(req.query.page, 10) > 0
        ? parseInt(req.query.page, 10)
        : 1;
    const skip = (page - 1) * limitItems;

    const totalRecord = await Notification.countDocuments(filter);
    const items = await Notification.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitItems)
      .lean();

    const companyIds = [
      ...new Set(items.map((it) => String(it.companyId)).filter(Boolean)),
    ];
    const companies = await Company.find({ _id: { $in: companyIds } })
      .select("_id name")
      .lean();
    const coMap = Object.fromEntries(
      companies.map((c) => [String(c._id), c.name])
    );

    for (const it of items) {
      it.companyName = coMap[String(it.companyId)] || "(đã xoá)";
      it.createdAtFormat = moment(it.createdAt).format("HH:mm - DD/MM/YYYY");
    }

    const totalPage = Math.ceil(totalRecord / limitItems) || 1;
    const pagination = {
      currentPage: page,
      limitItems,
      skip,
      totalRecord,
      totalPage,
    };

    const allCompanies = await Company.find({ deleted: false })
      .select("_id name")
      .sort({ name: 1 })
      .lean();

    res.render("admin/pages/super-admin/notification-list", {
      pageTitle: "Trung tâm thông báo",
      items,
      pagination,
      allCompanies,
      companyFilter,
      typeFilter,
      keyword,
    });
  } catch (error) {
    console.error("Super Admin Notification List Error:", error);
    res.status(500).send("Có lỗi xảy ra!");
  }
};

/**
 * GET /admin/super-admin/notifications/broadcast
 */
module.exports.broadcastForm = async (req, res) => {
  try {
    const allCompanies = await Company.find({ deleted: false })
      .select("_id name")
      .sort({ name: 1 })
      .lean();
    res.render("admin/pages/super-admin/notification-broadcast", {
      pageTitle: "Gửi thông báo đến công ty",
      allCompanies,
    });
  } catch (error) {
    console.error("Super Admin Notification BroadcastForm Error:", error);
    res.status(500).send("Có lỗi xảy ra!");
  }
};

/**
 * POST /admin/super-admin/notifications/broadcast
 * body: { title, content, link?, type?, target: 'all'|'selected', companyIds?: [] }
 */
module.exports.broadcast = async (req, res) => {
  try {
    const { title, content, link, type, target, companyIds } = req.body;
    if (!title || !content) {
      return res.json({
        code: "error",
        message: "Vui lòng nhập tiêu đề và nội dung.",
      });
    }

    let targets = [];
    if (target === "selected" && Array.isArray(companyIds) && companyIds.length) {
      targets = companyIds;
    } else {
      const all = await Company.find({ deleted: false })
        .select("_id")
        .lean();
      targets = all.map((c) => c._id);
    }

    const docs = targets.map((cid) => ({
      companyId: cid,
      type: type || "other",
      title: title.trim(),
      content: content.trim(),
      link: link || "",
      isRead: false,
      deleted: false,
    }));

    if (docs.length) await Notification.insertMany(docs);

    await auditLogHelper.log(req, {
      action: "notification.broadcast",
      resourceType: "Notification",
      metadata: {
        count: docs.length,
        target,
        title,
      },
    });

    res.json({
      code: "success",
      message: `Đã gửi thông báo đến ${docs.length} công ty!`,
    });
  } catch (error) {
    console.error("Super Admin Notification Broadcast Error:", error);
    res.json({ code: "error", message: "Có lỗi xảy ra!" });
  }
};

/**
 * DELETE /admin/super-admin/notifications/:id
 */
module.exports.remove = async (req, res) => {
  try {
    await Notification.updateOne(
      { _id: req.params.id },
      { deleted: true }
    );
    await auditLogHelper.log(req, {
      action: "notification.delete",
      resourceType: "Notification",
      resourceId: req.params.id,
    });
    res.json({ code: "success", message: "Đã xoá!" });
  } catch (error) {
    console.error("Super Admin Notification Remove Error:", error);
    res.json({ code: "error", message: "Có lỗi xảy ra!" });
  }
};
