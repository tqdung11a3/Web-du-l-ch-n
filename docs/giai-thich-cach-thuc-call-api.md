# Cách thức gọi API hoạt động trong dự án

Dự án dùng **Express.js** ở backend và **Fetch API** (JavaScript thuần) ở frontend. Một request từ trình duyệt đi qua: **Route → Controller → Response JSON**, rồi frontend xử lý JSON và cập nhật giao diện.

---

## 1. Tổng quan luồng (end-to-end)

```
[Trình duyệt]  --fetch(url, options)-->  [Express Route]  -->  [Controller]
                                                                   |
                                                                   v
[Trình duyệt]  <--res.json({...})--  [Express Route]  <--  [Controller]
       |
       v
  Xử lý data, hiển thị thông báo / cập nhật DOM
```

- **Frontend**: Gọi `fetch('/hotel-cart/add', { method: 'POST', body: JSON.stringify(...) })`.
- **Backend**: Route khớp URL → gọi hàm controller tương ứng → controller đọc `req.body`, xử lý (DB, validate…) → `res.json({ code, message, ... })`.
- **Frontend**: `const data = await response.json()` rồi kiểm tra `data.code === 'success'` để thông báo hoặc cập nhật UI.

---

## 2. Ví dụ cụ thể: Thêm phòng vào giỏ hàng (POST /hotel-cart/add)

### Bước 1: Frontend gửi request (call API)

**File:** `public/assets/js/hotel-cart.js` (khoảng dòng 109–127)

```javascript
const response = await fetch('/hotel-cart/add', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    hotelId,
    roomTypeId,
    quantity: 1,
    checkInDate,
    checkOutDate,
    roomsData,
    adults,
    children,
    rooms
  })
});

const data = await response.json();
```

**Giải thích:**

| Thành phần | Ý nghĩa |
|------------|--------|
| `fetch('/hotel-cart/add', ...)` | Gửi HTTP request tới URL **/hotel-cart/add** (cùng domain với trang web). |
| `method: 'POST'` | Dùng phương thức POST (tạo/cập nhật dữ liệu). |
| `headers: { 'Content-Type': 'application/json' }` | Báo cho server biết body là JSON. |
| `body: JSON.stringify({...})` | Chuyển object JavaScript thành chuỗi JSON gửi lên server. |
| `await response.json()` | Đọc body response (JSON) và parse thành object `data`. |

Sau đó code kiểm tra `data.code === 'success'` để hiển thị thông báo thành công/lỗi và gọi `updateCartCount()`.

---

### Bước 2: Backend nhận request – Đăng ký route

**File:** `routes/client/index.route.js` (dòng 27)

```javascript
router.use("/hotel-cart", hotelCartRoutes);
```

Mọi URL bắt đầu bằng **/hotel-cart** sẽ do `hotelCartRoutes` xử lý.

**File:** `routes/client/hotel-cart.route.js` (dòng 8)

```javascript
router.post("/add", controller.addToCart);
```

- URL đầy đủ: **POST /hotel-cart/add**
- Khi có request POST tới `/hotel-cart/add`, Express gọi hàm **controller.addToCart**.

---

### Bước 3: Controller xử lý và trả JSON

**File:** `controllers/client/hotel-cart.controller.js` (dòng 20–183)

```javascript
module.exports.addToCart = async (req, res) => {
  try {
    const {
      hotelId,
      roomTypeId,
      quantity,
      checkInDate,
      checkOutDate,
      roomsData,
      adults,
      children,
      rooms
    } = req.body;   // ← Dữ liệu JSON từ body request được Express parse vào đây

    // Validate, kiểm tra hotel/roomType, kiểm tra phòng trống...
    if (!hotelId || !roomTypeId || !checkInDate || !checkOutDate) {
      return res.json({
        code: "error",
        message: "Thiếu thông tin bắt buộc"
      });
    }

    // ... logic thêm vào giỏ (Cart model, DB) ...

    return res.json({
      code: "success",
      message: "Đã thêm vào giỏ hàng",
      cartItemCount: cart.items.length
    });
  } catch (error) {
    return res.json({
      code: "error",
      message: "Có lỗi xảy ra khi thêm vào giỏ hàng"
    });
  }
};
```

**Giải thích:**

| Thành phần | Ý nghĩa |
|------------|--------|
| `req.body` | Object chứa dữ liệu gửi từ frontend (nhờ middleware `express.json()` parse body JSON). |
| `res.json({...})` | Gửi response HTTP với Content-Type `application/json` và body là object đã cho (Express tự stringify). |
| `return res.json(...)` | Kết thúc xử lý request, gửi response một lần. |

Frontend nhận đúng object này khi gọi `await response.json()`.

---

## 3. Các kiểu API thường gặp trong dự án

| Method | Ví dụ URL | Ý nghĩa | File frontend (ví dụ) |
|--------|-----------|---------|------------------------|
| **GET** | `/hotel-cart/count` | Lấy dữ liệu (không thay đổi server) | `script.js`, `hotel-cart.js` |
| **POST** | `/hotel-cart/add`, `/order/create` | Tạo mới / gửi form | `hotel-cart.js`, `script.js` |
| **PATCH** | `/hotel-cart/update-quantity`, `/account/profile` | Cập nhật một phần | `hotel-cart.js`, `script.js` |
| **DELETE** | `/hotel-cart/remove`, `/hotel-cart/clear` | Xóa dữ liệu | `hotel-cart.js`, `admin/.../hotel-booking.js` |

- **GET**: Thường không có `body`; dữ liệu qua query string `?key=value`.
- **POST / PATCH**: Thường có `body` dạng JSON (`Content-Type: application/json`) hoặc FormData (upload file).

---

## 4. Ví dụ GET API: Lấy số lượng giỏ hàng

**Frontend:** `public/assets/js/script.js` (khoảng dòng 296–298)

```javascript
const response = await fetch('/hotel-cart/count');
const data = await response.json();
```

**Route:** `routes/client/hotel-cart.route.js` → `router.get("/count", controller.getCount);`

**Controller:** `controllers/client/hotel-cart.controller.js` → `getCount` đọc giỏ từ session/DB, rồi `res.json({ count: ... })`.

Không cần body, chỉ cần URL. Server trả JSON, frontend parse và dùng `data.count`.

---

## 5. Ví dụ Admin: POST JSON (xóa booking)

**Frontend:** `public/admin/assets/js/hotel-booking.js` (khoảng dòng 180–182)

```javascript
const res = await fetch(`/${pathAdmin}/hotel/booking/delete`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ bookingId: bookingId })
});
const data = await res.json();
```

**Route:** `routes/admin/hotel.route.js` → `router.post("/booking/delete", hotelController.deleteBooking);`

**Controller:** Đọc `req.body.bookingId`, xóa booking trong DB, rồi `res.json({ code: 'success', message: '...' })`.

Cách hoạt động giống ví dụ thêm giỏ hàng: **URL + method + body JSON** → route → controller → **res.json()** → frontend xử lý `data`.

---

## 6. Tóm tắt

1. **Frontend** luôn dùng **Fetch API**: `fetch(url, { method, headers, body })`, sau đó `response.json()` để lấy dữ liệu.
2. **Backend** đăng ký URL trong **routes** (theo method GET/POST/PATCH/DELETE), trỏ tới hàm trong **controller**.
3. **Controller** dùng **req.body** (hoặc **req.query** với GET) để lấy dữ liệu, xử lý xong trả về bằng **res.json(...)**.
4. **Frontend** kiểm tra `data.code` (ví dụ `'success'` / `'error'`) và cập nhật giao diện hoặc hiển thị thông báo.

Toàn bộ giao tiếp client–server qua **HTTP**: URL + method + headers + body; dữ liệu trả về thống nhất dạng **JSON**.
