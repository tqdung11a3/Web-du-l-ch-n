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
  },
  {
    timestamps: true, // Tự động sinh ra trường createdAt và updatedAt
  }
);

const AccountAdmin = mongoose.model("AccountAdmin", schema, "accounts-admin");

module.exports = AccountAdmin;
