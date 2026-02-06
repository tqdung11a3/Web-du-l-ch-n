# Fix: Logic Tính Số Phòng Trống

## 🚨 Vấn đề nghiêm trọng:

### Logic CŨ (SAI):

```javascript
// helpers/hotel-availability.helper.js
function getAvailableRoomsForType(allRooms, roomTypeId, bookings, checkIn, checkOut) {
  roomsOfType.forEach(room => {
    const hasConflict = bookings.some(booking => {
      // ❌ CHỈ kiểm tra booking ĐÃ ASSIGN phòng cụ thể
      if (String(booking.roomId) !== String(room._id)) return false;
      
      return hasTimeOverlap(...);
    });
  });
}
```

**Hậu quả:**

```
Hotel có 5 phòng Deluxe:
  - Room 101, 102, 103, 104, 105

Khách A đặt 2 phòng Deluxe
  → booking.roomId = null (chưa assign)
  → ❌ KHÔNG trừ số phòng trống

Khách B đặt 3 phòng Deluxe
  → booking.roomId = null (chưa assign)
  → ❌ KHÔNG trừ số phòng trống

Khách C đặt 5 phòng Deluxe
  → booking.roomId = null (chưa assign)
  → ❌ KHÔNG trừ số phòng trống

Tổng: 2 + 3 + 5 = 10 phòng được đặt
Thực tế: Chỉ có 5 phòng!

❌ OVERBOOKING!!!
```

---

## ✅ Logic MỚI (ĐÚNG):

```javascript
function getAvailableRoomsForType(allRooms, roomTypeId, bookings, checkIn, checkOut) {
  const roomsOfType = allRooms.filter(r => 
    String(r.roomTypeId) === String(roomTypeId) && 
    r.status === "vacant"
  );

  // ✅ Đếm TẤT CẢ booking của loại phòng này (cả chưa assign và đã assign)
  const overlappingBookingsCount = bookings.filter(booking => {
    if (booking.status === "cancelled" || booking.status === "checked_out") return false;
    
    // ✅ Kiểm tra theo roomTypeId (không cần roomId)
    const bookingRoomType = String(booking.roomTypeId);
    if (bookingRoomType !== String(roomTypeId)) return false;

    return hasTimeOverlap(checkIn, checkOut, booking.checkIn, booking.checkOut);
  }).length;

  // ✅ Số phòng khả dụng = Tổng phòng - Số booking
  const totalRooms = roomsOfType.length;
  const availableCount = Math.max(0, totalRooms - overlappingBookingsCount);

  return roomsOfType.slice(0, availableCount).map(r => r._id);
}
```

**Kết quả:**

```
Hotel có 5 phòng Deluxe:
  - Room 101, 102, 103, 104, 105

Khách A đặt 2 phòng Deluxe
  → booking.roomTypeId = "Deluxe"
  → booking.rooms = 2
  → ✅ Trừ 2 phòng → Còn 3 phòng

Khách B đặt 3 phòng Deluxe
  → booking.roomTypeId = "Deluxe"
  → booking.rooms = 3
  → ✅ Trừ 3 phòng → Còn 0 phòng

Khách C muốn đặt 5 phòng Deluxe
  → ✅ HẾT PHÒNG! (available = 0)
  → ❌ KHÔNG ĐẶT ĐƯỢC!

✅ KHÔNG CÒN OVERBOOKING!
```

---

## 📊 So sánh:

| Tình huống | Logic CŨ | Logic MỚI |
|-----------|----------|-----------|
| Booking chưa assign | ❌ Không đếm | ✅ Đếm |
| Booking đã assign | ✅ Đếm | ✅ Đếm |
| Booking cancelled | ✅ Không đếm | ✅ Không đếm |
| Booking checked_out | ✅ Không đếm | ✅ Không đếm |
| Overbooking? | ❌ CÓ | ✅ KHÔNG |

---

## 🔄 Luồng hoàn chỉnh:

### 1. Khách hàng tìm phòng:

```
GET /hotel/search?checkIn=2026-01-20&checkOut=2026-01-22
  ↓
Controller query bookings:
  - status != "cancelled"
  - status != "checked_out"
  - checkIn/checkOut overlap
  ↓
Helper tính available:
  totalRooms = 5
  overlappingBookings = 2 (cả pending và assigned)
  available = 5 - 2 = 3
  ↓
Response: "Còn 3 phòng trống"
```

### 2. Khách hàng đặt phòng:

```
POST /hotel-booking/create
Body: { roomTypeId: "Deluxe", rooms: 2 }
  ↓
Tạo booking:
  - roomId = null (chưa assign)
  - roomTypeId = "Deluxe" ✅
  - rooms = 2 ✅
  - status = "pending"
  - isTemporaryHold = true
  - holdExpiresAt = now + 15 phút
  ↓
✅ Booking này SẼ ĐƯỢC ĐẾM khi tính available!
```

### 3. Admin assign phòng cụ thể:

```
Admin assign:
  - Booking HB123456: Room 101, 102
  ↓
Update booking:
  - roomId vẫn null (vì multi-room)
  - Tạo sub-bookings:
    - HB123456-R1: roomId = 101
    - HB123456-R2: roomId = 102
  ↓
✅ Vẫn đếm đúng vì query theo roomTypeId!
```

### 4. Booking hết hạn (15 phút):

```
TTL index xóa booking
  ↓
overlappingBookings giảm
  ↓
available tăng
  ↓
✅ Phòng được giải phóng tự động!
```

---

## 🧪 Test cases:

### Test 1: Booking pending chiếm phòng

```javascript
// Setup
Hotel Deluxe: 5 phòng
Booking A: roomTypeId="Deluxe", rooms=2, roomId=null, status="pending"

// Test
getAvailableRoomsForType(allRooms, "Deluxe", [bookingA], ...)

// Expected
available = 5 - 2 = 3 ✅
```

### Test 2: Booking assigned chiếm phòng

```javascript
// Setup
Hotel Deluxe: 5 phòng
Booking B: roomTypeId="Deluxe", rooms=1, roomId="101", status="confirmed"

// Test
getAvailableRoomsForType(allRooms, "Deluxe", [bookingB], ...)

// Expected
available = 5 - 1 = 4 ✅
```

### Test 3: Multi-room booking

```javascript
// Setup
Hotel Deluxe: 5 phòng
Booking C: roomTypeId="Deluxe", rooms=3, roomId=null, status="pending"
Booking D: roomTypeId="Deluxe", rooms=2, roomId="102", status="confirmed"

// Test
getAvailableRoomsForType(allRooms, "Deluxe", [bookingC, bookingD], ...)

// Expected
available = 5 - 3 - 2 = 0 ✅
```

### Test 4: Cancelled không đếm

```javascript
// Setup
Hotel Deluxe: 5 phòng
Booking E: roomTypeId="Deluxe", rooms=2, status="cancelled"

// Test
getAvailableRoomsForType(allRooms, "Deluxe", [bookingE], ...)

// Expected
available = 5 - 0 = 5 ✅ (không trừ cancelled)
```

### Test 5: Temporary hold hết hạn

```javascript
// Setup
Hotel Deluxe: 5 phòng
Booking F: 
  roomTypeId="Deluxe", 
  rooms=2, 
  status="pending",
  isTemporaryHold=true,
  holdExpiresAt=now-1 (đã hết hạn)

// Sau khi TTL xóa booking F
available = 5 - 0 = 5 ✅
```

---

## ⚠️ Lưu ý quan trọng:

### 1. Booking phải có `roomTypeId`:

Đảm bảo khi tạo booking, luôn lưu `roomTypeId`:

```javascript
// controllers/client/hotel-booking.controller.js
const booking = new HotelBooking({
  // ...
  roomTypeId: item.roomTypeId, // ✅ BẮT BUỘC!
  roomId: null, // Chưa assign
  // ...
});
```

### 2. Đếm theo `rooms` field:

Nếu booking có nhiều phòng, phải đếm đúng số lượng:

```javascript
// Sai:
const count = bookings.filter(...).length; // ❌ Đếm số booking

// Đúng:
const count = bookings
  .filter(...)
  .reduce((sum, b) => sum + (b.rooms || 1), 0); // ✅ Đếm số phòng
```

**CẬP NHẬT:** Tôi cần sửa lại logic này!

---

## 🔧 Fix bổ sung:

### Đếm số PHÒNG chứ không phải số BOOKING:

```javascript
// ❌ SAI: Đếm số booking
const overlappingBookingsCount = bookings.filter(...).length;

// ✅ ĐÚNG: Đếm tổng số phòng trong các booking
const overlappingRoomsCount = bookings
  .filter(booking => {
    if (booking.status === "cancelled" || booking.status === "checked_out") return false;
    if (String(booking.roomTypeId) !== String(roomTypeId)) return false;
    return hasTimeOverlap(checkIn, checkOut, booking.checkIn, booking.checkOut);
  })
  .reduce((sum, booking) => sum + (booking.rooms || 1), 0);

const availableCount = Math.max(0, totalRooms - overlappingRoomsCount);
```

---

## ✅ Kết luận:

Sau khi fix:

1. ✅ Booking pending (chưa assign) VẪN chiếm phòng
2. ✅ Không còn overbooking
3. ✅ Đếm đúng số phòng (không phải số booking)
4. ✅ Booking hết hạn tự động giải phóng phòng
5. ✅ Logic nhất quán giữa client và admin

**Hệ thống giờ đây hoạt động đúng nghiệp vụ!** 🎉

