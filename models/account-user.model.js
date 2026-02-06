const mongoose = require("mongoose");

const AccountUser = mongoose.model(
  "AccountUser",
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
    toursCount: { type: Number, default: 0 },
  },
  "accounts-user"
);

module.exports = AccountUser;
