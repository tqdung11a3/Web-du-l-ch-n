# Phân tích luồng tính giá em bé trong Tour

## 📋 Mục lục
1. [Tổng quan](#tổng-quan)
2. [Cấu trúc dữ liệu](#cấu-trúc-dữ-liệu)
3. [Luồng tạo tour](#luồng-tạo-tour)
4. [Luồng chỉnh sửa tour](#luồng-chỉnh-sửa-tour)
5. [Luồng tính giá khi đặt hàng](#luồng-tính-giá-khi-đặt-hàng)
6. [Sơ đồ luồng](#sơ-đồ-luồng)

---

## 🎯 Tổng quan

Hệ thống hỗ trợ **2 chế độ tính giá em bé**:

1. **Fixed (Cố định)**: Giá em bé là một số cố định, nhập trực tiếp vào ô "Giá mới - Em bé"
2. **Tiered (Theo bậc)**: Giá em bé được tính theo % của giá người lớn hoặc trẻ em, tùy theo vị trí em bé (bé thứ 1, thứ 2, thứ 3...)

---

## 📊 Cấu trúc dữ liệu

### Model Tour (`models/tour.model.js`)

```javascript
// Cấu hình cách tính giá em bé
babyPricingMode: {
  type: String,
  enum: ["fixed", "tiered"],
  default: "fixed",
},

// Quy tắc tính giá em bé khi chọn 'tiered'
babyPricingRules: {
  type: [babyRuleSchema],
  default: [],
},

// Giá mới (áp dụng)
priceNewBaby: Number, // dùng khi babyPricingMode = 'fixed'
```

### Schema quy tắc bậc giá (`babyRuleSchema`)

```javascript
{
  from: Number,        // Em bé thứ mấy bắt đầu (1-based)
  to: Number | "inf",  // Em bé thứ mấy kết thúc ("inf" = vô hạn)
  percent: Number,     // % so với giá tham chiếu (0-100)
  ref: "children" | "adult"  // Giá tham chiếu
}
```

**Ví dụ quy tắc:**
```json
[
  { "from": 1, "to": 2, "percent": 0, "ref": "children" },    // Bé 1-2: miễn phí
  { "from": 3, "to": 4, "percent": 50, "ref": "children" },  // Bé 3-4: 50% giá trẻ em
  { "from": 5, "to": "inf", "percent": 75, "ref": "children" } // Từ bé 5 trở lên: 75% giá trẻ em
]
```

---

## 🔄 Luồng tạo tour

### Bước 1: Frontend - Form nhập liệu

**File:** `views/admin/pages/tour-create.pug` (dòng 114-156)

```pug
//- ==== CÁCH TÍNH GIÁ EM BÉ ====
.inner-group
  label(class="inner-label") Cách tính giá Em bé
  .inner-input-list
    .inner-input-item
      label(for="babyPricingMode") Chế độ
      select(id="babyPricingMode" name="babyPricingMode")
        option(value="fixed" selected) Cố định (dùng ô Giá mới - Em bé)
        option(value="tiered") Theo bậc (nhiều em bé, nhiều mức %)

//- Khối cấu hình bậc giá Em bé (chỉ hiện khi chọn "tiered")
.inner-group#baby-pricing-rules-wrapper(style="display:none")
  label(class="inner-label") Quy tắc bậc giá Em bé
  .baby-rules-table
    .baby-rules-header
      .baby-rules-cell Bé từ (thứ mấy)
      .baby-rules-cell đến (thứ mấy)
      .baby-rules-cell % so với giá
      .baby-rules-cell Giá tham chiếu
      .baby-rules-cell Thao tác
    .baby-rules-body#baby-rules-body
      //- Các dòng quy tắc được thêm động bằng JS
  input(type="hidden" id="babyPricingRulesJson" name="babyPricingRulesJson")
```

### Bước 2: Frontend - JavaScript xử lý form

**File:** `public/admin/assets/js/script.js` (dòng 350-478)

#### 2.1. Khởi tạo và lấy các element

```javascript
const babyModeSelect = tourCreateForm.querySelector("#babyPricingMode");
const babyRulesWrapper = document.querySelector("#baby-pricing-rules-wrapper");
const babyRulesBody = document.querySelector("#baby-rules-body");
const babyRulesHiddenInput = document.querySelector("#babyPricingRulesJson");
const priceBabyInput = tourCreateForm.querySelector('input[name="priceBaby"]');
const priceNewBabyInput = tourCreateForm.querySelector('input[name="priceNewBaby"]');
```

#### 2.2. Tạo dòng quy tắc mới

```javascript
function createRuleRow(from = "", to = "", percent = "", ref = "children") {
  const row = document.createElement("div");
  row.className = "baby-rule-row";
  row.innerHTML = `
    <div class="baby-rules-cell">
      <input class="rule-from" type="number" min="1" value="${from}">
    </div>
    <div class="baby-rules-cell">
      <input class="rule-to" type="number" min="1" 
             placeholder="VD: 2 (hoặc bỏ trống = trở lên)"
             value="${to === "inf" ? "" : to}">
    </div>
    <div class="baby-rules-cell">
      <input class="rule-percent" type="number" min="0" max="100" value="${percent}">
    </div>
    <div class="baby-rules-cell">
      <select class="rule-ref">
        <option value="children" ${ref === "children" ? "selected" : ""}>Giá Trẻ em</option>
        <option value="adult" ${ref === "adult" ? "selected" : ""}>Giá Người lớn</option>
      </select>
    </div>
    <div class="baby-rules-cell">
      <button type="button" class="baby-rule-remove type-button">Xóa</button>
    </div>
  `;
  return row;
}
```

#### 2.3. Thu thập quy tắc từ UI

```javascript
function collectBabyRules() {
  if (!babyRulesBody) return [];
  const rows = babyRulesBody.querySelectorAll(".baby-rule-row");
  const rules = [];
  rows.forEach((row) => {
    const fromEl = row.querySelector(".rule-from");
    const toEl = row.querySelector(".rule-to");
    const percentEl = row.querySelector(".rule-percent");
    const refEl = row.querySelector(".rule-ref");

    const from = Number(fromEl?.value || "");
    const toRaw = toEl?.value || "";
    const percent = Number(percentEl?.value || "");
    const ref = refEl?.value === "adult" ? "adult" : "children";

    if (!Number.isFinite(from)) return;
    let to = "inf";
    if (toRaw !== "") {
      const toNum = Number(toRaw);
      if (!Number.isFinite(toNum)) return;
      to = toNum;
    }
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) return;

    rules.push({ from, to, percent, ref });
  });
  return rules;
}
```

#### 2.4. Đồng bộ UI theo chế độ

```javascript
function syncBabyModeUI() {
  const mode = babyModeSelect?.value || "fixed";
  const isTiered = mode === "tiered";

  // Hiển thị/ẩn khối quy tắc
  if (babyRulesWrapper) {
    babyRulesWrapper.style.display = isTiered ? "block" : "none";
  }

  // Khi tiered: xóa và khóa 2 ô giá Em bé
  if (priceBabyInput) {
    if (isTiered) {
      priceBabyInput.value = "";
      priceBabyInput.disabled = true;
    } else {
      priceBabyInput.disabled = false;
    }
  }
  if (priceNewBabyInput) {
    if (isTiered) {
      priceNewBabyInput.value = "";
      priceNewBabyInput.disabled = true;
    } else {
      priceNewBabyInput.disabled = false;
    }
  }
}
```

#### 2.5. Xử lý submit form

**File:** `public/admin/assets/js/script.js` (dòng 884-892)

```javascript
const babyPricingMode = f.babyPricingMode.value || "fixed";
let babyPricingRulesJson = "";

if (babyPricingMode === "tiered") {
  // Không dùng giá cố định cho Em bé nữa
  priceBaby = "";
  priceNewBaby = "";
  const rules = collectBabyRules();
  babyPricingRulesJson = JSON.stringify(rules);
}

// Gửi lên server
formData.append("babyPricingMode", babyPricingMode);
formData.append("babyPricingRulesJson", babyPricingRulesJson);
```

### Bước 3: Backend - Validation

**File:** `validates/admin/tour.validate.js` (dòng 87-102)

```javascript
// Cấu hình giá em bé
babyPricingMode: Joi.string().valid("fixed", "tiered").default("fixed"),
babyPricingRulesJson: Joi.alternatives().conditional("babyPricingMode", {
  is: "tiered",
  then: Joi.string().required().custom((value, helpers) => {
    try {
      const parsed = JSON.parse(value);
      if (!Array.isArray(parsed)) {
        return helpers.error("any.invalid");
      }
      // Validate từng rule...
      return value;
    } catch {
      return helpers.error("any.invalid");
    }
  }, "JSON array for baby pricing rules"),
  otherwise: Joi.optional(),
}),
```

### Bước 4: Backend - Xử lý và lưu vào database

**File:** `controllers/admin/tour.controller.js` (dòng 889-923)

```javascript
// --- cấu hình giá em bé ---
const babyPricingMode = (req.body.babyPricingMode || "fixed").trim();
req.body.babyPricingMode = babyPricingMode === "tiered" ? "tiered" : "fixed";

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

**Lưu ý:**
- Nếu chế độ là `tiered`, `priceNewBaby` được set = 0 (không dùng)
- Nếu chế độ là `fixed`, `babyPricingRules` = [] (không dùng)

---

## ✏️ Luồng chỉnh sửa tour

### Bước 1: Backend - Load dữ liệu tour

**File:** `controllers/admin/tour.controller.js` (dòng 1057-1061)

```javascript
// Chuẩn hoá babyPricingRules thành JSON string để bind vào form
tourDetail.babyPricingRulesJson = JSON.stringify(
  tourDetail.babyPricingRules || []
);
```

### Bước 2: Frontend - Hiển thị form với dữ liệu

**File:** `views/admin/pages/tour-edit.pug` (dòng 128-167)

```pug
.inner-group
  label(for="babyPricingMode" class="inner-label") Cách tính giá Em bé
  select(id="babyPricingMode" name="babyPricingMode")
    option(
      value="fixed"
      selected=(tourDetail.babyPricingMode!='tiered')
    ) Cố định (dùng Giá mới Em bé)
    option(
      value="tiered"
      selected=(tourDetail.babyPricingMode=='tiered')
    ) Theo bậc (nhiều Em bé, nhiều mức %)

.inner-group#baby-pricing-rules-wrapper(style="display:none")
  .baby-rules-body#baby-rules-body
    //- Body sẽ được JS fill dựa trên tourDetail.babyPricingRulesJson

  input(
    type="hidden"
    id="babyPricingRulesJson"
    name="babyPricingRulesJson"
    value=tourDetail.babyPricingRulesJson
  )
```

### Bước 3: Frontend - JavaScript load quy tắc từ hidden input

**File:** `public/admin/assets/js/script.js` (dòng 2388-2412)

```javascript
function loadRulesFromHidden() {
  if (!rulesBody) return;
  rulesBody.innerHTML = "";
  let arr = [];
  try {
    arr = JSON.parse(rulesHidden?.value || "[]");
    if (!Array.isArray(arr)) arr = [];
  } catch {
    arr = [];
  }
  if (arr.length === 0) {
    rulesBody.appendChild(createRuleRow());
  } else {
    arr.forEach((r) => {
      rulesBody.appendChild(
        createRuleRow(
          r.from || "",
          r.to ?? "",
          r.percent || "",
          r.ref || "children"
        )
      );
    });
  }
}

// Gọi khi trang load
loadRulesFromHidden();
```

### Bước 4: Backend - Xử lý cập nhật

**File:** `controllers/admin/tour.controller.js` (dòng 1345-1385)

```javascript
// --- Cấu hình giá em bé ---
const mode = (
  req.body.babyPricingMode ||
  existed.babyPricingMode ||
  "fixed"
).trim();
req.body.babyPricingMode = mode === "tiered" ? "tiered" : "fixed";

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
    // JSON rules lỗi -> giữ rỗng
  }
  // tiered => không dùng priceNewBaby
  req.body.priceNewBaby = 0;
} else {
  // fixed => không cần rules
  req.body.babyPricingRules = [];
}
```

---

## 💰 Luồng tính giá khi đặt hàng

### Bước 1: Lấy thông tin tour và cấu hình

**File:** `controllers/client/order.controller.js` (dòng 74-83)

```javascript
// Chụp thông tin giá tại thời điểm đặt
const priceAdult = Number(tourInfo.priceNewAdult || 0);
const priceChild = Number(tourInfo.priceNewChildren || 0);
const priceBabyFix = Number(tourInfo.priceNewBaby || 0);

// Cấu hình tiered (nếu có)
const babyMode = (tourInfo.babyPricingMode || "fixed").trim();
const babyRules = Array.isArray(tourInfo.babyPricingRules)
  ? tourInfo.babyPricingRules
  : [];
```

### Bước 2: Tính giá em bé

#### 2.1. Hàm tính giá cho 1 em bé tại vị trí cụ thể

**File:** `controllers/client/order.controller.js` (dòng 13-27)

```javascript
function babyUnitAt(idx, mode, rules, priceAdult, priceChild, priceBabyFixed) {
  // Nếu không phải tiered hoặc không có rules -> dùng giá cố định
  if (mode !== "tiered" || !Array.isArray(rules) || !rules.length) {
    return Number(priceBabyFixed || 0);
  }
  
  // Tìm rule phù hợp với vị trí em bé
  const found = rules.find((r) => {
    const from = Number(r.from);
    const to = r.to === "inf" ? Infinity : Number(r.to);
    return Number.isFinite(from) && idx >= from && idx <= to;
  });
  
  if (!found) return 0;
  
  // Tính giá dựa trên giá tham chiếu và %
  const base = found.ref === "adult" 
    ? Number(priceAdult || 0) 
    : Number(priceChild || 0);
  const pct = Number(found.percent || 0);
  return Math.round((base * pct) / 100);
}
```

**Ví dụ:**
- Em bé thứ 1: `babyUnitAt(1, ...)` → tìm rule `from: 1, to: 2` → 0% giá trẻ em = 0 VNĐ
- Em bé thứ 3: `babyUnitAt(3, ...)` → tìm rule `from: 3, to: 4` → 50% giá trẻ em = 500,000 VNĐ
- Em bé thứ 5: `babyUnitAt(5, ...)` → tìm rule `from: 5, to: "inf"` → 75% giá trẻ em = 750,000 VNĐ

#### 2.2. Hàm tính tổng giá cho nhiều em bé

**File:** `controllers/client/order.controller.js` (dòng 29-43)

```javascript
function babyTotalQty(
  qty,
  mode,
  rules,
  priceAdult,
  priceChild,
  priceBabyFixed
) {
  let sum = 0;
  qty = Number(qty || 0);
  
  // Tính giá cho từng em bé (bé thứ 1, thứ 2, thứ 3...)
  for (let i = 1; i <= qty; i++) {
    sum += babyUnitAt(i, mode, rules, priceAdult, priceChild, priceBabyFixed);
  }
  return sum;
}
```

**Ví dụ:** Nếu có 3 em bé với rules:
- Bé 1-2: 0% giá trẻ em (1,000,000 * 0% = 0)
- Bé 3-4: 50% giá trẻ em (1,000,000 * 50% = 500,000)
- Từ bé 5: 75% giá trẻ em (1,000,000 * 75% = 750,000)

→ Tổng = 0 + 0 + 500,000 = 500,000 VNĐ

### Bước 3: Tính tổng tiền đơn hàng

**File:** `controllers/client/order.controller.js` (dòng 85-96)

```javascript
// ==== TÍNH TIỀN DÒNG ====
const moneyAdult = quantityAdult * priceAdult;
const moneyChild = quantityChildren * priceChild;
const moneyBaby = babyTotalQty(
  quantityBaby,        // Số lượng em bé
  babyMode,         // "fixed" hoặc "tiered"
  babyRules,        // Mảng quy tắc (nếu tiered)
  priceAdult,       // Giá người lớn
  priceChild,       // Giá trẻ em
  priceBabyFix      // Giá em bé cố định (nếu fixed)
);
const lineSubTotal = moneyAdult + moneyChild + moneyBaby;
```

---

## 📈 Sơ đồ luồng

### Luồng tạo/chỉnh sửa tour

```
┌─────────────────────────────────────────────────────────────┐
│ 1. USER CHỌN CHẾ ĐỘ TÍNH GIÁ EM BÉ                          │
│    - Fixed: Nhập giá cố định                                │
│    - Tiered: Cấu hình quy tắc bậc                           │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. FRONTEND (JavaScript)                                     │
│    - collectBabyRules(): Thu thập quy tắc từ UI             │
│    - syncBabyModeUI(): Đồng bộ UI (hiển thị/ẩn, khóa/mở)   │
│    - JSON.stringify(rules): Chuyển thành JSON string        │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. VALIDATION (Joi)                                          │
│    - Kiểm tra babyPricingMode: "fixed" | "tiered"           │
│    - Nếu tiered: Validate JSON rules                        │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. BACKEND (Controller)                                      │
│    - Parse JSON rules                                        │
│    - Validate và filter rules                                │
│    - Nếu tiered: priceNewBaby = 0                            │
│    - Nếu fixed: babyPricingRules = []                       │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. DATABASE (MongoDB)                                         │
│    - Lưu babyPricingMode                                     │
│    - Lưu babyPricingRules (nếu tiered)                       │
│    - Lưu priceNewBaby (nếu fixed)                            │
└─────────────────────────────────────────────────────────────┘
```

### Luồng tính giá khi đặt hàng

```
┌─────────────────────────────────────────────────────────────┐
│ 1. USER NHẬP SỐ LƯỢNG                                        │
│    - quantityAdult: 2                                       │
│    - quantityChildren: 1                                     │
│    - quantityBaby: 3                                         │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. LẤY THÔNG TIN TOUR                                         │
│    - priceNewAdult: 2,000,000                                │
│    - priceNewChildren: 1,000,000                            │
│    - priceNewBaby: 500,000 (nếu fixed)                      │
│    - babyPricingMode: "tiered"                               │
│    - babyPricingRules: [...]                                 │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. TÍNH GIÁ EM BÉ                                            │
│    - babyUnitAt(1, ...): Giá em bé thứ 1                    │
│    - babyUnitAt(2, ...): Giá em bé thứ 2                    │
│    - babyUnitAt(3, ...): Giá em bé thứ 3                    │
│    - babyTotalQty(): Tổng = sum của 3 em bé                 │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. TÍNH TỔNG TIỀN                                            │
│    - moneyAdult = 2 * 2,000,000 = 4,000,000                 │
│    - moneyChild = 1 * 1,000,000 = 1,000,000                 │
│    - moneyBaby = Tổng giá 3 em bé                           │
│    - lineSubTotal = moneyAdult + moneyChild + moneyBaby     │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔍 Ví dụ cụ thể

### Ví dụ 1: Chế độ Fixed

**Cấu hình:**
- `babyPricingMode`: `"fixed"`
- `priceNewBaby`: `500,000` VNĐ

**Đặt hàng:**
- Số lượng em bé: 3

**Tính giá:**
```javascript
moneyBaby = 3 * 500,000 = 1,500,000 VNĐ
```

---

### Ví dụ 2: Chế độ Tiered

**Cấu hình:**
- `babyPricingMode`: `"tiered"`
- `priceNewChildren`: `1,000,000` VNĐ
- `babyPricingRules`:
  ```json
  [
    { "from": 1, "to": 2, "percent": 0, "ref": "children" },
    { "from": 3, "to": 4, "percent": 50, "ref": "children" },
    { "from": 5, "to": "inf", "percent": 75, "ref": "children" }
  ]
  ```

**Đặt hàng:**
- Số lượng em bé: 5

**Tính giá:**
```javascript
// Em bé thứ 1: 0% * 1,000,000 = 0
babyUnitAt(1, ...) = 0

// Em bé thứ 2: 0% * 1,000,000 = 0
babyUnitAt(2, ...) = 0

// Em bé thứ 3: 50% * 1,000,000 = 500,000
babyUnitAt(3, ...) = 500,000

// Em bé thứ 4: 50% * 1,000,000 = 500,000
babyUnitAt(4, ...) = 500,000

// Em bé thứ 5: 75% * 1,000,000 = 750,000
babyUnitAt(5, ...) = 750,000

// Tổng
moneyBaby = 0 + 0 + 500,000 + 500,000 + 750,000 = 1,750,000 VNĐ
```

---

## 📝 Tóm tắt

### Khi tạo/chỉnh sửa tour:
1. User chọn chế độ: **Fixed** hoặc **Tiered**
2. Nếu **Fixed**: Nhập giá cố định vào `priceNewBaby`
3. Nếu **Tiered**: Cấu hình các quy tắc bậc giá (from, to, percent, ref)
4. Frontend thu thập và chuyển thành JSON string
5. Backend parse, validate và lưu vào database

### Khi đặt hàng:
1. Lấy thông tin tour (giá, chế độ, quy tắc)
2. Nếu **Fixed**: `moneyBaby = quantityBaby * priceNewBaby`
3. Nếu **Tiered**: 
   - Tính giá từng em bé theo vị trí (bé thứ 1, 2, 3...)
   - Tổng = sum của tất cả em bé
4. Tính tổng tiền: `moneyAdult + moneyChild + moneyBaby`

---

## 🔗 Các file liên quan

1. **Model:** `models/tour.model.js`
2. **Controller (Admin):** `controllers/admin/tour.controller.js`
3. **Controller (Client - Order):** `controllers/client/order.controller.js`
4. **Validation:** `validates/admin/tour.validate.js`
5. **View (Create):** `views/admin/pages/tour-create.pug`
6. **View (Edit):** `views/admin/pages/tour-edit.pug`
7. **Frontend JS:** `public/admin/assets/js/script.js`

---

**Tài liệu được tạo:** `docs/luong-tinh-gia-em-be.md`

