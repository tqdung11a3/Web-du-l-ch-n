// scripts/check-and-fix-super-admin.js
require("dotenv").config();
const databaseConfig = require("../config/database.config");
const AccountAdmin = require("../models/account-admin.model");

async function checkAndFix() {
  try {
    await databaseConfig.connect();
    console.log("✅ Đã kết nối database\n");

    // Tìm account superadmin@example.com
    const superAdmin = await AccountAdmin.findOne({
      email: "superadmin@example.com",
      deleted: false,
    });

    if (!superAdmin) {
      console.log("❌ Không tìm thấy tài khoản superadmin@example.com!");
      console.log("Chạy: npm run seed:super-admin");
      process.exit(1);
    }

    console.log("📊 Thông tin hiện tại:");
    console.log(`   Email: ${superAdmin.email}`);
    console.log(`   isSuperAdmin: ${superAdmin.isSuperAdmin}`);
    console.log(`   Status: ${superAdmin.status}`);
    console.log(`   CompanyId: ${superAdmin.companyId || "null"}\n`);

    if (superAdmin.isSuperAdmin === true) {
      console.log("✅ Tài khoản đã có flag isSuperAdmin = true");
      console.log("\n🔧 Vui lòng:");
      console.log("   1. Xóa cookies trong trình duyệt (F12 → Application → Cookies → xóa 'token')");
      console.log("   2. Hoặc mở Incognito/Private browsing");
      console.log("   3. Đăng nhập lại\n");
    } else {
      console.log("⚠️  Flag isSuperAdmin chưa đúng! Đang sửa...\n");
      
      await AccountAdmin.updateOne(
        { _id: superAdmin._id },
        {
          isSuperAdmin: true,
          companyId: null,
          positionCompany: null,
        }
      );

      console.log("✅ Đã cập nhật thành công!");
      console.log("\n🔧 Vui lòng:");
      console.log("   1. Xóa cookies trong trình duyệt");
      console.log("   2. Đăng nhập lại\n");
    }

    process.exit(0);
  } catch (error) {
    console.error("❌ Lỗi:", error);
    process.exit(1);
  }
}

checkAndFix();

