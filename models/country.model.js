const mongoose = require("mongoose");
const slug = require("mongoose-slug-updater");
mongoose.plugin(slug);

const schema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    nameEn: { type: String, default: "" }, // Tên tiếng Anh
    code: { type: String, default: "" }, // Mã quốc gia (VD: FR, DE, IT)
    continent: { type: String, default: "" }, // Châu lục (VD: Europe, Asia)
    status: { type: String, enum: ["active", "inactive"], default: "active" },
    position: { type: Number, default: 0 },
    slug: {
      type: String,
      slug: "name",
      unique: true,
    },
    deleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: Date,
    deletedBy: String,
  },
  {
    timestamps: true,
  }
);

const Country = mongoose.model("Country", schema, "countries");

module.exports = Country;

