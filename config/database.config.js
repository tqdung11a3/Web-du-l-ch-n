const mongoose = require('mongoose');

module.exports.connect = async () => {
  try {
    await mongoose.connect(process.env.DATABASE);
    console.log("Kết nối CSDL thành công!");
  } catch (error) {
    console.log(error);
    console.log("Kết nối CSDL thất bại!");
  }
}