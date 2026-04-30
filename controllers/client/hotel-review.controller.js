// controllers/client/hotel-review.controller.js
const mongoose = require("mongoose");
const HotelReview = require("../../models/hotel-review.model");
const Hotel = require("../../models/hotel.model");
const auditLogHelper = require("../../helpers/audit-log.helper");

// Tính lại rating trung bình của hotel
async function recomputeHotelRating(hotelId) {
  const stats = await HotelReview.aggregate([
    {
      $match: {
        hotelId: new mongoose.Types.ObjectId(hotelId),
        deleted: false,
      },
    },
    {
      $group: {
        _id: null,
        avgOverall: { $avg: "$ratingOverall" },
        avgLocation: { $avg: "$ratingLocation" },
        avgCleanliness: { $avg: "$ratingCleanliness" },
        avgFacilities: { $avg: "$ratingFacilities" },
        avgService: { $avg: "$ratingService" },
        avgValue: { $avg: "$ratingValue" },
        count: { $sum: 1 },
      },
    },
  ]);

  if (stats.length === 0) {
    await Hotel.updateOne(
      { _id: hotelId },
      {
        $set: {
          ratingOverall: 0,
          ratingCount: 0,
          ratingLocation: 0,
          ratingCleanliness: 0,
          ratingFacilities: 0,
          ratingService: 0,
          ratingValue: 0,
        },
      }
    );
    return;
  }

  const s = stats[0];
  await Hotel.updateOne(
    { _id: hotelId },
    {
      $set: {
        ratingOverall: Math.round(s.avgOverall * 10) / 10,
        ratingCount: s.count,
        ratingLocation: s.avgLocation
          ? Math.round(s.avgLocation * 10) / 10
          : 0,
        ratingCleanliness: s.avgCleanliness
          ? Math.round(s.avgCleanliness * 10) / 10
          : 0,
        ratingFacilities: s.avgFacilities
          ? Math.round(s.avgFacilities * 10) / 10
          : 0,
        ratingService: s.avgService ? Math.round(s.avgService * 10) / 10 : 0,
        ratingValue: s.avgValue ? Math.round(s.avgValue * 10) / 10 : 0,
      },
    }
  );
}

// Lấy danh sách reviews của hotel
module.exports.list = async (req, res) => {
  try {
    const hotelId = req.params.hotelId;
    if (!mongoose.Types.ObjectId.isValid(hotelId)) {
      return res.json({ code: "error", message: "hotelId không hợp lệ!" });
    }

    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.max(
      5,
      Math.min(50, parseInt(req.query.limit || "10", 10))
    );

    const filter = { hotelId, deleted: false, hiddenBySuperAdmin: { $ne: true } };
    const [items, total] = await Promise.all([
      HotelReview.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      HotelReview.countDocuments(filter),
    ]);

    return res.json({
      code: "success",
      data: {
        items,
        total,
        page,
        limit,
      },
    });
  } catch (e) {
    console.error("hotel-review.list error:", e);
    return res.json({ code: "error", message: "Không thể tải đánh giá!" });
  }
};

// Tạo hoặc cập nhật review
module.exports.createOrUpdate = async (req, res) => {
  try {
    const hotelId = req.params.hotelId;
    if (!mongoose.Types.ObjectId.isValid(hotelId)) {
      return res.json({ code: "error", message: "hotelId không hợp lệ!" });
    }

    const account = req.account;
    if (!account || !account.id) {
      return res.json({
        code: "error",
        message: "Bạn cần đăng nhập để đánh giá!",
      });
    }

    const ratingOverall = Math.max(
      1,
      Math.min(10, parseInt(req.body.ratingOverall || "0", 10))
    );
    const ratingLocation = req.body.ratingLocation
      ? Math.max(1, Math.min(10, parseInt(req.body.ratingLocation, 10)))
      : undefined;
    const ratingCleanliness = req.body.ratingCleanliness
      ? Math.max(1, Math.min(10, parseInt(req.body.ratingCleanliness, 10)))
      : undefined;
    const ratingFacilities = req.body.ratingFacilities
      ? Math.max(1, Math.min(10, parseInt(req.body.ratingFacilities, 10)))
      : undefined;
    const ratingService = req.body.ratingService
      ? Math.max(1, Math.min(10, parseInt(req.body.ratingService, 10)))
      : undefined;
    const ratingValue = req.body.ratingValue
      ? Math.max(1, Math.min(10, parseInt(req.body.ratingValue, 10)))
      : undefined;

    const content = String(req.body.content || "").trim().slice(0, 2000);

    const updateData = {
      ratingOverall,
      content,
      userName: account.fullName || account.email || "Người dùng",
    };

    if (ratingLocation) updateData.ratingLocation = ratingLocation;
    if (ratingCleanliness) updateData.ratingCleanliness = ratingCleanliness;
    if (ratingFacilities) updateData.ratingFacilities = ratingFacilities;
    if (ratingService) updateData.ratingService = ratingService;
    if (ratingValue) updateData.ratingValue = ratingValue;

    const doc = await HotelReview.findOneAndUpdate(
      { hotelId, userId: account.id, deleted: false },
      {
        $set: updateData,
        $setOnInsert: { hotelId, userId: account.id },
      },
      { new: true, upsert: true }
    );

    // Tính lại thống kê
    await recomputeHotelRating(hotelId);

    const hotelDoc = await Hotel.findById(hotelId).select("name companyId").lean();
    auditLogHelper.log(req, {
      action: "customer.hotel-review.create",
      resourceType: "HotelReview",
      resourceId: doc._id,
      resourceLabel: (hotelDoc && hotelDoc.name) || String(hotelId),
      asCompanyId: hotelDoc?.companyId || null,
      after: {
        ratingOverall,
        content: content ? content.slice(0, 200) : "",
      },
      summary: `Khách đánh giá ${ratingOverall}/10 cho khách sạn "${(hotelDoc && hotelDoc.name) || ""}"`,
    });

    return res.json({
      code: "success",
      message: "Gửi đánh giá thành công!",
      review: doc,
    });
  } catch (e) {
    console.error("hotel-review.createOrUpdate error:", e);
    return res.json({ code: "error", message: "Không thể gửi đánh giá!" });
  }
};

