// routes/admin/hotel.route.js
const router = require("express").Router();
const hotelController = require("../../controllers/admin/hotel.controller");
const hotelValidate = require("../../validates/admin/hotel.validate");
const multer = require("multer");
const cloudinaryHelper = require("../../helpers/cloudinary.helper");
const upload = multer({ storage: cloudinaryHelper.storage });
const hotelListMiddleware = require("../../middlewares/admin/hotel-list.middleware");

// Middleware: Lấy danh sách khách sạn cho tất cả routes
router.use(hotelListMiddleware.getHotelList);

// ========== HOTEL CRUD CHÍNH ==========

// Dashboard khách sạn
router.get("/dashboard", hotelController.dashboard);

// API: doanh thu từng ngày trong tháng
router.get("/dashboard/daily-revenue", hotelController.dailyRevenue);

// ========== QUẢN LÝ ĐẶT PHÒNG ==========
// Danh sách đặt phòng
router.get("/booking/list", hotelController.bookingList);

// Chi tiết đặt phòng
router.get("/booking/detail/:bookingId", hotelController.bookingDetail);

// Quản lý số phòng
router.get("/booking/room-management", hotelController.roomManagement);

// Assign phòng cho booking
router.post("/booking/assign-room", hotelController.assignRoom);

// Huỷ xếp phòng
router.post("/booking/unassign-room", hotelController.unassignRoom);

// Cập nhật trạng thái booking
router.post("/booking/update-status", hotelController.updateBookingStatus);

// Cập nhật thông tin khách hàng của đơn đặt phòng
router.patch("/booking/update-guest/:bookingCode", hotelController.updateGuestInfo);

// Xóa đơn đặt phòng
router.post("/booking/delete", hotelController.deleteBooking);

// Lịch phòng
router.get("/booking/calendar", hotelController.bookingCalendar);

// Danh sách khách hàng đã xếp phòng
router.get("/booking/guest-list", hotelController.guestList);

// Phòng đang giữ cho tour
router.get("/booking/tour-holds", hotelController.tourHolds);

// Giải phóng phòng giữ chỗ tour chưa gán khách
router.post("/booking/release-holds", hotelController.releaseHolds);

// Danh sách khách sạn
router.get("/list", hotelController.list);

// Tạo khách sạn
router.get("/create", hotelController.create);

router.post(
  "/create",
  upload.fields([
    { name: "avatar", maxCount: 1 },
    { name: "images", maxCount: 10 },
    { name: "highlightImages", maxCount: 20 },
    { name: "facilityImages", maxCount: 30 },
  ]),
  hotelValidate.createPost,
  hotelController.createPost
);

// Thùng rác
router.get("/trash", hotelController.trash);

// Chỉnh sửa khách sạn
router.get("/edit/:id", hotelController.edit);

router.patch(
  "/edit/:id",
  upload.fields([
    { name: "avatar", maxCount: 1 },
    { name: "images", maxCount: 10 },
    { name: "highlightImages", maxCount: 20 },
    { name: "facilityImages", maxCount: 30 },
  ]),
  hotelValidate.createPost,
  hotelController.editPatch
);

// Xoá mềm / khôi phục / xoá hẳn
router.patch("/delete/:id", hotelController.deletePatch);
router.patch("/undo/:id", hotelController.undoPatch);
router.delete("/destroy/:id", hotelController.destroyDelete);

// Đổi trạng thái nhiều bản ghi
router.patch("/change-multi", hotelController.changeMultiPatch);

// ========== QUẢN LÝ LOẠI PHÒNG (TỪ SIDEBAR) ==========
// Trang quản lý loại phòng - danh sách tất cả khách sạn
// PHẢI ĐẶT TRƯỚC route /:hotelId/room-types/manage để tránh conflict
router.get("/room-types", hotelController.roomTypesListPage);

// ========== DANH SÁCH PHÒNG ==========
// Danh sách phòng (hiển thị danh sách hotels)
router.get("/rooms/list", hotelController.roomsList);

// Danh sách phòng của một hotel cụ thể
router.get("/:hotelId/rooms/list", hotelController.roomsListByHotel);

// Chỉnh sửa phòng cụ thể
router.get("/:hotelId/rooms/:roomId/edit", hotelController.roomEdit);
router.patch("/:hotelId/rooms/:roomId/edit", hotelController.roomEditPatch);
router.delete("/:hotelId/rooms/:roomId", hotelController.individualRoomDelete);

// Tạo phòng mới
router.get("/rooms/create", hotelController.roomCreate);
router.post("/rooms/create", hotelController.roomCreatePost);

// ========== KHÁCH HÀNG ==========
// Quản lý khách hàng
router.get("/customers", hotelController.customersList);

// ========== THANH TOÁN ==========
// Quản lý thanh toán
router.get("/payments", hotelController.paymentsList);

// ========== BÌNH LUẬN VÀ ĐÁNH GIÁ ==========
// Danh sách đánh giá
router.get("/reviews", hotelController.reviewsList);

// ========== ROOM TYPE DETAIL (CHI TIẾT LOẠI PHÒNG) ==========
// Trang quản lý tất cả loại phòng của khách sạn
router.get("/:hotelId/room-types/manage", hotelController.roomTypesManagePage);

// Trang tạo loại phòng mới
router.get("/:hotelId/room/create", hotelController.roomTypeCreatePage);

// Submit tạo loại phòng mới
router.post(
  "/:hotelId/room/create",
  upload.fields([
    { name: "roomImages", maxCount: 10 },
  ]),
  hotelController.roomTypeCreatePost
);

// Trang chỉnh sửa chi tiết 1 loại phòng cụ thể của 1 khách sạn
// URL ví dụ:
//   /admin/hotel/64fd...abc/room/6501...xyz/edit
router.get("/:hotelId/room/:roomId/edit", hotelController.roomTypeEditPage);

// Submit form cập nhật chi tiết loại phòng
// (ở form Pug bạn dùng method="post" tới đúng URL này)
router.patch(
  "/:hotelId/room/:roomId/edit",
  upload.fields([
    { name: "roomImages", maxCount: 10 },
  ]),
  hotelController.roomTypeEditPost
);

// Xóa loại phòng
router.delete("/:hotelId/room/:roomId/delete", hotelController.roomTypeDelete);

module.exports = router;
