const mongoose = require("mongoose");
const slug = require("mongoose-slug-updater");
mongoose.plugin(slug);

const { Schema, Types } = mongoose;

// Quy tắc tính giá em bé (nếu chọn chế độ 'tiered')
//  - from/to: thứ tự em bé (1-based). to có thể là số hoặc 'inf' (vô hạn).
//  - percent: % so với giá tham chiếu (thường là giá Trẻ em)
//  - ref: giá tham chiếu ('children' | 'adult') -> mặc định 'children'
const babyRuleSchema = new Schema(
  {
    from: { type: Number, required: true, min: 1 },
    to: { type: Schema.Types.Mixed, required: true }, // Number | 'inf'
    percent: { type: Number, required: true, min: 0, max: 100 },
    ref: { type: String, enum: ["children", "adult"], default: "children" },
  },
  { _id: false }
);

const schema = new Schema(
  {
    // --- đa công ty ---
    companyId: { type: Types.ObjectId, ref: "Company", required: true },

    // --- thông tin tour ---
    name: String,
    category: String,
    position: Number,
    status: String,
    avatar: String,
    images: Array,

    // 1) Điểm khởi hành: 1 tỉnh/thành
    departureCity: {
      type: Types.ObjectId,
      ref: "City",
      default: null,
    },

    // 2) Những địa điểm có trong tour:
    //    mỗi phần tử: { city: ObjectId<City>, spots: [String] }
    locations: [
      {
        city: {
          type: Types.ObjectId,
          ref: "City",
          required: true,
        },
        spots: {
          type: [String],
          default: [],
        },
      },
    ],

    // Giá cũ
    priceAdult: Number,
    priceChildren: Number,
    priceBaby: Number,

    // Giá mới (áp dụng)
    priceNewAdult: Number,
    priceNewChildren: Number,
    priceNewBaby: Number, // dùng khi babyPricingMode = 'fixed'

    // === GIÁ BACKUP TRƯỚC KHUYẾN MÃI ===
    backupPriceNewAdult: { type: Number, default: 0 },
    backupPriceNewChildren: { type: Number, default: 0 },
    backupPriceNewBaby: { type: Number, default: 0 },

    // Thông tin khuyến mãi (giảm giá theo % có thời hạn)
    discountPercent: { type: Number, default: 0 }, // 0 = không khuyến mãi
    discountFrom: Date,
    discountTo: Date,

    // Đánh dấu hiện tại giá đã được áp dụng khuyến mãi hay chưa
    discountApplied: { type: Boolean, default: false },

    // Cấu hình cách tính giá em bé
    babyPricingMode: {
      type: String,
      enum: ["fixed", "tiered"],
      default: "fixed",
    },

    // Quy tắc tính giá em bé khi chọn 'tiered'
    babyPricingRules: {
      type: [babyRuleSchema],
      default: [],
    },

    // Khác
    time: String,
    vehicle: String,
    departureDate: Date, // Giữ lại để tương thích với dữ liệu cũ (= departures[0].departureDate)

    // Mảng cặp ngày: mỗi phần tử gồm ngày khởi hành + ngày kết thúc + ghế riêng
    departures: {
      type: [
        {
          departureDate: { type: Date, required: true },
          endDate: { type: Date, default: null },
          seatsTotal: { type: Number, default: 0 },     // tổng ghế của lịch khởi hành này
          seatsRemaining: { type: Number, default: 0 }, // ghế còn lại của lịch khởi hành này
        },
      ],
      default: [],
      _id: false,
    },
    information: String,
    schedules: Array,
    // Giữ lại 2 trường cấp tour cho backward-compatibility (dữ liệu cũ / API cũ)
    seatsTotal: Number,
    seatsRemaining: Number,

    // Điểm nổi bật, bao gồm, không bao gồm
    highlights: { type: [String], default: [] }, // Điểm nổi bật
    includes: { type: [String], default: [] }, // Bao gồm
    excludes: { type: [String], default: [] }, // Không bao gồm

    // Tags phân loại theo loại hình trải nghiệm
    tags: { type: [String], default: [] }, // Ví dụ: ["phiêu lưu", "biển", "văn hóa", "leo núi", "tham quan thành phố"]

    // Khách sạn gắn với tour (lớp trung gian Tour ↔ Hotel)
    accommodations: {
      type: [
        {
          hotel: { type: Types.ObjectId, ref: "Hotel", required: true },
          note: { type: String, default: "" }, // VD: "Đêm 1-2", "Toàn bộ tour"
        },
      ],
      default: [],
    },

    ratingAvg: { type: Number, default: 0 }, // ví dụ 4.6
    ratingCount: { type: Number, default: 0 }, // ví dụ 27

    // Audit
    createdBy: String,
    updatedBy: String,

    // Slug
    slug: { type: String, slug: "name", unique: true },

    // Soft delete
    deleted: { type: Boolean, default: false },
    deletedBy: String,
    deletedAt: Date,
  },
  {
    timestamps: true, // createdAt, updatedAt
    collection: "tours",
  }
);

const Tour = mongoose.model("Tour", schema);
module.exports = Tour;
