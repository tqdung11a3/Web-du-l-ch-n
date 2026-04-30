// models/audit-log.model.js
const mongoose = require("mongoose");

const schema = new mongoose.Schema(
  {
    // Actor: có thể là Admin (AccountAdmin) hoặc User (AccountUser) hoặc hệ thống.
    actorId: { type: mongoose.Schema.Types.ObjectId },
    actorRef: {
      type: String,
      enum: ["AccountAdmin", "AccountUser", "System"],
      default: "AccountAdmin",
    },
    actorName: { type: String, default: "" },
    actorEmail: { type: String, default: "" },

    // Vai trò ở thời điểm ghi log
    actorRole: {
      type: String,
      enum: ["super_admin", "company_admin", "customer", "system"],
      default: "company_admin",
      index: true,
    },
    // Giữ lại để tương thích bản cũ
    actorIsSuperAdmin: { type: Boolean, default: false },

    // Công ty của actor (nếu có) — company_admin → luôn có; super_admin override → actor vẫn là super admin
    actorCompanyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company" },

    action: { type: String, required: true, index: true },
    resourceType: { type: String, default: "", index: true },
    resourceId: { type: String, default: "" },
    resourceLabel: { type: String, default: "" }, // tên/code gợi nhớ: tên tour, mã đơn,…

    // Khi super admin thao tác với tư cách công ty X
    asCompanyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company" },

    // Diff: trạng thái trước/sau (key → value). Chỉ những field thật sự thay đổi.
    before: { type: mongoose.Schema.Types.Mixed, default: {} },
    after: { type: mongoose.Schema.Types.Mixed, default: {} },

    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    summary: { type: String, default: "" }, // mô tả ngắn gọn tiếng Việt để hiển thị nhanh

    ip: { type: String, default: "" },
    userAgent: { type: String, default: "" },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

schema.index({ createdAt: -1 });
schema.index({ resourceType: 1, resourceId: 1 });
schema.index({ actorRole: 1, createdAt: -1 });
schema.index({ actorCompanyId: 1, createdAt: -1 });

const AuditLog = mongoose.model("AuditLog", schema, "audit_logs");

module.exports = AuditLog;
