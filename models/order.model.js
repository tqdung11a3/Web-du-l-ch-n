const mongoose = require("mongoose");

// Mỗi phần tử trong `items` là 1 tour được đặt, có cấu trúc:
// {
//   tourId, name, slug, avatar, companyId,
//   departureCity, departureDateDisplay, departureDate,
//   quantityAdult, quantityChildren, quantityBaby, babySeat,
//   priceNewAdult, priceNewChildren, priceNewBaby,
//   babyPricingMode, babyPricingRules,
//
//   // Lớp trung gian Tour ↔ Hotel (kết quả phân bổ Greedy)
//   hotelAllocation: {
//     status: 'ok' | 'partial' | 'no_hotels',
//     totalPeople: Number,
//     totalAssigned: Number,
//     remaining: Number,
//     checkIn: Date,
//     checkOut: Date,
//     allocations: [{
//       hotelId: String,
//       hotelName: String,
//       assignedPeople: Number,  // số người được phân bổ vào hotel này
//       capacity: Number,         // sức chứa còn lại của hotel
//       vacantRooms: Number,      // số phòng trống tương ứng
//       note: String,             // ghi chú admin đặt (VD: "Đêm 1-2")
//     }]
//   }
// }

const schema = new mongoose.Schema(
  {
    code: String,
    fullName: String,
    phone: String,
    email: String,
    cccdImages: [String],
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

    // ==== ĐƠN TẠM / GIỮ CHỖ TOUR ====
    isTemporaryHold: { type: Boolean, default: false },
    holdExpiresAt:   { type: Date,    default: null  },
  },
  {
    timestamps: true, // Tự động sinh ra trường createdAt và updatedAt
  }
);

const Order = mongoose.model("Order", schema, "orders");

module.exports = Order;
