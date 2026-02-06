# Tài liệu: Chức năng Đơn Tạm / Giữ Chỗ (15 phút)

## Tổng quan

Chức năng "Đơn tạm / Giữ chỗ" cho phép hệ thống tự động hủy các booking chưa thanh toán sau 15 phút, giải phóng phòng cho khách hàng khác.

---

## Các thay đổi đã thực hiện

### 1. Model: `models/hotel-booking.model.js`

#### Thêm 2 field mới:

```javascript
// ==== ĐƠN TẠM / GIỮ CHỖ ====
isTemporaryHold: {
  type: Boolean,
  default: true, // Mặc định là đơn tạm khi mới tạo
},
holdExpiresAt: {
  type: Date,
  default: null, // Thời điểm hết hạn giữ chỗ (15 phút sau khi tạo)
},
```

#### Thêm TTL Index:

```javascript
// TTL Index: Tự động xóa booking pending chưa thanh toán sau khi hết hạn
schema.index(
  { holdExpiresAt: 1 },
  {
    expireAfterSeconds: 0, // Xóa ngay khi holdExpiresAt đến
    partialFilterExpression: {
      isTemporaryHold: true,
      status: "pending",
      paymentStatus: "unpaid",
    },
  }
);
```

**Cách hoạt động:**
- MongoDB TTL index tự động xóa document khi `holdExpiresAt` đến
- Chỉ áp dụng cho booking có:
  - `isTemporaryHold = true`
  - `status = "pending"`
  - `paymentStatus = "unpaid"`

---

### 2. Controller: `controllers/client/hotel-booking.controller.js`

#### Khi tạo booking mới:

```javascript
const booking = new HotelBooking({
  // ... existing fields ...
  
  // ==== ĐƠN TẠM / GIỮ CHỖ ====
  isTemporaryHold: true, // Đánh dấu là đơn tạm
  holdExpiresAt: moment().add(15, 'minutes').toDate(), // Hết hạn sau 15 phút
});
```

#### Khi thanh toán thành công (VNPay):

```javascript
for (const booking of bookingsToUpdate) {
  booking.paymentStatus = "paid";
  booking.isTemporaryHold = false; // Không còn là đơn tạm
  booking.holdExpiresAt = null; // Xóa thời gian hết hạn
  await booking.save();
}
```

---

### 3. UI: `views/client/pages/hotel-booking-success.pug`

#### Hiển thị countdown timer:

```pug
//- Hiển thị countdown timer nếu là đơn tạm và chưa thanh toán
if bookingDetail && bookingDetail.isTemporaryHold && bookingDetail.paymentStatus === 'unpaid' && bookingDetail.holdExpiresAt
  .hold-warning
    .warning-icon
      i.fa-solid.fa-clock
    .warning-content
      p.warning-title ⚠️ Đơn đặt phòng tạm thời
      p.warning-message Vui lòng thanh toán trong vòng:
      .countdown-timer#countdownTimer
        span.countdown-minutes 00
        span.countdown-separator :
        span.countdown-seconds 00
      p.warning-note Đơn sẽ tự động hủy nếu không thanh toán đúng hạn.
```

#### JavaScript countdown:

```javascript
const holdExpiresAt = new Date("#{bookingDetail.holdExpiresAt}");

function updateCountdown() {
  const now = new Date();
  const diff = holdExpiresAt - now;
  
  if (diff <= 0) {
    // Hết thời gian
    alert('Đơn đặt phòng đã hết hạn! Vui lòng đặt lại.');
    window.location.href = '/hotel/search';
    return;
  }
  
  const minutes = Math.floor(diff / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);
  
  minutesEl.textContent = String(minutes).padStart(2, '0');
  secondsEl.textContent = String(seconds).padStart(2, '0');
}

// Cập nhật mỗi giây
setInterval(updateCountdown, 1000);
```

---

### 4. CSS: `public/assets/css/style.css`

Thêm styling cho:
- `.hold-warning`: Khung cảnh báo vàng
- `.countdown-timer`: Đồng hồ đếm ngược
- Animation: pulse, blink

---

### 5. Script Cleanup: `scripts/cleanup-expired-bookings.js`

Script fallback để cleanup booking expired (phòng trường hợp TTL index không hoạt động):

```javascript
// Tìm và xóa các booking đã hết hạn
const expiredBookings = await HotelBooking.find({
  isTemporaryHold: true,
  status: "pending",
  paymentStatus: "unpaid",
  holdExpiresAt: { $lt: now },
});

await HotelBooking.deleteMany({
  isTemporaryHold: true,
  status: "pending",
  paymentStatus: "unpaid",
  holdExpiresAt: { $lt: now },
});
```

**Cách chạy:**

```bash
# Chạy 1 lần (testing)
node scripts/cleanup-expired-bookings.js

# Chạy định kỳ mỗi 5 phút
node scripts/cleanup-expired-bookings.js periodic
```

---

## Luồng hoạt động

### 1. Khách hàng tạo booking:

```
Client tạo booking
  ↓
Controller tạo HotelBooking
  - isTemporaryHold = true
  - holdExpiresAt = now + 15 phút
  - status = "pending"
  - paymentStatus = "unpaid"
  ↓
Redirect đến trang success
  ↓
Hiển thị countdown timer (15:00)
```

### 2. Khách hàng thanh toán (trước 15 phút):

```
Client thanh toán qua VNPay
  ↓
VNPay callback
  ↓
Controller update booking
  - paymentStatus = "paid"
  - isTemporaryHold = false
  - holdExpiresAt = null
  ↓
Booking được giữ vĩnh viễn
```

### 3. Khách hàng KHÔNG thanh toán (sau 15 phút):

```
15 phút trôi qua
  ↓
holdExpiresAt đến
  ↓
MongoDB TTL index tự động xóa booking
  (hoặc script cleanup xóa)
  ↓
Phòng được giải phóng
  ↓
Countdown timer hiển thị 00:00
  ↓
Alert: "Đơn đặt phòng đã hết hạn!"
  ↓
Redirect về trang tìm kiếm
```

---

## Cấu hình

### Thay đổi thời gian giữ chỗ:

**File:** `controllers/client/hotel-booking.controller.js`

```javascript
// Thay đổi từ 15 phút sang 10 phút
holdExpiresAt: moment().add(10, 'minutes').toDate(),
```

### Thay đổi tần suất cleanup script:

**File:** `scripts/cleanup-expired-bookings.js`

```javascript
// Thay đổi từ 5 phút sang 3 phút
setInterval(async () => {
  await cleanupExpiredBookings();
}, 3 * 60 * 1000); // 3 phút
```

---

## Testing

### 1. Test TTL Index:

```javascript
// Tạo booking test với holdExpiresAt = 1 phút
const booking = new HotelBooking({
  code: "TEST123",
  isTemporaryHold: true,
  holdExpiresAt: moment().add(1, 'minutes').toDate(),
  status: "pending",
  paymentStatus: "unpaid",
  // ... other fields
});
await booking.save();

// Đợi 2 phút, kiểm tra booking đã bị xóa chưa
setTimeout(async () => {
  const found = await HotelBooking.findOne({ code: "TEST123" });
  console.log(found ? "TTL chưa hoạt động" : "TTL hoạt động OK");
}, 2 * 60 * 1000);
```

### 2. Test Countdown Timer:

1. Tạo booking mới
2. Vào trang success
3. Kiểm tra countdown timer đếm ngược từ 15:00
4. Đợi hết thời gian, kiểm tra alert và redirect

### 3. Test Payment Flow:

1. Tạo booking mới
2. Thanh toán qua VNPay
3. Kiểm tra:
   - `paymentStatus = "paid"`
   - `isTemporaryHold = false`
   - `holdExpiresAt = null`
4. Đợi 15 phút, booking KHÔNG bị xóa

---

## Lưu ý

### 1. TTL Index Delay:

MongoDB TTL index có thể có độ trễ **lên đến 60 giây**. Nghĩa là booking có thể bị xóa muộn hơn 1 phút so với `holdExpiresAt`.

**Giải pháp:** Sử dụng script cleanup để đảm bảo xóa đúng thời gian.

### 2. Timezone:

Đảm bảo server timezone đúng với timezone của khách hàng:

```javascript
// Set timezone trong moment
moment.tz.setDefault("Asia/Ho_Chi_Minh");
```

### 3. Concurrency:

Nếu có nhiều server, mỗi server sẽ chạy script cleanup riêng. Cần đảm bảo không xung đột:

```javascript
// Thêm lock mechanism (Redis)
const redis = require("redis");
const lock = await redis.set("cleanup-lock", "1", "EX", 300, "NX");
if (lock) {
  await cleanupExpiredBookings();
}
```

### 4. Notification:

Có thể gửi email/SMS nhắc nhở khách hàng trước khi hết hạn:

```javascript
// Gửi nhắc nhở khi còn 5 phút
if (minutes === 5 && seconds === 0) {
  await sendReminderEmail(booking.guest.email);
}
```

---

## Monitoring

### 1. Log cleanup:

```bash
# Xem log cleanup
tail -f logs/cleanup-expired-bookings.log
```

### 2. Query expired bookings:

```javascript
// Kiểm tra số lượng booking sắp hết hạn
const expiringSoon = await HotelBooking.countDocuments({
  isTemporaryHold: true,
  status: "pending",
  paymentStatus: "unpaid",
  holdExpiresAt: { $lt: moment().add(5, 'minutes').toDate() },
});
console.log(`${expiringSoon} booking(s) expiring in 5 minutes`);
```

### 3. Dashboard metrics:

- Số booking tạm thời đang active
- Số booking bị hủy do hết hạn (theo ngày/tuần/tháng)
- Tỷ lệ chuyển đổi (booking tạm → booking paid)

---

## Kết luận

Chức năng "Đơn tạm / Giữ chỗ" đã được triển khai đầy đủ với:

✅ TTL index tự động xóa booking hết hạn
✅ Countdown timer hiển thị cho user
✅ Payment flow bỏ temporary hold
✅ Script cleanup fallback
✅ UI/UX warning rõ ràng

Hệ thống giờ đây có thể:
- Giữ chỗ tạm thời 15 phút
- Tự động giải phóng phòng nếu không thanh toán
- Hiển thị countdown timer cho khách hàng
- Đảm bảo phòng không bị "chiếm" vĩnh viễn

