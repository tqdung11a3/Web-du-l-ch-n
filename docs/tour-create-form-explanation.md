# Giải thích chi tiết: Tour Create Form Handler (script.js 344-1103)

## Tổng quan

Đoạn code này xử lý **form tạo tour mới** (`#tour-create-form`), bao gồm:
- Cấu hình giá em bé (cố định hoặc theo bậc)
- Quản lý khuyến mãi có thời hạn
- Quản lý địa điểm tour (tour trong nước / tour nước ngoài)
- Quản lý ngày khởi hành
- Validation và submit form

---

## 1. Khởi tạo và Setup (344-347)

```javascript
const tourCreateForm = document.querySelector("#tour-create-form");
if (tourCreateForm) {
  const validator = new JustValidate("#tour-create-form");
```

- Tìm form `#tour-create-form` trong DOM
- Nếu tìm thấy → khởi tạo **JustValidate** để validate form
- JustValidate là thư viện validate form phía client

---

## 2. Cấu hình giá em bé theo bậc (349-478)

### 2.1. Lấy các element cần thiết (350-362)

```javascript
const babyModeSelect = tourCreateForm.querySelector("#babyPricingMode");
const babyRulesWrapper = document.querySelector("#baby-pricing-rules-wrapper");
const babyRulesBody = document.querySelector("#baby-rules-body");
const babyRulesHiddenInput = document.querySelector("#babyPricingRulesJson");

const priceBabyInput = tourCreateForm.querySelector('input[name="priceBaby"]');
const priceNewBabyInput = tourCreateForm.querySelector('input[name="priceNewBaby"]');
```

**Giải thích:**
- `babyModeSelect`: Dropdown chọn chế độ tính giá em bé (`fixed` hoặc `tiered`)
- `babyRulesWrapper`: Khối chứa bảng quy tắc (chỉ hiện khi chọn `tiered`)
- `babyRulesBody`: Container chứa các dòng quy tắc
- `babyRulesHiddenInput`: Input ẩn lưu JSON rules (có thể không dùng)
- `priceBabyInput`, `priceNewBabyInput`: 2 ô nhập giá em bé (cố định)

### 2.2. Hàm tạo một dòng quy tắc mới (365-395)

```javascript
function createRuleRow(from = "", to = "", percent = "", ref = "children") {
  const row = document.createElement("div");
  row.className = "baby-rule-row";
  row.innerHTML = `...`;
  return row;
}
```

**Chức năng:**
- Tạo HTML cho **1 dòng quy tắc** trong bảng tính giá em bé theo bậc
- Mỗi dòng gồm:
  - **Từ em bé thứ mấy** (`from`): số nguyên ≥ 1
  - **Đến em bé thứ mấy** (`to`): số nguyên hoặc để trống (= vô hạn)
  - **Phần trăm** (`percent`): 0-100
  - **Tham chiếu** (`ref`): `"children"` (giá trẻ em) hoặc `"adult"` (giá người lớn)
  - **Nút Xóa**

**Ví dụ quy tắc:**
- Em bé thứ 1-2: 50% giá trẻ em
- Từ em bé thứ 3 trở lên: 30% giá trẻ em

### 2.3. Hàm thu thập quy tắc từ UI (398-425)

```javascript
function collectBabyRules() {
  if (!babyRulesBody) return [];
  const rows = babyRulesBody.querySelectorAll(".baby-rule-row");
  const rules = [];
  rows.forEach((row) => {
    // Lấy giá trị từ các input trong dòng
    const from = Number(fromEl?.value || "");
    const toRaw = toEl?.value || "";
    const percent = Number(percentEl?.value || "");
    const ref = refEl?.value === "adult" ? "adult" : "children";

    // Validate và push vào mảng
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

**Chức năng:**
- Đọc tất cả dòng quy tắc trong bảng
- Validate từng dòng (phải có `from`, `percent` hợp lệ)
- Nếu `to` để trống → gán `"inf"` (vô hạn)
- Trả về mảng `[{ from, to, percent, ref }, ...]`

### 2.4. Hàm đồng bộ UI theo chế độ (428-453)

```javascript
function syncBabyModeUI() {
  const mode = babyModeSelect?.value || "fixed";
  const isTiered = mode === "tiered";

  if (babyRulesWrapper) {
    babyRulesWrapper.style.display = isTiered ? "block" : "none";
  }

  if (priceBabyInput) {
    if (isTiered) {
      priceBabyInput.value = "";
      priceBabyInput.disabled = true;
    } else {
      priceBabyInput.disabled = false;
    }
  }
  // Tương tự cho priceNewBabyInput
}
```

**Chức năng:**
- Khi chọn `"tiered"`:
  - ✅ Hiện bảng quy tắc
  - ❌ Ẩn và khóa 2 ô giá em bé cố định
- Khi chọn `"fixed"`:
  - ❌ Ẩn bảng quy tắc
  - ✅ Mở khóa 2 ô giá em bé

### 2.5. Event handlers cho thêm/xóa quy tắc (456-477)

```javascript
const addRuleBtn = document.querySelector("#baby-rule-add");
if (addRuleBtn && babyRulesBody) {
  addRuleBtn.addEventListener("click", () => {
    babyRulesBody.appendChild(createRuleRow());
  });

  babyRulesBody.addEventListener("click", (e) => {
    const btn = e.target.closest(".baby-rule-remove");
    if (btn) {
      const row = btn.closest(".baby-rule-row");
      if (row && babyRulesBody.children.length > 1) {
        row.remove();
      }
    }
  });
}
```

**Chức năng:**
- **Thêm quy tắc**: Click nút "Thêm" → tạo dòng mới
- **Xóa quy tắc**: Click nút "Xóa" → xóa dòng (nhưng phải còn ≥ 1 dòng)

---

## 3. Thời hạn khuyến mãi theo giá cố định (480-515)

### 3.1. Lấy các element (481-489)

```javascript
const oldAdultInput = tourCreateForm.querySelector("#priceAdult");
const oldChildrenInput = tourCreateForm.querySelector("#priceChildren");
const oldBabyInput = tourCreateForm.querySelector("#priceBaby");

const discountWrapper = tourCreateForm.querySelector("#manual-discount-group");
const discountFromInput = tourCreateForm.querySelector("#discountFrom");
const discountToInput = tourCreateForm.querySelector("#discountTo");
```

**Giải thích:**
- `oldAdultInput`, `oldChildrenInput`, `oldBabyInput`: 3 ô **giá cũ** (giá niêm yết)
- `discountWrapper`: Khối chứa 2 ô **Từ ngày / Đến ngày** khuyến mãi
- `discountFromInput`, `discountToInput`: 2 ô date picker

### 3.2. Hàm kiểm tra có giá cũ không (491-496)

```javascript
function hasOldPriceCreate() {
  const a = parseInt(oldAdultInput?.value || "0", 10) || 0;
  const c = parseInt(oldChildrenInput?.value || "0", 10) || 0;
  const b = parseInt(oldBabyInput?.value || "0", 10) || 0;
  return a > 0 || c > 0 || b > 0;
}
```

**Chức năng:**
- Kiểm tra xem có **ít nhất 1 ô giá cũ** có giá trị > 0 không
- Nếu có → cần nhập thời hạn khuyến mãi

### 3.3. Hàm đồng bộ hiển thị khối khuyến mãi (498-507)

```javascript
function syncManualDiscountVisibilityCreate() {
  if (!discountWrapper) return;
  if (hasOldPriceCreate()) {
    discountWrapper.style.display = "";
  } else {
    discountWrapper.style.display = "none";
    if (discountFromInput) discountFromInput.value = "";
    if (discountToInput) discountToInput.value = "";
  }
}
```

**Chức năng:**
- Nếu **có giá cũ** → hiện khối "Từ ngày / Đến ngày"
- Nếu **không có giá cũ** → ẩn khối và xóa giá trị

### 3.4. Gắn event listener (509-514)

```javascript
[oldAdultInput, oldChildrenInput, oldBabyInput].forEach((el) => {
  if (el) el.addEventListener("input", syncManualDiscountVisibilityCreate);
});

syncManualDiscountVisibilityCreate(); // chạy 1 lần khi load form
```

**Chức năng:**
- Mỗi khi user nhập/xóa giá cũ → tự động hiện/ẩn khối khuyến mãi
- Chạy 1 lần khi load để set trạng thái ban đầu

---

## 4. Địa điểm có trong tour (517-817)

### 4.1. Lấy các element (518-525)

```javascript
const locationsWrapper = tourCreateForm.querySelector("#tour-locations-wrapper");
const locationAddBtn = tourCreateForm.querySelector("#location-add-btn");
const categorySelect = tourCreateForm.querySelector("#category");
const countriesGroup = tourCreateForm.querySelector("#tour-countries-group");
const vietnamLocationsGroup = tourCreateForm.querySelector("#vietnam-locations-group");
const countryCheckboxes = tourCreateForm.querySelectorAll(".tour-country-checkbox");
```

**Giải thích:**
- `locationsWrapper`: Container chứa các location items (tour trong nước)
- `locationAddBtn`: Nút "Thêm điểm đến" (tour trong nước)
- `categorySelect`: Dropdown chọn danh mục tour
- `countriesGroup`: Khối chứa các checkbox quốc gia (tour nước ngoài)
- `vietnamLocationsGroup`: Khối chứa location items Việt Nam
- `countryCheckboxes`: Tất cả checkbox quốc gia

### 4.2. Hàm lấy danh sách thành phố theo countryId (528-573)

```javascript
function getCitiesByCountryId(countryId) {
  if (!countryId) return [];
  const countryIdStr = String(countryId).trim();
  const cities = window.europeanCities || [];
  
  const filtered = cities.filter((city) => {
    let cityCountryId = null;
    if (city.countryId) {
      if (typeof city.countryId === 'object' && city.countryId !== null) {
        cityCountryId = city.countryId._id ? String(city.countryId._id).trim() : null;
      } else {
        cityCountryId = String(city.countryId).trim();
      }
    }
    return cityCountryId && cityCountryId === countryIdStr;
  });
  
  return filtered;
}
```

**Chức năng:**
- Nhận `countryId` (VD: `"68e3eb8f999ff87d3add177e"`)
- Lấy mảng `window.europeanCities` (đã được inject từ server)
- Filter các city có `countryId` khớp với `countryId` truyền vào
- Xử lý cả trường hợp `city.countryId` là object (populated) hoặc string

**Ví dụ:**
- Input: `countryId = "68e3eb8f999ff87d3add177e"` (Pháp)
- Output: `[{ _id: "...", name: "Paris", countryId: "..." }, { _id: "...", name: "Lyon", ... }, ...]`

### 4.3. Hàm tạo location item cho quốc gia (576-624)

```javascript
function createLocationItemForCountry(countryId) {
  const div = document.createElement("div");
  div.className = "tour-location-item";
  div.setAttribute("data-country-id", countryId);

  const cities = getCitiesByCountryId(countryId);
  let cityOptions = "";
  if (cities.length > 0) {
    cityOptions = cities
      .map((city) => `<option value="${city._id || city.id}">${city.name}</option>`)
      .join("");
  }

  div.innerHTML = `
    <div class="inner-input-list">
      <div class="inner-input-item">
        <label>Điểm đến</label>
        <select class="location-city" data-country-id="${countryId}">
          <option value="">-- Chọn thành phố --</option>
          ${cityOptions}
        </select>
      </div>
      <div class="inner-input-item">
        <label>Các địa điểm nổi tiếng (mỗi dòng một địa điểm)</label>
        <textarea class="location-spots" rows="3"></textarea>
      </div>
    </div>
    <div class="location-actions">
      <button type="button" class="location-remove-btn">Xóa điểm đến</button>
    </div>
  `;
  
  return div;
}
```

**Chức năng:**
- Tạo HTML cho **1 location item** (tour nước ngoài)
- Dropdown thành phố chỉ chứa các city thuộc quốc gia đó
- Có textarea để nhập các địa điểm nổi tiếng (spots)
- Có nút "Xóa điểm đến"

### 4.4. Hàm tạo location item cho Việt Nam (627-658)

```javascript
function createLocationItem() {
  const div = document.createElement("div");
  div.className = "tour-location-item";

  const vietnamCities = window.vietnamCities || [];
  const cityOptions = vietnamCities
    .map((city) => `<option value="${city._id || city.id}">${city.name}</option>`)
    .join("");

  div.innerHTML = `
    <div class="inner-input-list">
      <div class="inner-input-item">
        <label>Điểm đến</label>
        <select class="location-city">
          <option value="">-- Chọn tỉnh/thành --</option>
          ${cityOptions}
        </select>
      </div>
      <div class="inner-input-item">
        <label>Các địa điểm nổi tiếng (mỗi dòng một địa điểm)</label>
        <textarea class="location-spots" rows="3"></textarea>
      </div>
    </div>
    <div class="location-actions">
      <button type="button" class="location-remove-btn">Xóa điểm đến</button>
    </div>
  `;
  return div;
}
```

**Chức năng:**
- Tương tự `createLocationItemForCountry`, nhưng:
  - Dropdown chứa **tất cả tỉnh/thành Việt Nam** (từ `window.vietnamCities`)
  - Không cần filter theo quốc gia

### 4.5. Xử lý khi chọn/bỏ chọn quốc gia (660-756)

```javascript
if (countryCheckboxes.length > 0) {
  countryCheckboxes.forEach((checkbox, idx) => {
    checkbox.addEventListener("change", (e) => {
      const countryId = String(checkbox.value);
      const countryItem = checkbox.closest(".country-item");
      const locationsWrapper = countryItem?.querySelector(".country-locations-wrapper");
      
      if (checkbox.checked && locationsWrapper) {
        // Hiển thị khối địa điểm của quốc gia
        locationsWrapper.style.display = "";
        
        // Lấy danh sách cities cho quốc gia này
        const cities = getCitiesByCountryId(countryId);
        
        // Cập nhật tất cả location items hiện có
        existingItems.forEach((item, idx) => {
          const select = item.querySelector(".location-city");
          // Xóa tất cả options (trừ option đầu tiên)
          while (select.options.length > 1) {
            select.remove(1);
          }
          
          // Thêm các thành phố mới
          cities.forEach((city) => {
            const option = document.createElement("option");
            option.value = city._id || city.id;
            option.textContent = city.name;
            select.appendChild(option);
          });
        });
        
        // Nếu chưa có location item nào, tạo một item mới
        if (existingItems.length === 0) {
          const firstItem = createLocationItemForCountry(countryId);
          locationsWrapper.appendChild(firstItem);
        }
      } else if (!checkbox.checked && locationsWrapper) {
        // Ẩn khối địa điểm của quốc gia
        locationsWrapper.style.display = "none";
      }
    });
  });
}
```

**Chức năng:**
- Khi **check** một quốc gia:
  - ✅ Hiện khối `.country-locations-wrapper` của quốc gia đó
  - ✅ Lấy danh sách cities thuộc quốc gia
  - ✅ Cập nhật dropdown trong các location items hiện có
  - ✅ Nếu chưa có item nào → tạo item mới
- Khi **uncheck**:
  - ❌ Ẩn khối địa điểm

### 4.6. Xử lý nút "Thêm điểm đến" cho mỗi quốc gia (759-776)

```javascript
document.addEventListener("click", (e) => {
  const addBtn = e.target.closest(".country-location-add-btn");
  if (addBtn) {
    const countryId = addBtn.getAttribute("data-country-id");
    const countryItem = addBtn.closest(".country-item");
    const locationsWrapper = countryItem?.querySelector(".country-locations-wrapper");
    
    if (locationsWrapper && countryId) {
      const newItem = createLocationItemForCountry(countryId);
      locationsWrapper.appendChild(newItem);
    }
  }
});
```

**Chức năng:**
- Click nút "Thêm điểm đến" trong khối một quốc gia
- → Tạo location item mới cho quốc gia đó

### 4.7. Xử lý xóa location item (779-799)

```javascript
document.addEventListener("click", (e) => {
  const removeBtn = e.target.closest(".location-remove-btn");
  if (removeBtn) {
    const locationItem = removeBtn.closest(".tour-location-item");
    const locationsWrapper = locationItem?.closest(".country-locations-wrapper") || 
                             locationItem?.closest("#tour-locations-wrapper");
    
    if (locationItem && locationsWrapper) {
      const allItems = locationsWrapper.querySelectorAll(".tour-location-item");
      if (allItems.length > 1) {
        locationItem.remove();
      } else {
        // Nếu chỉ còn 1 item, chỉ xóa giá trị thay vì xóa item
        const citySelect = locationItem.querySelector(".location-city");
        const spotsTextarea = locationItem.querySelector(".location-spots");
        if (citySelect) citySelect.value = "";
        if (spotsTextarea) spotsTextarea.value = "";
      }
    }
  }
});
```

**Chức năng:**
- Click nút "Xóa điểm đến"
- Nếu còn **> 1 item** → xóa hẳn item
- Nếu chỉ còn **1 item** → không xóa DOM, chỉ clear giá trị (đảm bảo luôn có ít nhất 1 item)

### 4.8. Xử lý thêm/xóa location cho tour trong nước (801-816)

```javascript
if (locationAddBtn && locationsWrapper) {
  locationAddBtn.addEventListener("click", () => {
    locationsWrapper.appendChild(createLocationItem());
  });

  locationsWrapper.addEventListener("click", (e) => {
    const btn = e.target.closest(".location-remove-btn");
    if (btn) {
      const item = btn.closest(".tour-location-item");
      if (item && locationsWrapper.children.length > 1) {
        item.remove();
      }
    }
  });
}
```

**Chức năng:**
- Tương tự phần trên, nhưng dùng `createLocationItem()` (cho Việt Nam)

---

## 5. Ngày khởi hành (819-853)

### 5.1. Lấy element và tạo hàm (820-832)

```javascript
const departureDatesWrapper = document.getElementById("departure-dates-wrapper");
const departureDateAddBtn = document.getElementById("departure-date-add-btn");

function createDepartureDateItem() {
  const div = document.createElement("div");
  div.className = "departure-date-item";
  div.setAttribute("data-index", Date.now());
  div.innerHTML = `
    <input type="date" class="departure-date-input">
    <button type="button" class="departure-date-remove-btn">Xóa</button>
  `;
  return div;
}
```

**Chức năng:**
- Tạo HTML cho **1 ô chọn ngày khởi hành**
- Gồm: date picker + nút Xóa

### 5.2. Event handlers (834-852)

```javascript
if (departureDateAddBtn && departureDatesWrapper) {
  departureDateAddBtn.addEventListener("click", () => {
    departureDatesWrapper.appendChild(createDepartureDateItem());
  });

  departureDatesWrapper.addEventListener("click", (e) => {
    const btn = e.target.closest(".departure-date-remove-btn");
    if (btn) {
      const item = btn.closest(".departure-date-item");
      if (item && departureDatesWrapper.children.length > 1) {
        item.remove();
      } else if (item && departureDatesWrapper.children.length === 1) {
        // Nếu chỉ còn 1 item, chỉ xóa giá trị thay vì xóa item
        const dateInput = item.querySelector(".departure-date-input");
        if (dateInput) dateInput.value = "";
      }
    }
  });
}
```

**Chức năng:**
- **Thêm ngày**: Click nút "Thêm" → tạo date picker mới
- **Xóa ngày**: 
  - Nếu còn > 1 item → xóa hẳn
  - Nếu chỉ còn 1 item → chỉ clear giá trị

---

## 6. Validation và Submit Form (855-1102)

### 6.1. Validation (855-861)

```javascript
validator
  .addField("#name", [
    {
      rule: "required",
      errorMessage: "Vui lòng nhập tên tour!",
    },
  ])
```

**Chức năng:**
- Chỉ validate **tên tour** là bắt buộc
- Các field khác có thể để trống (tùy business logic)

### 6.2. Callback khi validation pass (862-1101)

#### 6.2.1. Lấy dữ liệu cơ bản (863-881)

```javascript
const f = event.target;

const name = f.name.value;
const category = f.category.value;
const position = f.position.value;
const status = f.status.value;
const avatar = filePond.avatar.getFile()?.file;

// Giá
let priceAdult = f.priceAdult.value;
let priceChildren = f.priceChildren.value;
let priceBaby = f.priceBaby.value;
let priceNewAdult = f.priceNewAdult.value;
let priceNewChildren = f.priceNewChildren.value;
let priceNewBaby = f.priceNewBaby.value;

// Ghế
const seatsTotal = f.seatsTotal.value;
const seatsRemaining = f.seatsRemaining.value;
```

**Chức năng:**
- Lấy tất cả giá trị từ form inputs
- `filePond.avatar.getFile()?.file`: Lấy file ảnh từ FilePond (nếu có)

#### 6.2.2. Xử lý cấu hình giá em bé (883-893)

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
```

**Chức năng:**
- Nếu chọn `"tiered"`:
  - Xóa giá em bé cố định
  - Thu thập rules từ UI → chuyển thành JSON

#### 6.2.3. Kiểm tra thời hạn khuyến mãi (895-908)

```javascript
const hasManualOldPrice = hasOldPriceCreate();
const discountFrom = discountFromInput?.value || "";
const discountTo = discountToInput?.value || "";

if (hasManualOldPrice) {
  if (!discountFrom || !discountTo) {
    notify.error(
      "Vui lòng nhập Từ ngày / Đến ngày khuyến mãi, hoặc xóa hết giá cũ (Người lớn / Trẻ em / Em bé)!"
    );
    return;
  }
}
```

**Chức năng:**
- Nếu có giá cũ → **bắt buộc** phải nhập thời hạn khuyến mãi
- Nếu không → báo lỗi và dừng submit

#### 6.2.4. Lấy điểm khởi hành (910-911)

```javascript
const departureCity = f.departureCity?.value || "";
```

#### 6.2.5. Thu thập địa điểm có trong tour (913-971)

```javascript
const locations = [];

// Kiểm tra xem có quốc gia nào được check không (tour nước ngoài)
const checkedCountries = tourCreateForm.querySelectorAll('.tour-country-checkbox:checked');

if (checkedCountries.length > 0) {
  // Tour nước ngoài: collect từ các .country-locations-wrapper
  checkedCountries.forEach((checkbox) => {
    const countryId = checkbox.value;
    const countryItem = checkbox.closest(".country-item");
    const countryLocationsWrapper = countryItem?.querySelector(".country-locations-wrapper");
    
    if (countryLocationsWrapper) {
      countryLocationsWrapper
        .querySelectorAll(".tour-location-item")
        .forEach((item) => {
          const citySelect = item.querySelector(".location-city");
          const cityId = citySelect?.value || "";
          
          // Thu thập spots từ các spot-input textarea
          const spots = [];
          item.querySelectorAll(".spot-input").forEach(textarea => {
            const value = textarea.value.trim();
            if (value) spots.push(value);
          });

          if (cityId && spots.length > 0) {
            locations.push({ cityId, spots });
          }
        });
    }
  });
} else if (locationsWrapper) {
  // Tour trong nước: collect từ #tour-locations-wrapper
  locationsWrapper
    .querySelectorAll(".tour-location-item")
    .forEach((item) => {
      const citySelect = item.querySelector(".location-city");
      const cityId = citySelect?.value || "";
      
      const spots = [];
      item.querySelectorAll(".spot-input").forEach(textarea => {
        const value = textarea.value.trim();
        if (value) spots.push(value);
      });

      if (cityId && spots.length > 0) {
        locations.push({ cityId, spots });
      }
    });
}
```

**Chức năng:**
- **Tour nước ngoài**: Duyệt các quốc gia đã check → lấy location items trong mỗi quốc gia
- **Tour trong nước**: Lấy location items từ `#tour-locations-wrapper`
- Mỗi location gồm:
  - `cityId`: ID thành phố
  - `spots`: Mảng các địa điểm nổi tiếng (từ các `.spot-input`)

**Kết quả:**
```javascript
locations = [
  { cityId: "68e3eb8f999ff87d3add177e", spots: ["Eiffel Tower", "Louvre Museum"] },
  { cityId: "68e3eb8f999ff87d3add178f", spots: ["Big Ben", "Tower Bridge"] }
]
```

#### 6.2.6. Thu thập ngày khởi hành (973-987)

```javascript
const departureDatesWrapper = document.getElementById("departure-dates-wrapper");
const departureDates = [];
if (departureDatesWrapper) {
  departureDatesWrapper
    .querySelectorAll(".departure-date-item")
    .forEach((item) => {
      const dateInput = item.querySelector(".departure-date-input");
      const dateValue = dateInput?.value || "";
      if (dateValue) {
        departureDates.push(dateValue);
      }
    });
}
```

**Chức năng:**
- Duyệt tất cả `.departure-date-item`
- Lấy giá trị từ date picker → push vào mảng

**Kết quả:**
```javascript
departureDates = ["2024-12-25", "2025-01-01", "2025-01-15"]
```

#### 6.2.7. Lấy thông tin khác (989-1004)

```javascript
const time = f.time.value;
const vehicle = f.vehicle.value;
const information = tinymce.get("information").getContent();

const schedules = [];
tourCreateForm
  .querySelectorAll(".inner-schedule-item")
  .forEach((item) => {
    const input = item.querySelector(".inner-schedule-head input");
    const title = input?.value || "";
    const textarea = item.querySelector(".inner-schedule-body textarea");
    const id = textarea?.id;
    const description = id ? tinymce.get(id).getContent() : "";
    schedules.push({ title, description });
  });
```

**Chức năng:**
- `time`: Thời lượng tour
- `vehicle`: Phương tiện
- `information`: Nội dung HTML từ TinyMCE
- `schedules`: Mảng lịch trình theo ngày (mỗi item có `title` và `description`)

#### 6.2.8. Tạo FormData và append dữ liệu (1006-1076)

```javascript
const formData = new FormData();

// Cơ bản
formData.append("name", name);
formData.append("category", category);
formData.append("position", position);
formData.append("status", status);
formData.append("avatar", avatar);

// Giá
formData.append("priceAdult", priceAdult);
formData.append("priceChildren", priceChildren);
formData.append("priceBaby", priceBaby);
formData.append("priceNewAdult", priceNewAdult);
formData.append("priceNewChildren", priceNewChildren);
formData.append("priceNewBaby", priceNewBaby);

// Cấu hình Em bé
formData.append("babyPricingMode", babyPricingMode);
formData.append("babyPricingRulesJson", babyPricingRulesJson);

// Ghế
formData.append("seatsTotal", seatsTotal);
formData.append("seatsRemaining", seatsRemaining);

// Thời hạn khuyến mãi
if (hasManualOldPrice && discountFrom && discountTo) {
  formData.append("discountFrom", discountFrom);
  formData.append("discountTo", discountTo);
}

// Địa điểm
formData.append("departureCity", departureCity);
formData.append("locations", JSON.stringify(locations));

// Khác
formData.append("time", time);
formData.append("vehicle", vehicle);
formData.append("departureDates", JSON.stringify(departureDates));
formData.append("information", information);
formData.append("schedules", JSON.stringify(schedules));

// Điểm nổi bật, bao gồm, không bao gồm
const highlightsArray = [];
tourCreateForm.querySelectorAll('.highlight-input').forEach(textarea => {
  const value = textarea.value.trim();
  if (value) highlightsArray.push(value);
});

const includesArray = [];
tourCreateForm.querySelectorAll('.include-input').forEach(textarea => {
  const value = textarea.value.trim();
  if (value) includesArray.push(value);
});

const excludesArray = [];
tourCreateForm.querySelectorAll('.exclude-input').forEach(textarea => {
  const value = textarea.value.trim();
  if (value) excludesArray.push(value);
});

formData.append("highlights", highlightsArray.join('\n'));
formData.append("includes", includesArray.join('\n'));
formData.append("excludes", excludesArray.join('\n'));

// Tags
const tagsCheckboxes = f.querySelectorAll('input[name="tags"]:checked');
const tags = Array.from(tagsCheckboxes).map(cb => cb.value);
tags.forEach(tag => {
  formData.append("tags", tag);
});

// Images
if (filePondMulti.images.getFiles().length > 0) {
  filePondMulti.images.getFiles().forEach((item) => {
    formData.append("images", item.file);
  });
}
```

**Chức năng:**
- Tạo `FormData` để gửi dữ liệu (hỗ trợ file upload)
- Append tất cả field:
  - Text/Number: append trực tiếp
  - Array/Object: `JSON.stringify()` trước khi append
  - File: append trực tiếp (FilePond đã xử lý)

**Lưu ý:**
- `highlights`, `includes`, `excludes`: Join bằng `\n` (newline) thay vì JSON
- `tags`: Append nhiều lần (FormData hỗ trợ multiple values cùng key)

#### 6.2.9. Gửi request và xử lý response (1086-1100)

```javascript
fetch(`/${pathAdmin}/tour/create`, {
  method: "POST",
  body: formData,
})
  .then((res) => res.json())
  .then((data) => {
    if (data.code == "error") {
      notify.error(data.message);
    }

    if (data.code == "success") {
      drawNotify(data.code, data.message);
      window.location.reload();
    }
  });
```

**Chức năng:**
- Gửi POST request với FormData
- Nếu lỗi → hiện thông báo lỗi
- Nếu thành công → hiện thông báo thành công + reload trang

---

## Tóm tắt luồng hoạt động

1. **User điền form** → Các event handler cập nhật UI (hiện/ẩn khối, thêm/xóa items)
2. **User bấm "Tạo tour"** → JustValidate kiểm tra
3. **Validation pass** → Callback `.onSuccess()` chạy
4. **Thu thập dữ liệu** từ form + các dynamic items (locations, dates, schedules, ...)
5. **Tạo FormData** và append tất cả
6. **Gửi POST** `/admin/tour/create`
7. **Server xử lý** → Trả JSON
8. **Client nhận response** → Hiện thông báo + reload

---

## Các điểm quan trọng cần lưu ý

1. **Tour trong nước vs Tour nước ngoài**: Logic khác nhau để collect locations
2. **Giá em bé**: 2 chế độ (`fixed` vs `tiered`) → xử lý khác nhau
3. **Khuyến mãi**: Chỉ hiện khi có giá cũ
4. **Dynamic items**: Locations, dates, schedules, highlights, includes, excludes đều có thể thêm/xóa động
5. **File upload**: Dùng FilePond cho avatar và images gallery

