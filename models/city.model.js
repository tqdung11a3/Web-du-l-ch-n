const mongoose = require("mongoose");

const schema = new mongoose.Schema({
  name: { type: String, required: true },
  nameEn: { type: String, default: "" }, // Tên tiếng Anh
  description: { type: String, default: "" },
  status: { type: String, enum: ["active", "inactive"], default: "active" },
  position: { type: Number, default: 0 },
  deleted: {
    type: Boolean,
    default: false,
  },
  deletedAt: Date,
  deletedBy: String,
}, {
  timestamps: true,
});

const City = mongoose.model("City", schema, "cities");

module.exports = City;
