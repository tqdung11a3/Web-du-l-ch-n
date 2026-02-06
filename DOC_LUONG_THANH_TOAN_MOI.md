# Luồng Thanh Toán Mới - Hiển thị Countdown Timer

## 🔄 Luồng CŨ (Có vấn đề):

```
Khách hàng bấm "Đặt phòng"
  ↓
POST /hotel-booking/create
  ↓
JavaScript check paymentMethod
  ├─ money/bank → /hotel-booking/success ✅
  └─ vnpay → /hotel-booking/payment-vnpay ❌ (Bypass success page)
       ↓
     VNPay gateway
       ↓
     ❌ KHÔNG THẤY COUNTDOWN TIMER!
```

**Vấn đề:**
- User chọn VNPay → Bị redirect trực tiếp sang VNPay
- KHÔNG thấy trang success
- KHÔNG thấy countdown timer
- KHÔNG biết đơn sẽ hết hạn sau 15 phút

---

## ✅ Luồng MỚI (Đã fix):

```
Khách hàng bấm "Đặt phòng"
  ↓
POST /hotel-booking/create
  ↓
JavaScript LUÔN redirect đến success
  ↓
GET /hotel-booking/success
  ↓
┌─────────────────────────────────────┐
│ ✓ Đặt phòng thành công!            │
│                                     │
│ ⚠️ Đơn tạm thời - 15 phút           │
│    ╔═══════════╗                   │
│    ║  14 : 58 ║  ← COUNTDOWN       │
│    ╚═══════════╝                   │
│                                     │
│ [💳 Thanh toán ngay qua VNPay]     │ ← NÚT MỚI
│ [Tìm kiếm khách sạn khác]          │
│ [Về trang chủ]                     │
└─────────────────────────────────────┘
  ↓ (Nếu user bấm nút thanh toán)
GET /hotel-booking/payment-vnpay
  ↓
VNPay gateway
  ↓
Callback: /hotel-booking/payment-vnpay-result
  ↓
Update: paymentStatus = "paid", isTemporaryHold = false
  ↓
Redirect lại: /hotel-booking/success
  ↓
✅ Hiển thị "Đã thanh toán" (không còn countdown)
```

---

## 📝 Các thay đổi đã thực hiện:

### 1. JavaScript (`public/assets/js/hotel-cart.js`)

**Trước:**
```javascript
switch (paymentMethod) {
  case 'money':
  case 'bank':
    window.location.href = `/hotel-booking/success?...`;
    break;
  case 'vnpay':
    window.location.href = `/hotel-booking/payment-vnpay?...`; // ❌ Bypass
    break;
}
```

**Sau:**
```javascript
// LUÔN redirect đến success để hiển thị countdown
window.location.href = `/hotel-booking/success?bookingCode=${bookingCode}&phone=${respPhone}`;
```

---

### 2. Controller (`controllers/client/hotel-booking.controller.js`)

**Thêm:**
```javascript
const bookingDetail = {
  // ... existing fields ...
  paymentMethod: bookings[0].paymentMethod, // ✅ Để hiển thị nút thanh toán
  phone: phone, // ✅ Để tạo link thanh toán
};
```

---

### 3. View (`views/client/pages/hotel-booking-success.pug`)

**Thêm:**
```pug
.success-actions
  //- Hiển thị nút thanh toán nếu chưa thanh toán
  if bookingDetail && bookingDetail.paymentStatus === 'unpaid'
    if bookingDetail.paymentMethod === 'vnpay'
      a.btn-payment.btn-vnpay(href=`/hotel-booking/payment-vnpay?...`)
        i.fa-solid.fa-credit-card
        |  Thanh toán ngay qua VNPay
    else if bookingDetail.paymentMethod === 'bank'
      .payment-info
        p Vui lòng chuyển khoản theo thông tin...
```

---

### 4. CSS (`public/assets/css/style.css`)

**Thêm:**
```css
.btn-payment {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 16px 32px;
  font-size: 18px;
  font-weight: 700;
  border-radius: 8px;
  background: linear-gradient(135deg, #1e88e5 0%, #1565c0 100%);
  color: white;
}
```

---

## 🎯 Kết quả:

### Với tất cả phương thức thanh toán:

#### 1. Tiền mặt (`money`):
```
✓ Đặt phòng thành công!
⚠️ Đơn tạm thời - 14:58
Mã: HB123456
[Tìm kiếm khách sạn khác]
[Về trang chủ]
```

#### 2. Chuyển khoản (`bank`):
```
✓ Đặt phòng thành công!
⚠️ Đơn tạm thời - 14:58

ℹ️ Phương thức thanh toán: Chuyển khoản ngân hàng
   Vui lòng chuyển khoản theo thông tin...

[Tìm kiếm khách sạn khác]
[Về trang chủ]
```

#### 3. VNPay (`vnpay`):
```
✓ Đặt phòng thành công!
⚠️ Đơn tạm thời - 14:58

[💳 Thanh toán ngay qua VNPay]  ← NÚT MỚI
[Tìm kiếm khách sạn khác]
[Về trang chủ]
```

---

## 🔍 Chi tiết luồng VNPay:

### Bước 1: User chọn VNPay và đặt phòng
```
POST /hotel-booking/create
Body: { paymentMethod: "vnpay", ... }
  ↓
Response: { code: "success", bookingCode: "HB123456", ... }
  ↓
JavaScript: window.location.href = "/hotel-booking/success?..."
```

### Bước 2: Hiển thị trang success + countdown
```
GET /hotel-booking/success?bookingCode=HB123456&phone=0123456789
  ↓
Controller lấy booking từ DB
  ↓
Render view với:
  - isTemporaryHold = true
  - holdExpiresAt = now + 15 phút
  - paymentMethod = "vnpay"
  - paymentStatus = "unpaid"
  ↓
View hiển thị:
  - ⏰ Countdown timer (15:00)
  - 💳 Nút "Thanh toán ngay qua VNPay"
```

### Bước 3: User bấm nút thanh toán (hoặc không)

**Option A: User bấm thanh toán ngay**
```
Click nút "Thanh toán ngay qua VNPay"
  ↓
GET /hotel-booking/payment-vnpay?bookingCode=HB123456&phone=0123456789
  ↓
Controller tạo VNPay URL
  ↓
Redirect sang VNPay gateway
  ↓
User thanh toán
  ↓
VNPay callback: /hotel-booking/payment-vnpay-result
  ↓
Update booking: paymentStatus = "paid", isTemporaryHold = false
  ↓
Redirect: /hotel-booking/success
  ↓
✅ Hiển thị "Đã thanh toán" (không còn countdown)
```

**Option B: User không thanh toán**
```
User xem countdown: 14:58 → 14:57 → ... → 00:00
  ↓
Countdown hết
  ↓
Alert: "Đơn đặt phòng đã hết hạn!"
  ↓
Redirect: /hotel/search
  ↓
MongoDB TTL index tự động xóa booking
```

---

## ✅ Ưu điểm của luồng mới:

1. **Luôn thấy countdown timer** cho tất cả phương thức thanh toán
2. **User có quyền chọn** thanh toán ngay hoặc để sau
3. **Không bị ép** phải thanh toán ngay lập tức
4. **Rõ ràng** về thời gian còn lại
5. **Nhất quán** giữa các phương thức thanh toán

---

## 🧪 Test cases:

### Test 1: Chọn VNPay
1. Thêm phòng vào giỏ
2. Chọn phương thức thanh toán: VNPay
3. Bấm "Đặt phòng"
4. ✅ Thấy trang success + countdown
5. ✅ Thấy nút "Thanh toán ngay qua VNPay"
6. Bấm nút thanh toán
7. ✅ Redirect sang VNPay

### Test 2: Chọn Tiền mặt
1. Thêm phòng vào giỏ
2. Chọn phương thức thanh toán: Tiền mặt
3. Bấm "Đặt phòng"
4. ✅ Thấy trang success + countdown
5. ✅ KHÔNG thấy nút thanh toán (vì là tiền mặt)

### Test 3: Chọn Chuyển khoản
1. Thêm phòng vào giỏ
2. Chọn phương thức thanh toán: Chuyển khoản
3. Bấm "Đặt phòng"
4. ✅ Thấy trang success + countdown
5. ✅ Thấy thông tin chuyển khoản

---

## 📊 So sánh:

| Tiêu chí | Luồng CŨ | Luồng MỚI |
|----------|----------|-----------|
| Thấy countdown? | ❌ Không (với VNPay) | ✅ Có (tất cả) |
| Bị ép thanh toán? | ✅ Có (VNPay) | ❌ Không |
| Nhất quán? | ❌ Không | ✅ Có |
| User experience | ⭐⭐ | ⭐⭐⭐⭐⭐ |

---

## 🎉 Kết luận:

Giờ đây, **TẤT CẢ** khách hàng đều sẽ:
1. ✅ Thấy trang success
2. ✅ Thấy countdown timer 15 phút
3. ✅ Biết đơn sẽ hết hạn khi nào
4. ✅ Có thể thanh toán ngay hoặc để sau (trong 15 phút)

**Không còn bị bypass trang success nữa!** 🎯

