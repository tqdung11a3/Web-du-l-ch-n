module.exports.pathAdmin = "admin";

module.exports.paymentMethodList = [
  {
    label: "Tiền mặt",
    value: "money",
  },
  {
    label: "Chuyển khoản",
    value: "bank",
  },
  {
    label: "VNPay",
    value: "vnpay",
  },
];

module.exports.paymentStatusList = [
  {
    label: "Chưa thanh toán",
    value: "unpaid",
  },
  {
    label: "Đã thanh toán",
    value: "paid",
  },
];

module.exports.statusList = [
  {
    label: "Khởi tạo",
    value: "initial",
    color: "orange",
  },
  {
    label: "Hoàn thành",
    value: "done",
    color: "green",
  },
  {
    label: "Đã hủy",
    value: "cancel",
    color: "red",
  },
];
