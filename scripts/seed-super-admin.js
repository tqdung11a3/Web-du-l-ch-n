// scripts/seed-super-admin.js
require("dotenv").config();
const databaseConfig = require("../config/database.config");
const AccountAdmin = require("../models/account-admin.model");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");

async function seedSuperAdmin() {
  try {
    await databaseConfig.connect();
    console.log("✅ Đã kết nối database");

    // Kiểm tra xem đã có Super Admin chưa
    const existingSuperAdmin = await AccountAdmin.findOne({
      isSuperAdmin: true,
      deleted: false,
    });

    if (existingSuperAdmin) {
      console.log("⚠️  Super Admin đã tồn tại:");
      console.log(`   Email: ${existingSuperAdmin.email}`);
      console.log(`   Họ tên: ${existingSuperAdmin.fullName}`);
      console.log("\n💡 Nếu muốn tạo mới, hãy xóa Super Admin hiện tại trong database.");
      process.exit(0);
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash("SuperAdmin@123", salt);

    // Tạo Super Admin
    const _id = new mongoose.Types.ObjectId();

    await AccountAdmin.create({
      _id,
      fullName: "Super Administrator",
      email: "superadmin@example.com",
      password: passwordHash,
      phone: "0900000000",
      status: "active", // ⭐ Active ngay lập tức
      isSuperAdmin: true, // ⭐ Đánh dấu là Super Admin
      // companyId: null (Super Admin không thuộc công ty nào)
      // positionCompany: null (Super Admin không có chức vụ trong công ty)
      createdBy: _id.toString(),
      updatedBy: _id.toString(),
      deleted: false,
    });

    console.log("\n🎉 Tạo Super Admin thành công!");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📧 Email:    superadmin@example.com");
    console.log("🔐 Password: SuperAdmin@123");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("\n🚀 Bạn có thể đăng nhập tại:");
    console.log("   http://localhost:5000/admin/account/login");
    console.log("\n⚠️  LƯU Ý: Hãy đổi mật khẩu sau khi đăng nhập lần đầu!\n");

    process.exit(0);
  } catch (error) {
    console.error("❌ Lỗi khi tạo Super Admin:", error);
    process.exit(1);
  }
}

seedSuperAdmin();

