// controllers/client/review.controller.js
const mongoose = require("mongoose");
const Review = require("../../models/review.model");
const Tour = require("../../models/tour.model");
const auditLogHelper = require("../../helpers/audit-log.helper");

// Tính lại ratingAvg & ratingCount cho 1 tour
async function recomputeTourRating(tourId) {
  const agg = await Review.aggregate([
    { $match: { tourId: new mongoose.Types.ObjectId(tourId), deleted: false } },
    {
      $group: { _id: "$tourId", count: { $sum: 1 }, avg: { $avg: "$rating" } },
    },
  ]);
  const stat = agg[0] || { count: 0, avg: 0 };
  await Tour.updateOne(
    { _id: tourId },
    {
      $set: {
        ratingCount: stat.count,
        ratingAvg: Math.round((stat.avg || 0) * 10) / 10,
      },
    }
  );
}

module.exports.list = async (req, res) => {
  try {
    const tourId = req.params.tourId;
    if (!mongoose.Types.ObjectId.isValid(tourId)) {
      return res.json({ code: "error", message: "tourId không hợp lệ!" });
    }

    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.max(
      5,
      Math.min(50, parseInt(req.query.limit || "10", 10))
    );

    const filter = { tourId, deleted: false, hiddenBySuperAdmin: { $ne: true } };
    const [items, total] = await Promise.all([
      Review.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Review.countDocuments(filter),
    ]);

    // stats nhanh
    const starBuckets = await Review.aggregate([
      {
        $match: { tourId: new mongoose.Types.ObjectId(tourId), deleted: false },
      },
      { $group: { _id: "$rating", c: { $sum: 1 } } },
    ]);

    const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    starBuckets.forEach((b) => (counts[b._id] = b.c));
    const ratingCount = Object.values(counts).reduce((s, n) => s + n, 0);
    const ratingAvg =
      ratingCount === 0
        ? 0
        : Math.round(
            ((1 * counts[1] +
              2 * counts[2] +
              3 * counts[3] +
              4 * counts[4] +
              5 * counts[5]) /
              ratingCount) *
              10
          ) / 10;

    return res.json({
      code: "success",
      data: {
        items,
        total,
        page,
        limit,
        counts,
        ratingAvg,
        ratingCount,
      },
    });
  } catch (e) {
    return res.json({ code: "error", message: "Không thể tải đánh giá!" });
  }
};

module.exports.createOrUpdate = async (req, res) => {
  try {
    const tourId = req.params.tourId;
    if (!mongoose.Types.ObjectId.isValid(tourId)) {
      return res.json({ code: "error", message: "tourId không hợp lệ!" });
    }

    // Tuỳ hệ thống, mình giả định user đang login có ở req.account
    const account = req.account;
    if (!account || !account.id) {
      return res.json({
        code: "error",
        message: "Bạn cần đăng nhập để đánh giá!",
      });
    }

    const rating = Math.max(
      1,
      Math.min(5, parseInt(req.body.rating || "0", 10))
    );
    const content = String(req.body.content || "")
      .trim()
      .slice(0, 2000);

    const doc = await Review.findOneAndUpdate(
      { tourId, userId: account.id, deleted: false },
      {
        $set: {
          rating,
          content,
          userName: account.fullName || account.email || "Người dùng",
        },
        $setOnInsert: { tourId, userId: account.id },
      },
      { new: true, upsert: true }
    );

    // Tính lại thống kê
    await recomputeTourRating(tourId);

    const tourDoc = await Tour.findById(tourId).select("name companyId").lean();
    auditLogHelper.log(req, {
      action: "customer.review.create",
      resourceType: "Review",
      resourceId: doc._id,
      resourceLabel: (tourDoc && tourDoc.name) || String(tourId),
      asCompanyId: tourDoc?.companyId || null,
      after: { rating, content: content ? content.slice(0, 200) : "" },
      summary: `Khách đánh giá ${rating}★ cho tour "${(tourDoc && tourDoc.name) || ""}"`,
    });

    return res.json({
      code: "success",
      message: "Gửi đánh giá thành công!",
      review: doc,
    });
  } catch (e) {
    return res.json({ code: "error", message: "Không thể gửi đánh giá!" });
  }
};
