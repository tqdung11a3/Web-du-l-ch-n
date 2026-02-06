const mongoose = require("mongoose");

const schema = new mongoose.Schema(
  {
    code: String,
    fullName: String,
    phone: String,
    note: String,
    items: Array,
    subTotal: Number,
    discount: Number,
    total: Number,
    paymentMethod: String, // momo, bank, money, vnpay, zalopay
    paymentStatus: String, // unpaid, paid
    status: String, // initial, done, cancel
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AccountUser",
      index: true,
    },
    userName: { type: String, trim: true },
    updatedBy: String,
    deleted: {
      type: Boolean,
      default: false,
    },
    deletedBy: String,
    deletedAt: Date,
  },
  {
    timestamps: true, // Tự động sinh ra trường createdAt và updatedAt
  }
);

const Order = mongoose.model("Order", schema, "orders");

module.exports = Order;
