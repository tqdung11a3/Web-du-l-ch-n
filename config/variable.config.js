module.exports.pathAdmin = "admin";

module.exports.permissionList = [
  {
    label: "Xem trang Tổng quan",
    value: "dashboard-view",
  },
  {
    label: "Xem danh mục",
    value: "category-view",
  },
  {
    label: "Tạo danh mục",
    value: "category-create",
  },
  {
    label: "Sửa danh mục",
    value: "category-edit",
  },
  {
    label: "Xóa danh mục",
    value: "category-delete",
  },
];

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
