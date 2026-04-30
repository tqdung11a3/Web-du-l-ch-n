const mongoose = require("mongoose");

const schema = new mongoose.Schema({
  websiteName: String,
  phone: String,
  email: String,
  address: String,
  logo: String,
  favicon: String,
  /** @deprecated Giữ để tương thích; ưu tiên dùng categoryIdsSection4 */
  categoryIdSection4: String,
  /** Danh mục hiển thị Section 4 trên trang chủ (thứ tự giữ nguyên) */
  categoryIdsSection4: { type: [String], default: [] },
  hotelSearchBreadcrumbImage: String, // Ảnh breadcrumb cho trang /hotel/search
});

const SettingWebsiteInfo = mongoose.model(
  "SettingWebsiteInfo",
  schema,
  "setting-website-info"
);

module.exports = SettingWebsiteInfo;
