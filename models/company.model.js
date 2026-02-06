// models/company.model.js
const mongoose = require("mongoose");

const companySchema = new mongoose.Schema(
  {
    // Cơ bản
    name: { type: String, required: true, trim: true, unique: true },
    slug: { type: String, required: true, unique: true, lowercase: true },
    status: { type: String, enum: ["active", "inactive"], default: "active" },

    // Hiển thị thương hiệu
    logo: { type: String, default: "" }, // URL ảnh logo
    coverImage: { type: String, default: "" }, // URL ảnh bìa/cover
    banner: { type: String, default: "" },
    description: { type: String, default: "" }, // HTML/markdown mô tả công ty
    overview: { type: String, default: "" }, // Thông tin tổng quan để hiển thị ở client
    tradeName: { type: String, default: "" }, // Tên giao dịch nếu có
    foundedAt: { type: Date }, // Năm/thời điểm thành lập
    size: { type: String, default: "" }, // Quy mô: "1-10", "11-50", ...

    // Pháp lý
    taxCode: { type: String, default: "" }, // Mã số thuế
    licenseNo: { type: String, default: "" }, // Số giấy phép lữ hành

    // Liên hệ/địa chỉ
    headquarters: { type: String, default: "" }, // Trụ sở chính (tỉnh/thành)
    address: { type: String, default: "" }, // Địa chỉ chi tiết
    hotline: { type: String, default: "" },
    email: { type: String, default: "" },
    website: { type: String, default: "" },

    // Mạng xã hội
    facebook: { type: String, default: "" },
    instagram: { type: String, default: "" },
    tiktok: { type: String, default: "" },

    // Người phụ trách (nếu muốn hiện)
    contactPerson: { type: String, default: "" },
    contactPhone: { type: String, default: "" },

    // Chính sách
    cancelPolicyTour: { type: String, default: "" }, // Chính sách hủy tour
    cancelPolicyHotel: { type: String, default: "" }, // Chính sách hủy đặt phòng khách sạn

    // Audit & soft delete (đồng bộ với các model khác của bạn)
    createdBy: { type: String, default: "" },
    updatedBy: { type: String, default: "" },
    deleted: { type: Boolean, default: false },
    deletedAt: { type: Date },
    deletedBy: { type: String, default: "" },
  },
  { timestamps: true }
);

// Helper tạo slug đơn giản (giữ nguyên như bạn đang dùng)
companySchema.statics.slugify = function (name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
};

// Tự sinh slug nếu người gọi quên truyền
companySchema.pre("validate", function (next) {
  if (!this.slug && this.name) {
    this.slug = this.constructor.slugify(this.name);
  }
  next();
});

module.exports = mongoose.model("Company", companySchema);
