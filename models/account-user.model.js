const mongoose = require("mongoose");

const accountUserSchema = new mongoose.Schema(
  {
    fullName: String,
    email: String,
    password: String,
    phone: String,
    gender: String,
    birthday: String,
    idNumber: String,
    nationality: String,
    address: String,
  },
  {
    collection: "accounts-user",
    timestamps: true,
  }
);

module.exports = mongoose.model("AccountUser", accountUserSchema);
