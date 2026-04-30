const mongoose = require("mongoose");

const schema = new mongoose.Schema(
  {
    fullName: String,
    email: String,
    phone: String,
    role: String,
    positionCompany: String,
    status: String, // initial: Khởi tạo, active: Hoạt động, inactive: Tạm dừng
    password: String,
    avatar: String,
    
    // ⭐ SUPER ADMIN FLAG
    isSuperAdmin: {
      type: Boolean,
      default: false,
    },
    
    // CompanyId: REQUIRED cho company admin, NULL cho super admin
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: function() {
        // Chỉ required khi KHÔNG phải super admin
        return !this.isSuperAdmin;
      },
    },
    
    createdBy: String,
    updatedBy: String,
    deleted: {
      type: Boolean,
      default: false,
    },
    deletedBy: String,
    deletedAt: Date,

    /**
     * Phạm vi tab Tour / Khách sạn — do company admin cấu hình tại Cài đặt → Tài khoản quản trị.
     * inherit: áp dụng tour-access/hotel-access trên Role (tương thích dữ liệu cũ).
     */
    tabAccessScope: {
      type: String,
      enum: ["inherit", "full", "tour_only", "hotel_only"],
      default: "inherit",
    },
  },
  {
    timestamps: true, // Tự động sinh ra trường createdAt và updatedAt
  }
);

const AccountAdmin = mongoose.model("AccountAdmin", schema, "accounts-admin");

module.exports = AccountAdmin;
