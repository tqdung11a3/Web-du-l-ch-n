// models/tour-segment.model.js
//
// Lưu cấu hình "khung thời gian – khách sạn" mà company admin thiết lập
// cho một lịch khởi hành (departure) cụ thể của tour.
//
// Cấu trúc:
//   TourSegment (1 document = 1 tour + 1 departure)
//     └── segments[]          (N khung thời gian trong khoảng [startDate, endDate])
//           └── hotels[]      (primary + backup hotels cho khung này)
//                 └── roomAllocations[]  (loại phòng + số phòng giữ)

const mongoose = require("mongoose");
const { Schema, Types } = mongoose;

// ── Phân bổ phòng theo loại ──────────────────────────────────────────────────
const roomAllocationSchema = new Schema(
  {
    roomTypeId:   { type: Types.ObjectId, required: true },
    roomTypeName: { type: String, default: "" },
    baseOccupancy:{ type: Number, default: 2 }, // người/phòng
    assignedRooms:{ type: Number, default: 0 }, // số phòng được giữ
    totalPeople:  { type: Number, default: 0 }, // = assignedRooms × baseOccupancy
  },
  { _id: false }
);

// ── Khách sạn trong một khung thời gian ──────────────────────────────────────
const hotelInSegmentSchema = new Schema(
  {
    hotelId:      { type: Types.ObjectId, ref: "Hotel", required: true },
    hotelName:    { type: String, default: "" },
    isPrimary:    { type: Boolean, default: false }, // true = khách sạn chính
    roomAllocations: { type: [roomAllocationSchema], default: [] },
    totalPeople:  { type: Number, default: 0 }, // tổng sức chứa hotel này trong khung
  },
  { _id: true }
);

// ── Một khung thời gian ───────────────────────────────────────────────────────
const segmentSchema = new Schema(
  {
    fromDate:      { type: Date, required: true },
    toDate:        { type: Date, required: true },
    hotels:        { type: [hotelInSegmentSchema], default: [] },
    totalCapacity: { type: Number, default: 0 }, // tổng sức chứa của tất cả hotels
    status: {
      type: String,
      enum: ["draft", "confirmed", "pending_approval", "rejected"],
      default: "draft",
    },
  },
  { _id: true }
);

// ── Phân công phòng cụ thể cho từng khách trong đơn hàng ─────────────────────
const roomAssignmentSchema = new Schema(
  {
    orderId:        { type: Types.ObjectId, ref: "Order", required: true },
    orderCode:      { type: String, default: "" },
    guestName:      { type: String, default: "" },
    phone:          { type: String, default: "" },
    numPeople:      { type: Number, default: 1 }, // sức chứa quy đổi của phần atoms thuộc đơn này trong phòng (= ra.usedCapacity)
    hotelId:        { type: Types.ObjectId, ref: "Hotel", required: true },
    hotelName:      { type: String, default: "" },
    roomId:         { type: Types.ObjectId, required: true }, // phòng vật lý cụ thể
    roomNumber:     { type: String, default: "" },
    roomTypeName:   { type: String, default: "" },
    holdBookingId:  { type: Types.ObjectId, ref: "HotelBooking", default: null }, // booking giữ chỗ tương ứng

    // ── Mở rộng: hỗ trợ ghép cross-order cho mode shared ──
    accommodationMode: { type: String, enum: ["private", "shared"], default: "private" },
    gender:            { type: String, enum: ["male", "female", null], default: null }, // shared: 'male'|'female'; private: null
    atomLabels:        { type: [String], default: [] }, // labels của các atoms thuộc đơn này trong phòng

    // Trạng thái nhận/trả phòng riêng của từng đơn (tách khỏi HotelBooking.status
    // để nhiều khách share cùng 1 phòng vật lý có trạng thái độc lập).
    guestStatus: {
      type: String,
      enum: ["confirmed", "checked_in", "checked_out"],
      default: "confirmed",
    },
  },
  { _id: true }
);

// ── Document gốc: 1 tour × 1 departure ───────────────────────────────────────
const schema = new Schema(
  {
    tourId:       { type: Types.ObjectId, ref: "Tour", required: true },
    companyId:    { type: Types.ObjectId, required: true },
    departureDate:{ type: Date, required: true },
    endDate:      { type: Date, required: true },
    paxRequired:  { type: Number, default: 0 }, // số người cần bố trí

    segments: { type: [segmentSchema], default: [] },

    // Phân công phòng cho từng khách hàng (sau khi admin xếp thủ công)
    assignments: { type: [roomAssignmentSchema], default: [] },

    status: {
      type: String,
      enum: ["draft", "confirmed", "pending_approval", "rejected", "cancelled"],
      default: "draft",
    },

    // Lưu id của các HotelBooking đã tạo để giữ phòng (dùng khi huỷ)
    holdBookingIds: { type: [Types.ObjectId], default: [] },

    // Lưu id các HotelLinkRequest (yêu cầu liên kết KS khác company)
    linkRequestIds: { type: [Types.ObjectId], default: [] },
  },
  { timestamps: true, collection: "tour_segments" }
);

// Index để tìm nhanh theo tour + departure
schema.index({ tourId: 1, departureDate: 1 }, { unique: true });
schema.index({ companyId: 1 });

module.exports = mongoose.model("TourSegment", schema);
