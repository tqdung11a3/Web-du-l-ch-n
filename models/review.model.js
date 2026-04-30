// models/review.model.js
const mongoose = require("mongoose");

const ReviewSchema = new mongoose.Schema(
  {
    tourId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tour",
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AccountUser",
      required: true,
      index: true,
    },
    userName: { type: String, required: true, trim: true }, // snapshot tên tại thời điểm viết
    rating: { type: Number, min: 1, max: 5, required: true },
    content: { type: String, trim: true, default: "" },
    hiddenBySuperAdmin: { type: Boolean, default: false },
    hiddenReason: { type: String, default: "" },
    hiddenBy: { type: String, default: "" },
    hiddenAt: { type: Date },
    deleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Mỗi user chỉ được 1 review / tour (có thể sửa review sau)
ReviewSchema.index(
  { tourId: 1, userId: 1 },
  { unique: true, partialFilterExpression: { deleted: false } }
);

module.exports = mongoose.model("Review", ReviewSchema);
