// scripts/fix-super-admin-fields.js
require("dotenv").config();
const databaseConfig = require("../config/database.config");
const AccountAdmin = require("../models/account-admin.model");

async function fixSuperAdminFields() {
  try {
    await databaseConfig.connect();
    console.log("✅ Đã kết nối database\n");

    // Update tất cả Super Admin để xóa fields không cần thiết
    const result = await AccountAdmin.updateMany(
      { isSuperAdmin: true },
      {
        $unset: {
          positionCompany: "", // Xóa field positionCompany
        },
        // companyId đã được set null ở model nên không cần unset
      }
    );

    console.log(`✅ Đã cập nhật ${result.modifiedCount} Super Admin`);
    console.log("\n📋 Kết quả:");
    console.log("   - positionCompany: đã xóa (không cần cho Super Admin)");
    console.log("   - companyId: null (Super Admin không thuộc công ty)\n");

    // Hiển thị Super Admin sau khi update
    const superAdmins = await AccountAdmin.find({
      isSuperAdmin: true,
      deleted: false,
    })
      .select("fullName email positionCompany companyId")
      .lean();

    console.log("📊 Super Admin sau khi cập nhật:");
    superAdmins.forEach((admin) => {
      console.log(`\n   ${admin.fullName}`);
      console.log(`   Email: ${admin.email}`);
      console.log(`   positionCompany: ${admin.positionCompany || "null ✅"}`);
      console.log(`   companyId: ${admin.companyId || "null ✅"}`);
    });

    process.exit(0);
  } catch (error) {
    console.error("❌ Lỗi:", error);
    process.exit(1);
  }
}

fixSuperAdminFields();

