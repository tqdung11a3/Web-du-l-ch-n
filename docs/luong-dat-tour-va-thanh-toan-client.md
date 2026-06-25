# Luồng client: Chọn tour → Đặt tour → Thanh toán (chỉ mục code cụ thể)

Tài liệu liệt kê **file + hàm + dòng** cho từng bước. Đọc theo thứ tự số bước.

> **Phạm vi:** Tour client. Không mô tả đặt phòng KS độc lập (`/hotel-booking/...`).

---

## Bước 0 — App khởi động & mount route

| File | Dòng | Code làm gì |
|------|------|-------------|
| `index.js` | 7 | `require("./routes/client/index.route")` |
| `index.js` | 47–48 | `clientAuth.attachUser` → `app.use("/", clientRoutes)` |
| `index.js` | 76 | `startExpiredOrdersCleanup()` — cron hủy hold tour |
| `routes/client/index.route.js` | 27–37 | Mount `/tour`, `/cart`, `/order`, `/company` |

---

## Bước 1 — Khách duyệt danh sách tour

### 1.1 Route → Controller → View

| URL | Route file | Dòng route | Controller | Dòng hàm | View |
|-----|------------|------------|------------|----------|------|
| `/` | `routes/client/home.route.js` | 4 | `controllers/client/home.controller.js` | 163 `home` | `views/client/pages/home.pug` |
| `/search` | `routes/client/search.route.js` | 4 | `controllers/client/search.controller.js` | 49 `list` | `search.pug` |
| `/category/:slug` | `routes/client/category.route.js` | 4 | `controllers/client/category.controller.js` | 61 `list` | `tour-list.pug` |
| `/company/:slug/tours` | `routes/client/company.route.js` | 13 | `controllers/client/company.controller.js` | 493 `toursByCompany` | `company-tour-list.pug` |
| `/tour/discount` | `routes/client/tour.route.js` | 7 | `controllers/client/tour.controller.js` | 714 `listDiscount` | `tour-discount-list.pug` |

### 1.2 Link vào trang chi tiết

| File | Dòng | Code |
|------|------|------|
| `views/client/mixins/product.pug` | 2 | `tourDetailUrl = /company/${company.slug}/tour/detail/${item.slug}` |

---

## Bước 2 — Trang chi tiết tour (chọn ngày, pax, lưu trú)

### 2.1 Route

| URL | File | Dòng |
|-----|------|------|
| `GET /company/:slug/tour/detail/:tourSlug` | `routes/client/company.route.js` | 12 |
| `POST .../check-shared-feasibility` | `routes/client/company.route.js` | 8–10 |
| `GET /tour/detail/:slug` (cũ) | `routes/client/tour.route.js` | 5 |
| `POST /tour/check-shared-feasibility` | `routes/client/tour.route.js` | 4 |

### 2.2 Server — `tour.controller.js` → `detail`

| File | Dòng | Code làm gì |
|------|------|-------------|
| `controllers/client/tour.controller.js` | 48 | `module.exports.detail` bắt đầu |
| | 62–66 | Query `Company` (`status: "active"`) |
| | 77–81 | Query `Tour` — **chỉ tour `status: "active"`** |
| | 101–122 | Route cũ `/tour/detail/:slug` → redirect 301 sang URL company |
| | 311–346 | Load `TourSegment`, set `hotelAccommodationRequired` |
| | 340–345 | `TourSegment.find({ tourId, status: { $in: ["confirmed","pending_approval"] } })` |
| | 430–623 | Build `tourRoomOptions` (phòng trống), `tourRoomSegments` |
| | 625–632 | `res.render("client/pages/tour-detail", { tourRoomSegments, hotelAccommodationRequired, ... })` |

### 2.3 View — nút Đặt ngay

| File | Dòng | Code |
|------|------|------|
| `views/client/pages/tour-detail.pug` | 519 | `button.inner-button-add-cart(tour-id=...)` — 「Đặt ngay」 |

### 2.4 Client JS — cấu hình & đặt ngay

| File | Dòng | Code làm gì |
|------|------|-------------|
| `public/assets/js/script.js` | 2999 | `buttonAddToCart = .inner-button-add-cart` |
| | 3186–3191 | `setSessionCart([item])` + `window.location.href = "/cart"` |
| | 3220–3257 | Chọn ngày khởi hành → đọc `data-seats-by-date`, cập nhật `maxSeats` |
| | 1895–1896 | URL `check-shared-feasibility` (ở riêng/ghép) |

### 2.5 API kiểm tra ở ghép (tùy chọn, trước khi đặt)

| File | Dòng |
|------|------|
| `controllers/client/tour.controller.js` | 640 `checkSharedFeasibility` |

---

## Bước 3 — Giỏ tour (browser storage)

### 3.1 Storage layer

| File | Dòng | Code |
|------|------|------|
| `public/assets/js/script.js` | 501–505 | `localStorage` key `"cart"` |
| | 508–520 | `sessionStorage` key `"cart_once"` — **Đặt ngay** |
| | 532–533 | `isQuickOrderMode()` |

> **Không** dùng `models/cart.model.js` (chỉ hotel).

### 3.2 Route giỏ

| URL | File | Dòng |
|-----|------|------|
| `GET /cart` | `routes/client/cart.route.js` | 8 |
| `POST /cart/detail` | `routes/client/cart.route.js` | 11 |

### 3.3 Render trang giỏ

| File | Dòng | Code |
|------|------|------|
| `controllers/client/cart.controller.js` | 36 | `module.exports.index` |
| | 372 | `res.render("client/pages/cart-unified", ...)` |
| `views/client/pages/cart-unified.pug` | 45 | `form#order-form` |
| | 94–114 | Radio `money` / `vnpay` / `bank` |

### 3.4 Enrich giá từ DB

| File | Dòng | Code |
|------|------|------|
| `public/assets/js/script.js` | 3757–3765 | `drawCart()` → `fetch("/cart/detail", { body: cartJSON })` |
| `controllers/client/cart.controller.js` | 397 | `module.exports.getCartDetail` |

---

## Bước 4 — Submit đơn (`POST /order/create`)

### 4.1 Route

| File | Dòng |
|------|------|
| `routes/client/order.route.js` | 4 → `orderController.createPost` |

### 4.2 Client gửi request

| File | Dòng | Code |
|------|------|------|
| `public/assets/js/script.js` | 3264 | `const orderForm = document.querySelector("#order-form")` |
| | 3341–3356 | Build `dataFinal`, `fetch("/order/create", { method: "POST", body: JSON.stringify(...) })` |
| | 3377–3385 | Success → `clearSessionCart()` hoặc cập nhật `localStorage` |
| | 3403–3414 | Redirect theo `paymentMethod` → `/order/pending?...` |

### 4.3 Server — `order.controller.js` → `createPost`

| File | Dòng | Code làm gì |
|------|------|-------------|
| `controllers/client/order.controller.js` | 301 | `module.exports.createPost` |
| | 316–320 | Chặn nếu tour **không** `status: "active"` |
| | 328–333 | Bắt buộc ≥ 1 người lớn |
| | 336–366 | Logic ghế em bé (auto vs picker mode) |
| | 637–704 | Build `sharedRoomRequest` từ `TourSegment` |
| | 706–725 | Bắt buộc chọn lưu trú nếu tour có quota KS |
| | 734–735 | `seatsUsed = NL + TE + privateSeatBabyCount` |
| | 741–751 | **Atomic** `$inc` `Tour.seatsRemaining` (điều kiện `$gte`) |
| | 755–779 | Chặn nếu có hold active khác cùng lịch |
| | 793–810 | `$inc` `departures[].seatsRemaining` |
| | 813–963 | Nhóm theo `companyId` → 1 Order / công ty |
| | 973–1040 | Validate phòng **ở riêng** |
| | 1042–1190+ | Validate + auto-assign **ở ghép** |
| | 1200–1356 | Kiểm tra conflict phòng |
| | 1033, 1190, 1320, 1330 | Lỗi → `_restoreSeatsForGroups(groups)` |
| | 1363 | `holdExpiresAt = now + 15 phút` |
| | 1388–1410 | `new Order({ status: "initial", paymentStatus: "unpaid", isTemporaryHold: true, ... })` |
| | 1410 | `await newRecord.save()` |
| | 1432–1488 | **Private:** `new HotelBooking({ status: "pending", isTemporaryHold: true, orderCode, ... }).save()` |
| | 1493–1700+ | **Shared:** claim `[Tour Hold]`, push `TourSegment.assignments` |
| | 1946–1952 | `return res.json({ code: "success", orders: createdOrders })` |
| | 1957–1961 | `catch` → `_restoreSeatsForGroups` |

### 4.4 Hoàn ghế khi hủy / lỗi

| File | Dòng | Hàm |
|------|------|-----|
| `controllers/client/order.controller.js` | 119–154 | `_restoreSeatsForGroups` |
| | 155–299 | `_cancelHoldAndRestoreSeats` (hủy hold, dọn `assignments`) |

### 4.5 Model Order

| File | Dòng | Field |
|------|------|-------|
| `models/order.model.js` | 99–101 | `paymentMethod`, `paymentStatus`, `status` |
| | 119–120 | `isTemporaryHold`, `holdExpiresAt` |
| | 1–85 (comment) | Cấu trúc `items[]`: `roomSelections`, `sharedRoomRequest`, `passengers` |

---

## Bước 5 — Trang chờ thanh toán

### 5.1 Route & render

| URL | File | Dòng |
|-----|------|------|
| `GET /order/pending` | `routes/client/order.route.js` | 6 |
| Controller | `controllers/client/order.controller.js` | 1970 `pending` |
| View | `views/client/pages/order-pending.pug` | 253 — nút VNPay |

### 5.2 Logic server `pending`

| File | Dòng | Code |
|------|------|------|
| `controllers/client/order.controller.js` | 1978–1982 | `Order.findOne({ code, phone })` |
| | 1988–1992 | Đã `paid` → redirect `/order/success` |
| | 1995–2003 | Hết `holdExpiresAt` → `_cancelHoldAndRestoreSeats` → redirect `/?expired=1` |

### 5.3 Các route phụ trên trang pending

| URL | Route file | Dòng | Controller | Dòng hàm |
|-----|------------|------|------------|----------|
| `GET /order/check-payment-status` | `order.route.js` | 8 | `order.controller.js` | 2436 |
| `PATCH /order/transfer-proof` | `order.route.js` | 10 | `order.controller.js` | 2398 `saveTransferProof` |
| `GET/POST /order/cancel-hold` | `order.route.js` | 12–13 | `order.controller.js` | 2337 `cancelHold` |

### 5.4 Cron hủy hold tự động

| File | Dòng | Code |
|------|------|------|
| `scripts/cleanup-expired-orders.js` | 119–172 | `cleanupExpiredOrders()` — query hold hết hạn, hoàn ghế, `status: cancel` |
| | 177–180 | `startExpiredOrdersCleanup()` — mỗi 60s |
| `index.js` | 76 | Gọi khi server start |

---

## Bước 6 — Thanh toán VNPay

| Bước | URL | Route file | Controller | Dòng |
|------|-----|------------|------------|------|
| Tạo URL VNPay | `GET /order/payment-vnpay` | `order.route.js` 17 | `order.controller.js` | 2142 `paymentVNPay` |
| Callback VNPay | `GET /order/payment-vnpay-result` | `order.route.js` 19 | `order.controller.js` | 2215 `paymentVNPayResult` |
| Cập nhật paid | — | — | `order.controller.js` | **2243–2249** `Order.updateOne({ paymentStatus: "paid", isTemporaryHold: false })` |
| Redirect success | — | — | `order.controller.js` | ~2314 `res.redirect("/order/success?...")` |

**Tiền mặt / chuyển khoản:** không có route thanh toán online — admin đánh `paymentStatus: paid` trên panel (`controllers/admin/order.controller.js`).

---

## Bước 7 — Trang thành công

| URL | Route | Controller | Dòng | View |
|-----|-------|------------|------|------|
| `GET /order/success` | `order.route.js` 15 | `order.controller.js` | 2045 `success` | `order-success.pug` |

| File | Dòng | Code |
|------|------|------|
| `controllers/client/order.controller.js` | 2053–2057 | `Order.findOne({ code, phone })` |

---

## Điều kiện tiên quyết (admin) — tour phải `active`

Client chỉ đặt được tour `active`; admin bật `active` bị gate:

| Mục đích | File | Dòng |
|----------|------|------|
| Kiểm tra đủ điều kiện xuất bản | `helpers/tour-publishable.helper.js` | 46 `canPublishTour` |
| | | 93–141 — kiểm tra `HotelLinkRequest` approved/partially_approved |
| Chặn lưu `active` khi sửa tour | `controllers/admin/tour.controller.js` | **1498–1511** `editPatch` |
| Chặn bật hàng loạt | `controllers/admin/tour.controller.js` | **2130–2173** `changeMulti` case `"active"` |

---

## Bảng chuyển trạng thái (kèm dòng code)

| Sự kiện | File | Dòng | Field thay đổi |
|---------|------|------|----------------|
| Tạo đơn | `order.controller.js` | 1399–1407 | `status: initial`, `paymentStatus: unpaid`, `isTemporaryHold: true` |
| VNPay OK | `order.controller.js` | 2243–2249 | `paymentStatus: paid`, `isTemporaryHold: false` |
| Hold hết hạn | `cleanup-expired-orders.js` | 159–161 | `status: cancel` |
| Hủy hold (pending) | `order.controller.js` | 155–299 `_cancelHoldAndRestoreSeats` | `status: cancel` + hoàn ghế |
| Trừ ghế | `order.controller.js` | 741–751 | `$inc seatsRemaining: -seatsUsed` |
| Hoàn ghế | `order.controller.js` | 119–154 `_restoreSeatsForGroups` | `$inc seatsRemaining: +` |

---

## Sơ đồ luồng (tham khảo nhanh)

```
product.pug:2
  → company.route.js:12 → tour.controller.js:48 detail → tour-detail.pug:519
  → script.js:3186-3191 sessionStorage → GET cart.route.js:8
  → cart.controller.js:372 cart-unified.pug → script.js:3351 POST order.route.js:4
  → order.controller.js:301 createPost → script.js:3406 pending
  → order.controller.js:1970 pending → (vnpay) order.controller.js:2142
  → order.controller.js:2215 result → order.controller.js:2045 success
```

---

## File chưa implement (tránh nhầm)

| Client gọi | File | Ghi chú |
|------------|------|---------|
| `script.js:3408-3409` `/order/payment-zalopay` | **Không có** trong `routes/client/order.route.js` | Sẽ 404 |
| `momo` | `config/variable.config.js` | Có enum, chưa có route tour |

---

## Tài liệu liên quan

- `docs/chuc-nang-client-va-company-admin.md`
- `docs/luong-tim-kiem-tour-client.md`
- `helpers/tour-publishable.helper.js` — gate tour active
