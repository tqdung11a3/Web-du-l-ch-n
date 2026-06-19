const mongoose = require("mongoose");
const { Schema } = mongoose;

const schema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "AccountUser",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["tour_order", "hotel_booking", "tour_assignment", "room_assignment"],
      default: "tour_order",
    },
    title: { type: String, required: true },
    content: { type: String, required: true },
    link: { type: String, default: "" },
    metadata: {
      orderId: Schema.Types.ObjectId,
      orderCode: String,
      bookingCode: String,
      resourceLabel: String,
      changes: [
        {
          field: String,
          label: String,
          from: String,
          to: String,
        },
      ],
    },
    isRead: { type: Boolean, default: false },
    deleted: { type: Boolean, default: false },
    emailSentAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: "user_notifications",
  }
);

schema.index({ userId: 1, isRead: 1, deleted: 1, createdAt: -1 });

module.exports = mongoose.model("UserNotification", schema);
