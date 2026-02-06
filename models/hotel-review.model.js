// models/hotel-review.model.js
const mongoose = require("mongoose");

const HotelReviewSchema = new mongoose.Schema(
  {
    hotelId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Hotel",
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AccountUser",
      required: true,
      index: true,
    },
    // Snapshot tên người dùng tại thời điểm viết review
    userName: { type: String, required: true, trim: true },

    // Điểm tổng (1–10 giống Booking)
    ratingOverall: { type: Number, min: 1, max: 10, required: true },

    // Các điểm chi tiết – có thể optional
    ratingLocation: { type: Number, min: 1, max: 10 },
    ratingCleanliness: { type: Number, min: 1, max: 10 },
    ratingFacilities: { type: Number, min: 1, max: 10 },
    ratingService: { type: Number, min: 1, max: 10 },
    ratingValue: { type: Number, min: 1, max: 10 },

    // Nội dung nhận xét
    content: { type: String, trim: true, default: "" },

    deleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Mỗi user chỉ được 1 review / 1 khách sạn (nếu muốn sửa thì cập nhật lại review)
HotelReviewSchema.index(
  { hotelId: 1, userId: 1 },
  { unique: true, partialFilterExpression: { deleted: false } }
);

module.exports = mongoose.model("HotelReview", HotelReviewSchema);
