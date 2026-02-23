## Tổng quan luồng tìm kiếm tour (client)

Luồng tìm kiếm tour ở phía client gồm 2 “entry point” chính:

- **Form tìm kiếm trên trang chủ**: gửi người dùng sang trang `/search` với các tham số lọc.
- **Box bộ lọc (box-filter)**: dùng chung cho trang `/search` và trang danh mục `/category/:slug`, cho phép thay đổi filter ngay trên trang hiện tại bằng cách thao tác với query string URL.

Phần “tìm kiếm” thực sự (lọc tour từ database) nằm ở **backend** (`search.controller.js`, `category.controller.js`), nhưng toàn bộ việc:
- Thu thập input của user,
- Biến input thành query string,
- Điều hướng sang URL phù hợp,

là do **JS phía client** xử lý.

---

## 1. Form tìm kiếm trên trang chủ → điều hướng sang `/search`

### 1.1. Giao diện form trên trang chủ

**File:** `views/client/pages/home.pug`

Form có attribute `form-search` để JS bắt được:

```24:75:views/client/pages/home.pug
form.inner-form(
  data-aos-delay="300"
  data-aos-duration="800"
  data-aos="fade-up"
  form-search
)
  // Địa điểm (tìm trong tiêu đề tour)
  .inner-box.inner-address
    .inner-input-group
      input.inner-input(
        type="text"
        name="q"
        placeholder="Bạn muốn đi đâu?"
      )

  // Số lượng thành viên (minSeats)
  .inner-box.inner-user
    .inner-input-group
      input.inner-input(
        type="number"
        name="minSeats"
        min="1"
        placeholder="Số lượng thành viên"
      )

  // Ngày khởi hành
  .inner-box.inner-calendar
    .inner-input-group
      input.inner-input(
        type="date"
        name="departureDate"
        placeholder="Lịch khởi hành"
      )

  // Khoảng giá
  .inner-box.inner-price
    .inner-input-group
      select.inner-input(name="price")
        option(value="") -- Chọn khoảng giá --
        option(value="0-999999") Dưới 1 triệu
        ...

  button.inner-button(type="submit")
    i.fa-solid.fa-magnifying-glass
    |  Tìm Kiếm
```

### 1.2. JS bắt sự kiện submit và dựng URL `/search`

**File:** `public/assets/js/script.js`

```250:275:public/assets/js/script.js
const formSearch = document.querySelector("[form-search]");
if (formSearch) {
  const FIELDS = ["q", "departureDate", "price", "minSeats"];
  const NUM_FIELDS = new Set(["minSeats"]);

  formSearch.addEventListener("submit", (event) => {
    event.preventDefault(); // không reload form theo cách mặc định

    // Tạo URL mới mỗi lần submit
    const url = new URL(`${window.location.origin}/search`);

    FIELDS.forEach((name) => {
      const el = formSearch.querySelector(`[name="${name}"]`);
      let val = (el && el.value != null ? String(el.value) : "").trim();

      // Nếu là field số mà <= 0 thì bỏ khỏi query
      if (!val || (NUM_FIELDS.has(name) && Number(val) <= 0)) {
        url.searchParams.delete(name);
      } else {
        url.searchParams.set(name, val);
      }
    });

    // Điều hướng sang trang /search với query string đã build
    window.location.href = url.href;
  });
}
```

### 1.3. Tóm tắt luồng (trang chủ → /search)

1. User nhập:
   - `q`: nơi muốn đi (tên địa điểm, gõ tự do),
   - `minSeats`: số lượng thành viên,
   - `departureDate`,
   - `price`: khoảng giá.
2. User bấm nút **Tìm Kiếm** → form submit.
3. JS chặn submit mặc định (`event.preventDefault()`).
4. JS đọc lần lượt các input trong `FIELDS`, bỏ các field trống hoặc `minSeats <= 0`.
5. JS tạo URL `/search?q=...&departureDate=...&price=...&minSeats=...`.
6. Gán `window.location.href = url.href` → trình duyệt chuyển sang trang `/search` với query string tương ứng.
7. Ở backend, `search.controller.js` đọc `req.query` để truy vấn tour (chi tiết ở phần Backend bên dưới).

---

## 2. Box Filter dùng chung (trang `/search` & `/category/:slug`)

Trên trang **kết quả tìm kiếm** (`/search`) và trang **danh mục tour** (`/category/:slug`), bộ lọc bên trái đều dùng cùng một partial `box-filter.pug` và JS xử lý chung.

### 2.1. Giao diện box filter

**File:** `views/client/partials/box-filter.pug`

```1:71:views/client/partials/box-filter.pug
.box-filter
  .inner-head
    .inner-title Bộ Lọc
  .inner-body
    // Ô nhập địa điểm (keyword)
    .inner-group
      .inner-label Địa điểm (gõ tên nơi muốn đến)
      input(
        type="text"
        name="q"
        placeholder="VD: Hạ Long, Sapa, Phú Quốc..."
        value=(query && query.q) || ""
      )

    // Điểm đi
    .inner-group
      .inner-label Điểm đi
      select(name="locationFrom")
        option(value="") -- Chọn điểm đi --
        each item in cityList
          option(value=item.id) #{item.name}

    // Điểm đến
    .inner-group
      .inner-label Điểm đến
      select(name="locationTo")
        option(value="") -- Chọn điểm đến --
        each item in cityList
          option(value=item.name) #{item.name}

    // Ngày khởi hành
    .inner-group
      .inner-label Ngày khởi hành
      input(name="departureDate" type="date")

    // Số chỗ trống tối thiểu
    .inner-group
      .inner-label Số chỗ trống tối thiểu
      input(
        name="minSeats"
        type="number"
        min="0"
        value="0"
        placeholder="Ví dụ: 5"
      )

    // Mức giá
    .inner-group
      .inner-label Mức giá
      select(name="price")
        option(value="") -- Chọn khoảng giá --
        option(value="0-999999") Dưới 1tr
        option(value="1000000-3000000") Từ 1tr đến 3tr
        ...

    // Tags loại hình trải nghiệm (nhiều checkbox)
    .inner-group
      .inner-label Loại hình trải nghiệm
      .inner-checkbox-list
        each tag in allTags
          .inner-checkbox-item
            input(type="checkbox" name="tags" value=tag ...)

    .inner-group
      button.inner-button Áp Dụng
```

Trên trang `/search.pug` và `/tour-list.pug` (category), partial này được `include` ở cột trái.

### 2.2. JS đồng bộ filter với URL + điều hướng

**File:** `public/assets/js/script.js`

```921:995:public/assets/js/script.js
(() => {
  const boxFilter = document.querySelector(".box-filter");
  if (!boxFilter) return;

  const form = document.querySelector("#filter-form");
  const applyBtn = boxFilter.querySelector(".inner-button");
  if (!applyBtn) return;

  const FIELDS = [
    "q",
    "locationFrom",
    "locationTo",
    "departureDate",
    "price",
    "minSeats",
  ];

  const NUM_FIELDS = new Set(["minSeats"]);

  // 1) Prefill từ URL vào các input
  (function prefillFromURL() {
    const url = new URL(window.location.href.split("#")[0]);
    FIELDS.forEach((name) => {
      const el = boxFilter.querySelector(`[name="${name}"]`);
      if (!el) return;
      const v = url.searchParams.get(name);
      if (v !== null) el.value = v;
    });

    // Prefill cho tags (nhiều checkbox)
    const selectedTags = url.searchParams.getAll("tags");
    if (selectedTags && selectedTags.length) {
      const tagCheckboxes = boxFilter.querySelectorAll(
        'input[name="tags"][type="checkbox"]'
      );
      tagCheckboxes.forEach((cb) => {
        cb.checked = selectedTags.includes(cb.value);
      });
    }
  })();

  // 2) Hàm applyFilter: build lại URL mới dựa trên các input hiện tại
  function applyFilter() {
    const url = new URL(window.location.href.split("#")[0]);

    // Xử lý riêng cho tags (nhiều giá trị)
    url.searchParams.delete("tags");
    const tagCheckboxes = boxFilter.querySelectorAll(
      'input[name="tags"][type="checkbox"]:checked'
    );
    tagCheckboxes.forEach((cb) => {
      const val = (cb.value || "").trim();
      if (val) {
        url.searchParams.append("tags", val);
      }
    });

    // Xử lý các field đơn (q, locationFrom, locationTo, ...)
    FIELDS.forEach((name) => {
      const el = boxFilter.querySelector(`[name="${name}"]`);
      let val = (el && el.value != null ? String(el.value) : "").trim();

      if (!val || (NUM_FIELDS.has(name) && Number(val) <= 0)) {
        url.searchParams.delete(name);
      } else {
        url.searchParams.set(name, val);
      }
    });

    // Điều hướng với URL mới (vẫn giữ nguyên path hiện tại: /search hoặc /category/:slug)
    window.location.assign(url.toString());
  }

  // 3) Gắn sự kiện click nút "Áp Dụng"
  applyBtn.addEventListener("click", (e) => {
    e.preventDefault();
    applyFilter();
  });
})();
```

### 2.3. Tóm tắt luồng Box Filter

**Khi trang load:**

1. JS tìm `.box-filter`; nếu không có thì return (code dùng chung nhiều trang).
2. JS đọc `window.location.href` → parse query string.
3. Với mỗi field trong `FIELDS`, nếu URL có tham số tương ứng thì set `el.value = v`.
4. Với `tags`, dùng `url.searchParams.getAll("tags")` → tick lại đúng các checkbox đã chọn.

**Khi user bấm nút “Áp Dụng”:**

1. JS tạo `url = new URL(window.location.href.split("#")[0])` (giữ nguyên path hiện tại).
2. Xóa toàn bộ `tags` khỏi `searchParams`, rồi append lại từng tag đang được check.
3. Với từng field trong `FIELDS`:
   - Nếu rỗng hoặc là số nhưng <= 0 → xóa khỏi query string.
   - Ngược lại → set `url.searchParams.set(name, val)`.
4. Gọi `window.location.assign(url.toString())` → reload trang với query mới.
5. Backend đọc `req.query` (ở `search.controller.js` hoặc `category.controller.js`) và trả về danh sách tour đã được lọc.
6. Lần reload tiếp theo, `prefillFromURL()` lại điền đúng các giá trị filter vào UI.

---

## 3. Backend: route & controller cho `/search`

### 3.1. Route `/search`

**File:** `routes/client/search.route.js`

```1:6:routes/client/search.route.js
const router = require("express").Router();
const searchController = require("../../controllers/client/search.controller");

router.get("/", searchController.list);

module.exports = router;
```

- Khi client điều hướng tới `/search?...`, Express sẽ gọi `searchController.list`.

### 3.2. Controller đọc query và build điều kiện tìm kiếm

**File:** `controllers/client/search.controller.js`

#### a) Tách các tham số từ query string

```51:61:controllers/client/search.controller.js
module.exports.list = async (req, res) => {
  try {
    const {
      q,            // nơi muốn đi? (địa điểm tự do)
      departureDate,
      price,        // "min-max"
      minSeats,     // số chỗ trống tối thiểu
      sort,         // key sort: price_asc | price_desc | rating
      tags,
    } = req.query;

    const sortKey = sort || "rating";
```

- `req.query` chính là phần phía sau dấu `?` mà client đã build ở URL.
- Ví dụ: `/search?q=Ha+Long&price=1000000-3000000&minSeats=4` → `req.query.q = "Ha Long"`, `req.query.price = "1000000-3000000"`, …

#### b) Điều kiện cơ bản

```65:69:controllers/client/search.controller.js
    // Điều kiện chung
    const find = {
      deleted: false,
      status: "active",
    };
```

- Chỉ tìm tour:
  - chưa bị xóa mềm (`deleted: false`),
  - đang active (`status: "active"`).

#### c) Tìm theo keyword `q` (tiêu đề + location)

```17:28:controllers/client/search.controller.js
function nameContainsTokens(q) {
  const raw = String(q || "").trim();
  if (!raw) return null;

  const tokens = raw
    .split(/\s*-\s*|\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (!tokens.length) return null;

  return {
    $and: tokens.map((t) => {
      const regex = new RegExp(escapeRegex(t), "i");
      return {
        $or: [
          { name: regex },
          { "locations.cityName": regex },
          { "locations.cityLabel": regex },
          { "locations.spots": regex },
          { "locations.spotsText": regex },
        ],
      };
    }),
  };
}
```

Áp dụng vào `find`:

```71:74:controllers/client/search.controller.js
    const nameCond = nameContainsTokens(q);
    if (nameCond) Object.assign(find, nameCond);
```

- Ví dụ `q = "Hạ Long"` → tách thành token `["Hạ", "Long"]`, mỗi token tạo một điều kiện regex.
- Điều kiện tổng quát: mỗi token phải xuất hiện **ở ít nhất một trong các trường**:
  - `name` (tiêu đề tour),
  - `locations.cityName` / `locations.cityLabel`,
  - `locations.spots` / `locations.spotsText`.

#### d) Lọc theo ngày khởi hành, số chỗ, giá, tags

```75:90:controllers/client/search.controller.js
    // 2. Ngày khởi hành
    if (departureDate) {
      find.departureDate = new Date(departureDate);
    }

    // 3. Số chỗ trống tối thiểu
    const seats = Number(minSeats) || 0;
    if (seats > 0) {
      find.seatsRemaining = { $gte: seats };
    }

    // 4. Khoảng giá priceNewAdult: "min-max"
    if (price && /^\d+-\d+$/.test(price)) {
      const [priceMin, priceMax] = price.split("-").map(Number);
      find.priceNewAdult = { $gte: priceMin, $lte: priceMax };
    }
```

- `departureDate`: tìm tour có `departureDate` đúng ngày đó.
- `minSeats`: yêu cầu `seatsRemaining >= minSeats`.
- `price`: lọc theo khoảng giá của `priceNewAdult` (giá hiện tại sau khuyến mãi).

```92:100:controllers/client/search.controller.js
    // 5. Lọc theo tags (loại hình trải nghiệm)
    let tagArray = [];
    if (tags) {
      tagArray = Array.isArray(tags) ? tags : [tags];
      tagArray = tagArray.filter((t) => t && typeof t === "string");
    }
    if (tagArray.length > 0) {
      find.tags = { $in: tagArray };
    }
```

- `tags` có thể là 1 string hoặc nhiều (array) → chuẩn hóa thành mảng, lọc rỗng, rồi dùng `$in` để lấy tour có ít nhất một tag trong đó.

#### e) Phân trang và query MongoDB

```102:115:controllers/client/search.controller.js
    const limitItems = 12;
    let page = 1;
    if (req.query.page && parseInt(req.query.page) > 0) {
      page = parseInt(req.query.page);
    }
    const skip = (page - 1) * limitItems;
    const totalRecord = await Tour.countDocuments(find);
    const totalPage = Math.ceil(totalRecord / limitItems);
    const pagination = {
      skip,
      totalRecord,
      totalPage,
    };
```

```117:122:controllers/client/search.controller.js
    const tourList = await Tour.find(find)
      .sort({ position: "asc" })
      .limit(limitItems)
      .skip(skip)
      .lean();
```

- Dựa trên `find` đã build, controller:
  - Đếm tổng số bản ghi (`countDocuments`),
  - Tính số trang,
  - Lấy page hiện tại với `limit` + `skip`.

#### f) Decorate thêm field để hiển thị

```124:142:controllers/client/search.controller.js
    for (const item of tourList) {
      const oldP = Number(item.priceAdult || 0);
      const newP = Number(item.priceNewAdult || 0);
      item.discount = oldP > 0 ? Math.floor(((oldP - newP) / oldP) * 100) : 0;

      if (item.departureDate) {
        item.departureDateFormat = moment(item.departureDate).format(
          "DD/MM/YYYY"
        );
      }

      // fallback seatsRemaining nếu chưa có
      if (typeof item.seatsRemaining === "undefined") {
        const a = Number(item.stockAdult || 0);
        const c = Number(item.stockChildren || 0);
        item.seatsRemaining = a + c;
      }
    }
```

- Tính % giảm giá để hiển thị.
- Format ngày khởi hành.
- Fallback `seatsRemaining` từ `stockAdult + stockChildren` nếu chưa có.

#### g) Gắn thông tin company cho từng tour

```145:163:controllers/client/search.controller.js
    const validCompanyIds = Array.from(
      new Set(
        tourList
          .map((t) => (t && t.companyId ? String(t.companyId) : ""))
          .filter((id) => id && mongoose.Types.ObjectId.isValid(id))
      )
    ).map((id) => new mongoose.Types.ObjectId(id));

    if (validCompanyIds.length) {
      const companies = await Company.find({ _id: { $in: validCompanyIds } })
        .select("name slug logo hotline address")
        .lean();

      const cmap = new Map(companies.map((c) => [String(c._id), c]));

      tourList.forEach((t) => {
        const c = cmap.get(String(t.companyId));
        if (c) t.company = c;
      });
    }
```

- Lấy danh sách company một lần, rồi map vào từng tour để `product-item` có thể hiển thị logo, tên, slug công ty.

#### h) Sắp xếp lại trên mảng theo sortKey

```166:189:controllers/client/search.controller.js
    switch (sortKey) {
      case "price_asc":
        tourList.sort(
          (a, b) =>
            Number(a._priceNewAdult ?? a.priceNewAdult ?? 0) -
            Number(b._priceNewAdult ?? b.priceNewAdult ?? 0)
        );
        break;
      case "price_desc":
        tourList.sort(
          (a, b) =>
            Number(b._priceNewAdult ?? b.priceNewAdult ?? 0) -
            Number(a._priceNewAdult ?? a.priceNewAdult ?? 0)
        );
        break;
      case "rating":
      default:
        tourList.sort(
          (a, b) =>
            (b.ratingAvg || 0) - (a.ratingAvg || 0) ||
            (b.ratingCount || 0) - (a.ratingCount || 0)
        );
        break;
    }
```

- Cho phép người dùng đổi sort trên UI (giá tăng/giảm, đánh giá).

#### i) Render view kết quả

```199:210:controllers/client/search.controller.js
    return res.render("client/pages/search", {
      pageTitle: q ? `Kết quả cho "${q}"` : "Kết quả tìm kiếm",
      tourList,
      pagination,
      sort: sortKey,
      sortHrefs: {
        priceAsc: makeSortHref("price_asc"),
        priceDesc: makeSortHref("price_desc"),
        rating: makeSortHref("rating"),
      },
      query: req.query,
    });
```

- Truyền `tourList` + `pagination` + `sort` + `query` cho view `search.pug`.

---

## 4. Backend: tìm kiếm trong một danh mục cụ thể (`/category/:slug`)

Khi user đang ở trang danh mục `/category/:slug`, box filter vẫn gửi các tham số `q`, `locationFrom`, `locationTo`, `departureDate`, `price`, `minSeats`, `tags` giống như `/search`.  
Nhưng backend sẽ:

- Chỉ tìm trong **danh mục hiện tại + danh mục con**,
- Dùng **Aggregation Pipeline** để tính thêm các field phụ (giá, seats, discount, …).

### 4.1. Route `/category/:slug`

**File:** `routes/client/category.route.js`

```1:6:routes/client/category.route.js
const router = require("express").Router();
const categoryController = require("../../controllers/client/category.controller");

router.get("/:slug", categoryController.list);

module.exports = router;
```

### 4.2. Controller đọc query và build pipeline

**File:** `controllers/client/category.controller.js`

```93:104:controllers/client/category.controller.js
// 4) Query params (filter + sort)
const {
  q,
  locationFrom,
  locationTo,
  departureDate, // yyyy-mm-dd
  price,         // "min-max"
  minSeats,      // số chỗ trống tối thiểu
  tags,
} = req.query;
const sortKey = (req.query.sort || "rating").trim(); // default: rating
```

#### a) Giới hạn trong đúng danh mục + danh mục con

```88:92:controllers/client/category.controller.js
const categoryId = String(categoryDetail._id);
const categoryChild = await categoryHelper.getCategoryChild(categoryId);
const categoryChildId = categoryChild.map((item) => item.id);
```

```105:111:controllers/client/category.controller.js
const matchBase = {
  category: { $in: [categoryId, ...categoryChildId] },
  deleted: false,
  status: "active",
};
```

- Đây là khác biệt lớn so với `/search`: chỉ lấy tour thuộc **cây danh mục** tương ứng.

#### b) Lọc theo keyword, location, date, tags, price, seats

```112:121:controllers/client/category.controller.js
const keywordCond = nameOrLocationContainsTokens(q);
if (keywordCond) Object.assign(matchBase, keywordCond);
if (locationFrom) matchBase.locationFrom = locationFrom;
if (locationTo) matchBase.locationTo = locationTo;

if (departureDate) {
  const start = moment(departureDate, "YYYY-MM-DD").startOf("day").toDate();
  const end = moment(departureDate, "YYYY-MM-DD").endOf("day").toDate();
  matchBase.departureDate = { $gte: start, $lte: end };
}
```

```123:131:controllers/client/category.controller.js
let tagArray = [];
if (tags) {
  tagArray = Array.isArray(tags) ? tags : [tags];
  tagArray = tagArray.filter((t) => t && typeof t === "string");
}
if (tagArray.length > 0) {
  matchBase.tags = { $in: tagArray };
}
```

```133:137:controllers/client/category.controller.js
let priceCond = null;
if (price && /^\d+-\d+$/.test(price)) {
  const [min, max] = price.split("-").map(Number);
  priceCond = { $gte: min, $lte: max };
}
```

#### c) Aggregation Pipeline

```139:161:controllers/client/category.controller.js
const pipeline = [
  { $match: matchBase },
  {
    $addFields: {
      _priceAdult: toNumberExpr("$priceAdult"),
      _priceNewAdult: toNumberExpr("$priceNewAdult"),
      _stockAdult: toNumberExpr("$stockAdult"),
      _stockChildren: toNumberExpr("$stockChildren"),
      _seatsRemaining: toNumberExpr("$seatsRemaining"),
    },
  },
  {
    $addFields: {
      seatsRemainingEff: {
        $cond: [
          { $gt: ["$_seatsRemaining", 0] },
          "$_seatsRemaining",
          { $add: ["$_stockAdult", "$_stockChildren"] },
        ],
      },
    },
  },
];

if (priceCond) {
  pipeline.push({ $match: { _priceNewAdult: priceCond } });
}

const needSeats = Number(minSeats) || 0;
if (needSeats > 0) {
  pipeline.push({ $match: { seatsRemainingEff: { $gte: needSeats } } });
}

pipeline.push({ $sort: { position: 1 } });
```

- Dùng `$addFields` để:
  - ép giá/ghế về kiểu số,
  - tính `seatsRemainingEff` (ưu tiên `seatsRemaining`, fallback từ stock).

Query pipeline:

```175:176:controllers/client/category.controller.js
const tourListRaw = await Tour.aggregate(pipeline);
```

#### d) Decorate dữ liệu thô

```178:205:controllers/client/category.controller.js
let tourList = tourListRaw.map((t) => {
  const oldP = Number(t._priceAdult ?? t.priceAdult ?? 0);
  const newP = Number(t._priceNewAdult ?? t.priceNewAdult ?? 0);
  const discount = oldP > 0 ? Math.floor(((oldP - newP) / oldP) * 100) : 0;

  const departureDateFormat = t.departureDate
    ? moment(t.departureDate).format("DD/MM/YYYY")
    : "";

  const discountFromFormat = t.discountFrom
    ? moment(t.discountFrom).format("DD/MM/YYYY")
    : "";
  const discountToFormat = t.discountTo
    ? moment(t.discountTo).format("DD/MM/YYYY")
    : "";

  return {
    ...t,
    discount,
    departureDateFormat,
    discountFromFormat,
    discountToFormat,
    seatsRemaining:
      typeof t.seatsRemainingEff === "number"
        ? t.seatsRemainingEff
        : Number(t.seatsRemaining || 0),
  };
});
```

- Tính % giảm giá, format ngày, chuẩn hóa `seatsRemaining`.

Các bước sau (rating, gắn company, phân trang, sort) tương tự cách làm ở `search.controller.js`.

---

## 5. Tổng kết full luồng tìm kiếm tour (Frontend + Backend)

### 5.1. Từ trang chủ → `/search`

1. **Frontend (home.pug + script.js)**:
   - Form `form-search` thu `q`, `departureDate`, `price`, `minSeats`.
   - JS build URL `/search?...` và điều hướng.
2. **Backend (search.route.js + search.controller.js)**:
   - Route `/search` gọi `searchController.list`.
   - Controller đọc `req.query`, build object `find` theo:
     - keyword (tiêu đề + location),
     - ngày khởi hành,
     - số chỗ,
     - khoảng giá,
     - tags.
   - Query MongoDB (`Tour.find(find)`), decorate dữ liệu, gắn company, sort, phân trang.
   - Render `views/client/pages/search.pug` với `tourList`.
3. **Frontend (search.pug)**:
   - Hiển thị danh sách tour với `+product-item(item)`.
   - Box Filter bên trái đọc lại query string để prefill filter.

### 5.2. Trên trang `/search` hoặc `/category/:slug`, dùng Box Filter

1. **Frontend (box-filter.pug + script.js)**:
   - Box Filter hiển thị các input filter (q, locationFrom, locationTo, date, price, minSeats, tags).
   - JS đọc query string để prefill khi load.
   - Khi user bấm “Áp Dụng”, JS build lại URL hiện tại (giữ nguyên path) với query mới → reload.
2. **Backend**:
   - Nếu path là `/search` → dùng `search.controller.js`:
     - Không giới hạn danh mục, tìm trong toàn bộ tour active.
   - Nếu path là `/category/:slug` → dùng `category.controller.js`:
     - Tìm danh mục theo `slug`, lấy ID + danh mục con,
     - Dùng Aggregation Pipeline với `$match` giới hạn theo cây danh mục + các filter còn lại.
3. **Frontend**:
   - Trang reload với danh sách tour mới,
   - Box Filter tự động prefill lại từ URL.

Như vậy, toàn bộ luồng tìm kiếm tour là sự kết hợp:

- **Frontend**: thu input, gói vào query string, điều hướng, prefill UI.
- **Backend**: đọc `req.query`, build điều kiện MongoDB/aggregation, query DB, tính toán thêm field (discount, seats, rating, company), trả về view với danh sách tour đã được tìm kiếm/lọc đúng theo yêu cầu.

**File:** `controllers/client/search.controller.js`

Client gửi query string, server xử lý:

```51:61:controllers/client/search.controller.js
module.exports.list = async (req, res) => {
  const { q, departureDate, price, minSeats, sort, tags } = req.query;
  const sortKey = sort || "rating";

  const find = { deleted: false, status: "active" };

  // 1) keyword q (tiêu đề + location)
  const nameCond = nameContainsTokens(q);
  if (nameCond) Object.assign(find, nameCond);

  // 2) departureDate, 3) seatsRemaining >= minSeats,
  // 4) priceNewAdult trong khoảng price, 5) tags...
  // 6) Phân trang, 7) Lấy tourList, 8) Decorate, 9) Gắn company, 10) Sort...
```

Sau đó render view:

```199:210:controllers/client/search.controller.js
return res.render("client/pages/search", {
  pageTitle: q ? `Kết quả cho "${q}"` : "Kết quả tìm kiếm",
  tourList,
  pagination,
  sort: sortKey,
  sortHrefs: { ... },
  query: req.query,
});
```

**View:** `views/client/pages/search.pug`

```4:35:views/client/pages/search.pug
.section-9
  .container
    .inner-wrap
      .inner-left
        include ../partials/box-filter.pug
      .inner-right
        .inner-info
          h2.inner-title #{pageTitle}
        .inner-info-2
          .inner-total-item
            | Tất cả: 
            b #{pagination.totalRecord} Tour
        .inner-product-list
          if (tourList.length > 0)
            each item in tourList
              +product-item(item)
          else
            div Không tìm thấy bản ghi nào.
```

---

## 4. Tổng kết luồng tìm kiếm tour (client-side)

**Luồng 1 – Từ trang chủ:**

1. User nhập bộ lọc trong form có `form-search`.
2. JS đọc các field, build URL `/search?...`.
3. Trình duyệt chuyển hướng sang `/search` với query string.
4. Backend trả về danh sách tour, view render danh sách.

**Luồng 2 – Dùng Box Filter trên `/search` hoặc `/category/:slug`:**

1. Box Filter đọc lại query string để prefill UI.
2. User chỉnh sửa filter, click “Áp Dụng”.
3. JS build lại URL hiện tại với query mới.
4. Trang reload với kết quả tour đã được backend lọc theo tham số mới.

→ Phía **client** chịu trách nhiệm:

- Thu thập input từ form/box filter.
- Chuyển input → query string (URL).
- Điều hướng đến đúng route (`/search` hoặc `/category/:slug`).

Phía **server** chịu trách nhiệm:

- Đọc query string (`req.query`).
- Truy vấn MongoDB theo các điều kiện đó.
- Trả về view chứa danh sách tour đã được tìm kiếm/lọc.


