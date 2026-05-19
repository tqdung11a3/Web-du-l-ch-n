# Biểu đồ UML (PlantUML)

Render online: [plantuml.com/plantuml](https://www.plantuml.com/plantuml/uml/) — dán nội dung file `.puml` → xuất PNG/SVG.

## Biểu đồ lớp (class diagram)

| File | Nội dung |
|------|-----------|
| `class-diagram-tour-package.puml` | Gói **quản lý tour** |
| `class-diagram-hotel-package.puml` | Gói **quản lý khách sạn** |
| `class-diagram-tour-hotel-link-package.puml` | Gói **liên kết tour – KS** (TourSegment, yêu cầu liên kết, phân công) |
| `class-diagram-tour-booking-package.puml` | Gói **đặt tour** (Order, OrderController) |
| `class-diagram-hotel-booking-package.puml` | Gói **đặt phòng KS** (HotelBooking, Cart, HotelBookingController) |

## Biểu đồ trình tự (sequence diagram — BCE)

| File | Nội dung |
|------|-----------|
| `seq-diagram-tour-management.puml` | Quản lý tour admin: danh sách, tạo/sửa, thùng rác, khuyến mãi |
| `seq-diagram-hotel-management.puml` | Quản lý KS **admin** (giống cấu trúc tour: danh sách, CRUD, thùng rác, loại phòng) |
| `seq-diagram-tour-hotel-link.puml` | Cấu hình segment, phân công tour/KS, yêu cầu liên kết |
| `seq-diagram-tour-booking.puml` | Đặt tour: tạo Order, chờ thanh toán, VNPay, thành công |
| `seq-diagram-hotel-booking.puml` | Đặt phòng: Cart → HotelBooking, VNPay |

## Biểu đồ E-R (thực thể – liên kết)

| File | Nội dung |
|------|-----------|
| `er-diagram-system.puml` | Các thực thể chính và quan hệ (đa công ty, tour–KS, đơn, booking, giỏ) |

## CLI (tuỳ chọn)

```bash
java -jar plantuml.jar class-diagram-*.puml
```

Cần Java + PlantUML jar hoặc extension IDE.
