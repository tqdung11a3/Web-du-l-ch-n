// scripts/fix-category-created-by.js
// Script để set tất cả categories có createdBy = Super Admin

require("dotenv").config();
const databaseConfig = require("../config/database.config");
const AccountAdmin = require("../models/account-admin.model");
const Category = require("../models/category.model");

async function main() {
  try {
    // Kết nối database
    await databaseConfig.connect();
    console.log("✅ Đã kết nối database");

    // Tìm Super Admin
    const superAdmin = await AccountAdmin.findOne({
      isSuperAdmin: true,
      deleted: { $ne: true },
    });

    if (!superAdmin) {
      console.error("❌ Không tìm thấy Super Admin!");
      process.exit(1);
    }

    console.log(`✅ Tìm thấy Super Admin: ${superAdmin.fullName} (${superAdmin.email})`);
    console.log(`   ID: ${superAdmin._id}`);

    // Đếm số categories cần update
    const totalCategories = await Category.countDocuments({
      deleted: { $ne: true },
    });

    console.log(`\n📊 Tổng số danh mục cần cập nhật: ${totalCategories}`);

    // Update tất cả categories
    const result = await Category.updateMany(
      {
        deleted: { $ne: true },
      },
      {
        $set: {
          createdBy: superAdmin._id.toString(),
        },
      }
    );

    console.log(`\n✅ Đã cập nhật ${result.modifiedCount} danh mục`);
    console.log(`   - Tổng số danh mục: ${result.matchedCount}`);
    console.log(`   - Số danh mục đã sửa: ${result.modifiedCount}`);

    // Kiểm tra lại
    const categoriesWithoutCreator = await Category.countDocuments({
      deleted: { $ne: true },
      $or: [
        { createdBy: { $exists: false } },
        { createdBy: null },
        { createdBy: "" },
      ],
    });

    if (categoriesWithoutCreator > 0) {
      console.log(`\n⚠️  Còn ${categoriesWithoutCreator} danh mục chưa có người tạo`);
    } else {
      console.log(`\n✅ Tất cả danh mục đã có người tạo là Super Admin`);
    }

    console.log("\n✅ Hoàn thành!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Lỗi:", error);
    process.exit(1);
  }
}

main();

