const mongoose = require("mongoose");
const { Schema } = mongoose;

const schema = new Schema(
  {
    // Thông báo thuộc về company nào
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },
    
    // Loại thông báo
    type: {
      type: String,
      enum: ["hotel_booking", "order", "review", "other"],
      default: "other",
    },
    
    // Tiêu đề thông báo
    title: {
      type: String,
      required: true,
    },
    
    // Nội dung thông báo
    content: {
      type: String,
      required: true,
    },
    
    // Link đến trang chi tiết (nếu có)
    link: {
      type: String,
      default: "",
    },
    
    // Dữ liệu liên quan (flexible)
    metadata: {
      bookingCode: String,
      customerName: String,
      checkIn: Date,
      checkOut: Date,
      paymentMethod: String,
      amount: Number,
      hotelId: Schema.Types.ObjectId,
      hotelName: String,
    },
    
    // Đã đọc chưa
    isRead: {
      type: Boolean,
      default: false,
    },
    
    // Đã xóa chưa
    deleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    collection: "notifications",
  }
);

// Index để query nhanh
schema.index({ companyId: 1, isRead: 1, deleted: 1, createdAt: -1 });

const Notification = mongoose.model("Notification", schema);
module.exports = Notification;

