const mongoose = require("mongoose");
const { Schema } = mongoose;

const guestSchema = new Schema(
  {
    fullName: String,
    phone: String,
    email: String,
  },
  { _id: false }
);

// Lưu "snapshot" thông tin khách sạn tại thời điểm đặt
const hotelSnapshotSchema = new Schema(
  {
    hotelId: { type: Schema.Types.ObjectId, ref: "Hotel" }, // ID của hotel
    amadeusOfferId: String, // id của offer trong Amadeus
    amadeusHotelId: String, // hotelId
    name: String,
    cityCode: String,
    address: String,
    thumbnail: String,
  },
  { _id: false }
);

const schema = new Schema(
  {
    code: { type: String, unique: true }, // mã đơn: ví dụ HB123456
    userId: { type: Schema.Types.ObjectId, ref: "AccountUser" }, // ID của user đã đặt
    guest: guestSchema,

    checkIn: Date,
    checkOut: Date,
    adults: { type: Number, default: 1 },
    children: { type: Number, default: 0 },
    childrenDetails: [{ age: Number }], // Lưu độ tuổi cụ thể của từng trẻ em: [{ age: 2 }, { age: 8 }]
    rooms: { type: Number, default: 1 },
    roomsData: String, // JSON string của thông tin chi tiết từng phòng: [{adults: 2, children: [{age: 3}]}, ...]

    // Thông tin phòng đặt
    roomId: { type: Schema.Types.ObjectId }, // ID của phòng cụ thể (individual room)
    roomTypeId: { type: Schema.Types.ObjectId }, // ID của loại phòng

    currency: String,
    pricePerNight: Number,
    totalNights: Number,
    totalAmount: Number, // tổng tiền cho riêng phòng này (chưa chắc bằng tổng đơn)

    // Tổng tiền toàn bộ đơn đặt phòng (bao gồm thuế, phí, dịch vụ thêm)
    // Các booking thuộc cùng một đơn sẽ có cùng orderTotal
    orderTotal: Number,

    hotel: hotelSnapshotSchema,

    status: {
      type: String,
      enum: ["pending", "confirmed", "checked_in", "checked_out", "cancelled"],
      default: "pending",
    },
    paymentStatus: {
      type: String,
      enum: ["unpaid", "paid"],
      default: "unpaid",
    },
    paymentMethod: {
      type: String,
      enum: ["money", "bank", "vnpay"],
      default: "money",
    },
    note: {
      type: String,
      default: "",
    },
    additionalServices: {
      type: Schema.Types.Mixed, // Lưu dưới dạng object { early_checkin: 'true', service_breakfast: '2', ... }
      default: {},
    },
    
    // ==== ĐƠN TẠM / GIỮ CHỖ ====
    isTemporaryHold: {
      type: Boolean,
      default: true, // Mặc định là đơn tạm khi mới tạo
    },
    holdExpiresAt: {
      type: Date,
      default: null, // Thời điểm hết hạn giữ chỗ (15 phút sau khi tạo)
    },
  },
  {
    timestamps: true,
    collection: "hotel_bookings",
  }
);

// ==== TTL INDEX: Tự động xóa booking pending chưa thanh toán sau khi hết hạn ====
// Index này chỉ áp dụng cho booking có isTemporaryHold = true và status = pending
schema.index(
  { holdExpiresAt: 1 },
  {
    expireAfterSeconds: 0, // Xóa ngay khi holdExpiresAt đến
    partialFilterExpression: {
      isTemporaryHold: true,
      status: "pending",
      paymentStatus: "unpaid",
    },
  }
);

// Index để tìm booking theo userId và code
schema.index({ userId: 1 });
schema.index({ code: 1 });

const HotelBooking = mongoose.model("HotelBooking", schema);
module.exports = HotelBooking;
