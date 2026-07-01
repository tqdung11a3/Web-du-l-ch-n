# Hướng dẫn cài đặt hệ thống

Tài liệu này mô tả các bước cài đặt và chạy hệ thống **Web du lịch & khách sạn Asmadeus** trên máy phát triển (local) hoặc môi trường triển khai.

---

## 1. Tổng quan

Hệ thống là ứng dụng web full-stack xây dựng trên:

| Thành phần | Công nghệ |
|---|---|
| Backend | Node.js, Express 5 |
| Cơ sở dữ liệu | MongoDB (Mongoose) |
| Giao diện | Pug template engine |
| Xác thực | JWT, bcrypt |
| Lưu trữ ảnh | Cloudinary |
| Gửi email | Nodemailer (Gmail SMTP) |
| Thanh toán | VNPay |
| Tích hợp du lịch | Amadeus API |

---

## 2. Yêu cầu hệ thống

Trước khi cài đặt, máy cần có:

- **Node.js** phiên bản **18 trở lên** (khuyến nghị LTS mới nhất)
- **npm** (đi kèm Node.js) hoặc **yarn**
- **MongoDB**:
  - MongoDB Atlas (cloud), hoặc
  - MongoDB Community cài local (`mongodb://localhost:27017/...`)
- **Git** (nếu clone từ repository)

Các dịch vụ bên ngoài (tùy chọn theo chức năng cần dùng):

| Dịch vụ | Mục đích |
|---|---|
| Cloudinary | Upload và lưu trữ ảnh tour, khách sạn, avatar |
| Gmail (App Password) | Gửi email xác nhận đơn, thông báo |
| VNPay Sandbox | Thanh toán trực tuyến đặt tour / đặt phòng |
| Amadeus for Developers | Đồng bộ dữ liệu tour, khách sạn từ Amadeus |

---

## 3. Lấy mã nguồn

### Cách 1: Clone từ Git

```bash
git clone <URL-repository>
cd Web-du-lich-asmadeus-hotel
```

### Cách 2: Giải nén file nén

Giải nén và mở thư mục dự án `Web-du-lich-asmadeus-hotel`.

---

## 4. Cài đặt thư viện phụ thuộc

Trong thư mục gốc dự án, chạy:

```bash
npm install
```

Lệnh này cài đặt toàn bộ package trong `package.json` (Express, Mongoose, Pug, Amadeus SDK, v.v.).

---

## 5. Cấu hình biến môi trường

### 5.1. Tạo file `.env`

Sao chép file mẫu:

```bash
cp .env.example .env
```

Trên Windows (PowerShell):

```powershell
Copy-Item .env.example .env
```

### 5.2. Khai báo các biến môi trường

Mở file `.env` và cập nhật các giá trị phù hợp:

```env
# --- Bắt buộc ---
DATABASE="mongodb+srv://<user>:<password>@<cluster>/<ten-database>?retryWrites=true&w=majority"
JWT_SECRET="chuoi-bi-mat-ngau-nhien-manh"
PORT=5000
NODE_ENV=development

# --- Website ---
WEBSITE_DOMAIN="http://localhost:5000"
CLIENT_BASE_URL="http://localhost:5000"

# --- Email (Gmail SMTP) ---
GMAIL_USER="your-email@gmail.com"
GMAIL_PASS="xxxx xxxx xxxx xxxx"

# --- Cloudinary (upload ảnh) ---
CLOUDINARY_NAME="your-cloud-name"
CLOUDINARY_API_KEY="your-api-key"
CLOUDINARY_API_SECRET="your-api-secret"

# --- VNPay (thanh toán) ---
VNPAY_TMNCODE="your-tmn-code"
VNPAY_SECRET="your-secret-key"
VNPAY_URL="https://sandbox.vnpayment.vn/paymentv2/vpcpay.html"

# --- Amadeus API ---
AMADEUS_CLIENT_ID="your-client-id"
AMADEUS_CLIENT_SECRET="your-client-secret"
```

#### Giải thích nhanh

| Biến | Bắt buộc | Mô tả |
|---|---|---|
| `DATABASE` | Có | Chuỗi kết nối MongoDB |
| `JWT_SECRET` | Có | Khóa bí mật ký JWT cho đăng nhập admin/client |
| `PORT` | Không | Cổng chạy server (mặc định `5000`) |
| `NODE_ENV` | Không | `development` hoặc `production` |
| `WEBSITE_DOMAIN` | Có (nếu dùng VNPay) | URL gốc website, dùng làm `returnUrl` callback VNPay |
| `GMAIL_USER`, `GMAIL_PASS` | Không* | Gửi email; `GMAIL_PASS` là **Mật khẩu ứng dụng** Gmail |
| `CLOUDINARY_*` | Không* | Upload ảnh qua Cloudinary |
| `VNPAY_*` | Không* | Cổng thanh toán VNPay |
| `AMADEUS_*` | Không* | Đồng bộ dữ liệu từ Amadeus |

\* Bắt buộc nếu bạn cần sử dụng chức năng tương ứng.

> **Lưu ý bảo mật:** Không commit file `.env` lên Git. File này chứa thông tin nhạy cảm.

### 5.3. Cấu hình Gmail (nếu dùng gửi mail)

1. Bật xác minh 2 bước cho tài khoản Google.
2. Tạo **Mật khẩu ứng dụng** tại [Google Account → Security → App passwords](https://myaccount.google.com/apppasswords).
3. Điền `GMAIL_USER` và `GMAIL_PASS` vào file `.env`.

### 5.4. Cấu hình MongoDB

**MongoDB Atlas:**

1. Tạo cluster miễn phí tại [mongodb.com/atlas](https://www.mongodb.com/atlas).
2. Tạo database user và whitelist IP (`0.0.0.0/0` cho dev).
3. Copy connection string và thay `<password>`, `<dbname>` vào `DATABASE`.

**MongoDB local:**

```env
DATABASE="mongodb://127.0.0.1:27017/asmadeus-hotel"
```

---

## 6. Khởi tạo dữ liệu ban đầu

### 6.1. Tạo tài khoản Super Admin

Sau khi MongoDB đã kết nối được, chạy:

```bash
npm run seed:super-admin
```

Script tạo tài khoản quản trị cấp cao nhất:

| Thông tin | Giá trị mặc định |
|---|---|
| Email | `superadmin@example.com` |
| Mật khẩu | `SuperAdmin@123` |
| URL đăng nhập | `http://localhost:5000/admin/account/login` |

> Đổi mật khẩu ngay sau lần đăng nhập đầu tiên.

Nếu Super Admin đã tồn tại, script sẽ báo và không tạo trùng.

### 6.2. Import dữ liệu địa danh (tùy chọn)

Import danh sách quốc gia và thành phố Châu Âu (phục vụ quản lý tour):

```bash
node scripts/import-european-countries-cities.js
```

### 6.3. Đồng bộ dữ liệu Amadeus (tùy chọn)

Cần cấu hình `AMADEUS_CLIENT_ID` và `AMADEUS_CLIENT_SECRET`:

```bash
# Đồng bộ hoạt động du lịch
npm run sync:amadeus

# Import hoạt động Amadeus thành tour
npm run import:amadeus-tours

# Đồng bộ khách sạn từ Amadeus
npm run sync:amadeus-hotels
```

---

## 7. Chạy hệ thống

### 7.1. Môi trường phát triển (có tự reload)

```bash
npm run dev
```

### 7.2. Môi trường production / chạy thường

```bash
npm start
```

Khi khởi động thành công, console hiển thị:

```
Kết nối CSDL thành công!
Website đang chạy ở cổng 5000
```

Các tác vụ nền tự chạy kèm server:

- Nhắc nhở tour sắp khởi hành
- Dọn đơn tour tạm hết hạn
- Dọn đặt phòng tạm hết hạn

---

## 8. Truy cập hệ thống

| Khu vực | URL mặc định |
|---|---|
| Trang khách (client) | `http://localhost:5000/` |
| Trang quản trị (admin) | `http://localhost:5000/admin` |
| Đăng nhập admin | `http://localhost:5000/admin/account/login` |

Đường dẫn admin được cấu hình trong `config/variable.config.js` (`pathAdmin = "admin"`).

---

## 9. Các lệnh npm hỗ trợ

| Lệnh | Mô tả |
|---|---|
| `npm start` | Chạy server production |
| `npm run dev` | Chạy server với nodemon (tự reload khi sửa code) |
| `npm run seed:super-admin` | Tạo tài khoản Super Admin |
| `npm run sync:amadeus` | Đồng bộ hoạt động Amadeus |
| `npm run import:amadeus-tours` | Import tour từ Amadeus |
| `npm run sync:amadeus-hotels` | Đồng bộ khách sạn từ Amadeus |
| `npm run fix:category-created-by` | Sửa dữ liệu `createdBy` của danh mục |

---

## 10. Cấu trúc thư mục chính

```
Web-du-lich-asmadeus-hotel/
├── config/           # Cấu hình database, biến hệ thống
├── controllers/      # Xử lý logic admin & client
├── helpers/          # Tiện ích (mail, cloudinary, ...)
├── middlewares/      # Middleware xác thực, phân quyền
├── models/           # Mongoose schema / collections
├── public/           # File tĩnh (CSS, JS, ảnh)
├── routes/           # Định tuyến API & trang
├── scripts/          # Script seed, đồng bộ, dọn dữ liệu
├── views/            # Template Pug
├── index.js          # Entry point
├── package.json
└── .env              # Biến môi trường (tự tạo, không commit)
```

---

## 11. Xử lý sự cố thường gặp

### Không kết nối được MongoDB

- Kiểm tra `DATABASE` trong `.env`.
- Với Atlas: kiểm tra whitelist IP và username/password.
- Với local: đảm bảo dịch vụ MongoDB đang chạy.

### Lỗi `JWT_SECRET` / đăng nhập không giữ phiên

- Đặt `JWT_SECRET` trong `.env` và khởi động lại server.
- Xóa cookie trình duyệt rồi đăng nhập lại.

### Upload ảnh thất bại

- Kiểm tra `CLOUDINARY_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`.
- Xác nhận tài khoản Cloudinary còn quota.

### Gửi email thất bại

- Dùng **Mật khẩu ứng dụng**, không dùng mật khẩu đăng nhập Gmail thông thường.
- Kiểm tra `GMAIL_USER` và `GMAIL_PASS`.

### VNPay redirect lỗi hoặc callback sai

- `WEBSITE_DOMAIN` phải trùng URL bạn truy cập (ví dụ `http://localhost:5000`).
- Kiểm tra `VNPAY_TMNCODE`, `VNPAY_SECRET`, `VNPAY_URL` (sandbox/production).

### Cổng 5000 đã được sử dụng

Đổi cổng trong `.env`:

```env
PORT=3000
```

---

## 12. Triển khai production (gợi ý)

1. Đặt `NODE_ENV=production`.
2. Dùng `JWT_SECRET` mạnh, không dùng giá trị mặc định.
3. Cấu hình `WEBSITE_DOMAIN` bằng domain HTTPS thật.
4. Dùng MongoDB Atlas hoặc cluster MongoDB có backup.
5. Chạy bằng process manager (PM2, systemd, Docker, v.v.):

```bash
npm start
```

Ví dụ với PM2:

```bash
npm install -g pm2
pm2 start index.js --name asmadeus-hotel
pm2 save
```

---

## 13. Liên hệ / hỗ trợ

Khi gặp lỗi trong quá trình cài đặt, kiểm tra:

1. Log console khi chạy `npm run dev` hoặc `npm start`.
2. File `.env` đã khai báo đủ biến bắt buộc.
3. Các tài liệu nghiệp vụ bổ sung trong thư mục `docs/`.
