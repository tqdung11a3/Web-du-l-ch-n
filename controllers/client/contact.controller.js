const Contact = require("../../models/contact.model");

module.exports.createPost = async (req, res) => {
  const { email } = req.body;

  const existEmail = await Contact.findOne({
    email: email,
    deleted: false,
  });

  if (existEmail) {
    res.json({
      code: "error",
      message: "Email của bạn đã từng đăng ký!",
    });
    return;
  }

  const newRecord = new Contact({
    email: email,
  });
  await newRecord.save();

  res.json({
    code: "success",
    message: "Chúc mừng bạn đã đăng ký nhận tin thành công!",
  });
};
