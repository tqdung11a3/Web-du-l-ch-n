# Luồng Đặt Phòng Khách Sạn - Chi Tiết

Tài liệu này mô tả chi tiết luồng đặt phòng khách sạn từ khi khách hàng tìm kiếm cho đến khi admin quản lý đơn và xếp phòng cụ thể.

---

## 📋 Mục Lục

1. [Tổng Quan](#tổng-quan)
2. [Luồng Client-Side (Khách Hàng)](#luồng-client-side-khách-hàng)
3. [Luồng Admin-Side (Quản Trị)](#luồng-admin-side-quản-trị)
4. [Cấu Trúc Database](#cấu-trúc-database)
5. [Các Helper Functions](#các-helper-functions)

---

## 🎯 Tổng Quan

### Các Bước Chính:

1. **Tìm kiếm khách sạn** → `/hotel/search`
2. **Xem chi tiết khách sạn** → `/hotel/detail/:id`
3. **Thêm vào giỏ hàng** → `/hotel-cart/add`
4. **Xem giỏ hàng** → `/cart?tab=hotel`
5. **Tạo đơn đặt phòng** → `/hotel-booking/create`
6. **Thanh toán** → VNPay hoặc tiền mặt
7. **Admin xem danh sách đơn** → `/admin/hotel/booking/list`
8. **Admin xem chi tiết đơn** → `/admin/hotel/booking/detail/:bookingId`
9. **Admin cập nhật trạng thái** → `/admin/hotel/booking/update-status`
10. **Admin xếp phòng cụ thể** → `/admin/hotel/booking/assign-room`

---

## 🔵 Luồng Client-Side (Khách Hàng)

### **BƯỚC 1: Tìm Kiếm Khách Sạn**

**Route:** `GET /hotel/search`  
**Controller:** `controllers/client/hotel.controller.js` → `module.exports.search`  
**View:** `views/client/pages/hotel-search.pug`

#### Quy Trình:

1. **Nhận query parameters:**
   ```javascript
   {
     provinceId: String,      // ID tỉnh thành
     location: String,         // Địa điểm
     address: String,          // Địa chỉ
     checkInDate: String,      // YYYY-MM-DD
     checkOutDate: String,     // YYYY-MM-DD
     rooms: Number,            // Số phòng
     adults: Number,           // Tổng số người lớn
     children: Number,         // Tổng số trẻ em
     roomsData: String         // JSON string: [{adults: 2, children: [{age: 3}]}, ...]
   }
   ```

2. **Query database:**
   - Collection: `hotels`
   - Filter: `deleted: false`, `status: "active"`
   - Populate: `companyId`, `province`

3. **Kiểm tra availability:**
   - Gọi `checkHotelAvailability()` từ `helpers/hotel-availability.helper.js`
   - Kiểm tra số phòng trống trong khoảng thời gian `checkInDate` → `checkOutDate`
   - Lọc các khách sạn có đủ phòng trống

4. **Tính toán:**
   - Tính số đêm: `checkOutDate - checkInDate`
   - Tính giá từng khách sạn
   - Tính rating từ `hotel_reviews`

5. **Trả về:**
   - Render `hotel-search.pug` với danh sách khách sạn
   - Mỗi hotel object có: `id`, `name`, `address`, `pricePerNight`, `vacantRooms`, `roomsData`, ...

#### Database Operations:
- **READ:** `Hotel.find()`, `HotelReview.aggregate()`
- **Collection:** `hotels`, `hotel_reviews`

---

### **BƯỚC 2: Xem Chi Tiết Khách Sạn**

**Route:** `GET /hotel/detail/:id`  
**Controller:** `controllers/client/hotel.controller.js` → `module.exports.detail`  
**View:** `views/client/pages/hotel-detail.pug`

#### Quy Trình:

1. **Nhận parameters:**
   - `id`: Hotel ID
   - Query: `checkInDate`, `checkOutDate`, `rooms`, `adults`, `children`, `roomsData`

2. **Query database:**
   ```javascript
   const hotel = await Hotel.findOne({ _id: id, deleted: false })
     .populate('companyId', 'name logo')
     .populate('province', 'name')
     .lean();
   ```

3. **Lọc room types:**
   - Parse `roomsData` từ URL (JSON string, có thể URL-encoded)
   - Với mỗi phòng trong `roomsData`, tìm các room types có thể chứa được
   - Logic: **Ít nhất 1 phòng** trong room type phải chứa được occupancy của phòng đó
   - Gọi `getAvailableRoomsForType()` để kiểm tra số phòng trống

4. **Tính giá:**
   - Giá cơ bản: `roomType.basePrice * nights * quantity`
   - Phụ thu vượt sức chứa (nếu có)
   - Thuế (10%) và phí (5%)

5. **Trả về:**
   - Render `hotel-detail.pug` với:
     - Thông tin khách sạn
     - Danh sách room types có sẵn
     - Form phân bổ phòng (room allocation)
     - Nút "Thêm tất cả vào giỏ hàng"

#### Database Operations:
- **READ:** `Hotel.findOne()`, `HotelBooking.find()` (để check availability)
- **Collections:** `hotels`, `hotel_bookings`

---

### **BƯỚC 3: Thêm Vào Giỏ Hàng**

**Route:** `POST /hotel-cart/add`  
**Controller:** `controllers/client/hotel-cart.controller.js` → `module.exports.addToCart`  
**Model:** `models/cart.model.js`

#### Quy Trình:

1. **Nhận body:**
   ```javascript
   {
     hotelId: ObjectId,
     roomTypeId: ObjectId,
     quantity: Number,         // Số phòng
     checkInDate: String,      // YYYY-MM-DD
     checkOutDate: String,     // YYYY-MM-DD
     roomsData: String,        // JSON string
     adults: Number,
     children: Number,
     rooms: Number
   }
   ```

2. **Validate:**
   - Kiểm tra hotel tồn tại
   - Kiểm tra room type tồn tại
   - Kiểm tra số phòng trống (`getAvailableRoomsForType()`)

3. **Tìm hoặc tạo Cart:**
   ```javascript
   // Tìm cart theo userId (nếu đăng nhập) hoặc sessionId (cookie)
   let cart = await Cart.findOne({ userId }) || 
              await Cart.findOne({ sessionId });
   
   // Nếu chưa có, tạo mới
   if (!cart) {
     cart = new Cart({
       userId: userId || null,
       sessionId: sessionId || uuidv4(),
       hotelId: hotelId,
       items: []
     });
   }
   ```

4. **Thêm item vào cart:**
   ```javascript
   cart.items.push({
     hotelId,
     roomTypeId,
     quantity,
     pricePerNight: roomType.basePrice,
     checkInDate,
     checkOutDate,
     nights: checkOutMoment.diff(checkInMoment, 'days'),
     roomsData,  // Lưu nguyên JSON string
     adults,
     children,
     rooms
   });
   ```

5. **Lưu vào database:**
   ```javascript
   await cart.save();
   ```

6. **Trả về JSON:**
   ```json
   {
     "code": "success",
     "message": "Đã thêm vào giỏ hàng",
     "cartCount": cart.items.length
   }
   ```

#### Database Operations:
- **READ:** `Hotel.findOne()`, `Cart.findOne()`
- **CREATE/UPDATE:** `Cart.save()`
- **Collections:** `hotels`, `carts`

#### Lưu ý:
- Cart có TTL index: tự động xóa sau 24h
- Cart có thể lưu theo `userId` (đăng nhập) hoặc `sessionId` (cookie)

---

### **BƯỚC 4: Xem Giỏ Hàng**

**Route:** `GET /cart?tab=hotel`  
**Controller:** `controllers/client/cart.controller.js` → `module.exports.index`  
**View:** `views/client/pages/cart-unified.pug`

#### Quy Trình:

1. **Tìm cart:**
   ```javascript
   const cart = await Cart.findOne({ userId }) || 
                await Cart.findOne({ sessionId });
   ```

2. **Parse và format data:**
   - Parse `roomsData` từ JSON string
   - Tính tổng số người lớn, trẻ em, và chi tiết từng phòng
   - Tính giá dịch vụ thêm (breakfast, extra bed, early check-in, late checkout, airport transfer)

3. **Tính tổng tiền:**
   - Subtotal: `pricePerNight * nights * quantity` cho mỗi item
   - Extra occupancy fee (nếu có)
   - Tax (10%) và Fee (5%)
   - Additional services total

4. **Trả về:**
   - Render `cart-unified.pug` với:
     - Danh sách items trong cart
     - Chi tiết từng phòng (số người lớn, trẻ em, độ tuổi)
     - Tổng tiền
     - Form nhập thông tin khách hàng
     - Nút "Đặt phòng"

#### Database Operations:
- **READ:** `Cart.findOne()`, `Hotel.findOne()`
- **Collections:** `carts`, `hotels`

---

### **BƯỚC 5: Tạo Đơn Đặt Phòng**

**Route:** `POST /hotel-booking/create`  
**Controller:** `controllers/client/hotel-booking.controller.js` → `module.exports.createPost`  
**Model:** `models/hotel-booking.model.js`

#### Quy Trình:

1. **Nhận body:**
   ```javascript
   {
     fullName: String,
     phone: String,
     email: String,
     note: String,
     paymentMethod: String,      // "money" | "bank" | "vnpay"
     additionalServices: Object   // { global: {...}, perItem: {...} }
   }
   ```

2. **Lấy cart:**
   ```javascript
   const cart = await Cart.findOne({ userId }) || 
                await Cart.findOne({ sessionId });
   ```

3. **Validate availability:**
   - Kiểm tra lại số phòng trống cho từng item
   - Nếu không đủ, trả về lỗi

4. **Tính toán giá:**
   - **Subtotal:** Tổng giá cơ bản của tất cả items
   - **Extra occupancy fee:** Phụ thu vượt sức chứa (nếu có)
   - **Tax:** 10% của subtotal
   - **Fee:** 5% của subtotal
   - **Additional services:**
     - Global: early check-in, late checkout, airport transfer
     - Per item: extra bed, breakfast (theo age bands)
   - **Total:** `subtotal + extraOccupancyFee + tax + fee + additionalServicesTotal`

5. **Tạo booking code:**
   ```javascript
   const baseCode = "HB" + generateRandomNumber(10);  // VD: HB1234567890
   ```

6. **Tạo bookings:**
   - **Mỗi item trong cart = 1 booking record**
   - Item đầu tiên: `HB1234567890`
   - Item thứ 2: `HB1234567890-1`
   - Item thứ 3: `HB1234567890-2`
   - ...

   ```javascript
   for (let itemIndex = 0; itemIndex < cart.items.length; itemIndex++) {
     const item = cart.items[itemIndex];
     const code = itemIndex === 0 ? baseCode : `${baseCode}-${itemIndex}`;
     
     // Extract childrenDetails từ roomsData
     const childrenDetails = [];
     if (item.roomsData) {
       const parsedRoomsData = JSON.parse(decodeURIComponent(item.roomsData));
       parsedRoomsData.forEach(roomData => {
         if (roomData.children && Array.isArray(roomData.children)) {
           roomData.children.forEach(child => {
             childrenDetails.push({ age: child.age || 0 });
           });
         }
       });
     }
     
     // Lọc additionalServices cho item này
     let itemAdditionalServices = {};
     if (additionalServices.global) {
       itemAdditionalServices.global = additionalServices.global;
     }
     if (additionalServices.perItem && additionalServices.perItem[itemIndex]) {
       itemAdditionalServices.perItem = {
         [itemIndex]: additionalServices.perItem[itemIndex]
       };
     }
     
     const booking = new HotelBooking({
       code,
       userId: userId || null,
       guest: { fullName, phone, email },
       checkIn: checkInMoment.toDate(),
       checkOut: checkOutMoment.toDate(),
       adults: item.adults || 1,
       children: item.children || 0,
       childrenDetails: childrenDetails.length > 0 ? childrenDetails : undefined,
       rooms: item.quantity,
       roomsData: item.roomsData || undefined,  // Lưu nguyên JSON string
       roomId: null,  // Chưa assign phòng cụ thể
       roomTypeId: item.roomTypeId,
       currency: hotel.currency || "VND",
       pricePerNight: item.pricePerNight,
       totalNights: item.nights,
       totalAmount: item.pricePerNight * item.nights * item.quantity,
       hotel: {
         hotelId: hotel._id,
         name: hotel.name,
         address: hotel.address || "",
         thumbnail: hotel.avatar || "",
       },
       orderTotal: total,  // Tổng tiền cả đơn (tất cả bookings cùng orderTotal)
       additionalServices: itemAdditionalServices,
       status: "pending",
       paymentStatus: "unpaid",
       paymentMethod: paymentMethod || "money",
       note: note || "",
     });
     
     await booking.save();
   }
   ```

7. **Tạo notification:**
   ```javascript
   await Notification.create({
     companyId: hotel.companyId,
     type: "hotel_booking",
     title: "Đặt phòng mới",
     content: `${fullName} đã đặt ${totalRoomsBooked} phòng...`,
     link: `/${pathAdmin}/hotel/booking/list?hotelId=${hotel._id}`,
     metadata: { bookingCode: baseCode, ... }
   });
   ```

8. **Xóa cart:**
   ```javascript
   await Cart.deleteOne({ _id: cart._id });
   ```

9. **Trả về:**
   - Nếu `paymentMethod === "vnpay"`: Redirect đến VNPay
   - Nếu không: Trả về JSON với `bookingCode` để redirect đến trang success

#### Database Operations:
- **READ:** `Cart.findOne()`, `Hotel.findOne()`, `HotelBooking.find()` (check availability)
- **CREATE:** `HotelBooking.save()` (nhiều records), `Notification.create()`
- **DELETE:** `Cart.deleteOne()`
- **Collections:** `carts`, `hotels`, `hotel_bookings`, `notifications`

#### Cấu Trúc Booking Record:

```javascript
{
  code: "HB1234567890",           // Mã booking (unique)
  userId: ObjectId,                // ID user (nếu đăng nhập)
  guest: {
    fullName: "Nguyễn Văn A",
    phone: "0123456789",
    email: "a@example.com"
  },
  checkIn: Date,
  checkOut: Date,
  adults: 2,
  children: 2,
  childrenDetails: [{ age: 3 }, { age: 5 }],  // Chi tiết độ tuổi
  rooms: 2,                        // Số phòng đặt
  roomsData: String,               // JSON string: [{adults: 2, children: [{age: 3}]}, ...]
  roomId: null,                    // Chưa assign phòng cụ thể
  roomTypeId: ObjectId,
  currency: "VND",
  pricePerNight: 1000000,
  totalNights: 2,
  totalAmount: 4000000,            // Tổng tiền cho booking này
  orderTotal: 5000000,            // Tổng tiền cả đơn (tất cả bookings cùng orderTotal)
  hotel: {
    hotelId: ObjectId,
    name: "Khách sạn ABC",
    address: "123 Đường XYZ",
    thumbnail: "https://..."
  },
  additionalServices: {
    global: { early_checkin: "true", ... },
    perItem: { 0: { extra_bed: "1", ... } }
  },
  status: "pending",              // pending | confirmed | checked_in | checked_out | cancelled
  paymentStatus: "unpaid",         // unpaid | paid
  paymentMethod: "vnpay",          // money | bank | vnpay
  note: "",
  createdAt: Date,
  updatedAt: Date
}
```

---

### **BƯỚC 6: Thanh Toán**

#### 6.1. Thanh Toán VNPay

**Route:** `GET /hotel-booking/payment-vnpay`  
**Controller:** `controllers/client/hotel-booking.controller.js` → `module.exports.paymentVNPay`

1. **Lấy booking code từ query:**
   ```javascript
   const { bookingCode } = req.query;
   ```

2. **Tìm booking:**
   ```javascript
   const booking = await HotelBooking.findOne({ code: bookingCode });
   ```

3. **Tạo VNPay payment URL:**
   - Sử dụng VNPay SDK
   - Amount: `booking.orderTotal`
   - Order info: `bookingCode`

4. **Redirect đến VNPay:**
   ```javascript
   res.redirect(vnpayUrl);
   ```

#### 6.2. Callback VNPay

**Route:** `GET /hotel-booking/payment-vnpay-result`  
**Controller:** `controllers/client/hotel-booking.controller.js` → `module.exports.paymentVNPayResult`

1. **Verify payment:**
   - Kiểm tra signature từ VNPay
   - Kiểm tra `vnp_ResponseCode === "00"` (thành công)

2. **Cập nhật payment status:**
   ```javascript
   // Tìm tất cả bookings cùng base code
   const baseCode = extractBaseCode(bookingCode);
   const bookings = await HotelBooking.find({
     code: new RegExp(`^${baseCode}(-\\d+)?$`)
   });
   
   // Cập nhật tất cả
   await HotelBooking.updateMany(
     { code: new RegExp(`^${baseCode}(-\\d+)?$`) },
     { paymentStatus: "paid" }
   );
   ```

3. **Redirect đến trang success:**
   ```javascript
   res.redirect(`/hotel-booking/success?bookingCode=${bookingCode}`);
   ```

#### Database Operations:
- **READ:** `HotelBooking.findOne()`
- **UPDATE:** `HotelBooking.updateMany()`
- **Collection:** `hotel_bookings`

---

## 🔴 Luồng Admin-Side (Quản Trị)

### **BƯỚC 7: Admin Xem Danh Sách Đơn**

**Route:** `GET /admin/hotel/booking/list?hotelId=...`  
**Controller:** `controllers/admin/hotel.controller.js` → `module.exports.bookingList`  
**View:** `views/admin/pages/hotel-booking.pug` (tab: `list`)

#### Quy Trình:

1. **Lấy companyId:**
   ```javascript
   const companyId = req.account?.companyId;
   ```

2. **Lấy hotelId từ query:**
   ```javascript
   const hotelId = req.query.hotelId;
   ```

3. **Query bookings:**
   ```javascript
   const rawBookings = await HotelBooking.find({
     "hotel.hotelId": hotelId,
     // Có thể có search query
     $or: [
       { code: new RegExp(searchQuery, "i") },
       { "guest.fullName": new RegExp(searchQuery, "i") },
       { "guest.email": new RegExp(searchQuery, "i") }
     ]
   })
     .sort({ createdAt: -1 })
     .lean();
   ```

4. **Group bookings theo base code:**
   ```javascript
   // Extract base code (loại bỏ -1, -2, -R1, -R2, ...)
   // VD: HB123 → HB123
   //     HB123-1 → HB123
   //     HB123-R1 → HB123
   //     HB123-1-R1 → HB123
   
   const bookingGroups = {};
   rawBookings.forEach(b => {
     let baseCode = b.code;
     baseCode = baseCode.replace(/-R\d+(-\d+)?$/, '');  // Loại bỏ -R1, -R2
     while (baseCode.match(/-\d+$/)) {
       baseCode = baseCode.replace(/-\d+$/, '');  // Loại bỏ -1, -2
     }
     
     if (!bookingGroups[baseCode]) {
       bookingGroups[baseCode] = [];
     }
     bookingGroups[baseCode].push(b);
   });
   ```

5. **Format data:**
   - Mỗi group = 1 đơn
   - Tính tổng số phòng, tổng tiền, trạng thái, phương thức thanh toán
   - Đếm số lượng phòng theo từng loại phòng

6. **Trả về:**
   - Render `hotel-booking.pug` với:
     - Bảng danh sách đơn (mỗi đơn = 1 row)
     - Search bar (tìm theo mã, tên, email)
     - Status tabs (Tất cả, Chờ xác nhận, Đã xác nhận, ...)
     - Link đến chi tiết đơn

#### Database Operations:
- **READ:** `HotelBooking.find()`, `Hotel.find()`
- **Collections:** `hotel_bookings`, `hotels`

---

### **BƯỚC 8: Admin Xem Chi Tiết Đơn**

**Route:** `GET /admin/hotel/booking/detail/:bookingId`  
**Controller:** `controllers/admin/hotel.controller.js` → `module.exports.bookingDetail`  
**View:** `views/admin/pages/hotel-booking-detail.pug`

#### Quy Trình:

1. **Lấy bookingId từ params:**
   ```javascript
   const bookingId = req.params.bookingId;  // VD: "HB1234567890"
   ```

2. **Extract base code:**
   ```javascript
   function extractBaseCode(code) {
     let base = code;
     base = base.replace(/-R\d+(-\d+)?$/, '');
     while (base.match(/-\d+$/)) {
       base = base.replace(/-\d+$/, '');
     }
     return base;
   }
   
   const baseCode = extractBaseCode(bookingId);
   ```

3. **Tìm tất cả bookings cùng base code:**
   ```javascript
   const allBookings = await HotelBooking.find({
     code: new RegExp(`^${baseCode}(-\\d+)?(-R\\d+(-\\d+)?)?$`)
   })
     .sort({ code: 1 })
     .lean();
   ```

4. **Parse additionalServices:**
   ```javascript
   // Cấu trúc: { global: {...}, perItem: {...} }
   // Global: early_checkin, late_checkout, airport_transfer
   // PerItem: extra_bed, breakfast_{bandname}_{index}_item_{itemIndex}
   
   let globalServices = {};
   let perItemServices = {};
   
   allBookings.forEach((booking, index) => {
     if (booking.additionalServices) {
       if (booking.additionalServices.global) {
         globalServices = booking.additionalServices.global;
       }
       if (booking.additionalServices.perItem && booking.additionalServices.perItem[index]) {
         perItemServices[index] = booking.additionalServices.perItem[index];
       }
     }
   });
   ```

5. **Aggregate thông tin:**
   - Tổng số người lớn: `sum(booking.adults)` cho tất cả bookings
   - Tổng số trẻ em: `sum(booking.children)` cho tất cả bookings
   - Chi tiết trẻ em: Gộp `childrenDetails` từ tất cả bookings
   - Tổng tiền: `orderTotal` từ booking đầu tiên (tất cả bookings cùng orderTotal)

6. **Parse roomsData cho từng booking:**
   ```javascript
   allBookings.forEach(booking => {
     let roomsDetails = [];
     if (booking.roomsData) {
       try {
         roomsDetails = JSON.parse(decodeURIComponent(booking.roomsData));
       } catch (e) {
         console.error("Failed to parse roomsData:", e);
       }
     }
     
     // Nếu booking có suffix -R\d+, filter roomsData cho phòng tương ứng
     // VD: HB123-R1 → roomsDetails[0], HB123-R2 → roomsDetails[1]
     const roomNumberMatch = booking.code.match(/-R(\d+)(-\d+)?$/);
     if (roomNumberMatch && roomsDetails.length > 1) {
       const roomNumber = parseInt(roomNumberMatch[1]);
       const roomIndex = roomNumber - 1;  // -R1 → index 0
       if (roomIndex >= 0 && roomIndex < roomsDetails.length) {
         roomsDetails = [roomsDetails[roomIndex]];
       }
     }
     
     booking.roomsDetails = roomsDetails;
   });
   ```

7. **Trả về:**
   - Render `hotel-booking-detail.pug` với:
     - Thông tin khách hàng
     - Thông tin đặt phòng (tổng số phòng, người lớn, trẻ em, chi tiết từng phòng)
     - Chi tiết từng loại phòng (bảng với cột "Chi tiết từng phòng")
     - Dịch vụ thêm (global + per item)
     - Tổng tiền
     - Form cập nhật trạng thái

#### Database Operations:
- **READ:** `HotelBooking.find()`, `Hotel.findOne()`
- **Collections:** `hotel_bookings`, `hotels`

---

### **BƯỚC 9: Admin Cập Nhật Trạng Thái**

**Route:** `POST /admin/hotel/booking/update-status`  
**Controller:** `controllers/admin/hotel.controller.js` → `module.exports.updateBookingStatus`

#### Quy Trình:

1. **Nhận body:**
   ```javascript
   {
     bookingId: String,      // VD: "HB1234567890"
     status: String         // "confirmed" | "checked_in" | "checked_out" | "cancelled"
   }
   ```

2. **Extract base code:**
   ```javascript
   const baseCode = extractBaseCode(bookingId);
   ```

3. **Tìm tất cả bookings cùng base code:**
   ```javascript
   const allBookings = await HotelBooking.find({
     code: new RegExp(`^${baseCode}(-\\d+)?(-R\\d+(-\\d+)?)?$`)
   });
   ```

4. **Cập nhật tất cả bookings:**
   ```javascript
   await HotelBooking.updateMany(
     { code: new RegExp(`^${baseCode}(-\\d+)?(-R\\d+(-\\d+)?)?$`) },
     { status: newStatus }
   );
   ```

5. **Trả về JSON:**
   ```json
   {
     "code": "success",
     "message": "Cập nhật trạng thái thành công"
   }
   ```

#### Database Operations:
- **READ:** `HotelBooking.find()`
- **UPDATE:** `HotelBooking.updateMany()`
- **Collection:** `hotel_bookings`

#### Lưu ý:
- Khi cập nhật trạng thái, **tất cả bookings cùng base code** đều được cập nhật
- VD: Cập nhật `HB123` → `HB123`, `HB123-1`, `HB123-R1`, `HB123-R2` đều được cập nhật

---

### **BƯỚC 10: Admin Xếp Phòng Cụ Thể**

**Route:** `POST /admin/hotel/booking/assign-room`  
**Controller:** `controllers/admin/hotel.controller.js` → `module.exports.assignRoom`  
**View:** `views/admin/pages/hotel-booking.pug` (tab: `room-management`)

#### Quy Trình:

1. **Nhận body:**
   ```javascript
   {
     bookingId: String,      // ID của booking gốc (VD: ObjectId của HB123)
     roomIds: Array          // [ObjectId1, ObjectId2, ...] - Số phòng cụ thể
   }
   ```

2. **Tìm booking gốc:**
   ```javascript
   const originalBooking = await HotelBooking.findById(bookingId);
   ```

3. **Validate:**
   - Kiểm tra booking chưa được assign phòng: `originalBooking.roomId === null`
   - Kiểm tra booking không phải là child booking (không có suffix `-R\d+`)
   - Kiểm tra số lượng phòng khớp: `roomIds.length === originalBooking.rooms`
   - Kiểm tra các phòng còn trống trong khoảng thời gian

4. **Tạo child bookings:**
   ```javascript
   const baseCode = extractBaseCode(originalBooking.code);
   const createdBookings = [];
   
   for (let i = 0; i < roomIds.length; i++) {
     const roomId = roomIds[i];
     const suffix = `-R${i + 1}`;  // -R1, -R2, -R3, ...
     const newCode = `${baseCode}${suffix}`;
     
     // Kiểm tra code chưa tồn tại
     const existing = await HotelBooking.findOne({ code: newCode });
     if (existing) {
       // Fallback: thêm timestamp
       const timestamp = Date.now();
       const newCode = `${baseCode}${suffix}-${timestamp}`;
     }
     
     // Parse roomsData để lấy thông tin phòng tương ứng
     let roomsDetails = [];
     if (originalBooking.roomsData) {
       roomsDetails = JSON.parse(decodeURIComponent(originalBooking.roomsData));
     }
     
     const roomDetail = roomsDetails[i] || {
       adults: originalBooking.adults,
       children: originalBooking.childrenDetails || []
     };
     
     const childBooking = new HotelBooking({
       code: newCode,
       userId: originalBooking.userId,
       guest: originalBooking.guest,
       checkIn: originalBooking.checkIn,
       checkOut: originalBooking.checkOut,
       adults: roomDetail.adults || originalBooking.adults,
       children: roomDetail.children?.length || originalBooking.children || 0,
       childrenDetails: roomDetail.children || originalBooking.childrenDetails || [],
       rooms: 1,  // Mỗi child booking = 1 phòng
       roomsData: JSON.stringify([roomDetail]),  // Chỉ lưu thông tin phòng này
       roomId: roomId,  // ✅ Assign phòng cụ thể
       roomTypeId: originalBooking.roomTypeId,
       currency: originalBooking.currency,
       pricePerNight: originalBooking.pricePerNight,
       totalNights: originalBooking.totalNights,
       totalAmount: originalBooking.pricePerNight * originalBooking.totalNights,
       hotel: originalBooking.hotel,
       orderTotal: originalBooking.orderTotal,
       additionalServices: originalBooking.additionalServices,
       status: originalBooking.status,
       paymentStatus: originalBooking.paymentStatus,
       paymentMethod: originalBooking.paymentMethod,
       note: originalBooking.note,
     });
     
     await childBooking.save();
     createdBookings.push(childBooking);
   }
   ```

5. **Trả về JSON:**
   ```json
   {
     "code": "success",
     "message": "Xếp phòng thành công",
     "bookings": createdBookings.map(b => ({
       code: b.code,
       roomId: b.roomId,
       roomNumber: room.roomNumber
     }))
   }
   ```

#### Database Operations:
- **READ:** `HotelBooking.findById()`, `HotelBooking.findOne()`, `Hotel.findOne()`
- **CREATE:** `HotelBooking.save()` (nhiều child bookings)
- **Collections:** `hotel_bookings`, `hotels`

#### Lưu ý:
- Booking gốc (`HB123`) vẫn giữ nguyên, không bị xóa
- Tạo các child bookings (`HB123-R1`, `HB123-R2`, ...) với `roomId` cụ thể
- Mỗi child booking = 1 phòng cụ thể
- `roomsData` của child booking chỉ chứa thông tin của phòng đó

---

### **BƯỚC 11: Admin Xem Quản Lý Số Phòng**

**Route:** `GET /admin/hotel/booking/room-management?hotelId=...`  
**Controller:** `controllers/admin/hotel.controller.js` → `module.exports.roomManagement`  
**View:** `views/admin/pages/hotel-booking.pug` (tab: `room-management`)

#### Quy Trình:

1. **Lấy hotelId từ query:**
   ```javascript
   const hotelId = req.query.hotelId;
   ```

2. **Lấy tất cả phòng của hotel:**
   ```javascript
   const hotel = await Hotel.findOne({ _id: hotelId, deleted: false });
   const rooms = hotel.rooms || [];
   // Sort theo floor và room number
   rooms.sort((a, b) => {
     const floorCompare = (a.floor || "").localeCompare(b.floor || "");
     if (floorCompare !== 0) return floorCompare;
     return (a.roomNumber || "").localeCompare(b.roomNumber || "");
   });
   ```

3. **Lấy bookings chưa assign phòng:**
   ```javascript
   const pendingBookings = await HotelBooking.find({
     "hotel.hotelId": hotelId,
     roomId: null,  // Chưa assign
     status: { $nin: ["cancelled"] }
   })
     .sort({ checkIn: 1 })
     .lean();
   ```

4. **Lấy bookings đã assign phòng:**
   ```javascript
   const assignedBookings = await HotelBooking.find({
     "hotel.hotelId": hotelId,
     roomId: { $ne: null, $exists: true },
     status: { $nin: ["cancelled"] }
   })
     .lean();
   ```

5. **Tính trạng thái phòng:**
   ```javascript
   // Phòng "Đang sử dụng" chỉ khi có booking checked_in và đang diễn ra
   const now = new Date();
   const occupiedRoomIds = new Set();
   
   assignedBookings.forEach(booking => {
     if (booking.status === "checked_in" &&
         booking.checkIn <= now &&
         booking.checkOut > now) {
       occupiedRoomIds.add(String(booking.roomId));
     }
   });
   ```

6. **Format data:**
   - Mỗi phòng có: `_id`, `roomNumber`, `floor`, `roomType`, `status`, `bookings[]`
   - Mỗi booking có: `code`, `customerName`, `checkIn`, `checkOut`, `status`, `roomsDetails`

7. **Trả về:**
   - Render `hotel-booking.pug` với:
     - Danh sách bookings chưa assign (có thể drag & drop)
     - Danh sách phòng với trạng thái (Trống / Đang sử dụng)
     - Modal "Xem chi tiết" khi click vào booking

#### Database Operations:
- **READ:** `Hotel.findOne()`, `HotelBooking.find()`
- **Collections:** `hotels`, `hotel_bookings`

---

### **BƯỚC 12: Admin Xem Danh Sách Khách Hàng**

**Route:** `GET /admin/hotel/booking/guest-list?hotelId=...`  
**Controller:** `controllers/admin/hotel.controller.js` → `module.exports.guestList`  
**View:** `views/admin/pages/hotel-booking.pug` (tab: `guest-list`)

#### Quy Trình:

1. **Lấy hotelId từ query:**
   ```javascript
   const hotelId = req.query.hotelId;
   ```

2. **Lấy search query (nếu có):**
   ```javascript
   const searchGuestName = (req.query.guestName || "").trim();
   const searchCheckInDate = req.query.checkInDate || null;
   const searchCheckOutDate = req.query.checkOutDate || null;
   ```

3. **Tạo filter:**
   ```javascript
   const bookingFilter = {
     "hotel.hotelId": hotelId,
     roomId: { $ne: null, $exists: true },  // Đã được assign phòng
     status: { $nin: ["cancelled"] }
   };
   
   if (searchGuestName) {
     bookingFilter["guest.fullName"] = new RegExp(searchGuestName, "i");
   }
   
   if (searchCheckInDate) {
     const checkInStart = moment(searchCheckInDate).startOf("day").toDate();
     const checkInEnd = moment(searchCheckInDate).endOf("day").toDate();
     bookingFilter.checkIn = { $gte: checkInStart, $lte: checkInEnd };
   }
   
   if (searchCheckOutDate) {
     const checkOutStart = moment(searchCheckOutDate).startOf("day").toDate();
     const checkOutEnd = moment(searchCheckOutDate).endOf("day").toDate();
     bookingFilter.checkOut = { $gte: checkOutStart, $lte: checkOutEnd };
   }
   ```

4. **Query bookings:**
   ```javascript
   const bookings = await HotelBooking.find(bookingFilter)
     .select("code guest checkIn checkOut adults children childrenDetails roomId roomTypeId status roomsData")
     .sort({ checkIn: -1 })
     .lean();
   ```

5. **Format guests:**
   ```javascript
   const guests = bookings.map(booking => {
     // Parse roomsData
     let roomsDetails = [];
     if (booking.roomsData) {
       try {
         roomsDetails = JSON.parse(decodeURIComponent(booking.roomsData));
       } catch (e) {
         console.error("Failed to parse roomsData:", e);
       }
     }
     
     // Nếu booking có suffix -R\d+, filter roomsData cho phòng tương ứng
     const roomNumberMatch = booking.code.match(/-R(\d+)(-\d+)?$/);
     if (roomNumberMatch && roomsDetails.length > 1) {
       const roomNumber = parseInt(roomNumberMatch[1]);
       const roomIndex = roomNumber - 1;
       if (roomIndex >= 0 && roomIndex < roomsDetails.length) {
         roomsDetails = [roomsDetails[roomIndex]];
       }
     }
     
     const roomDetail = roomsDetails[0] || {
       adults: booking.adults || 0,
       children: booking.childrenDetails || []
     };
     
     return {
       bookingCode: booking.code,
       guestName: booking.guest?.fullName || "N/A",
       guestEmail: booking.guest?.email || "N/A",
       guestPhone: booking.guest?.phone || "",
       checkInDisplay: moment(booking.checkIn).format("DD/MM/YYYY"),
       checkOutDisplay: moment(booking.checkOut).format("DD/MM/YYYY"),
       roomType: roomTypeName,
       roomNumber: roomNumber,
       adults: roomDetail.adults || booking.adults || 0,
       children: roomDetail.children?.length || booking.children || 0,
       childrenDetails: roomDetail.children || booking.childrenDetails || [],
       status: booking.status
     };
   });
   ```

6. **Trả về:**
   - Render `hotel-booking.pug` với:
     - Search form (tên khách hàng, ngày check-in, ngày check-out)
     - Bảng danh sách khách hàng với thông tin chi tiết

#### Database Operations:
- **READ:** `HotelBooking.find()`, `Hotel.findOne()`
- **Collections:** `hotel_bookings`, `hotels`

---

## 🗄️ Cấu Trúc Database

### **Collection: `hotels`**

```javascript
{
  _id: ObjectId,
  companyId: ObjectId,           // Reference đến Company
  name: String,
  province: ObjectId,            // Reference đến City
  address: String,
  starRating: Number,
  basePrice: Number,
  currency: String,
  status: String,                // "active" | "inactive"
  avatar: String,
  images: [String],
  description: String,
  
  // Age Bands (Mức tuổi)
  ageBands: [{
    bandName: String,            // "Trẻ nhỏ", "Trẻ em", "Người lớn"
    minAge: Number,
    maxAge: Number,
    bandType: String,            // "infant" | "child" | "adult" | "other"
    countInOccupancy: Boolean,
    occupancyWeight: Number,    // 0 | 0.5 | 1
    breakfastIsFree: Boolean,
    breakfastFeePerPersonPerMeal: Number,
    applyExtraPersonFee: Boolean,
    extraPersonFeePerNight: Number
  }],
  
  // Room Types (Loại phòng)
  roomTypes: [{
    _id: ObjectId,
    name: String,
    basePrice: Number,
    baseOccupancy: Number,       // Số người đã gồm trong giá
    maxOccupancy: Number,         // Tối đa người
    maxExtraBeds: Number,
    extraBedFeePerNight: Number,
    sizeM2: Number,
    bedInfo: String,
    view: String,
    images: [String],
    // ...
  }],
  
  // Individual Rooms (Phòng cụ thể)
  rooms: [{
    _id: ObjectId,
    roomNumber: String,          // "101", "102", ...
    floor: String,               // "Tầng 1", "Tầng 2", ...
    roomTypeId: ObjectId,        // Reference đến roomTypes[]._id
    status: String               // "vacant" | "occupied" | "cleaning" | "out_of_service"
  }],
  
  deleted: Boolean,
  createdAt: Date,
  updatedAt: Date
}
```

### **Collection: `hotel_bookings`**

```javascript
{
  _id: ObjectId,
  code: String,                   // "HB1234567890", "HB1234567890-1", "HB1234567890-R1", ...
  userId: ObjectId,              // Reference đến AccountUser (nếu đăng nhập)
  guest: {
    fullName: String,
    phone: String,
    email: String
  },
  checkIn: Date,
  checkOut: Date,
  adults: Number,
  children: Number,
  childrenDetails: [{ age: Number }],  // [{ age: 3 }, { age: 5 }]
  rooms: Number,                 // Số phòng đặt
  roomsData: String,             // JSON string: [{adults: 2, children: [{age: 3}]}, ...]
  
  roomId: ObjectId,              // ID của phòng cụ thể (null nếu chưa assign)
  roomTypeId: ObjectId,          // ID của loại phòng
  
  currency: String,
  pricePerNight: Number,
  totalNights: Number,
  totalAmount: Number,           // Tổng tiền cho booking này
  orderTotal: Number,            // Tổng tiền cả đơn (tất cả bookings cùng orderTotal)
  
  hotel: {
    hotelId: ObjectId,
    name: String,
    address: String,
    thumbnail: String
  },
  
  additionalServices: {
    global: {
      early_checkin: "true" | "false",
      late_checkout: "true" | "false",
      airport_transfer: "true" | "false" | quantity
    },
    perItem: {
      0: {                      // Index của item trong cart
        extra_bed: "1",
        breakfast_trẻ_nhỏ_0_item_0: "2",
        breakfast_trẻ_em_1_item_0: "3"
      }
    }
  },
  
  status: String,                // "pending" | "confirmed" | "checked_in" | "checked_out" | "cancelled"
  paymentStatus: String,        // "unpaid" | "paid"
  paymentMethod: String,         // "money" | "bank" | "vnpay"
  note: String,
  
  createdAt: Date,
  updatedAt: Date
}
```

### **Collection: `carts`**

```javascript
{
  _id: ObjectId,
  userId: ObjectId,              // Reference đến AccountUser (nếu đăng nhập)
  sessionId: String,             // Cookie session ID (nếu chưa đăng nhập)
  hotelId: ObjectId,              // Reference đến Hotel
  items: [{
    hotelId: ObjectId,
    hotelName: String,
    roomTypeId: ObjectId,
    roomTypeName: String,
    quantity: Number,             // Số phòng
    pricePerNight: Number,
    checkInDate: String,         // YYYY-MM-DD
    checkOutDate: String,        // YYYY-MM-DD
    nights: Number,
    roomsData: String,           // JSON string
    adults: Number,
    children: Number,
    rooms: Number
  }],
  createdAt: Date,               // TTL index: tự động xóa sau 24h
  updatedAt: Date
}
```

### **Collection: `notifications`**

```javascript
{
  _id: ObjectId,
  companyId: ObjectId,            // Reference đến Company
  type: String,                   // "hotel_booking"
  title: String,
  content: String,
  link: String,
  metadata: {
    bookingCode: String,
    customerName: String,
    checkIn: Date,
    checkOut: Date,
    paymentMethod: String,
    amount: Number,
    hotelId: ObjectId,
    hotelName: String
  },
  read: Boolean,
  createdAt: Date
}
```

---

## 🔧 Các Helper Functions

### **1. `helpers/hotel-availability.helper.js`**

#### `calculateEffectiveOccupancy(roomsData, ageBands)`

Tính effective occupancy dựa trên age bands.

**Input:**
- `roomsData`: `[{adults: 2, children: [{age: 3}]}, ...]`
- `ageBands`: `[{bandName: "Trẻ nhỏ", minAge: 0, maxAge: 2, countInOccupancy: true, occupancyWeight: 0.5}, ...]`

**Output:** `Number` (effective occupancy)

**Logic:**
- Người lớn luôn tính đủ 1
- Trẻ em tính theo `occupancyWeight` của age band phù hợp

---

#### `getAvailableRoomsForType(allRooms, roomTypeId, bookings, checkIn, checkOut)`

Lấy danh sách phòng trống cho một room type trong khoảng thời gian.

**Input:**
- `allRooms`: Tất cả phòng của hotel
- `roomTypeId`: ID của room type
- `bookings`: Tất cả bookings của hotel
- `checkIn`: Date
- `checkOut`: Date

**Output:** `Array<ObjectId>` (danh sách room IDs còn trống)

**Logic:**
1. Lọc phòng thuộc room type này và có `status === "vacant"`
2. Với mỗi phòng, kiểm tra xem có booking nào overlap không
3. Trả về danh sách phòng không có conflict

---

#### `hasTimeOverlap(searchCheckIn, searchCheckOut, bookingCheckIn, bookingCheckOut)`

Kiểm tra xem có overlap giữa 2 khoảng thời gian hay không.

**Input:** 4 Date objects

**Output:** `Boolean`

**Logic:**
- Không overlap nếu: `booking.checkOut <= searchCheckIn` HOẶC `booking.checkIn >= searchCheckOut`
- Ngược lại: có overlap

---

#### `checkHotelAvailability(hotel, checkIn, checkOut, roomsData, ageBands)`

Kiểm tra xem hotel có đủ phòng trống không.

**Input:**
- `hotel`: Hotel object
- `checkIn`: Date
- `checkOut`: Date
- `roomsData`: `[{adults: 2, children: [{age: 3}]}, ...]`
- `ageBands`: Age bands của hotel

**Output:** `Boolean`

**Logic:**
1. Với mỗi phòng trong `roomsData`:
   - Tính effective occupancy
   - Tìm room types có thể chứa được (ít nhất 1 phòng trong room type chứa được)
   - Kiểm tra số phòng trống
2. Trả về `true` nếu tất cả phòng đều có room type phù hợp và đủ phòng trống

---

### **2. `helpers/generate.helper.js`**

#### `generateRandomNumber(length)`

Tạo số ngẫu nhiên với độ dài cho trước.

**Input:** `Number` (độ dài)

**Output:** `String` (số ngẫu nhiên)

**Ví dụ:** `generateRandomNumber(10)` → `"1234567890"`

---

## 📝 Ghi Chú Quan Trọng

### **1. Booking Code Structure:**

- **Base code:** `HB1234567890` (10 chữ số ngẫu nhiên)
- **Multi-item suffix:** `HB1234567890-1`, `HB1234567890-2`, ... (khi có nhiều loại phòng)
- **Room assignment suffix:** `HB1234567890-R1`, `HB1234567890-R2`, ... (khi admin xếp phòng)
- **Combined:** `HB1234567890-1-R1` (nếu vừa có multi-item vừa có room assignment)

### **2. Grouping Logic:**

- Tất cả bookings có cùng **base code** được group lại thành 1 đơn
- Base code = code sau khi loại bỏ tất cả suffix (`-1`, `-2`, `-R1`, `-R2`, ...)

### **3. roomsData Format:**

- Lưu dưới dạng **JSON string** (có thể URL-encoded)
- Format: `[{adults: 2, children: [{age: 3}, {age: 5}]}, {adults: 1, children: []}]`
- Mỗi object trong array = 1 phòng
- Khi parse, cần `decodeURIComponent()` trước `JSON.parse()`

### **4. Additional Services Structure:**

```javascript
{
  global: {
    early_checkin: "true",
    late_checkout: "true",
    airport_transfer: "2"  // Quantity
  },
  perItem: {
    0: {  // Index của item trong cart
      extra_bed: "1",
      breakfast_trẻ_nhỏ_0_item_0: "2",
      breakfast_trẻ_em_1_item_0: "3"
    }
  }
}
```

### **5. Status Flow:**

```
pending → confirmed → checked_in → checked_out
   ↓
cancelled
```

- **pending:** Chờ xác nhận (mặc định khi tạo booking)
- **confirmed:** Đã xác nhận (admin xác nhận)
- **checked_in:** Đã nhận phòng (khách đã check-in)
- **checked_out:** Đã trả phòng (khách đã check-out)
- **cancelled:** Đã hủy

### **6. Payment Flow:**

- **unpaid** → **paid** (sau khi thanh toán thành công)
- Khi thanh toán VNPay thành công, **tất cả bookings cùng base code** đều được cập nhật `paymentStatus = "paid"`

---

## 🎯 Tóm Tắt Luồng

```
1. Client tìm kiếm → /hotel/search
   ↓
2. Client xem chi tiết → /hotel/detail/:id
   ↓
3. Client thêm vào giỏ hàng → POST /hotel-cart/add
   ↓
4. Client xem giỏ hàng → /cart?tab=hotel
   ↓
5. Client tạo đơn → POST /hotel-booking/create
   ↓
6. Client thanh toán → VNPay hoặc tiền mặt
   ↓
7. Admin xem danh sách → /admin/hotel/booking/list
   ↓
8. Admin xem chi tiết → /admin/hotel/booking/detail/:bookingId
   ↓
9. Admin cập nhật trạng thái → POST /admin/hotel/booking/update-status
   ↓
10. Admin xếp phòng → POST /admin/hotel/booking/assign-room
   ↓
11. Admin xem quản lý số phòng → /admin/hotel/booking/room-management
   ↓
12. Admin xem danh sách khách hàng → /admin/hotel/booking/guest-list
```

---

**Tài liệu này được tạo tự động dựa trên code hiện tại. Có thể cần cập nhật khi code thay đổi.**

