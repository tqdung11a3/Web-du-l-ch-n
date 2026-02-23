## Chức năng hệ thống (Client & Company Admin)

### 1. Chức năng phía **Client** (khách hàng)

#### 1.1. Trang chủ & điều hướng chung
- **Trang chủ** (`GET /`)
  - Hiển thị banner, khối tour nội địa, khối gợi ý tour, form tìm kiếm nhanh theo:
    - Điểm đến / loại tour
    - Số ngày
    - Ngân sách
    - Số lượng khách
  - Hiển thị danh sách tour nổi bật, tour mới, tour khuyến mãi (theo cấu hình admin).
- **Thanh điều hướng**
  - Liệt kê các danh mục tour chính (đã được lọc ẩn Tour Nước Ngoài nếu cần).
  - Link tới:
    - Trang danh mục tour (`/category/:slug`)
    - Trang tìm kiếm (`/search`)
    - Trang công ty (`/company`)
    - Trang tin tức (`/news`)
    - Trang liên hệ (form contact).

#### 1.2. Tài khoản khách hàng (`/account`)
- **Đăng ký** (`GET /account/register`, `POST /account/register`)
  - Tạo tài khoản với các thông tin cơ bản (email, mật khẩu, họ tên,...).
  - Validate dữ liệu phía server.
- **Đăng nhập** (`GET /account/login`, `POST /account/login`)
  - Đăng nhập bằng email/số điện thoại + mật khẩu.
  - Bảo vệ route cho các chức năng cần đăng nhập (profile, review,...).
- **Đăng xuất** (`POST /account/logout`)
  - Xóa token phiên, đưa user về trạng thái khách.
- **Trang hồ sơ** (`GET /account/profile`, `PATCH /account/profile`)
  - Xem thông tin tài khoản: họ tên, email, số điện thoại.
  - Cập nhật thông tin cá nhân.
  - Tab lịch sử đơn hàng tour / đặt phòng khách sạn (để khách xem lại).

#### 1.3. Tour du lịch – tìm kiếm, xem chi tiết, so sánh
- **Trang danh mục tour** (`GET /category/:slug`)
  - Liệt kê tour theo danh mục (VD: tour trong nước, tour miền Bắc, tour 4N3Đ...).
  - Bộ lọc:
    - Số ngày (theo query `q` như `4N3`).
    - Số chỗ còn lại (theo số khách nhập).
  - Hiển thị mỗi tour:
    - Tên, ảnh đại diện, giá người lớn/trẻ em/em bé.
    - Ngày khởi hành, số chỗ còn lại ***theo từng ngày khởi hành***.
- **Tìm kiếm tour** (`GET /search`)
  - Tìm theo:
    - Tên tour (từ khóa).
    - Số lượng khách (kiểm tra số ghế còn lại theo từng lịch khởi hành).
    - Khoảng giá, khu vực,...
- **Trang chi tiết tour** (`GET /tour/detail/:slug`)
  - Thông tin chung tour:
    - Tên, mã, mô tả, lịch trình, điểm nổi bật, thông tin bao gồm/không bao gồm.
  - Lịch khởi hành:
    - Danh sách ngày đi – ngày về.
    - Số ghế tổng, số ghế còn lại theo từng departure.
  - Giá:
    - Giá người lớn, trẻ em, em bé (kèm logic tính giá em bé nhiều bậc).
  - Các khách sạn liên quan (nếu có cấu hình).
- **Danh sách tour khuyến mãi** (`GET /tour/discount`)
  - Liệt kê các tour đang chạy chương trình giảm giá (theo cấu hình admin).
- **So sánh tour** (`GET /tour/compare?ids=...`)
  - So sánh nhiều tour theo bảng:
    - Tên tour, giá, thời lượng.
    - Lịch khởi hành + số chỗ còn lại ***theo từng ngày khởi hành***.
    - Các thông số dịch vụ khác.

#### 1.4. Giỏ hàng tour & đặt tour
- **Giỏ hàng tour** (`routes/client/cart.route.js`)
  - `GET /cart`:
    - Render trang giỏ hàng tour.
    - Cho phép chỉnh sửa số lượng khách trên giao diện.
  - `POST /cart/detail`:
    - API lấy chi tiết giỏ hàng tour (dành cho JS phía client).
- **Đặt tour & thanh toán** (`routes/client/order.route.js`)
  - `POST /order/create`:
    - Tạo đơn hàng tour từ dữ liệu giỏ hàng:
      - Các item tour: tourId, ngày khởi hành, số lượng người lớn/trẻ em/em bé, thông tin khách (tên, điện thoại, email).
      - Ảnh CCCD/Hộ chiếu (upload qua `/upload/images`).
    - Kiểm tra & trừ số ghế còn lại:
      - Ở cấp tour tổng (`seatsRemaining`).
      - Ở cấp từng lịch khởi hành (`departures[].seatsRemaining`).
    - Lưu đơn hàng với trạng thái:
      - `paymentStatus`: unpaid/paid.
      - `status`: initial/done/cancel.
  - `GET /order/pending`:
    - Trang “chờ thanh toán” (nếu dùng VNPay).
  - `GET/POST /order/cancel-hold`:
    - Hủy đơn giữ chỗ (chưa thanh toán) và hoàn lại số ghế cho tour.
  - `GET /order/success`:
    - Trang thông báo đặt tour thành công.
  - `GET /order/payment-vnpay`, `GET /order/payment-vnpay-result`:
    - Tích hợp VNPay cho thanh toán tour.

#### 1.5. Khách sạn – tìm kiếm, chi tiết, đánh giá
- **Tìm kiếm khách sạn** (`GET /hotel/search`)
  - Tham số: `cityCode`, `checkInDate`, `checkOutDate`, `adults`, ...
  - Hiển thị danh sách khách sạn:
    - Tên, địa chỉ, hạng sao, giá tham khảo.
    - Bộ lọc và sắp xếp theo giá, vị trí, đánh giá.
- **So sánh khách sạn** (`GET /hotel/compare`)
  - So sánh nhiều khách sạn:
    - Giá, tiện nghi, vị trí, chính sách.
- **Chi tiết khách sạn** (`GET /hotel/detail/:id`)
  - Thông tin khách sạn:
    - Tên, mô tả, địa chỉ, hình ảnh, tiện nghi.
  - Danh sách loại phòng:
    - Giá, sức chứa, số giường, tiện nghi trong phòng.
  - Review & điểm đánh giá.
- **Chọn phòng & đặt phòng**:
  - `GET /hotel/room-select`:
    - Màn hình chọn phòng theo khoảng ngày & số khách.
  - `GET /hotel/booking`:
    - Trang booking từ kết quả chọn phòng.

#### 1.6. Giỏ khách sạn & đặt phòng
- **Giỏ khách sạn** (`routes/client/hotel-cart.route.js`)
  - `GET /hotel-cart`:
    - Trang giỏ phòng khách sạn.
  - `POST /hotel-cart/add`:
    - Thêm phòng vào giỏ (theo hotelId, roomType, ngày, số lượng).
  - `PATCH /hotel-cart/update-quantity`:
    - Cập nhật số lượng phòng.
  - `DELETE /hotel-cart/remove`:
    - Xóa 1 dòng phòng khỏi giỏ.
  - `DELETE /hotel-cart/clear`:
    - Xóa toàn bộ giỏ phòng.
  - `GET /hotel-cart/count`:
    - Lấy số lượng item trong giỏ (hiển thị badge).
  - `GET /hotel-cart/check-availability`:
    - Kiểm tra lại tình trạng phòng trống trước khi thanh toán.
- **Đặt phòng & thanh toán** (`routes/client/hotel-booking.route.js`)
  - `POST /hotel-booking/create`:
    - Tạo booking khách sạn:
      - Thông tin khách: tên, điện thoại, email, ảnh CCCD/Hộ chiếu.
      - Thông tin phòng: số phòng, loại phòng, ngày ở, dịch vụ kèm.
  - `GET /hotel-booking/pending`:
    - Trang chờ thanh toán VNPay nếu chọn VNPay.
  - `GET/POST /hotel-booking/cancel-hold`:
    - Hủy đơn giữ chỗ khách sạn nếu chưa thanh toán.
  - `GET /hotel-booking/success`:
    - Trang thông báo đặt phòng thành công (hiện thông tin booking, không còn nút “Xem đơn hàng của tôi / Về trang chủ” theo yêu cầu mới).
  - `GET /hotel-booking/payment-vnpay`, `GET /hotel-booking/payment-vnpay-result`:
    - Tích hợp VNPay cho booking khách sạn.

#### 1.7. Công ty du lịch & thương hiệu (`/company`)
- **Danh sách công ty** (`GET /company`)
  - Hiển thị các công ty đối tác (company admin).
- **Chi tiết công ty** (`GET /company/:slug`)
  - Thông tin thương hiệu, mô tả, liên hệ.
- **Tour & khách sạn theo công ty**:
  - `GET /company/:slug/tours` – danh sách tour của công ty.
  - `GET /company/:slug/hotels` – danh sách khách sạn của công ty.
  - `GET /company/:slug/flights` – placeholder cho dịch vụ chuyến bay.
  - `GET /company/:slug/discount` – danh sách tour khuyến mãi của công ty.
  - `GET /company/:slug/tour/detail/:tourSlug` – chi tiết tour của riêng công ty.

#### 1.8. Đánh giá (Review) & Tin tức
- **Review tour** (`routes/client/review.route.js`)
  - `GET /review/tour/:tourId/reviews`:
    - Lấy danh sách review cho 1 tour (public).
  - `POST /review/tour/:tourId/reviews`:
    - Khách hàng đã đăng nhập gửi hoặc cập nhật đánh giá:
      - Số sao, nhận xét,...
- **Review khách sạn** (`routes/client/hotel.route.js`)
  - `GET /hotel/:hotelId/reviews`:
    - Lấy danh sách đánh giá khách sạn.
  - `POST /hotel/:hotelId/reviews` (yêu cầu đăng nhập):
    - Tạo/cập nhật đánh giá khách sạn.
- **Tin tức** (`routes/client/news.route.js`)
  - `GET /news`:
    - Danh sách bài tin, blog du lịch.
  - `GET /news/:slug`:
    - Chi tiết bài viết.

#### 1.9. Liên hệ & Upload CCCD
- **Gửi form liên hệ** (`POST /contact/create`)
  - Khách gửi câu hỏi, yêu cầu hỗ trợ; lưu cho admin xử lý.
- **Upload ảnh CCCD / Hộ chiếu** (`POST /upload/images`)
  - Dùng Cloudinary:
    - Upload nhiều ảnh (tối đa 10).
    - Trả về URL để lưu vào đơn tour/hotel.

---

### 2. Chức năng **Company Admin** (vùng `/admin`)

> Các route company admin đều qua middleware `authMiddleware.verifyToken` và `notificationMiddleware.getUnreadCount` (trừ `/admin/account` và `/admin/super-admin`).

#### 2.1. Tài khoản admin & super admin (`/admin/account`, `/admin/super-admin`)
- **Đăng nhập / đăng ký admin** (`routes/admin/account.route.js`)
  - `GET /admin/account/login`, `POST /admin/account/login` – đăng nhập.
  - `GET /admin/account/register`, `POST /admin/account/register` – đăng ký admin.
  - Flow quên mật khẩu:
    - `GET/POST /admin/account/forgot-password`
    - `GET/POST /admin/account/otp-password`
    - `GET/POST /admin/account/reset-password`
  - `POST /admin/account/logout` – đăng xuất admin.
- **Super admin** (`/admin/super-admin/...`)
  - Có file route riêng, dùng cho quản trị cấp cao (không chi tiết ở đây nếu bạn đang focus company admin).

#### 2.2. Dashboard & báo cáo (`/admin/dashboard`)
- **Trang tổng quan** (`GET /admin/dashboard`)
  - Thống kê doanh thu / đơn hàng / booking theo khoảng thời gian.
- **Biểu đồ doanh thu** (`POST /admin/dashboard/revenue-chart`)
  - API lấy dữ liệu vẽ chart doanh thu theo tháng/năm.

#### 2.3. Quản lý tour du lịch (`/admin/tour`)
- **Danh sách tour** (`GET /admin/tour`, `/admin/tour/list`)
  - Liệt kê tour của công ty:
    - Bộ lọc trạng thái, tìm kiếm theo tên mã.
    - Thao tác: chỉnh sửa, xóa mềm, khôi phục, xóa vĩnh viễn.
- **Tạo tour** (`GET /admin/tour/create`, `POST /admin/tour/create`)
  - Form đầy đủ:
    - Thông tin cơ bản, giá người lớn/trẻ em/em bé.
    - Ảnh đại diện, album ảnh (upload Cloudinary).
    - Lịch trình, mô tả chi tiết, điểm nổi bật.
    - Cấu hình `departures[]`: ngày khởi hành, ngày kết thúc, `seatsTotal`, `seatsRemaining`.
- **Chỉnh sửa tour** (`GET /admin/tour/edit/:id`, `PATCH /admin/tour/edit/:id`)
  - Update mọi thông tin tour, bao gồm:
    - Thêm/sửa/xóa lịch khởi hành, thay đổi `seatsTotal`, `seatsRemaining`.
    - Cập nhật ảnh, nội dung, giá.
- **Quản lý tour khuyến mãi**:
  - `GET /admin/tour/discounts` – danh sách tour đang áp dụng giảm giá của công ty.
  - `PATCH /admin/tour/discount/:id` – cập nhật thông tin giảm giá cho 1 tour.
  - `PATCH /admin/tour/discount/:id/cancel` – hủy giảm giá.
  - `POST /admin/tour/bulk-discount` – áp dụng giảm giá hàng loạt cho nhiều tour.
- **Quản lý tuổi khách (Age bands)**:
  - `PATCH /admin/tour/age-bands` – lưu cấu hình độ tuổi (infant/child/adult) dùng cho nhiều tour.
- **Thùng rác & bulk actions**:
  - `GET /admin/tour/trash` – danh sách tour đã xóa mềm.
  - `PATCH /admin/tour/delete/:id` – xóa mềm.
  - `PATCH /admin/tour/undo/:id` – khôi phục.
  - `DELETE /admin/tour/destroy/:id` – xóa vĩnh viễn.
  - `PATCH /admin/tour/change-multi` – đổi trạng thái nhiều tour cùng lúc.

#### 2.4. Quản lý khách sạn & phòng (`/admin/hotel`)

##### 2.4.1. Quản lý khách sạn
- **Danh sách khách sạn** (`GET /admin/hotel/list`)
  - Bộ lọc hotel theo trạng thái, tìm kiếm.
- **Tạo khách sạn** (`GET /admin/hotel/create`, `POST /admin/hotel/create`)
  - Thông tin:
    - Tên, địa chỉ, mô tả, cityCode, tiện nghi.
    - Ảnh: avatar, gallery, highlight images, facility images.
    - Cấu hình `ageBands` (dùng cho giá ăn sáng, extra bed,...).
- **Chỉnh sửa khách sạn** (`GET /admin/hotel/edit/:id`, `PATCH /admin/hotel/edit/:id`)
  - Cập nhật toàn bộ thông tin trên.
- **Thùng rác & thao tác nhiều bản ghi**:
  - `GET /admin/hotel/trash`
  - `PATCH /admin/hotel/delete/:id`, `PATCH /admin/hotel/undo/:id`, `DELETE /admin/hotel/destroy/:id`
  - `PATCH /admin/hotel/change-multi` – đổi trạng thái nhiều khách sạn.

##### 2.4.2. Quản lý loại phòng & phòng cụ thể
- **Quản lý loại phòng toàn hệ thống**:
  - `GET /admin/hotel/room-types` – danh sách loại phòng của tất cả khách sạn (overview).
- **Danh sách phòng**:
  - `GET /admin/hotel/rooms/list` – danh sách phòng (theo khách sạn).
  - `GET /admin/hotel/:hotelId/rooms/list` – danh sách phòng của 1 khách sạn.
- **CRUD phòng**:
  - `GET /admin/hotel/:hotelId/rooms/:roomId/edit`, `PATCH /admin/hotel/:hotelId/rooms/:roomId/edit`
  - `GET /admin/hotel/rooms/create`, `POST /admin/hotel/rooms/create`
- **Quản lý loại phòng chi tiết cho 1 khách sạn**:
  - `GET /admin/hotel/:hotelId/room-types/manage` – danh sách loại phòng của khách sạn.
  - `GET/POST /admin/hotel/:hotelId/room/create` – tạo loại phòng mới (ảnh roomImages, sức chứa, giá,...).
  - `GET/PATCH /admin/hotel/:hotelId/room/:roomId/edit` – chỉnh sửa loại phòng.
  - `DELETE /admin/hotel/:hotelId/room/:roomId/delete` – xóa loại phòng.

##### 2.4.3. Quản lý đặt phòng khách sạn (booking)
- **Danh sách đặt phòng** (`GET /admin/hotel/booking/list`)
  - Bảng booking của khách sạn:
    - Thông tin khách (tên, email, SĐT).
    - Ngày đặt, thời gian lưu trú, loại phòng, số phòng, số người.
    - Số tiền, trạng thái thanh toán, trạng thái booking (pending/confirmed/checked_in/checked_out/cancelled).
  - Cột Thao tác:
    - Xem chi tiết (`/admin/hotel/booking/detail/:bookingId`).
    - Chỉnh sửa trạng thái (mở modal, gọi `POST /admin/hotel/booking/update-status`).
    - Xóa đơn đặt phòng (`POST /admin/hotel/booking/delete`).
- **Chi tiết booking** (`GET /admin/hotel/booking/detail/:bookingId`)
  - Gộp các booking con cùng base code:
    - Thông tin khách, khách sạn, ngày ở, số đêm.
    - Chi tiết các phòng (roomsDetails).
    - Dịch vụ thêm (global/perItem).
    - Tổng tiền, phương thức thanh toán, trạng thái thanh toán.
    - Ghi chú, ảnh CCCD/Hộ chiếu của khách.
- **Quản lý số phòng (room-management)** (`GET /admin/hotel/booking/room-management`)
  - Khối “Booking cần xếp phòng”:
    - Danh sách booking chưa có `roomId`, chưa bị hủy.
    - Nút “Xếp phòng” → filter phòng trống phù hợp, chọn phòng, gọi `POST /booking/assign-room`.
  - Bảng “Tình trạng phòng”:
    - Mỗi phòng: số phòng, loại phòng, tầng, trạng thái (trống/đang sử dụng).
    - Nút “Xem chi tiết” hiển thị các booking (kể cả đã trả phòng / đã hủy) trong modal:
      - Thể hiện rõ trạng thái: chờ, đã xác nhận, đã nhận, đã trả, đã hủy.
      - **Nút “Huỷ xếp phòng”**: trả booking về trạng thái chưa gán phòng (roomId=null) cho booking thường.
      - **Nút “Xóa”**: chỉ hiển thị khi booking đã “Đã trả phòng” hoặc “Đã hủy”; cho phép xóa booking group khỏi hệ thống.
- **Lịch phòng** (`GET /admin/hotel/booking/calendar`)
  - Lịch dạng gantt theo phòng:
    - Mỗi dòng là 1 phòng.
    - Trục ngang là ngày theo tháng.
    - Thanh màu biểu diễn booking (bao gồm booking tour-hold).
    - Popup chi tiết booking khi click.
- **Danh sách khách đã xếp phòng** (`GET /admin/hotel/booking/guest-list`)
  - Bảng khách:
    - Tên, email, SĐT.
    - Check-in / check-out, loại phòng, số phòng.
    - Chi tiết trẻ em, mã booking, ảnh CCCD (inline).
- **Phòng giữ chỗ cho tour** (`GET /admin/hotel/booking/tour-holds`)
  - Nhóm theo tour segment:
    - Khung thời gian (Khung 1, Khung 2, ...), ngày checkin-checkout rõ ràng.
    - Danh sách phòng đang giữ cho từng khung.
  - Hành động:
    - Nhận phòng / Trả phòng / Hoàn tác (undo check-in/check-out).
    - Giải phóng phòng chưa gán khách (`POST /booking/release-holds`).

##### 2.4.4. Danh sách khách & thanh toán
- **Danh sách khách hàng** (`GET /admin/hotel/customers`)
  - Thống kê khách đã từng đặt phòng khách sạn.
- **Quản lý thanh toán** (`GET /admin/hotel/payments`)
  - Danh sách các invoice/thanh toán liên quan booking khách sạn:
    - Mã booking, khách, số phòng, số tiền.

##### 2.4.5. Đánh giá khách sạn admin (`GET /admin/hotel/reviews`)
- Xem danh sách đánh giá khách sạn từ khách hàng:
  - Tên khách, điểm số, nội dung, ngày review.

#### 2.5. Quản lý Tour–Hotel (gán khách tour vào phòng khách sạn) – `/admin/tour-hotel`
- **Danh sách tour có cấu hình khách sạn** (`GET /admin/tour-hotel/list`)
  - Chọn tour và ngày khởi hành cần gán khách sạn.
- **Cấu hình segment (khung ngày checkin/checkout)** (`GET /admin/tour-hotel/detail/:tourId?departure=YYYY-MM-DD`)
  - Cấu hình:
    - Khung thời gian lưu trú (segments) cho tour đó ở từng khách sạn.
    - `paxRequired` (số người cần bố trí phòng).
    - Đặt phòng giữ chỗ (hold) cho từng khung (HotelBooking với `tourSegmentId`).
- **Phân công khách tour vào phòng** (`GET /admin/tour-hotel/assign/:segmentId`)
  - Cột trái “Khách hàng đã đặt”:
    - Hiển thị từng đơn tour đã thanh toán:
      - Tên khách, SĐT, số lượng NL/TE/EB, độ tuổi, ghi chú từ giỏ tour (`note`), tour allocation gợi ý khách sạn.
    - Hiển thị tiến độ phân công đa khung (cho multi-segment).
  - Cột phải “Phòng đang giữ chỗ”:
    - Danh sách các booking giữ phòng từ Tour Hold, ghép với khách sạn/loại phòng.
    - Tính toán sức chứa, số người đã phân công / còn thiếu từng phòng.
  - Hành động:
    - Kéo thả/chọn khách → gán vào phòng.
    - Lưu phân công (`POST /assign/:segmentId/save`):
      - Ghi vào `tourSeg.assignments`.
      - Đồng bộ `HotelBooking.guest` (từ “[Tour Hold]” sang tên khách thật).
      - Reset lại các booking hold chưa gán khách.
- **API hỗ trợ**:
  - `/api/hotel-availability` – kiểm tra khả dụng khách sạn theo segment.
  - `/api/suggest-allocation` – gợi ý phân bổ khách theo khách sạn.
  - `/api/save-segments` – lưu cấu hình segments.
  - `/api/confirm-segments` – xác nhận cấu hình (mở màn phân công).
  - `/api/cancel-segments` – hủy cấu hình hold.

#### 2.6. Quản lý đơn hàng tour (`/admin/order`)
- **Danh sách đơn hàng** (`GET /admin/order/list`)
  - Bảng đơn tour:
    - Mã đơn, thông tin khách, danh sách tour (tên, ảnh, ngày khởi hành, số người & giá chi tiết).
    - Tổng tiền, phương thức thanh toán, trạng thái thanh toán, trạng thái đơn.
  - Thanh tìm kiếm đa trường:
    - Theo mã đơn hàng.
    - Theo tên khách.
    - Theo số điện thoại.
    - Theo tên tour.
- **Chỉnh sửa đơn** (`GET /admin/order/edit/:id`, `PATCH /admin/order/edit/:id`)
  - Cập nhật:
    - Thông tin khách (tên, SĐT, email, ghi chú).
    - Trạng thái thanh toán, phương thức thanh toán.
    - Trạng thái đơn (initial/done/cancel).
  - Hiển thị danh sách tour trong đơn:
    - Số lượng NL/TE/EB, giá từng loại, ngày khởi hành (ưu tiên `departureDateDisplay`).
- **Xóa đơn (mềm)** (`PATCH /admin/order/delete/:id`)
  - Chuyển trạng thái `deleted=true` (không hiển thị nữa).
- **Liên kết tour–hotel khi hủy đơn**:
  - Khi admin chuyển trạng thái đơn sang “Đã hủy”:
    - Gọi `restoreSeatsForOrder`:
      - Cộng lại `seatsRemaining` + stock theo đúng tour & ngày khởi hành.
    - Gọi `releaseHotelHoldsForOrder`:
      - Xóa assignments khỏi `TourSegment.assignments`.
      - Reset `HotelBooking` về `[Tour Hold]` và status `confirmed`.

#### 2.7. Danh mục, công ty, hồ sơ admin, cấu hình website

##### 2.7.1. Danh mục tour (`/admin/category`)
- **Xem danh mục** (read-only cho company admin):
  - `GET /admin/category/view` – danh sách danh mục.
  - `GET /admin/category/detail/:id` – chi tiết 1 danh mục.

##### 2.7.2. Thông tin công ty (`/admin/company`)
- `GET /admin/company/info`:
  - Xem thông tin công ty tương ứng với admin đăng nhập.
- `POST /admin/company/info`:
  - Cập nhật banner & logo công ty (upload Cloudinary).

##### 2.7.3. Hồ sơ admin (`/admin/profile`)
- `GET /admin/profile/edit`:
  - Form chỉnh sửa thông tin admin (tên, avatar,...).
- `PATCH /admin/profile/edit`:
  - Cập nhật hồ sơ (có upload avatar).
- `GET /admin/profile/change-password`:
  - Trang đổi mật khẩu.

##### 2.7.4. Cấu hình website & tài khoản admin (`/admin/setting`)
- **Website info**:
  - `GET /admin/setting/list` – tổng quan setting.
  - `GET/PATCH /admin/setting/website-info` – cấu hình:
    - Logo, favicon.
    - Thông tin hiển thị chung trên client.
- **Quản lý account admin**:
  - `GET /admin/setting/account-admin/list` – danh sách admin nội bộ.
  - `GET/POST /admin/setting/account-admin/create` – tạo admin mới (avatar, quyền).
  - `GET/PATCH /admin/setting/account-admin/edit/:id` – chỉnh sửa admin.
- **Quản lý vai trò (role)**:
  - `GET /admin/setting/role/list` – danh sách role.
  - `GET/POST /admin/setting/role/create` – tạo role.
  - `GET/PATCH /admin/setting/role/edit/:id` – sửa role.

#### 2.8. Thông báo, liên hệ, người dùng
- **Thông báo** (`/admin/notifications`)
  - `GET /admin/notifications/list` – danh sách thông báo.
  - `POST /admin/notifications/mark-as-read/:id` – đánh dấu 1 thông báo đã đọc.
  - `POST /admin/notifications/mark-all-as-read` – đánh dấu tất cả đã đọc.
- **Liên hệ** (`/admin/contact/list`)
  - Danh sách contact do khách gửi từ client (`/contact/create`).
- **Người dùng** (`/admin/user/list`)
  - Danh sách user hệ thống (tùy vào phân quyền mà hiển thị).

---

Tài liệu này tổng hợp theo các route và controller hiện có trong codebase, bao gồm cả các cập nhật gần đây (CCCD upload, undo check-in/check-out, khôi phục ghế khi hủy đơn, xóa booking phòng,...). Nếu bạn muốn, có thể tách ra thêm 2 file riêng `docs/chuc-nang-client.md` và `docs/chuc-nang-company-admin.md` để tiện quản lý.

