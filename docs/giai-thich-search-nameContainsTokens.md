## Mục đích của đoạn code `escapeRegex` và `nameContainsTokens`

Đoạn code trong `controllers/client/search.controller.js`:

```7:10:controllers/client/search.controller.js
/* ------------------- helpers giống category/company ------------------- */
function escapeRegex(str = "") {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
```

```17:49:controllers/client/search.controller.js
function nameContainsTokens(q) {
  const raw = String(q || "").trim();
  if (!raw) return null;

  const tokens = raw
    .split(/\s*-\s*|\s+/) // tách theo "-" và khoảng trắng
    .map((t) => t.trim())
    .filter(Boolean);

  if (!tokens.length) return null;

  return {
    $and: tokens.map((t) => {
      const regex = new RegExp(escapeRegex(t), "i");
      return {
        $or: [
          // 1) Tiêu đề tour
          { name: regex },

          // 2) Tên tỉnh/thành trong locations (tuỳ bạn đang lưu)
          { "locations.cityName": regex },
          { "locations.cityLabel": regex },

          // 3) Các điểm nổi tiếng trong từng tỉnh/thành
          //    - nếu lưu dạng array: spots: ["Lăng Chủ tịch Hồ Chí Minh", ...]
          { "locations.spots": regex },
          //    - nếu lưu dạng chuỗi nhiều dòng: spotsText: "Lăng...\nVăn Miếu..."
          { "locations.spotsText": regex },
        ],
      };
    }),
  };
}
```

Được dùng để xây dựng **điều kiện tìm kiếm theo từ khóa tự do** (keyword `q`) cho trang `/search`:

- User gõ chuỗi bất kỳ (ví dụ: `"Hạ Long - Cát Bà"`).
- Hàm tách chuỗi đó thành các **token** nhỏ: `"Hạ"`, `"Long"`, `"Cát"`, `"Bà"`.
- Với **mỗi token**, tạo một biểu thức tìm kiếm (regex) và yêu cầu:
  - token đó phải xuất hiện trong **tiêu đề tour** hoặc
  - trong **tên tỉnh/thành** hoặc
  - trong **các điểm nổi tiếng** (spots/spotsText).
- Sau đó kết hợp các điều kiện này lại bằng `$and` và `$or` để đưa vào MongoDB query.

Nói ngắn gọn: đoạn code này giúp user **tìm tour theo nhiều từ khóa**, kiểm tra đồng thời trong tên tour và địa điểm.

---

## 1. Hàm `escapeRegex(str)` – Bảo vệ chuỗi khỏi ký tự đặc biệt trong regex

### 1.1. Vấn đề nếu không escape

Khi tạo một `RegExp` từ input người dùng, ví dụ:

```js
const regex = new RegExp(q, "i");
```

Nếu `q` chứa ký tự đặc biệt của regex như `.`, `*`, `?`, `+`, `[`, `]`, `(`, `)`, `\`, `^`, `$`, `{`, `}`, `|`… thì:

- Regex sẽ hiểu đó là **cú pháp đặc biệt**, không phải chữ bình thường.
- Có thể:
  - Tìm sai kết quả.
  - Hoặc nặng hơn là gây lỗi regex (invalid pattern).

Ví dụ:

- User gõ: `C++`
  - Nếu không escape, regex pattern là `"C++"` → trong regex, `+` nghĩa là “lặp lại 1 hoặc nhiều lần”, nên `"C++"` bị hiểu khác, thậm chí lỗi.

### 1.2. Cách `escapeRegex` hoạt động

```js
function escapeRegex(str = "") {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
```

Giải thích:

- `String(str)`:
  - Đảm bảo `str` là chuỗi (phòng khi truyền vào số, null, v.v.).

- `.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")`:
  - Regex `/[.*+?^${}()|[\]\\]/g` tìm **mọi ký tự đặc biệt** trong chuỗi:
    - `. * + ? ^ $ { } ( ) | [ ] \`
  - `"$&"` trong replace nghĩa là **chính ký tự match được**.
  - `"\\$&"` nghĩa là thêm một dấu `\` đằng trước ký tự đó.

Ví dụ:

| Input           | Sau `escapeRegex`          |
|----------------|----------------------------|
| `"C++"`        | `"C\+\+"`                  |
| `"Hà Nội (HN)"`| `"Hà Nội \(HN\)"`          |
| `"A.B*C?"`     | `"A\.B\*C\?"`              |

→ Đảm bảo khi đưa vào `new RegExp(escapeRegex(t), "i")` thì pattern luôn **an toàn và chỉ tìm đúng chuỗi literal**, không bị hiểu nhầm là cú pháp regex.

---

## 2. Hàm `nameContainsTokens(q)` – Tách keyword và build điều kiện MongoDB

Mục tiêu: từ một chuỗi keyword (người dùng gõ), tạo ra **object điều kiện** để dùng với MongoDB, ví dụ:

```js
const cond = nameContainsTokens("Hạ Long");
// cond sẽ tương đương:
// {
//   $and: [
//     { $or: [ { name: /Hạ/i }, { "locations.cityName": /Hạ/i }, ... ] },
//     { $or: [ { name: /Long/i }, { "locations.cityName": /Long/i }, ... ] }
//   ]
// }
```

### 2.1. Bước 1: Làm sạch input

```js
const raw = String(q || "").trim();
if (!raw) return null;
```

- `String(q || "")`: nếu `q` là `null/undefined`, dùng chuỗi rỗng, sau đó ép kiểu về string.
- `.trim()`: bỏ khoảng trắng đầu/cuối.
- Nếu sau khi trim mà rỗng (`""`) → trả về `null`:
  - Nghĩa là: **không có điều kiện keyword nào cả**.

### 2.2. Bước 2: Tách chuỗi thành các token

```js
const tokens = raw
  .split(/\s*-\s*|\s+/) // tách theo "-" và khoảng trắng
  .map((t) => t.trim())
  .filter(Boolean);

if (!tokens.length) return null;
```

- `.split(/\s*-\s*|\s+/)`:
  - Regex này chia chuỗi theo:
    - `\s*-\s*`: dấu gạch ngang `-` có thể có hoặc không có khoảng trắng hai bên,
    - hoặc `\s+`: một hoặc nhiều khoảng trắng.
- `.map((t) => t.trim())`:
  - Trim lại từng đoạn (phòng khi có dư khoảng trắng).
- `.filter(Boolean)`:
  - Loại bỏ token rỗng (`""`).

Ví dụ:

1. `q = "Hạ Long"`:
   - `split(/\s*-\s*|\s+/)` → `["Hạ", "Long"]`
   - tokens = `["Hạ", "Long"]`.

2. `q = "Hà Nội - Hạ Long"`:
   - `split` theo `"-"` hoặc khoảng trắng → `["Hà", "Nội", "Hạ", "Long"]`.

3. `q = "   "` → `raw = ""` → trả về `null`.

### 2.3. Bước 3: Xây dựng object điều kiện `$and` + `$or`

```js
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
```

#### 2.3.1. Tạo regex cho từng token

```js
const regex = new RegExp(escapeRegex(t), "i");
```

- Dùng `escapeRegex` để token an toàn (tránh lỗi regex).
- `"i"`: flag **case-insensitive** → không phân biệt hoa/thường (`"Hạ"` = `"hạ"`).

#### 2.3.2. `$or` – token có thể nằm ở nhiều trường khác nhau

```js
{
  $or: [
    { name: regex },
    { "locations.cityName": regex },
    { "locations.cityLabel": regex },
    { "locations.spots": regex },
    { "locations.spotsText": regex },
  ],
}
```

Ý nghĩa:

- **Chỉ cần** một trong các field sau **match regex**:
  - `name`: tiêu đề tour,
  - `locations.cityName`: tên tỉnh/thành trong cấu trúc `locations`,
  - `locations.cityLabel`: label hiển thị cho tỉnh/thành,
  - `locations.spots`: mảng các điểm tham quan (array of string),
  - `locations.spotsText`: chuỗi nhiều dòng chứa các điểm tham quan.

Ví dụ: với token `"Hạ"`:

- Tour được chấp nhận nếu:
  - `name` chứa `"Hạ"`, HOẶC
  - `locations.cityName` chứa `"Hạ"`, HOẶC
  - `locations.spots` có phần tử chứa `"Hạ"`, ...

#### 2.3.3. `$and` – mọi token đều phải match

```js
{
  $and: tokens.map((t) => ({ $or: [ ... ] }))
}
```

Với `tokens = ["Hạ", "Long"]`:

- Kết quả:

```js
{
  $and: [
    {
      $or: [
        { name: /Hạ/i },
        { "locations.cityName": /Hạ/i },
        ...
      ]
    },
    {
      $or: [
        { name: /Long/i },
        { "locations.cityName": /Long/i },
        ...
      ]
    }
  ]
}
```

Giải thích:

- `$and` yêu cầu **tất cả** điều kiện con đều đúng.
- Mỗi điều kiện con là một `$or` cho 1 token.
- Nên:
  - Tour chỉ được chọn nếu:
    - Vừa match `"Hạ"` ở ít nhất một trường (name/locations…),
    - **VÀ** match `"Long"` ở ít nhất một trường (có thể cùng field hoặc field khác).

**Kết quả**: Tìm những tour mà nội dung (tiêu đề/địa điểm/điểm tham quan) **chứa tất cả các từ khóa người dùng gõ**, không phân biệt hoa/thường, và không cần đúng thứ tự tuyệt đối.

---

## 3. Cách `nameContainsTokens` được sử dụng trong controller

Trong `search.controller.js`, hàm này được dùng để bổ sung điều kiện vào object `find`:

```71:74:controllers/client/search.controller.js
// 1. Tìm theo tiêu đề tour (name)
const nameCond = nameContainsTokens(q);
if (nameCond) Object.assign(find, nameCond);
```

- Nếu user **không nhập** `q` → `nameContainsTokens(q)` trả về `null` → **không thêm điều kiện keyword**.
- Nếu user có nhập `q` → `nameCond` là object `$and/$or` như trên → được merge vào `find`.

Ví dụ tổng thể:

```js
// Giả sử:
q = "Hạ Long";
minSeats = 4;

// Sau các bước xử lý:
find = {
  deleted: false,
  status: "active",
  $and: [
    { $or: [ { name: /Hạ/i }, { "locations.cityName": /Hạ/i }, ... ] },
    { $or: [ { name: /Long/i }, { "locations.cityName": /Long/i }, ... ] },
  ],
  seatsRemaining: { $gte: 4 },
  // ... thêm điều kiện khác (price, tags, ...)
};
```

Sau đó `find` được dùng trong:

```js
const tourList = await Tour.find(find).sort(...).limit(...).skip(...).lean();
```

---

## 4. Tóm tắt dễ nhớ

- **`escapeRegex(str)`**:
  - Dùng để **escape** tất cả ký tự đặc biệt trong một chuỗi,
  - Đảm bảo chuỗi đó có thể đưa vào `new RegExp()` một cách an toàn,
  - Tránh lỗi regex và tránh bị hiểu nhầm là cú pháp regex.

- **`nameContainsTokens(q)`**:
  - Nhận chuỗi keyword người dùng nhập (ví dụ: `"Hà Nội Hạ Long"`).
  - Tách thành các token theo dấu `-` và khoảng trắng.
  - Với **mỗi token**, tạo một điều kiện `$or` kiểm tra token đó có xuất hiện trong:
    - tiêu đề tour (`name`),
    - tên tỉnh/thành (`locations.cityName`, `locations.cityLabel`),
    - danh sách điểm tham quan (`locations.spots`, `locations.spotsText`).
  - Gom tất cả `$or` lại thành một `$and` → **mọi token đều phải match ít nhất 1 field**.
  - Trả về object điều kiện để gắn vào `find` trong MongoDB query.

Nhờ 2 helper này, ô “Địa điểm (gõ tên nơi muốn đến)” trong tìm kiếm tour trở nên:

- Linh hoạt: gõ tự do nhiều từ khóa, không cần đúng thứ tự 100%.
- Mạnh: cùng lúc quét cả tiêu đề tour và các trường địa điểm liên quan.
- An toàn: không bị vỡ regex khi người dùng gõ ký tự đặc biệt.


