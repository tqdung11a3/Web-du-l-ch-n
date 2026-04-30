// controllers/admin/super-admin/contact.controller.js
const Contact = require("../../../models/contact.model");
const AccountAdmin = require("../../../models/account-admin.model");
const moment = require("moment");

/**
 * GET /admin/super-admin/contacts
 */
module.exports.list = async (req, res) => {
  try {
    const filter = { deleted: false };

    if (req.query.keyword) {
      filter.email = new RegExp(req.query.keyword, "i");
    }

    if (req.query.handled === "yes") filter.handled = true;
    if (req.query.handled === "no") filter.handled = { $ne: true };

    if (req.query.startDate) {
      filter.createdAt = filter.createdAt || {};
      filter.createdAt.$gte = moment(req.query.startDate).startOf("day").toDate();
    }
    if (req.query.endDate) {
      filter.createdAt = filter.createdAt || {};
      filter.createdAt.$lte = moment(req.query.endDate).endOf("day").toDate();
    }

    const limitItems = 20;
    let page = 1;
    if (req.query.page && parseInt(req.query.page, 10) > 0) {
      page = parseInt(req.query.page, 10);
    }
    const skip = (page - 1) * limitItems;
    const totalRecord = await Contact.countDocuments(filter);
    const totalPage = Math.ceil(totalRecord / limitItems) || 1;
    const pagination = {
      currentPage: page,
      limitItems,
      skip,
      totalRecord,
      totalPage,
    };

    const items = await Contact.find(filter)
      .sort({ createdAt: -1 })
      .limit(limitItems)
      .skip(skip)
      .lean();

    for (const it of items) {
      it.createdAtFormat = moment(it.createdAt).format("HH:mm - DD/MM/YYYY");
      if (it.handled && it.handledBy) {
        const ad = await AccountAdmin.findById(it.handledBy)
          .select("fullName")
          .lean();
        it.handledByName = ad ? ad.fullName : "";
      }
    }

    res.render("admin/pages/super-admin/contact-list", {
      pageTitle: "Trung tâm liên hệ",
      items,
      pagination,
      keyword: req.query.keyword || "",
      handled: req.query.handled || "",
      startDate: req.query.startDate || "",
      endDate: req.query.endDate || "",
    });
  } catch (error) {
    console.error("Super Admin Contact List Error:", error);
    res.status(500).send("Có lỗi xảy ra!");
  }
};

/**
 * PATCH /admin/super-admin/contacts/mark-handled
 * body: { id, handled: boolean, note? }
 */
module.exports.markHandled = async (req, res) => {
  try {
    const { id, handled, note } = req.body;
    const update = {
      handled: !!handled,
    };
    if (handled) {
      update.handledBy = req.account.id;
      update.handledAt = new Date();
    } else {
      update.handledBy = "";
      update.handledAt = null;
    }
    if (typeof note === "string") update.note = note;
    await Contact.updateOne({ _id: id }, update);
    const auditLogHelper = require("../../../helpers/audit-log.helper");
    await auditLogHelper.log(req, {
      action: handled ? "contact.mark-handled" : "contact.mark-unhandled",
      resourceType: "Contact",
      resourceId: id,
      metadata: { note },
    });
    res.json({ code: "success", message: "Cập nhật thành công!" });
  } catch (error) {
    console.error("Super Admin Contact markHandled Error:", error);
    res.json({ code: "error", message: "Có lỗi xảy ra!" });
  }
};

/**
 * DELETE /admin/super-admin/contacts/:id
 */
module.exports.remove = async (req, res) => {
  try {
    const id = req.params.id;
    await Contact.updateOne(
      { _id: id },
      {
        deleted: true,
        deletedAt: new Date(),
        deletedBy: req.account.id,
      }
    );
    const auditLogHelper = require("../../../helpers/audit-log.helper");
    await auditLogHelper.log(req, {
      action: "contact.delete",
      resourceType: "Contact",
      resourceId: id,
    });
    res.json({ code: "success", message: "Đã xóa!" });
  } catch (error) {
    console.error("Super Admin Contact delete Error:", error);
    res.json({ code: "error", message: "Có lỗi xảy ra!" });
  }
};
