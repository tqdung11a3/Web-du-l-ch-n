# Giải thích chi tiết hàm `createPost` - Tạo Tour mới

## Tổng quan

Hàm `createPost` là một controller xử lý việc tạo tour mới trong hệ thống quản lý tour du lịch. Hàm này nhận dữ liệu từ form phía client, chuẩn hóa và validate dữ liệu, sau đó lưu vào database MongoDB.

**Vị trí:** `controllers/admin/tour.controller.js` (dòng 762-969)

**Chức năng chính:**
- Nhận và xử lý dữ liệu từ request body
- Chuẩn hóa các trường dữ liệu (giá, ngày, mảng, file)
- Validate và kiểm tra tính hợp lệ
- Lưu tour mới vào database

---

## Phân tích chi tiết từng phần

### 1. Kiểm tra và xác định công ty (dòng 764-771)

```javascript
const companyId = req.account.companyId;
if (!companyId) {
  return res.json({
    code: "error",
    message: "Không xác định được công ty!",
  });
}
```

**Mục đích:**
- Lấy `companyId` từ tài khoản admin đang đăng nhập
- Đảm bảo mỗi tour phải thuộc về một công ty cụ thể (multi-tenant system)

**Logic:**
- Nếu không có `companyId` → trả về lỗi và dừng xử lý
- Đây là bước bảo mật quan trọng để đảm bảo dữ liệu được phân tách theo công ty

---

### 2. Xử lý vị trí (position) của tour (dòng 773-779)

```javascript
if (req.body.position) {
  req.body.position = parseInt(req.body.position, 10) || 0;
} else {
  const totalRecord = await Tour.countDocuments({ companyId });
  req.body.position = totalRecord + 1;
}
```

**Mục đích:**
- Xác định vị trí hiển thị của tour trong danh sách
- Đếm theo từng công ty (scope theo `companyId`)

**Logic:**
- Nếu client gửi `position` → chuyển sang số nguyên
- Nếu không có → tự động gán = số tour hiện có của công ty + 1
- Tour mới nhất sẽ có position cao nhất

**Ví dụ:**
- Công ty A có 5 tour → tour mới sẽ có `position = 6`
- Công ty B có 0 tour → tour mới sẽ có `position = 1`

---

### 3. Chuẩn hóa giá (dòng 781-794)

```javascript
const toInt = (v, d = 0) =>
  v !== undefined && v !== null && v !== "" ? parseInt(v, 10) || d : d;

req.body.priceAdult = toInt(req.body.priceAdult);
req.body.priceChildren = toInt(req.body.priceChildren);
req.body.priceBaby = toInt(req.body.priceBaby);

req.body.priceNewAdult = toInt(req.body.priceNewAdult, req.body.priceAdult);
req.body.priceNewChildren = toInt(
  req.body.priceNewChildren,
  req.body.priceChildren
);
req.body.priceNewBaby = toInt(req.body.priceNewBaby, req.body.priceBaby);
```

**Mục đích:**
- Chuyển đổi tất cả giá từ string sang số nguyên
- Xử lý giá gốc và giá khuyến mãi

**Hàm `toInt`:**
- Tham số `v`: giá trị cần chuyển đổi
- Tham số `d`: giá trị mặc định (default = 0)
- Logic: Nếu giá trị hợp lệ → `parseInt`, nếu không → dùng giá trị mặc định

**Các loại giá:**
- **Giá gốc:**
  - `priceAdult`: Giá người lớn
  - `priceChildren`: Giá trẻ em
  - `priceBaby`: Giá em bé
- **Giá khuyến mãi (priceNew*):**
  - Nếu không có giá khuyến mãi → dùng giá gốc làm mặc định
  - Dùng để hiển thị giá đã giảm

**Ví dụ:**
```javascript
// Input: priceAdult = "1000000", priceNewAdult = "800000"
// Output: priceAdult = 1000000, priceNewAdult = 800000

// Input: priceAdult = "1000000", priceNewAdult = ""
// Output: priceAdult = 1000000, priceNewAdult = 1000000 (dùng giá gốc)
```

---

### 4. Xử lý điểm khởi hành (dòng 796-797)

```javascript
req.body.departureCity = req.body.departureCity || null;
```

**Mục đích:**
- Chuẩn hóa điểm khởi hành
- Nếu không có → gán `null`

---

### 5. Xử lý dữ liệu mảng và ngày (dòng 799-835)

#### 5.1. Locations (địa điểm) - dòng 801

```javascript
req.body.locations = parseLocationsPayload(req.body.locations);
```

**Mục đích:**
- Chuẩn hóa danh sách địa điểm tour sẽ đi qua
- Hàm `parseLocationsPayload` (định nghĩa ở đầu file) xử lý:
  - Parse JSON string thành mảng
  - Chuẩn hóa format: `[{ city: ObjectId, spots: [String] }, ...]`
  - Hỗ trợ cả dữ liệu cũ (chỉ có cityId)

**Ví dụ input:**
```json
[
  { "city": "507f1f77bcf86cd799439011", "spots": ["Chợ Bến Thành", "Nhà thờ Đức Bà"] },
  { "city": "507f1f77bcf86cd799439012", "spots": ["Hồ Hoàn Kiếm"] }
]
```

#### 5.2. Schedules (lịch trình) - dòng 803-805

```javascript
req.body.schedules = req.body.schedules
  ? JSON.parse(req.body.schedules)
  : [];
```

**Mục đích:**
- Parse lịch trình tour từ JSON string
- Nếu không có → mảng rỗng

**Ví dụ:**
```json
[
  { "day": 1, "title": "Ngày 1: Khởi hành", "description": "..." },
  { "day": 2, "title": "Ngày 2: Tham quan", "description": "..." }
]
```

#### 5.3. DepartureDates (mảng ngày khởi hành) - dòng 807-830

```javascript
if (req.body.departureDates) {
  try {
    const datesRaw = typeof req.body.departureDates === "string" 
      ? JSON.parse(req.body.departureDates) 
      : req.body.departureDates;
    if (Array.isArray(datesRaw)) {
      req.body.departureDates = datesRaw
        .map((d) => {
          if (!d) return null;
          const date = typeof d === "string" ? new Date(d) : d;
          return date instanceof Date && !isNaN(date) ? date : null;
        })
        .filter((d) => d !== null)
        .sort((a, b) => a - b); // Sắp xếp tăng dần
    } else {
      req.body.departureDates = [];
    }
  } catch {
    req.body.departureDates = [];
  }
} else {
  req.body.departureDates = [];
}
```

**Mục đích:**
- Xử lý mảng các ngày khởi hành của tour
- Một tour có thể có nhiều ngày khởi hành khác nhau

**Logic xử lý:**
1. Kiểm tra nếu có `departureDates`
2. Parse từ string (nếu là string) hoặc dùng trực tiếp (nếu là mảng)
3. Chuyển mỗi phần tử thành Date object
4. Lọc bỏ các ngày không hợp lệ (`null`, `NaN`)
5. Sắp xếp theo thứ tự tăng dần (ngày sớm nhất trước)

**Ví dụ:**
```javascript
// Input: ["2024-12-25", "2024-12-20", "2024-12-30"]
// Output: [Date(2024-12-20), Date(2024-12-25), Date(2024-12-30)]
```

#### 5.4. DepartureDate (tương thích) - dòng 832-835

```javascript
req.body.departureDate = req.body.departureDates.length > 0 
  ? req.body.departureDates[0] 
  : null;
```

**Mục đích:**
- Giữ lại field `departureDate` để tương thích với code cũ
- Lấy ngày đầu tiên trong mảng `departureDates` (đã được sắp xếp)

---

### 6. Xử lý textarea thành mảng (dòng 837-849)

```javascript
const parseTextareaToArray = (text) => {
  if (!text || typeof text !== "string") return [];
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
};

req.body.highlights = parseTextareaToArray(req.body.highlights);
req.body.includes = parseTextareaToArray(req.body.includes);
req.body.excludes = parseTextareaToArray(req.body.excludes);
```

**Mục đích:**
- Chuyển đổi textarea (mỗi dòng một mục) thành mảng
- Áp dụng cho 3 trường:
  - `highlights`: Điểm nổi bật của tour
  - `includes`: Những gì bao gồm trong tour
  - `excludes`: Những gì không bao gồm trong tour

**Logic:**
1. Kiểm tra nếu là string hợp lệ
2. Tách theo ký tự xuống dòng (`\n`)
3. Loại bỏ khoảng trắng đầu/cuối mỗi dòng
4. Lọc bỏ các dòng rỗng

**Ví dụ:**
```javascript
// Input (textarea):
// "Bữa sáng buffet\nXe đưa đón\nHướng dẫn viên\n\nBảo hiểm du lịch"

// Output (array):
// ["Bữa sáng buffet", "Xe đưa đón", "Hướng dẫn viên", "Bảo hiểm du lịch"]
```

---

### 7. Xử lý khuyến mãi (giảm giá theo số tiền cố định) - dòng 851-887

```javascript
if (req.body.discountFrom || req.body.discountTo) {
  const fromRaw = req.body.discountFrom;
  const toRaw = req.body.discountTo;

  if (fromRaw && toRaw) {
    const fromM = moment(fromRaw, "YYYY-MM-DD").startOf("day");
    const toM = moment(toRaw, "YYYY-MM-DD").endOf("day");

    if (fromM.isValid() && toM.isValid() && toM.isAfter(fromM)) {
      req.body.discountFrom = fromM.toDate();
      req.body.discountTo = toM.toDate();
    } else {
      req.body.discountFrom = null;
      req.body.discountTo = null;
    }
  } else {
    req.body.discountFrom = null;
    req.body.discountTo = null;
  }

  // Đây là khuyến mãi theo giá cố định -> không dùng % giảm
  if (!req.body.discountPercent) {
    req.body.discountPercent = 0;
  }
  req.body.discountApplied = false;
  req.body.backupPriceNewAdult = 0;
  req.body.backupPriceNewChildren = 0;
  req.body.backupPriceNewBaby = 0;
} else {
  // không cấu hình khuyến mãi
  req.body.discountFrom = null;
  req.body.discountTo = null;
  if (!req.body.discountPercent) {
    req.body.discountPercent = 0;
  }
}
```

**Mục đích:**
- Xử lý khuyến mãi theo thời hạn (giảm giá cố định, không phải %)
- Validate và chuẩn hóa khoảng thời gian khuyến mãi

**Logic:**
1. **Nếu có `discountFrom` hoặc `discountTo`:**
   - Chuyển sang Date object bằng `moment`
   - `startOf("day")`: Bắt đầu từ 00:00:00
   - `endOf("day")`: Kết thúc lúc 23:59:59
   - Validate: Cả 2 ngày phải hợp lệ và `to > from`
   - Nếu không hợp lệ → reset về `null`

2. **Reset các field liên quan:**
   - `discountPercent = 0` (không dùng % giảm)
   - `discountApplied = false` (chưa áp dụng)
   - `backupPriceNew* = 0` (reset giá backup)

3. **Nếu không có khuyến mãi:**
   - Reset tất cả về `null` hoặc `0`

**Lưu ý:**
- Đây là khuyến mãi theo **giá cố định** (đã được set ở `priceNew*`)
- Không phải khuyến mãi theo **phần trăm** (`discountPercent`)

**Ví dụ:**
```javascript
// Input: discountFrom = "2024-12-01", discountTo = "2024-12-31"
// Output: 
//   discountFrom = Date(2024-12-01 00:00:00)
//   discountTo = Date(2024-12-31 23:59:59)
```

---

### 8. Cấu hình giá em bé (dòng 889-923)

```javascript
const babyPricingMode = (req.body.babyPricingMode || "fixed").trim();
req.body.babyPricingMode =
  babyPricingMode === "tiered" ? "tiered" : "fixed";

req.body.babyPricingRules = [];
if (
  req.body.babyPricingMode === "tiered" &&
  req.body.babyPricingRulesJson
) {
  try {
    const raw = JSON.parse(req.body.babyPricingRulesJson);
    if (Array.isArray(raw)) {
      req.body.babyPricingRules = raw
        .map((r) => ({
          from: Number(r.from),
          to: r.to === "inf" ? "inf" : Number(r.to),
          percent: Number(r.percent),
          ref: r.ref === "adult" ? "adult" : "children",
        }))
        .filter(
          (r) =>
            Number.isFinite(r.from) &&
            (r.to === "inf" || Number.isFinite(r.to)) &&
            Number.isFinite(r.percent) &&
            r.percent >= 0 &&
            r.percent <= 100
        );
    }
  } catch (_) {
    /* JSON rules không hợp lệ -> bỏ qua */
  }
  // tiered => không dùng priceNewBaby
  req.body.priceNewBaby = 0;
}
```

**Mục đích:**
- Xử lý 2 chế độ tính giá em bé:
  - **Fixed**: Giá cố định (dùng `priceNewBaby`)
  - **Tiered**: Giá theo bậc (tính theo % của người lớn/trẻ em)

**Logic:**

1. **Xác định chế độ:**
   - Mặc định: `"fixed"`
   - Nếu là `"tiered"` → dùng tiered, ngược lại → fixed

2. **Nếu là chế độ Tiered:**
   - Parse JSON rules từ `babyPricingRulesJson`
   - Mỗi rule có:
     - `from`: Tuổi bắt đầu (số)
     - `to`: Tuổi kết thúc (số hoặc `"inf"` = vô hạn)
     - `percent`: Phần trăm (0-100%)
     - `ref`: Tham chiếu (`"adult"` hoặc `"children"`)
   - Validate: Tất cả giá trị phải hợp lệ
   - Nếu JSON không hợp lệ → bỏ qua (giữ mảng rỗng)
   - Reset `priceNewBaby = 0` (không dùng giá cố định)

**Ví dụ Tiered Rules:**
```json
[
  { "from": 0, "to": 2, "percent": 0, "ref": "adult" },
  { "from": 2, "to": 5, "percent": 50, "ref": "adult" },
  { "from": 5, "to": "inf", "percent": 75, "ref": "children" }
]
```
**Giải thích:**
- 0-2 tuổi: Miễn phí (0% giá người lớn)
- 2-5 tuổi: 50% giá người lớn
- Trên 5 tuổi: 75% giá trẻ em

---

### 9. Quản lý ghế (seats) - dòng 925-942

```javascript
const seatsTotal = toInt(req.body.seatsTotal, 0);
let seatsRemaining =
  req.body.seatsRemaining !== undefined
    ? toInt(req.body.seatsRemaining, seatsTotal)
    : seatsTotal;

// chuẩn hoá ràng buộc
if (seatsRemaining < 0) seatsRemaining = 0;
if (seatsRemaining > seatsTotal) seatsRemaining = seatsTotal;

req.body.seatsTotal = seatsTotal;
req.body.seatsRemaining = seatsRemaining;

// bỏ các field stock cũ nếu client còn gửi lên
delete req.body.stockAdult;
delete req.body.stockChildren;
delete req.body.stockBaby;
```

**Mục đích:**
- Quản lý số lượng ghế của tour
- Đảm bảo tính hợp lệ của dữ liệu

**Logic:**
1. **Chuẩn hóa `seatsTotal`:**
   - Chuyển sang số nguyên, mặc định = 0

2. **Chuẩn hóa `seatsRemaining`:**
   - Nếu có giá trị → dùng giá trị đó
   - Nếu không có → mặc định = `seatsTotal` (tour mới = còn đầy đủ ghế)

3. **Ràng buộc:**
   - `seatsRemaining >= 0` (không được âm)
   - `seatsRemaining <= seatsTotal` (không được vượt quá tổng)

4. **Xóa field cũ:**
   - Xóa `stockAdult`, `stockChildren`, `stockBaby` (không dùng nữa)

**Ví dụ:**
```javascript
// Input: seatsTotal = "50", seatsRemaining = "45"
// Output: seatsTotal = 50, seatsRemaining = 45

// Input: seatsTotal = "50", seatsRemaining = undefined
// Output: seatsTotal = 50, seatsRemaining = 50 (mặc định)

// Input: seatsTotal = "50", seatsRemaining = "60"
// Output: seatsTotal = 50, seatsRemaining = 50 (giới hạn)
```

---

### 10. Audit, file và company (dòng 944-958)

```javascript
req.body.createdBy = req.account.id;
req.body.updatedBy = req.account.id;
req.body.companyId = companyId;
if (req.files && req.files.avatar && req.files.avatar.length > 0) {
  req.body.avatar = req.files.avatar[0].path;
} else {
  req.body.avatar = "";
}

if (req.files && req.files.images && req.files.images.length > 0) {
  req.body.images = req.files.images.map((item) => item.path);
} else {
  req.body.images = [];
}
```

**Mục đích:**
- Gán thông tin audit (người tạo, người cập nhật)
- Xử lý upload file (ảnh đại diện và ảnh gallery)

**Logic:**

1. **Audit fields:**
   - `createdBy`: ID người tạo (từ `req.account.id`)
   - `updatedBy`: ID người cập nhật (từ `req.account.id`)
   - `companyId`: ID công ty (đã lấy ở đầu hàm)

2. **Avatar (ảnh đại diện):**
   - Nếu có file upload → lấy path của file đầu tiên
   - Nếu không có → chuỗi rỗng `""`

3. **Images (ảnh gallery):**
   - Nếu có nhiều file → map thành mảng các path
   - Nếu không có → mảng rỗng `[]`

**Lưu ý:**
- File upload được xử lý bởi middleware (ví dụ: `multer`)
- `req.files` chứa thông tin các file đã upload
- `path` là đường dẫn file trên server

---

### 11. Lưu vào database (dòng 960-968)

```javascript
// Lưu
const newRecord = new Tour(req.body);
await newRecord.save();

return res.json({ code: "success", message: "Tạo tour thành công!" });
} catch (error) {
  console.error("tour.createPost error:", error);
  return res.json({ code: "error", message: "Dữ liệu không hợp lệ!" });
}
```

**Mục đích:**
- Tạo document mới từ dữ liệu đã chuẩn hóa
- Lưu vào MongoDB
- Trả về kết quả cho client

**Logic:**
1. Tạo instance mới của model `Tour` với `req.body` (đã được chuẩn hóa)
2. Lưu vào database bằng `save()`
3. Trả về JSON response:
   - Thành công: `{ code: "success", message: "..." }`
   - Lỗi: `{ code: "error", message: "..." }`

**Error handling:**
- Tất cả lỗi được bắt trong `try-catch`
- Log lỗi ra console để debug
- Trả về message lỗi chung cho client (không tiết lộ chi tiết lỗi)

---

## Tóm tắt luồng xử lý

```
1. Kiểm tra companyId
   ↓
2. Xử lý position
   ↓
3. Chuẩn hóa giá (priceAdult, priceChildren, priceBaby, priceNew*)
   ↓
4. Xử lý departureCity
   ↓
5. Parse và chuẩn hóa:
   - locations (địa điểm)
   - schedules (lịch trình)
   - departureDates (ngày khởi hành)
   - departureDate (tương thích)
   ↓
6. Chuyển textarea → mảng:
   - highlights
   - includes
   - excludes
   ↓
7. Xử lý khuyến mãi (discountFrom, discountTo)
   ↓
8. Cấu hình giá em bé (fixed/tiered)
   ↓
9. Quản lý ghế (seatsTotal, seatsRemaining)
   ↓
10. Gán audit fields và xử lý file upload
   ↓
11. Lưu vào database
   ↓
12. Trả về kết quả
```

---

## Các điểm cần lưu ý

### 1. **Multi-tenant system**
- Mọi tour đều phải có `companyId`
- Dữ liệu được phân tách theo công ty

### 2. **Chuẩn hóa dữ liệu**
- Tất cả giá trị được chuẩn hóa trước khi lưu
- Xử lý cả trường hợp dữ liệu không hợp lệ

### 3. **Tương thích ngược**
- Giữ lại `departureDate` để tương thích với code cũ
- Xóa các field cũ (`stock*`) để tránh xung đột

### 4. **Error handling**
- Sử dụng `try-catch` để bắt mọi lỗi
- Không tiết lộ chi tiết lỗi cho client (bảo mật)

### 5. **File upload**
- Xử lý cả trường hợp có và không có file
- Lưu path của file, không lưu file content

### 6. **Validation**
- Validate ngày tháng (discountFrom < discountTo)
- Validate số (seatsRemaining <= seatsTotal)
- Validate phần trăm (0-100%)

---

## Ví dụ request body đầy đủ

```json
{
  "title": "Tour Đà Lạt 3 ngày 2 đêm",
  "position": 1,
  "priceAdult": "2000000",
  "priceChildren": "1500000",
  "priceBaby": "500000",
  "priceNewAdult": "1800000",
  "priceNewChildren": "1300000",
  "priceNewBaby": "500000",
  "departureCity": "507f1f77bcf86cd799439011",
  "departureDates": "[\"2024-12-25\", \"2024-12-30\", \"2025-01-05\"]",
  "locations": "[{\"city\":\"507f1f77bcf86cd799439011\",\"spots\":[\"Chợ Đà Lạt\",\"Hồ Xuân Hương\"]}]",
  "schedules": "[{\"day\":1,\"title\":\"Ngày 1\",\"description\":\"Khởi hành\"}]",
  "highlights": "Khách sạn 4 sao\nXe đưa đón\nHướng dẫn viên",
  "includes": "Bữa sáng\nVé tham quan",
  "excludes": "Bữa trưa\nBữa tối",
  "discountFrom": "2024-12-01",
  "discountTo": "2024-12-31",
  "babyPricingMode": "fixed",
  "seatsTotal": "50",
  "seatsRemaining": "50"
}
```

---

## Kết luận

Hàm `createPost` là một hàm xử lý phức tạp với nhiều bước chuẩn hóa và validate dữ liệu. Việc hiểu rõ từng phần giúp:

- **Debug dễ dàng hơn** khi có lỗi
- **Mở rộng tính năng** một cách chính xác
- **Bảo trì code** hiệu quả hơn
- **Tối ưu hiệu suất** nếu cần

Nếu cần giải thích thêm phần nào, vui lòng hỏi!

