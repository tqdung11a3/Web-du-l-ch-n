// controllers/admin/super-admin/review.controller.js
const Review = require("../../../models/review.model");
const HotelReview = require("../../../models/hotel-review.model");
const Tour = require("../../../models/tour.model");
const Hotel = require("../../../models/hotel.model");
const Company = require("../../../models/company.model");
const AccountUser = require("../../../models/account-user.model");
const moment = require("moment");
const auditLogHelper = require("../../../helpers/audit-log.helper");

/**
 * Trang danh sách review, tab = 'tour' | 'hotel' (mặc định tour)
 * GET /admin/super-admin/reviews
 */
module.exports.list = async (req, res) => {
  try {
    const tab = req.query.tab === "hotel" ? "hotel" : "tour";
    const keyword = req.query.keyword || "";
    const hiddenFilter = req.query.hidden || ""; // "only" | "no" | ""
    const ratingFilter = req.query.rating || "";
    const companyFilter = req.query.companyId || "";

    const limitItems = 20;
    const page =
      req.query.page && parseInt(req.query.page, 10) > 0
        ? parseInt(req.query.page, 10)
        : 1;
    const skip = (page - 1) * limitItems;

    const companies = await Company.find({ deleted: false })
      .select("_id name")
      .sort({ name: 1 })
      .lean();

    // Lấy danh sách id tour/hotel của công ty (nếu có filter)
    let scopedIds = null;
    if (companyFilter) {
      if (tab === "tour") {
        const tours = await Tour.find({ companyId: companyFilter })
          .select("_id")
          .lean();
        scopedIds = tours.map((t) => t._id);
      } else {
        const hotels = await Hotel.find({ companyId: companyFilter })
          .select("_id")
          .lean();
        scopedIds = hotels.map((h) => h._id);
      }
    }

    const filter = { deleted: false };
    if (hiddenFilter === "only") filter.hiddenBySuperAdmin = true;
    else if (hiddenFilter === "no") filter.hiddenBySuperAdmin = { $ne: true };
    if (keyword) {
      filter.$or = [
        { userName: new RegExp(keyword, "i") },
        { content: new RegExp(keyword, "i") },
      ];
    }

    let items = [];
    let totalRecord = 0;

    if (tab === "tour") {
      const ratingNum = parseInt(ratingFilter, 10);
      if (ratingNum >= 1 && ratingNum <= 5) filter.rating = ratingNum;
      if (scopedIds) filter.tourId = { $in: scopedIds };
      totalRecord = await Review.countDocuments(filter);
      items = await Review.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitItems)
        .lean();
      // Join tour + company names
      const tourIds = [...new Set(items.map((it) => String(it.tourId)))];
      const tours = await Tour.find({ _id: { $in: tourIds } })
        .select("_id name companyId")
        .lean();
      const tourMap = Object.fromEntries(tours.map((t) => [String(t._id), t]));
      const companyIds = [
        ...new Set(tours.map((t) => String(t.companyId)).filter(Boolean)),
      ];
      const cos = await Company.find({ _id: { $in: companyIds } })
        .select("_id name")
        .lean();
      const coMap = Object.fromEntries(cos.map((c) => [String(c._id), c.name]));
      for (const it of items) {
        const t = tourMap[String(it.tourId)];
        it.tourTitle = t
          ? t.name || t.title || "(chưa đặt tên)"
          : "(tour đã xoá)";
        it.companyName = t ? coMap[String(t.companyId)] || "" : "";
        it.createdAtFormat = moment(it.createdAt).format("HH:mm - DD/MM/YYYY");
      }
    } else {
      const ratingNum = parseFloat(ratingFilter);
      if (!isNaN(ratingNum)) filter.ratingOverall = { $gte: ratingNum };
      if (scopedIds) filter.hotelId = { $in: scopedIds };
      totalRecord = await HotelReview.countDocuments(filter);
      items = await HotelReview.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitItems)
        .lean();
      const hotelIds = [...new Set(items.map((it) => String(it.hotelId)))];
      const hotels = await Hotel.find({ _id: { $in: hotelIds } })
        .select("_id name companyId")
        .lean();
      const hotelMap = Object.fromEntries(
        hotels.map((h) => [String(h._id), h])
      );
      const companyIds = [
        ...new Set(hotels.map((h) => String(h.companyId)).filter(Boolean)),
      ];
      const cos = await Company.find({ _id: { $in: companyIds } })
        .select("_id name")
        .lean();
      const coMap = Object.fromEntries(cos.map((c) => [String(c._id), c.name]));
      for (const it of items) {
        const h = hotelMap[String(it.hotelId)];
        it.hotelName = h ? h.name : "(khách sạn đã xoá)";
        it.companyName = h ? coMap[String(h.companyId)] || "" : "";
        it.rating = it.ratingOverall;
        it.createdAtFormat = moment(it.createdAt).format("HH:mm - DD/MM/YYYY");
      }
    }

    const totalPage = Math.ceil(totalRecord / limitItems) || 1;
    const pagination = {
      currentPage: page,
      limitItems,
      skip,
      totalRecord,
      totalPage,
    };

    res.render("admin/pages/super-admin/review-list", {
      pageTitle: "Kiểm duyệt đánh giá",
      tab,
      items,
      pagination,
      companies,
      keyword,
      hiddenFilter,
      ratingFilter,
      companyFilter,
    });
  } catch (error) {
    console.error("Super Admin Review List Error:", error);
    res.status(500).send("Có lỗi xảy ra!");
  }
};

/**
 * PATCH /admin/super-admin/reviews/toggle-hidden
 * body: { tab: 'tour'|'hotel', id, hidden: bool, reason? }
 */
module.exports.toggleHidden = async (req, res) => {
  try {
    const { tab, id, hidden, reason } = req.body;
    const Model = tab === "hotel" ? HotelReview : Review;
    const update = {
      hiddenBySuperAdmin: !!hidden,
    };
    if (hidden) {
      update.hiddenBy = req.account.id;
      update.hiddenAt = new Date();
      update.hiddenReason = reason || "";
    } else {
      update.hiddenBy = "";
      update.hiddenAt = null;
      update.hiddenReason = "";
    }
    await Model.updateOne({ _id: id }, update);
    await auditLogHelper.log(req, {
      action: hidden ? "review.hide" : "review.unhide",
      resourceType: tab === "hotel" ? "HotelReview" : "Review",
      resourceId: id,
      metadata: { reason },
    });
    res.json({ code: "success", message: "Cập nhật thành công!" });
  } catch (error) {
    console.error("Super Admin review toggleHidden Error:", error);
    res.json({ code: "error", message: "Có lỗi xảy ra!" });
  }
};

/**
 * DELETE /admin/super-admin/reviews/:tab/:id
 */
module.exports.remove = async (req, res) => {
  try {
    const { tab, id } = req.params;
    const Model = tab === "hotel" ? HotelReview : Review;
    await Model.updateOne({ _id: id }, { deleted: true });
    await auditLogHelper.log(req, {
      action: "review.delete",
      resourceType: tab === "hotel" ? "HotelReview" : "Review",
      resourceId: id,
    });
    res.json({ code: "success", message: "Đã xoá đánh giá!" });
  } catch (error) {
    console.error("Super Admin review delete Error:", error);
    res.json({ code: "error", message: "Có lỗi xảy ra!" });
  }
};
