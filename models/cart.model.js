// models/cart.model.js
const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const CartItemSchema = new Schema({
  hotelId: {
    type: Schema.Types.ObjectId,
    ref: "Hotel",
    required: true
  },
  hotelName: String,
  hotelAddress: String,
  hotelProvince: String,
  roomTypeId: {
    type: Schema.Types.ObjectId,
    required: true
  },
  roomTypeName: String,
  roomTypeImage: String,
  quantity: {
    type: Number,
    required: true,
    min: 1,
    default: 1
  },
  maxAvailable: Number, // Số phòng trống tối đa
  pricePerNight: {
    type: Number,
    required: true,
    default: 0
  },
  checkInDate: {
    type: String, // YYYY-MM-DD
    required: true
  },
  checkOutDate: {
    type: String, // YYYY-MM-DD
    required: true
  },
  nights: {
    type: Number,
    required: true,
    min: 1
  },
  roomsData: String, // JSON string của thông tin khách
  adults: Number,
  children: Number,
  rooms: Number,
}, { _id: false });

const CartSchema = new Schema({
  userId: {
    type: Schema.Types.ObjectId,
    ref: "AccountUser",
    default: null
  },
  sessionId: {
    type: String,
    default: null
  },
  hotelId: {
    type: Schema.Types.ObjectId,
    ref: "Hotel",
    default: null // Không bắt buộc, sẽ set khi add item đầu tiên
  },
  items: [CartItemSchema]
}, {
  timestamps: true // Tự động tạo createdAt và updatedAt
});

// Index để tìm cart theo userId hoặc sessionId
CartSchema.index({ userId: 1 });
CartSchema.index({ sessionId: 1 });
// TTL index: Auto-delete cart sau 24h (chỉ cần 1 index này, không duplicate)
CartSchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 });

const Cart = mongoose.model("Cart", CartSchema, "carts");

module.exports = Cart;

