# Phân tích luồng Tour Khuyến mãi trong trang tạo tour và chỉnh sửa tour

## 📋 Mục lục
1. [Tổng quan](#tổng-quan)
2. [Cấu trúc dữ liệu](#cấu-trúc-dữ-liệu)
3. [2 loại khuyến mãi](#2-loại-khuyến-mãi)
4. [Luồng tạo tour với khuyến mãi](#luồng-tạo-tour-với-khuyến-mãi)
5. [Luồng chỉnh sửa tour với khuyến mãi](#luồng-chỉnh-sửa-tour-với-khuyến-mãi)
6. [Luồng áp dụng khuyến mãi tự động](#luồng-áp-dụng-khuyến-mãi-tự-động)
7. [Sơ đồ luồng](#sơ-đồ-luồng)

---

## 🎯 Tổng quan

Hệ thống hỗ trợ **2 loại khuyến mãi** cho tour:

1. **Khuyến mãi theo % (discountPercent)**: Giảm giá theo phần trăm, có thời hạn
2. **Khuyến mãi giảm theo số tiền cố định**: Dùng `priceAdult/Children/Baby` làm "giá cũ", `priceNew*` là "giá mới" (đã giảm), có thời hạn

**Đặc điểm:**
- Cả 2 loại đều có thời hạn (`discountFrom`, `discountTo`)
- Khuyến mãi được áp dụng tự động khi đến ngày
- Khuyến mãi tự động hết hạn khi quá ngày

---

## 📊 Cấu trúc dữ liệu

### Model Tour (`models/tour.model.js`)

```javascript
// Giá cũ (dùng cho khuyến mãi giảm theo số tiền cố định)
priceAdult: Number,
priceChildren: Number,
priceBaby: Number,

// Giá mới (áp dụng) - có thể đã giảm giá
priceNewAdult: Number,
priceNewChildren: Number,
priceNewBaby: Number,

// === GIÁ BACKUP TRƯỚC KHUYẾN MÃI ===
backupPriceNewAdult: { type: Number, default: 0 },
backupPriceNewChildren: { type: Number, default: 0 },
backupPriceNewBaby: { type: Number, default: 0 },

// Thông tin khuyến mãi (giảm giá theo % có thời hạn)
discountPercent: { type: Number, default: 0 }, // 0 = không khuyến mãi
discountFrom: Date,
discountTo: Date,

// Đánh dấu hiện tại giá đã được áp dụng khuyến mãi hay chưa
discountApplied: { type: Boolean, default: false },
```

**Giải thích:**
- `priceAdult/Children/Baby`: Giá cũ (dùng cho khuyến mãi giảm theo số tiền cố định)
- `priceNewAdult/Children/Baby`: Giá mới (giá đang bán, có thể đã giảm)
- `backupPriceNew*`: Backup giá gốc trước khi áp dụng khuyến mãi theo %
- `discountPercent`: % giảm giá (0 = không khuyến mãi)
- `discountFrom/To`: Thời hạn khuyến mãi
- `discountApplied`: Đánh dấu đã áp dụng khuyến mãi chưa

---

## 🎁 2 loại khuyến mãi

### Loại 1: Khuyến mãi theo % (discountPercent)

**Cách hoạt động:**
- Admin cấu hình `discountPercent` (ví dụ: 20% = giảm 20%)
- Cấu hình thời hạn: `discountFrom`, `discountTo`
- Hệ thống tự động tính: `priceNew = priceGốc × (100 - discountPercent) / 100`

**Ví dụ:**
- Giá gốc: 2,000,000 VNĐ
- Giảm 20%
- Giá mới: 2,000,000 × (100 - 20) / 100 = 1,600,000 VNĐ

**Lưu ý:**
- Giá gốc được backup vào `backupPriceNew*` trước khi giảm
- Khi hết hạn, giá tự động trở về giá gốc

---

### Loại 2: Khuyến mãi giảm theo số tiền cố định

**Cách hoạt động:**
- Admin nhập "Giá cũ" (`priceAdult/Children/Baby`) và "Giá mới" (`priceNew*`)
- Chênh lệch = Giá cũ - Giá mới (số tiền giảm)
- Cấu hình thời hạn: `discountFrom`, `discountTo`
- Trong thời hạn: Hiển thị giá mới (đã giảm)
- Hết hạn: Giá mới trở về giá cũ

**Ví dụ:**
- Giá cũ: 2,000,000 VNĐ
- Giá mới: 1,500,000 VNĐ
- Số tiền giảm: 500,000 VNĐ
- Trong thời hạn: Bán với giá 1,500,000 VNĐ
- Hết hạn: Bán với giá 2,000,000 VNĐ

**Lưu ý:**
- Không dùng `discountPercent` (để = 0)
- Không dùng `backupPriceNew*`

---

## 🔄 Luồng tạo tour với khuyến mãi

### Bước 1: Frontend - Form nhập liệu

**File:** `views/admin/pages/tour-create.pug` (dòng 73-112)

```pug
//- GIÁ CŨ
.inner-group
  label(class="inner-label") Giá cũ
  .inner-input-list
    .inner-input-item
      label(for="priceAdult") Người lớn
      input(type="number" id="priceAdult" name="priceAdult")
    .inner-input-item
      label(for="priceChildren") Trẻ em (3-11 tuổi)
      input(type="number" id="priceChildren" name="priceChildren")
    .inner-input-item
      label(for="priceBaby") Em bé (0-2 tuổi)
      input(type="number" id="priceBaby" name="priceBaby")

//- GIÁ MỚI
.inner-group
  label(class="inner-label") Giá mới
  .inner-input-list
    .inner-input-item
      label(for="priceNewAdult") Người lớn
      input(type="number" id="priceNewAdult" name="priceNewAdult")
    .inner-input-item
      label(for="priceNewChildren") Trẻ em (3-11 tuổi)
      input(type="number" id="priceNewChildren" name="priceNewChildren")
    .inner-input-item
      label(for="priceNewBaby") Em bé (0-2 tuổi)
      input(type="number" id="priceNewBaby" name="priceNewBaby")

//- ==== KHUNG THỜI HẠN KHUYẾN MÃI (giảm theo số tiền cố định) ====
.inner-group.inner-two-col#manual-discount-group(style="display:none")
  label(class="inner-label") Thời hạn khuyến mãi
  .inner-input-list
    .inner-input-item
      label(for="discountFrom") Từ ngày
      input(type="date" id="discountFrom" name="discountFrom")
    .inner-input-item
      label(for="discountTo") Đến ngày
      input(type="date" id="discountTo" name="discountTo")
  .inner-desc
    | Khung này chỉ dùng khi đã nhập ít nhất một giá cũ (Người lớn / Trẻ em / Em bé).
    br
    | Nếu không muốn khuyến mãi theo thời hạn, hãy xóa hết giá cũ hoặc để 0.
```

**Cấu trúc:**
- **Giá cũ**: `priceAdult`, `priceChildren`, `priceBaby`
- **Giá mới**: `priceNewAdult`, `priceNewChildren`, `priceNewBaby`
- **Thời hạn khuyến mãi**: Chỉ hiện khi có ít nhất 1 giá cũ > 0

### Bước 2: Frontend - JavaScript xử lý UI

**File:** `public/admin/assets/js/script.js` (dòng 480-515)

#### 2.1. Kiểm tra có giá cũ không

```javascript
function hasOldPriceCreate() {
  const a = parseInt(oldAdultInput?.value || "0", 10) || 0;
  const c = parseInt(oldChildrenInput?.value || "0", 10) || 0;
  const b = parseInt(oldBabyInput?.value || "0", 10) || 0;
  return a > 0 || c > 0 || b > 0;
}
```

#### 2.2. Hiển thị/ẩn khung thời hạn khuyến mãi

```javascript
function syncManualDiscountVisibilityCreate() {
  if (!discountWrapper) return;
  if (hasOldPriceCreate()) {
    discountWrapper.style.display = "";  // Hiển thị
  } else {
    discountWrapper.style.display = "none";  // Ẩn
    if (discountFromInput) discountFromInput.value = "";
    if (discountToInput) discountToInput.value = "";
  }
}

// Gắn event listener cho các input giá cũ
[oldAdultInput, oldChildrenInput, oldBabyInput].forEach((el) => {
  if (el) el.addEventListener("input", syncManualDiscountVisibilityCreate);
});

// Chạy lần đầu khi load form
syncManualDiscountVisibilityCreate();
```

**Logic:**
- Nếu có ít nhất 1 giá cũ > 0 → Hiển thị khung thời hạn khuyến mãi
- Nếu không có giá cũ → Ẩn khung thời hạn khuyến mãi

### Bước 3: Frontend - Validation khi submit

**File:** `public/admin/assets/js/script.js` (dòng 895-908)

```javascript
// ==== LẤY / KIỂM TRA THỜI HẠN KHUYẾN MÃI (GIẢM THEO SỐ TIỀN CỐ ĐỊNH) ====
const hasManualOldPrice = hasOldPriceCreate();
const discountFrom = discountFromInput?.value || "";
const discountTo = discountToInput?.value || "";

if (hasManualOldPrice) {
  if (!discountFrom || !discountTo) {
    notify.error(
      "Vui lòng nhập Từ ngày / Đến ngày khuyến mãi, hoặc xóa hết giá cũ (Người lớn / Trẻ em / Em bé)!"
    );
    return;  // Dừng submit
  }
}
```

**Validation:**
- Nếu có giá cũ → Bắt buộc nhập thời hạn khuyến mãi
- Nếu không có giá cũ → Không cần thời hạn khuyến mãi

### Bước 4: Frontend - Gửi dữ liệu lên server

**File:** `public/admin/assets/js/script.js` (dòng 1030-1034)

```javascript
// ==== GỬI THỜI HẠN KHUYẾN MÃI NẾU CÓ ====
if (hasManualOldPrice && discountFrom && discountTo) {
  formData.append("discountFrom", discountFrom);
  formData.append("discountTo", discountTo);
}
```

### Bước 5: Backend - Xử lý và lưu vào database

**File:** `controllers/admin/tour.controller.js` (dòng 851-887)

```javascript
// --- THỜI HẠN KHUYẾN MÃI (GIẢM THEO SỐ TIỀN CỐ ĐỊNH, NẾU CÓ) ---
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

**Xử lý:**
1. Parse và validate ngày tháng
2. Đảm bảo `discountFrom < discountTo`
3. Set `discountPercent = 0` (không dùng %)
4. Set `discountApplied = false` (chưa áp dụng)
5. Set `backupPriceNew* = 0` (không dùng backup)

---

## ✏️ Luồng chỉnh sửa tour với khuyến mãi

### Bước 1: Backend - Load dữ liệu tour

**File:** `controllers/admin/tour.controller.js` (dòng 1049-1056)

```javascript
// ===== THỜI HẠN KHUYẾN MÃI (prefill cho input date) =====
tourDetail.discountFromInput = tourDetail.discountFrom
  ? moment(tourDetail.discountFrom).format("YYYY-MM-DD")
  : "";

tourDetail.discountToInput = tourDetail.discountTo
  ? moment(tourDetail.discountTo).format("YYYY-MM-DD")
  : "";
```

**Chuẩn hóa:**
- Chuyển Date → string format "YYYY-MM-DD" để bind vào `input[type="date"]`

### Bước 2: Frontend - Hiển thị form với dữ liệu

**File:** `views/admin/pages/tour-edit.pug` (dòng 104-126)

```pug
.inner-group.inner-two-col#manual-discount-group(style="display:none")
  label(class="inner-label") Thời hạn khuyến mãi
  .inner-input-list
    .inner-input-item
      label(for="discountFrom") Từ ngày
      input(
        type="date"
        id="discountFrom"
        name="discountFrom"
        value=(tourDetail.discountFromInput || '')
      )
    .inner-input-item
      label(for="discountTo") Đến ngày
      input(
        type="date"
        id="discountTo"
        name="discountTo"
        value=(tourDetail.discountToInput || '')
      )
  .inner-desc
    | Khung này chỉ dùng khi đã nhập ít nhất một giá cũ (Người lớn / Trẻ em / Em bé).
    br
    | Nếu không muốn khuyến mãi theo thời hạn, hãy xóa hết giá cũ hoặc để 0.
```

### Bước 3: Backend - Xử lý cập nhật

**File:** `controllers/admin/tour.controller.js` (dòng 1320-1343)

```javascript
// --- THỜI HẠN KHUYẾN MÃI (GIẢM THEO SỐ TIỀN CỐ ĐỊNH) ---
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

  // đang dùng giảm theo % -> không chỉnh thời hạn ở luồng này
  // (logic này có thể cần điều chỉnh tùy yêu cầu)
} else {
  // không gửi field từ form -> giữ nguyên trong DB
  delete req.body.discountFrom;
  delete req.body.discountTo;
}
```

**Lưu ý:**
- Nếu không gửi `discountFrom/To` → Giữ nguyên trong DB (không xóa)
- Nếu gửi → Validate và cập nhật

---

## ⚙️ Luồng áp dụng khuyến mãi tự động

### Hàm refreshDiscounts (Khuyến mãi theo %)

**File:** `controllers/admin/tour.controller.js` (dòng 132-333)

#### 1. Kích hoạt khuyến mãi (khi đến ngày)

```javascript
// Tìm các tour:
// - Có discountPercent > 0
// - Đang trong thời hạn khuyến mãi (discountFrom <= now <= discountTo)
// - Chưa áp dụng (discountApplied != true)

await Tour.updateMany(
  {
    companyId,
    deleted: false,
    discountPercent: { $gt: 0 },
    discountFrom: { $lte: now },
    discountTo: { $gte: now },
    discountApplied: { $ne: true },
  },
  [
    {
      $set: {
        // Tính giá gốc (base)
        _baseAdult: {
          $cond: [
            { $gt: ["$backupPriceNewAdult", 0] },
            "$backupPriceNewAdult",
            {
              $cond: [
                { $gt: ["$priceNewAdult", 0] },
                "$priceNewAdult",
                "$priceAdult",
              ],
            },
          ],
        },
        // ... tương tự cho Children và Baby
      },
    },
    {
      $set: {
        // Giá cũ = giá gốc (để hiển thị)
        priceAdult: "$_baseAdult",
        priceChildren: "$_baseChildren",
        priceBaby: {
          $cond: [{ $eq: ["$babyPricingMode", "fixed"] }, "$_baseBaby", 0],
        },

        // Giá mới = giá gốc × (100 - discountPercent) / 100
        priceNewAdult: {
          $round: [
            {
              $multiply: [
                "$_baseAdult",
                {
                  $divide: [{ $subtract: [100, "$discountPercent"] }, 100],
                },
              ],
            },
            0,
          ],
        },
        // ... tương tự cho Children và Baby

        discountApplied: true,  // Đánh dấu đã áp dụng
      },
    },
  ]
);
```

**Công thức:**
```
Giá mới = Giá gốc × (100 - discountPercent) / 100
```

**Ví dụ:**
- Giá gốc: 2,000,000 VNĐ
- discountPercent: 20%
- Giá mới: 2,000,000 × (100 - 20) / 100 = 1,600,000 VNĐ

#### 2. Hủy khuyến mãi (khi hết hạn)

```javascript
// Tìm các tour:
// - Đã áp dụng khuyến mãi (discountApplied = true)
// - Nhưng đã hết hạn hoặc discountPercent <= 0

await Tour.updateMany(
  {
    companyId,
    deleted: false,
    discountApplied: true,
    $or: [
      { discountPercent: { $lte: 0 } },
      { discountTo: { $lt: now } },
      { discountFrom: { $gt: now } },
    ],
  },
  {
    $set: {
      // Giá mới trở lại giá gốc (từ backup hoặc giá hiện tại)
      priceNewAdult: {
        $cond: [
          { $gt: ["$backupPriceNewAdult", 0] },
          "$backupPriceNewAdult",
          {
            $cond: [
              { $gt: ["$priceNewAdult", 0] },
              "$priceNewAdult",
              "$priceAdult",
            ],
          },
        ],
      },
      // ... tương tự

      // Reset giá cũ về 0
      priceAdult: 0,
      priceChildren: 0,
      priceBaby: 0,

      // Xóa thông tin khuyến mãi
      discountPercent: 0,
      discountFrom: null,
      discountTo: null,
      backupPriceNewAdult: 0,
      backupPriceNewChildren: 0,
      backupPriceNewBaby: 0,
      discountApplied: false,
    },
  }
);
```

### Hàm cleanExpiredFixedDiscounts (Khuyến mãi giảm theo số tiền cố định)

**File:** `controllers/admin/tour.controller.js` (dòng 340-410)

```javascript
// Tìm các tour:
// - Không dùng % (discountPercent <= 0 hoặc không có)
// - Có thời hạn khuyến mãi (discountFrom, discountTo)
// - Đã hết hạn (discountTo < now)

await Tour.updateMany(
  {
    companyId,
    deleted: false,
    $or: [
      { discountPercent: { $exists: false } },
      { discountPercent: { $lte: 0 } },
    ],
    discountTo: { $exists: true, $lt: now },
  },
  {
    $set: {
      // Giá mới = giá cũ (trở về giá gốc)
      priceNewAdult: {
        $cond: [
          { $gt: ["$priceAdult", 0] },
          "$priceAdult",
          "$priceNewAdult",
        ],
      },
      // ... tương tự

      // Xóa giá cũ
      priceAdult: 0,
      priceChildren: 0,
      priceBaby: 0,

      // Xóa thông tin khuyến mãi
      discountFrom: null,
      discountTo: null,
    },
  }
);
```

**Logic:**
- Khi hết hạn: `priceNew*` = `price*` (giá cũ)
- Xóa `price*` và thông tin khuyến mãi

### Khi nào gọi refreshDiscounts và cleanExpiredFixedDiscounts?

**Được gọi tự động khi:**
1. Load danh sách tour (`tour.list`)
2. Load danh sách tour khuyến mãi (`tour.discountList`)
3. Áp dụng khuyến mãi hàng loạt (`tour.applyCompanyDiscount`)
4. Cập nhật khuyến mãi cho tour (`tour.updateDiscount`)

**Ví dụ:**
```javascript
// controllers/admin/tour.controller.js
module.exports.list = async (req, res) => {
  const companyId = req.account.companyId;
  
  // Làm mới trạng thái khuyến mãi trước khi load
  await refreshDiscounts(companyId);
  await cleanExpiredFixedDiscounts(companyId);
  
  // ... load danh sách tour
};
```

---

## 📈 Sơ đồ luồng

### Luồng tạo tour với khuyến mãi (giảm theo số tiền cố định)

```
┌─────────────────────────────────────────────────────────────┐
│ 1. USER NHẬP GIÁ                                            │
│    - Giá cũ: priceAdult, priceChildren, priceBaby          │
│    - Giá mới: priceNewAdult, priceNewChildren, priceNewBaby │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. FRONTEND (JavaScript)                                    │
│    - Kiểm tra có giá cũ > 0?                                │
│    - Nếu có → Hiển thị khung thời hạn khuyến mãi           │
│    - Nếu không → Ẩn khung thời hạn                          │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. USER NHẬP THỜI HẠN KHUYẾN MÃI                            │
│    - discountFrom: Từ ngày                                  │
│    - discountTo: Đến ngày                                   │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. FRONTEND VALIDATION                                      │
│    - Nếu có giá cũ → Bắt buộc nhập thời hạn                │
│    - Nếu không có giá cũ → Không cần thời hạn                │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. GỬI LÊN SERVER                                           │
│    formData.append("discountFrom", discountFrom)            │
│    formData.append("discountTo", discountTo)                │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. BACKEND XỬ LÝ                                             │
│    - Parse và validate ngày tháng                            │
│    - Set discountPercent = 0                                 │
│    - Set discountApplied = false                             │
│    - Set backupPriceNew* = 0                                 │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ 7. DATABASE (MongoDB)                                        │
│    - Lưu priceAdult/Children/Baby (giá cũ)                  │
│    - Lưu priceNewAdult/Children/Baby (giá mới)               │
│    - Lưu discountFrom, discountTo                            │
└─────────────────────────────────────────────────────────────┘
```

### Luồng áp dụng khuyến mãi tự động (theo %)

```
┌─────────────────────────────────────────────────────────────┐
│ 1. ADMIN CẤU HÌNH KHUYẾN MÃI                                │
│    - discountPercent: 20%                                   │
│    - discountFrom: 2024-01-01                               │
│    - discountTo: 2024-01-31                                 │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. BACKEND LƯU CẤU HÌNH                                      │
│    - Backup giá gốc vào backupPriceNew*                     │
│    - Lưu discountPercent, discountFrom, discountTo          │
│    - Set discountApplied = false (chưa áp dụng)              │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. HỆ THỐNG KIỂM TRA (refreshDiscounts)                      │
│    - Nếu discountFrom <= now <= discountTo                  │
│      → Áp dụng khuyến mãi                                   │
│    - Nếu discountTo < now                                    │
│      → Hủy khuyến mãi                                       │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. ÁP DỤNG KHUYẾN MÃI                                        │
│    - priceAdult = backupPriceNewAdult (giá cũ)              │
│    - priceNewAdult = backupPriceNewAdult × 0.8 (giảm 20%)  │
│    - discountApplied = true                                  │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. HẾT HẠN → HỦY KHUYẾN MÃI                                  │
│    - priceNewAdult = backupPriceNewAdult (trở về giá gốc)  │
│    - priceAdult = 0                                          │
│    - discountPercent = 0                                     │
│    - discountApplied = false                                  │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔍 Ví dụ cụ thể

### Ví dụ 1: Khuyến mãi giảm theo số tiền cố định

**Cấu hình:**
- Giá cũ (Người lớn): 2,000,000 VNĐ
- Giá mới (Người lớn): 1,500,000 VNĐ
- Thời hạn: 01/01/2024 - 31/01/2024

**Trong thời hạn (01/01 - 31/01):**
- Hiển thị: "Giá cũ: 2,000,000 VNĐ, Giá mới: 1,500,000 VNĐ"
- Bán với giá: 1,500,000 VNĐ

**Hết hạn (sau 31/01):**
- `cleanExpiredFixedDiscounts` tự động chạy
- `priceNewAdult` = `priceAdult` = 2,000,000 VNĐ
- `priceAdult` = 0
- Bán với giá: 2,000,000 VNĐ

---

### Ví dụ 2: Khuyến mãi theo %

**Cấu hình:**
- Giá gốc: 2,000,000 VNĐ
- Giảm: 20%
- Thời hạn: 01/01/2024 - 31/01/2024

**Trước khi áp dụng (trước 01/01):**
- `backupPriceNewAdult` = 2,000,000 VNĐ
- `priceNewAdult` = 2,000,000 VNĐ
- `discountApplied` = false

**Trong thời hạn (01/01 - 31/01):**
- `refreshDiscounts` tự động chạy
- `priceAdult` = 2,000,000 VNĐ (giá cũ để hiển thị)
- `priceNewAdult` = 2,000,000 × 0.8 = 1,600,000 VNĐ
- `discountApplied` = true

**Hết hạn (sau 31/01):**
- `refreshDiscounts` tự động chạy
- `priceNewAdult` = `backupPriceNewAdult` = 2,000,000 VNĐ
- `priceAdult` = 0
- `discountPercent` = 0
- `discountApplied` = false

---

## 📝 Tóm tắt

### Khuyến mãi giảm theo số tiền cố định:
1. Admin nhập giá cũ và giá mới
2. Cấu hình thời hạn khuyến mãi
3. Trong thời hạn: Bán với giá mới
4. Hết hạn: Tự động trở về giá cũ

### Khuyến mãi theo %:
1. Admin cấu hình % giảm và thời hạn
2. Hệ thống backup giá gốc
3. Khi đến ngày: Tự động tính và áp dụng giảm giá
4. Hết hạn: Tự động trở về giá gốc

### Điểm quan trọng:
- Khuyến mãi được áp dụng tự động (không cần can thiệp thủ công)
- Hệ thống tự động kiểm tra và cập nhật khi load danh sách tour
- Giá gốc được backup để có thể hoàn trả khi hết hạn

---

## 🔗 Các file liên quan

1. **Model:** `models/tour.model.js` (dòng 57-78)
2. **Controller (Create):** `controllers/admin/tour.controller.js` (dòng 851-887)
3. **Controller (Edit):** `controllers/admin/tour.controller.js` (dòng 1320-1343)
4. **Controller (Refresh):** `controllers/admin/tour.controller.js` (dòng 132-333, 340-410)
5. **View (Create):** `views/admin/pages/tour-create.pug` (dòng 73-112)
6. **View (Edit):** `views/admin/pages/tour-edit.pug` (dòng 104-126)
7. **Frontend JS (Create):** `public/admin/assets/js/script.js` (dòng 480-515, 895-908, 1030-1034)

---

**Tài liệu được tạo:** `docs/luong-khuyen-mai-tour.md`

