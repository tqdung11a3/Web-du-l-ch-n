const Contact = require("../../models/contact.model");
const moment = require("moment");

module.exports.list = async (req, res) => {
  const contactList = await Contact.find({
    deleted: false,
  }).sort({
    createdAt: "desc",
  });

  for (const item of contactList) {
    item.createdAtFormat = moment(item.createdAt).format("HH:mm - DD/MM/YYYY");
  }

  res.render("admin/pages/contact-list", {
    pageTitle: "Thông tin liên hệ",
    contactList: contactList,
  });
};
