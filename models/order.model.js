const mongoose = require("mongoose");

// Mỗi phần tử trong `items` là 1 tour được đặt, có cấu trúc:
// {
//   tourId, name, slug, avatar, companyId,
//   departureCity, departureDateDisplay, departureDate,
//   quantityAdult, quantityChildren, quantityBaby,
//   babySeat,            // (legacy) true nếu TẤT CẢ em bé đặt ghế riêng
//   babySeats,           // (mới) mảng per-baby: [{ babyIdx, seatType: 'private'|'shared', guardianIdx }]
//   babySeatFeeTotal,    // tổng phí ghế riêng em bé (VND)
//   maxBabiesPerAdult,   // snapshot cấu hình lúc đặt
//   priceNewAdult, priceNewChildren, priceNewBaby,
//   babyPricingMode, babyPricingRules,
//
//   // ==== HÌNH THỨC LƯU TRÚ ====
//   // - "private": khách chọn loại phòng cụ thể (cộng FULL tiền phòng vào tour)
//   // - "shared":  khách chỉ khai số nam/nữ, hệ thống chỉ kiểm tra tính khả thi
//   //              xếp ghép — admin gán phòng vật lý sau qua trang
//   //              /admin/hotel/tour-assignments
//   // (Đơn cũ không có trường này → fallback "private")
//   accommodationMode: 'private' | 'shared',
//
//   // Khi accommodationMode === 'private': dùng roomSelections như cũ
//   roomSelections: [{
//     tourSegmentId, hotelId, hotelName,
//     roomTypeId, roomTypeName,
//     baseOccupancy, pricePerNight,
//     selectedRooms,
//     fromDate, toDate,
//
//     // ==== PHÂN BỔ HÀNH KHÁCH VÀO TỪNG PHÒNG VẬT LÝ (private, mới) ====
//     // Mỗi roomSelection có `selectedRooms` phòng vật lý; mỗi phòng có
//     // 1 entry trong roomAssignments. passengerIdxs trỏ vào items[].passengers.
//     // Đơn private cũ KHÔNG có field này — render fallback chỉ hiển thị tổng số phòng.
//     roomAssignments: [{
//       roomIndex: Number,        // 0..selectedRooms-1 (chỉ để UI ổn định)
//       passengerIdxs: [Number],  // index trong items[].passengers
//       usedCapacity: Number,     // Σ occupancyWeight (snapshot tại lúc đặt)
//     }],
//   }],
//   extraRoomCost: Number, // private: full Σ pricePerNight×nights×selectedRooms
//                          // shared:  0
//
//   // Khi accommodationMode === 'shared': mỗi khung 1 entry
//   sharedRoomRequest: [{
//     tourSegmentId,
//     hotelId, hotelName,         // hotel primary của khung (snapshot)
//     fromDate, toDate,
//     males,                       // số người lớn nam (derived từ passengers)
//     females,                     // số người lớn nữ (derived từ passengers)
//   }],
//
//   // ==== DANH SÁCH HÀNH KHÁCH (áp dụng cho cả private + shared, mới) ====
//   // Mỗi adult là 1 atom; mỗi child/baby gắn vào 1 adult qua guardianIdx.
//   // - shared: dùng để build atoms cho thuật toán xếp ghép.
//   // - private: dùng để gán vào từng phòng cụ thể (xem roomAssignments).
//   // Đơn cũ KHÔNG có field này — server fallback (shared synthesize atoms
//   // từ males/females; private hiển thị UI cũ không có passenger list).
//   passengers: [{
//     idx: Number,                       // 0-based index trong list
//     name: String,                      // họ tên
//     age: Number,                       // tuổi (làm tròn xuống)
//     type: 'adult' | 'child' | 'baby',  // loại đối tượng
//     gender: 'male' | 'female' | null,  // chỉ adult có; child/baby = null
//     guardianIdx: Number | null,        // adult = null; child/baby = idx của adult cùng đoàn
//   }],
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

    transferProofImages: [String], // ảnh chứng từ chuyển khoản do khách gửi lên

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
