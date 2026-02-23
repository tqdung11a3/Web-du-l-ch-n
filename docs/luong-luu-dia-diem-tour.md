# Phân tích luồng lưu Địa điểm trong nước (Việt Nam) trong Tour

## 📋 Mục lục
1. [Tổng quan](#tổng-quan)
2. [Cấu trúc dữ liệu](#cấu-trúc-dữ-liệu)
3. [Luồng tạo tour](#luồng-tạo-tour)
4. [Luồng chỉnh sửa tour](#luồng-chỉnh-sửa-tour)
5. [Sơ đồ luồng](#sơ-đồ-luồng)

---

## 🎯 Tổng quan

Hệ thống hỗ trợ lưu **địa điểm trong nước (Việt Nam)** cho tour, bao gồm:
- **Điểm đến**: Chọn tỉnh/thành phố
- **Các địa điểm nổi tiếng**: Danh sách các địa điểm cụ thể trong tỉnh/thành đó

Mỗi tour có thể có **nhiều điểm đến**, mỗi điểm đến có **nhiều địa điểm nổi tiếng**.

---

## 📊 Cấu trúc dữ liệu

### Model Tour (`models/tour.model.js`)

```javascript
// 2) Những địa điểm có trong tour:
//    mỗi phần tử: { city: ObjectId<City>, spots: [String] }
locations: [
  {
    city: {
      type: Types.ObjectId,
      ref: "City",
      required: true,
    },
    spots: {
      type: [String],
      default: [],
    },
  },
],
```

**Cấu trúc:**
- `locations`: Mảng các địa điểm
- Mỗi phần tử có:
  - `city`: ObjectId tham chiếu đến bảng City (tỉnh/thành)
  - `spots`: Mảng các chuỗi (tên địa điểm nổi tiếng)

**Ví dụ:**
```json
[
  {
    "city": "507f1f77bcf86cd799439011",
    "spots": ["Chùa Linh Ứng", "Bãi biển Mỹ Khê", "Cầu Rồng"]
  },
  {
    "city": "507f1f77bcf86cd799439012",
    "spots": ["Phố cổ Hội An", "Chùa Cầu", "Làng gốm Thanh Hà"]
  }
]
```

---

## 🔄 Luồng tạo tour

### Bước 1: Frontend - Form nhập liệu

**File:** `views/admin/pages/tour-create.pug` (dòng 177-205)

```pug
//- ĐỊA ĐIỂM CÓ TRONG TOUR
.inner-group
  label(class="inner-label") Những địa điểm có trong tour
  
  //- Tour trong nước: Hiển thị các tỉnh thành Việt Nam
  .inner-group#vietnam-locations-group
    label(class="inner-label") Địa điểm trong nước (Việt Nam)
    .tour-locations-wrapper#tour-locations-wrapper
      .tour-location-item(data-index="0")
        .inner-input-list
          .inner-input-item
            label Điểm đến
            select.location-city
              option(value="") -- Chọn tỉnh/thành --
              each city in cityList
                option(value=city.id) #{city.name}
          .inner-input-item
            label Các địa điểm nổi tiếng
            .location-spots-list
              .location-spot-item
                .spot-input-group
                  textarea.spot-input(placeholder="VD: Chùa Linh Ứng" rows="2")
                  button(type="button" class="spot-remove-btn") Xóa
            .spot-actions
              button(type="button" class="spot-add-btn") + Thêm địa điểm
        .location-actions
          button(type="button" class="location-remove-btn") Xóa điểm đến
    .location-global-actions
      button(type="button" id="location-add-btn") + Thêm điểm đến

  //- Input ẩn: JS sẽ ghi JSON locations trước khi submit
  input(type="hidden" id="locationsJson" name="locations")
```

**Cấu trúc UI:**
- `#tour-locations-wrapper`: Container chứa tất cả các điểm đến
- `.tour-location-item`: Mỗi item là một điểm đến
  - `.location-city`: Select chọn tỉnh/thành
  - `.location-spots-list`: Danh sách các địa điểm nổi tiếng
    - `.location-spot-item`: Mỗi item là một địa điểm
      - `.spot-input`: Textarea nhập tên địa điểm
- `#location-add-btn`: Nút thêm điểm đến mới
- `.spot-add-btn`: Nút thêm địa điểm nổi tiếng

### Bước 2: Frontend - JavaScript xử lý UI

**File:** `public/admin/assets/js/script.js` (dòng 517-658)

#### 2.1. Khởi tạo và lấy các element

```javascript
const locationsWrapper = tourCreateForm.querySelector("#tour-locations-wrapper");
const locationAddBtn = tourCreateForm.querySelector("#location-add-btn");
const vietnamLocationsGroup = tourCreateForm.querySelector("#vietnam-locations-group");
```

#### 2.2. Tạo location item mới (cho Việt Nam)

```javascript
function createLocationItem() {
  const div = document.createElement("div");
  div.className = "tour-location-item";

  const vietnamCities = window.vietnamCities || [];
  const cityOptions = vietnamCities
    .map(
      (city) =>
        `<option value="${city._id || city.id}">${city.name}</option>`
    )
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
        <label>Các địa điểm nổi tiếng</label>
        <div class="location-spots-list">
          <div class="location-spot-item">
            <div class="spot-input-group">
              <textarea class="spot-input" placeholder="VD: Chùa Linh Ứng" rows="2"></textarea>
              <button type="button" class="spot-remove-btn">Xóa</button>
            </div>
          </div>
        </div>
        <div class="spot-actions">
          <button type="button" class="spot-add-btn">+ Thêm địa điểm</button>
        </div>
      </div>
    </div>
    <div class="location-actions">
      <button type="button" class="location-remove-btn">Xóa điểm đến</button>
    </div>
  `;
  return div;
}
```

#### 2.3. Xử lý thêm/xóa địa điểm nổi tiếng

**File:** `views/admin/pages/tour-create.pug` (dòng 370-412)

```javascript
// Helper function để tạo spot item
function createSpotItem() {
  const div = document.createElement('div');
  div.className = 'location-spot-item';
  div.innerHTML = `
    <div class="spot-input-group">
      <textarea class="spot-input" placeholder="VD: Chùa Linh Ứng" rows="2"></textarea>
      <button type="button" class="spot-remove-btn">Xóa</button>
    </div>
  `;
  attachSpotRemoveHandler(div);
  return div;
}

function attachSpotRemoveHandler(spotItem) {
  const btn = spotItem.querySelector('.spot-remove-btn');
  btn.addEventListener('click', () => {
    const spotsList = spotItem.closest('.location-spots-list');
    if (spotsList.children.length > 1) {
      spotItem.remove();
    } else {
      spotItem.querySelector('.spot-input').value = '';
    }
  });
}

// Gắn handlers cho nút thêm spot
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('spot-add-btn')) {
    const spotsList = e.target.closest('.inner-input-item').querySelector('.location-spots-list');
    if (spotsList) {
      spotsList.appendChild(createSpotItem());
    }
  }
});
```

#### 2.4. Xử lý thêm/xóa điểm đến

```javascript
// Thêm điểm đến
if (locationAddBtn && locationsWrapper) {
  locationAddBtn.addEventListener("click", () => {
    locationsWrapper.appendChild(createLocationItem());
  });
}

// Xóa điểm đến
locationsWrapper.addEventListener("click", (e) => {
  const btn = e.target.closest(".location-remove-btn");
  if (btn) {
    const item = btn.closest(".tour-location-item");
    if (item && locationsWrapper.children.length > 1) {
      item.remove();
    } else if (item) {
      // Nếu chỉ còn 1 item, xóa giá trị thay vì xóa item
      const citySelect = item.querySelector(".location-city");
      const spotsList = item.querySelectorAll(".spot-input");
      if (citySelect) citySelect.value = "";
      spotsList.forEach(textarea => textarea.value = "");
    }
  }
});
```

### Bước 3: Frontend - Thu thập dữ liệu khi submit

**File:** `public/admin/assets/js/script.js` (dòng 913-971)

```javascript
// ==== ĐỊA ĐIỂM CÓ TRONG TOUR (mảng { cityId, spots[] }) ====
const locations = [];

// Kiểm tra xem có quốc gia nào được check không (tour nước ngoài)
const checkedCountries = tourCreateForm.querySelectorAll('.tour-country-checkbox:checked');

if (checkedCountries.length > 0) {
  // Tour nước ngoài: collect từ các .country-locations-wrapper
  // ... (xử lý tour nước ngoài)
} else if (locationsWrapper) {
  // Tour trong nước: collect từ #tour-locations-wrapper
  console.log("Tour Create - Collecting locations from Vietnam wrapper");
  locationsWrapper
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

      // Chỉ thêm vào locations nếu có cityId và có ít nhất 1 spot
      if (cityId && spots.length > 0) {
        locations.push({ cityId, spots });
        console.log("Tour Create - Added location:", cityId, "with", spots.length, "spots");
      }
    });
}

console.log("Tour Create - Total locations collected:", locations.length);
```

**Lưu ý:**
- Chỉ thêm vào `locations` nếu có `cityId` và có ít nhất 1 spot
- Mỗi location có dạng: `{ cityId: string, spots: string[] }`

#### 3.1. Gửi lên server

```javascript
// Chuyển locations thành JSON string
const locationsJson = JSON.stringify(locations);

// Gửi lên server qua FormData
formData.append("locations", locationsJson);
```

### Bước 4: Backend - Parse và chuẩn hóa dữ liệu

**File:** `controllers/admin/tour.controller.js` (dòng 21-70)

#### 4.1. Hàm parseLocationsPayload

```javascript
/**
 * Chuẩn hoá payload locations từ client về dạng:
 *   [{ city: ObjectId|string, spots: [String] }, ...]
 * Hỗ trợ cả dữ liệu cũ (mảng cityId thuần, không có spots).
 */
function parseLocationsPayload(raw) {
  if (!raw) return [];

  let arr;
  try {
    arr = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return [];
  }

  if (!Array.isArray(arr)) return [];

  const result = [];
  for (const item of arr) {
    if (!item) continue;

    // 1) Lấy city id
    let city =
      item.city ||
      item.cityId ||
      item._id ||
      item.id ||
      (typeof item === "string" || typeof item === "number" ? item : null);

    if (!city) continue;

    // 2) Lấy danh sách địa điểm (spots)
    let spots = item.spots;

    // Cho phép gửi lên dạng text (spotsText) -> tách theo dòng
    if (!spots && typeof item.spotsText === "string") {
      spots = item.spotsText;
    }

    if (typeof spots === "string") {
      spots = spots
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (Array.isArray(spots)) {
      spots = spots.map((s) => String(s).trim()).filter(Boolean);
    } else {
      spots = [];
    }

    result.push({ city, spots });
  }

  return result;
}
```

**Chức năng:**
- Parse JSON string từ client
- Hỗ trợ nhiều format: `city`, `cityId`, `_id`, `id`
- Xử lý spots dạng string (tách theo dòng) hoặc array
- Loại bỏ các item không hợp lệ

#### 4.2. Xử lý trong controller createPost

**File:** `controllers/admin/tour.controller.js` (dòng 800-801)

```javascript
// locations: JSON từ client -> chuẩn hoá
req.body.locations = parseLocationsPayload(req.body.locations);
```

### Bước 5: Backend - Lưu vào database

**File:** `controllers/admin/tour.controller.js` (dòng 960-962)

```javascript
// Lưu
const newRecord = new Tour(req.body);
await newRecord.save();
```

MongoDB sẽ tự động lưu `locations` theo schema đã định nghĩa.

---

## ✏️ Luồng chỉnh sửa tour

### Bước 1: Backend - Load dữ liệu tour

**File:** `controllers/admin/tour.controller.js` (dòng 997-1027)

```javascript
// Chuẩn hoá locations cho form:
//   locationBlocks: [{ city: cityId, spots: ['...'] }]
const locs = Array.isArray(tourDetail.locations)
  ? tourDetail.locations
  : [];
tourDetail.locationBlocks = locs.map((loc) => {
  // dữ liệu cũ: chỉ lưu cityId (string/ObjectId)
  if (
    !loc ||
    typeof loc === "string" ||
    mongoose.Types.ObjectId.isValid(String(loc))
  ) {
    return {
      city: String(loc),
      spots: [],
    };
  }

  // dữ liệu mới: { city, spots }
  const cityId = loc.city ? String(loc.city) : "";
  let spots = [];
  
  if (Array.isArray(loc.spots)) {
    spots = loc.spots;
  } else if (typeof loc.spots === "string" && loc.spots.trim()) {
    // Nếu là string, split thành array
    spots = loc.spots.split("\n").map(s => s.trim()).filter(Boolean);
  }

  return { city: cityId, spots };
});
```

**Chuẩn hóa:**
- Dữ liệu cũ: chỉ có cityId → thêm `spots: []`
- Dữ liệu mới: có `{ city, spots }` → giữ nguyên
- Chuyển `city` (ObjectId) thành string để bind vào form

### Bước 2: Frontend - Hiển thị form với dữ liệu

**File:** `views/admin/pages/tour-edit.pug` (dòng 198-230)

```pug
.tour-locations-wrapper#tour-locations-wrapper
  if (tourDetail.locationBlocks && tourDetail.locationBlocks.length > 0)
    each loc, idx in tourDetail.locationBlocks
      .tour-location-item(data-index=idx)
        .inner-input-list
          .inner-input-item
            label Điểm đến
            select.location-city
              option(value="") -- Chọn tỉnh/thành --
              each city in cityList
                option(
                  value=city.id
                  selected=(loc.city && loc.city == city.id)
                ) #{city.name}
          .inner-input-item
            label Các địa điểm nổi tiếng
            .location-spots-list
              if loc.spots && loc.spots.length > 0
                each spot, spotIdx in loc.spots
                  .location-spot-item
                    .spot-input-group
                      textarea.spot-input(rows="2") #{spot}
                      button(type="button" class="spot-remove-btn") Xóa
              else
                .location-spot-item
                  .spot-input-group
                    textarea.spot-input(placeholder="VD: Chùa Linh Ứng" rows="2")
                    button(type="button" class="spot-remove-btn") Xóa
            .spot-actions
              button(type="button" class="spot-add-btn") + Thêm địa điểm
        .location-actions
          button(type="button" class="location-remove-btn") Xóa điểm đến
  else
    //- Nếu không có dữ liệu, hiển thị 1 item trống
    .tour-location-item(data-index="0")
      //- ... (giống tour-create)
```

### Bước 3: Frontend - Thu thập dữ liệu khi submit (giống tạo tour)

**File:** `public/admin/assets/js/script.js` (dòng 2907-2947)

```javascript
// ==== ĐỊA ĐIỂM CÓ TRONG TOUR ====
const locations = [];

const checkedCountriesE = tourEditForm.querySelectorAll('.tour-country-checkbox:checked');

if (checkedCountriesE.length > 0) {
  // Tour nước ngoài: collect từ các .country-locations-wrapper
  // ... (xử lý tour nước ngoài)
} else if (locationsWrapperE) {
  // Tour trong nước: collect từ #tour-locations-wrapper
  locationsWrapperE
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

const locationsJson = JSON.stringify(locations);
formData.append("locations", locationsJson);
```

### Bước 4: Backend - Xử lý cập nhật

**File:** `controllers/admin/tour.controller.js` (dòng 1340-1385)

```javascript
// locations: JSON từ client -> chuẩn hoá
req.body.locations = parseLocationsPayload(req.body.locations);

// Cập nhật tour
const updated = await Tour.findOneAndUpdate(
  { _id: id, deleted: false, companyId },
  req.body,
  { new: true, runValidators: true }
);
```

---

## 📈 Sơ đồ luồng

### Luồng tạo tour

```
┌─────────────────────────────────────────────────────────────┐
│ 1. USER NHẬP ĐỊA ĐIỂM                                       │
│    - Chọn tỉnh/thành từ dropdown                            │
│    - Nhập các địa điểm nổi tiếng (có thể nhiều)            │
│    - Có thể thêm nhiều điểm đến                            │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. FRONTEND (JavaScript)                                    │
│    - Tạo/thêm/xóa location items                            │
│    - Tạo/thêm/xóa spot items                                │
│    - Thu thập dữ liệu:                                      │
│      locations = [                                           │
│        { cityId: "...", spots: ["...", "..."] },           │
│        { cityId: "...", spots: ["..."] }                    │
│      ]                                                       │
│    - JSON.stringify(locations)                              │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. GỬI LÊN SERVER                                            │
│    FormData.append("locations", locationsJson)              │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. BACKEND (Controller)                                      │
│    - parseLocationsPayload(req.body.locations)              │
│    - Chuẩn hóa:                                              │
│      [{ city: ObjectId, spots: [String] }, ...]             │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. DATABASE (MongoDB)                                        │
│    - Lưu vào field locations của Tour                       │
│    - Schema: [{ city: ObjectId, spots: [String] }]         │
└─────────────────────────────────────────────────────────────┘
```

### Luồng chỉnh sửa tour

```
┌─────────────────────────────────────────────────────────────┐
│ 1. BACKEND - LOAD TOUR                                       │
│    - Lấy tour từ database                                    │
│    - Chuẩn hóa locations → locationBlocks                   │
│      [{ city: string, spots: [String] }, ...]               │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. FRONTEND - HIỂN THỊ                                      │
│    - Render locationBlocks vào form                         │
│    - Bind city vào select                                   │
│    - Render spots vào các textarea                          │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. USER CHỈNH SỬA                                           │
│    - Thêm/xóa điểm đến                                      │
│    - Thêm/xóa địa điểm nổi tiếng                           │
│    - Sửa tên địa điểm                                       │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. FRONTEND - THU THẬP & GỬI                                │
│    - Thu thập locations từ form                            │
│    - JSON.stringify(locations)                             │
│    - Gửi lên server                                         │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. BACKEND - CẬP NHẬT                                       │
│    - parseLocationsPayload()                                │
│    - Tour.findOneAndUpdate()                                │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔍 Ví dụ cụ thể

### Ví dụ 1: Tạo tour với 2 điểm đến

**User nhập:**
- Điểm đến 1: Đà Nẵng
  - Địa điểm: Chùa Linh Ứng
  - Địa điểm: Bãi biển Mỹ Khê
  - Địa điểm: Cầu Rồng
- Điểm đến 2: Hội An
  - Địa điểm: Phố cổ Hội An
  - Địa điểm: Chùa Cầu

**Frontend thu thập:**
```javascript
locations = [
  {
    cityId: "507f1f77bcf86cd799439011", // Đà Nẵng
    spots: ["Chùa Linh Ứng", "Bãi biển Mỹ Khê", "Cầu Rồng"]
  },
  {
    cityId: "507f1f77bcf86cd799439012", // Hội An
    spots: ["Phố cổ Hội An", "Chùa Cầu"]
  }
]
```

**Backend parse:**
```javascript
[
  {
    city: ObjectId("507f1f77bcf86cd799439011"),
    spots: ["Chùa Linh Ứng", "Bãi biển Mỹ Khê", "Cầu Rồng"]
  },
  {
    city: ObjectId("507f1f77bcf86cd799439012"),
    spots: ["Phố cổ Hội An", "Chùa Cầu"]
  }
]
```

**Lưu vào database:**
```json
{
  "_id": "...",
  "name": "Tour Đà Nẵng - Hội An",
  "locations": [
    {
      "city": ObjectId("507f1f77bcf86cd799439011"),
      "spots": ["Chùa Linh Ứng", "Bãi biển Mỹ Khê", "Cầu Rồng"]
    },
    {
      "city": ObjectId("507f1f77bcf86cd799439012"),
      "spots": ["Phố cổ Hội An", "Chùa Cầu"]
    }
  ]
}
```

---

## 📝 Tóm tắt

### Khi tạo tour:
1. User nhập địa điểm trong form
2. Frontend thu thập dữ liệu từ form → `{ cityId, spots[] }`
3. Chuyển thành JSON string và gửi lên server
4. Backend parse và chuẩn hóa → `{ city: ObjectId, spots: [String] }`
5. Lưu vào database

### Khi chỉnh sửa tour:
1. Backend load tour và chuẩn hóa `locations` → `locationBlocks`
2. Frontend hiển thị dữ liệu vào form
3. User chỉnh sửa
4. Frontend thu thập và gửi lên server (giống tạo tour)
5. Backend cập nhật tour

### Điểm quan trọng:
- Chỉ lưu location nếu có `cityId` và có ít nhất 1 spot
- Hỗ trợ nhiều format dữ liệu cũ (chỉ có cityId)
- Spots có thể là string (tách theo dòng) hoặc array

---

## 🔗 Các file liên quan

1. **Model:** `models/tour.model.js` (dòng 43-55)
2. **Controller (Create):** `controllers/admin/tour.controller.js` (dòng 21-70, 800-801, 960-962)
3. **Controller (Edit):** `controllers/admin/tour.controller.js` (dòng 997-1027, 1340-1385)
4. **View (Create):** `views/admin/pages/tour-create.pug` (dòng 177-205)
5. **View (Edit):** `views/admin/pages/tour-edit.pug` (dòng 191-250)
6. **Frontend JS (Create):** `public/admin/assets/js/script.js` (dòng 517-658, 913-971)
7. **Frontend JS (Edit):** `public/admin/assets/js/script.js` (dòng 2907-2947)

---

**Tài liệu được tạo:** `docs/luong-luu-dia-diem-tour.md`

