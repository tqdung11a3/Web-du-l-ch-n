// models/hotel.model.js
const mongoose = require("mongoose");
const { Schema } = mongoose;

// ==== Sub schema cho FAQ ====
const FaqSchema = new Schema(
  {
    question: { type: String, default: "" },
    answer: { type: String, default: "" },
  },
  { _id: false }
);

// ==== Sub schema cho Age Band (Mức tuổi) ====
const AgeBandSchema = new Schema(
  {
    bandName: { type: String, required: true }, // Tên mức tuổi (VD: Trẻ nhỏ, Trẻ em, Người lớn)
    minAge: { type: Number, required: true, min: 0 }, // Tuổi bé nhất
    maxAge: { type: Number, default: null }, // Tuổi lớn nhất (null = không giới hạn)
    bandType: { 
      type: String, 
      enum: ["infant", "child", "adult", "other"],
      default: "other"
    }, // Loại: Infant/Child/Adult

    // C.1. Tính vào sức chứa (Occupancy counting)
    countInOccupancy: { type: Boolean, default: true }, // Tính vào số người?
    occupancyWeight: { 
      type: Number, 
      enum: [0, 0.5, 1],
      default: 1
    }, // Trọng số tính sức chứa

    // C.2. Ăn sáng (Breakfast rules) - Khách hàng tự chọn đăng ký, admin chỉ cấu hình phí
    breakfastIsFree: { type: Boolean, default: true }, // Miễn phí hay tính tiền? (true = miễn phí, false = tính tiền)
    breakfastFeePerPersonPerMeal: { type: Number, default: 0 }, // Phí/người/bữa (VND) - chỉ dùng khi breakfastIsFree = false

    // C.3. Extra person charge (chỉ hiện khi countInOccupancy = true)
    applyExtraPersonFee: { type: Boolean, default: false }, // Áp dụng phụ thu vượt base occupancy?
    extraPersonFeePerNight: { type: Number, default: 0 }, // Phụ thu/đêm/người cho nhóm tuổi này (VND)
  },
  { _id: true, timestamps: false }
);

// ==== Sub schema cho phòng cụ thể (individual room) ====
const IndividualRoomSchema = new Schema(
  {
    roomNumber: { type: String, required: true }, // Số phòng: 101, 102, ...
    floor: { type: String, required: true }, // Tầng: Tầng 1, Tầng 2, ...
    roomTypeId: { type: Schema.Types.ObjectId, required: true }, // ID của loại phòng
    status: { 
      type: String, 
      enum: ["vacant", "occupied", "cleaning", "out_of_service"],
      default: "vacant"
    }, // Trạng thái: Trống, Đang sử dụng, Đang dọn, Ngừng hoạt động
  },
  { _id: true, timestamps: true }
);

// ==== Sub schema cho loại phòng ====
// LƯU Ý: KHÔNG dùng _id: false nữa, để mỗi room có _id riêng
const RoomTypeSchema = new Schema(
  {
    // Thông tin cơ bản (bạn đã có)
    name: { type: String, required: true }, // Tên loại phòng
    basePrice: { type: Number, default: 0 }, // Giá từ
    description: { type: String, default: "" }, // Mô tả ngắn

    // ===== KHỐI A: Thiết lập sức chứa chung (Occupancy) =====
    baseOccupancy: { type: Number, default: 2 }, // Số người đã gồm trong giá
    maxOccupancy: { type: Number, default: 3 }, // Tối đa người
    maxExtraBeds: { type: Number, default: 1 }, // Tối đa giường phụ
    extraBedFeePerNight: { type: Number, default: 0 }, // Phí giường phụ/đêm (VND)

    // ---- Thông tin chi tiết để làm trang giống Booking ----
    sizeM2: { type: Number }, // Diện tích (m2): 26, 37,...
    bedInfo: { type: String, default: "" }, // "1 giường đôi lớn"
    view: { type: String, default: "" }, // "Tầm nhìn ra khung cảnh"
    smokingPolicy: { type: String, default: "" }, // "Không hút thuốc"

    // Tiện nghi phòng tắm (hiển thị cột "Trong phòng tắm riêng của bạn")
    bathroomAmenities: { type: [String], default: [] },

    // Tiện nghi phòng (hiển thị cột "Tiện nghi phòng")
    roomAmenities: { type: [String], default: [] },

    // Ảnh riêng cho từng loại phòng (carousel)
    images: { type: [String], default: [] },

    // Đánh giá phòng (VD: 9.7)
    rating: { type: Number, default: 0 },
    // Loại đánh giá (VD: "Tiêu chuẩn/chất lượng phòng")
    ratingCategory: { type: String, default: "" },

    // Nút đề xuất
    isRecommended: { type: Boolean, default: false }, // "Được đề xuất"
    soloTravelerFavorite: { type: Boolean, default: false }, // "Khách đi một mình yêu thích"

    // ===== KHỐI B & C: Age Bands (Mức tuổi) =====
    // LƯU Ý: Age bands được quản lý ở cấp Hotel, áp dụng cho tất cả room types
    // Không còn override ở room type level nữa để đơn giản hóa hệ thống
  },
  {
    _id: true, // để chắc chắn mỗi room có ObjectId riêng
    timestamps: false,
  }
);

// ==== Hotel schema ====
const HotelSchema = new Schema(
  {
    // Multi–tenant: mỗi khách sạn thuộc 1 công ty
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },

    // Thông tin cơ bản
    name: { type: String, required: true },
    cityName: { type: String, default: "" }, // Giữ lại để tương thích ngược
    province: { 
      type: Schema.Types.ObjectId, 
      ref: "City", 
      default: null 
    }, // Tỉnh thành (reference đến City)
    address: { type: String, default: "" },
    phone: { type: String, default: "" }, // Số điện thoại
    googleMapsLink: { type: String, default: "" }, // Link Google Maps (embed URL hoặc share link)
    starRating: { type: Number, default: 0 }, // 1–5 sao

    basePrice: { type: Number, default: 0 }, // giá từ
    currency: { type: String, default: "VND" },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },

    avatar: { type: String, default: "" }, // Ảnh đại diện
    images: { type: [String], default: [] }, // gallery ảnh

    // Mô tả
    shortDescription: { type: String, default: "" }, // mô tả ngắn
    description: { type: String, default: "" }, // mô tả chi tiết

    // Tiện nghi (để hiển thị block tiện nghi / cơ sở vật chất)
    amenities: { 
      type: [{
        name: { type: String, required: true },
        icon: { type: String, default: "" },
        description: { type: String, default: "" },
        features: { type: [String], default: [] }
      }], 
      default: [] 
    },

    // Cơ sở vật chất (facilities) - để hiển thị chi tiết các tiện nghi
    facilities: {
      type: [{
        name: { type: String, required: true },
        icon: { type: String, default: "" }, // FontAwesome class
        image: { type: String, default: "" }, // Ảnh minh họa (cho carousel)
        category: { 
          type: String, 
          default: "other"
          // Cho phép giá trị tùy chỉnh khi chọn "Khác"
        },
        isAvailable: { type: Boolean, default: true } // Có sẵn hay không
      }],
      default: []
    },

    // Khách sạn nổi bật (badge “Nổi bật”)
    isFeatured: { type: Boolean, default: false },

    // ===== Phần giống các block: Điểm nổi bật, Khuyến mại, Di chuyển =====
    highlights: { 
      type: [{
        image: { type: String, default: "" },
        title: { type: String, default: "" }
      }], 
      default: [] 
    },
    promotionShortText: { type: String, default: "" },
    transportOptions: { type: [String], default: [] },

    // ===== Điểm đánh giá (để demo giống Booking) =====
    ratingOverall: { type: Number, default: 0 }, // VD 8.2
    ratingCount: { type: Number, default: 0 }, // số review

    ratingLocation: { type: Number, default: 0 },
    ratingCleanliness: { type: Number, default: 0 },
    ratingFacilities: { type: Number, default: 0 },
    ratingService: { type: Number, default: 0 },
    ratingValue: { type: Number, default: 0 },

    // ===== Quy định chỗ nghỉ & thông tin hữu ích =====
    checkinTimeFrom: { type: String, default: "" },
    checkinTimeTo: { type: String, default: "" },
    checkoutTimeFrom: { type: String, default: "" },
    checkoutTimeTo: { type: String, default: "" },
    // Nhận phòng sớm và Trả phòng muộn
    earlyCheckinTime: { type: String, default: "" }, // Giờ nhận phòng sớm (VD: 10:00)
    earlyCheckinFee: { type: Number, default: 0 }, // Số tiền phải trả thêm khi nhận phòng sớm (VND)
    lateCheckoutTime: { type: String, default: "" }, // Giờ trả phòng muộn (VD: 14:00)
    lateCheckoutFee: { type: Number, default: 0 }, // Số tiền phải trả thêm khi trả phòng muộn (VND)

    numberOfRooms: { type: Number, default: 0 },

    // ===== KHỐI B: Mức tuổi (Age Bands) - Phiên bản mới thay thế childrenPolicy =====
    ageBands: { type: [AgeBandSchema], default: [] },

    // Chính sách trẻ em và giường phụ (chi tiết) - GIỮ LẠI ĐỂ TƯƠNG THÍCH NGƯỢC
    // Sẽ không sử dụng nữa, thay thế bằng ageBands
    childrenPolicy: {
      infant0to1: {
        freeWithExistingBed: { type: Boolean, default: true },
        cribAvailable: { type: Boolean, default: false },
        note: { type: String, default: "" }
      },
      child2to5: {
        freeWithExistingBed: { type: Boolean, default: true },
        extraBedCharge: { type: Number, default: 0 },
        note: { type: String, default: "" }
      },
      guest6Plus: {
        consideredAdult: { type: Boolean, default: true },
        extraBedRequired: { type: Boolean, default: false },
        extraBedCharge: { type: Number, default: 0 },
        note: { type: String, default: "" }
      }
    },

    // Thông tin hữu ích
    usefulInfo: {
      // Di chuyển
      distanceFromCityCenter: { type: String, default: "" }, // VD: "2 km"
      timeToAirport: { type: String, default: "" }, // VD: "20 minutes"
      airportTransferFee: { type: Number, default: 0 }, // VND
      
      // Thông tin khác
      wifiFee: { type: Number, default: 0 }, // VND per day
      breakfastFee: { type: Number, default: 0 }, // VND (khi không bao gồm trong giá phòng)
      
      // Về khách sạn
      builtYear: { type: Number, default: 0 },
      numberOfFloors: { type: Number, default: 0 },
      inRoomVoltage: { type: String, default: "" }, // VD: "220"
      nonSmokingRooms: { type: Boolean, default: false },
      numberOfRestaurants: { type: Number, default: 0 },
      numberOfBars: { type: Number, default: 0 },
      licenseNumber: { type: String, default: "" }
    },

    rulesChildren: { type: String, default: "" },
    rulesPets: { type: String, default: "" },
    rulesExtraBed: { type: String, default: "" },
    rulesOther: { type: String, default: "" },

    // ===== Câu hỏi thường gặp (FAQ) =====
    faqs: { type: [FaqSchema], default: [] },

    // ===== Loại phòng =====
    roomTypes: { type: [RoomTypeSchema], default: [] },

    // ===== Phòng cụ thể (individual rooms) =====
    rooms: { type: [IndividualRoomSchema], default: [] },

    // Soft–delete
    deleted: { type: Boolean, default: false },
    deletedAt: { type: Date },

    // Audit
    createdBy: { type: Schema.Types.ObjectId, ref: "AccountAdmin" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "AccountAdmin" },
    deletedBy: { type: Schema.Types.ObjectId, ref: "AccountAdmin" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Hotel", HotelSchema);
