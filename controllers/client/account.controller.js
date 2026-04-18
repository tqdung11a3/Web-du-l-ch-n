// controllers/client/account.controller.js
const AccountUser = require("../../models/account-user.model");
const Order = require("../../models/order.model");
const City = require("../../models/city.model");
const HotelBooking = require("../../models/hotel-booking.model");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const moment = require("moment");

module.exports.login = async (req, res) => {
  res.render("client/pages/login", {
    pageTitle: "Đăng nhập",
  });
};

module.exports.loginPost = async (req, res) => {
  const { email, password } = req.body;

  const existAccount = await AccountUser.findOne({ email });

  if (!existAccount) {
    return res.json({
      code: "error",
      message: "Email không tồn tại trong hệ thống!",
    });
  }

  const isPasswordValid = await bcrypt.compare(password, existAccount.password);

  if (!isPasswordValid) {
    return res.json({
      code: "error",
      message: "Mật khẩu không đúng!",
    });
  }

  const token = jwt.sign(
    {
      id: existAccount.id,
      email: existAccount.email,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: "1d",
    }
  );

  res.cookie("client_token", token, {
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: "lax", // quan trọng cho luồng quay về từ VNPay
    secure: process.env.NODE_ENV === "production",
  });

  return res.json({
    code: "success",
    message: "Đăng nhập thành công!",
  });
};

module.exports.register = async (req, res) => {
  res.render("client/pages/register", {
    pageTitle: "Đăng ký",
  });
};

module.exports.registerPost = async (req, res) => {
  const existAccount = await AccountUser.findOne({
    email: req.body.email,
  });

  if (existAccount) {
    return res.json({
      code: "error",
      message: "Email đã tồn tại trong hệ thống!",
    });
  }

  // Mã hóa mật khẩu
  const salt = await bcrypt.genSalt(10);
  req.body.password = await bcrypt.hash(req.body.password, salt);

  const newAccount = new AccountUser(req.body);
  await newAccount.save();

  return res.json({
    code: "success",
    message: "Đăng ký tài khoản thành công!",
  });
};

// ===== Helpers tính tiền em bé theo bậc (snapshot trong item) =====
function babyUnitAt(idx, mode, rules, priceAdult, priceChild, priceBabyFixed) {
  if (mode !== "tiered" || !Array.isArray(rules) || !rules.length) {
    return Number(priceBabyFixed || 0);
  }
  const r = rules.find((x) => {
    const from = Number(x.from);
    const to = x.to === "inf" ? Infinity : Number(x.to);
    return Number.isFinite(from) && idx >= from && idx <= to;
  });
  if (!r) return 0;
  const base =
    r.ref === "adult" ? Number(priceAdult || 0) : Number(priceChild || 0);
  const pct = Number(r.percent || 0);
  return Math.round((base * pct) / 100);
}

function babyTotalQty(qty, mode, rules, pa, pc, pb) {
  let s = 0;
  qty = Number(qty || 0);
  for (let i = 1; i <= qty; i++) {
    s += babyUnitAt(i, mode, rules, pa, pc, pb);
  }
  return s;
}

module.exports.profile = async (req, res) => {
  const me = req.account;
  let totalTours = 0;

  // Tab đang chọn
  const tab = (req.query.tab || "info").toLowerCase();
  const now = moment().startOf("day");

  let upcoming = [];
  let history = [];
  let hotelBookings = [];

  if (me && me._id) {
    // 1) Lấy tất cả order của user
    const orders = await Order.find({ userId: me._id, deleted: false })
      .sort({ createdAt: -1 })
      .lean();

    // 2) Gom tất cả cityId (ưu tiên departureCity, fallback locationFrom cho đơn cũ)
    const cityIdSet = new Set();
    for (const o of orders) {
      for (const it of o.items || []) {
        const cid = it.departureCity || it.locationFrom;
        if (cid) cityIdSet.add(String(cid));
      }
    }

    let cityMap = {};
    if (cityIdSet.size) {
      const cities = await City.find({
        _id: { $in: Array.from(cityIdSet) },
      })
        .select("_id name")
        .lean();
      cityMap = Object.fromEntries(cities.map((c) => [String(c._id), c.name]));
    }

    // 3) Lấy company slugs cho các tour
    const tourSlugs = new Set();
    for (const o of orders) {
      for (const it of o.items || []) {
        if (it.slug) tourSlugs.add(it.slug);
      }
    }
    
    const Company = require("../../models/company.model");
    const Tour = require("../../models/tour.model");
    let companySlugMap = {};
    if (tourSlugs.size > 0) {
      const tours = await Tour.find({ slug: { $in: Array.from(tourSlugs) } })
        .select("slug companyId")
        .lean();
      const companyIds = [...new Set(tours.map(t => t.companyId).filter(Boolean))];
      if (companyIds.length > 0) {
        const companies = await Company.find({ _id: { $in: companyIds } })
          .select("_id slug")
          .lean();
        const companyMap = Object.fromEntries(
          companies.map(c => [String(c._id), c.slug])
        );
        companySlugMap = Object.fromEntries(
          tours.map(t => [t.slug, companyMap[String(t.companyId)] || null])
        );
      }
    }

    // 4) Trải item trong mỗi order
    const flat = [];
    for (const o of orders) {
      for (const it of o.items || []) {
        // ================== NGÀY KHỞI HÀNH ==================
        // Ưu tiên ngày mà khách đã chọn khi đặt (departureDateDisplay - dạng DD/MM/YYYY),
        // nếu không có thì fallback về departureDate (Date gốc của tour)
        let dep = null;
        if (it.departureDateDisplay && String(it.departureDateDisplay).trim()) {
          // Parse theo định dạng DD/MM/YYYY
          dep = moment(String(it.departureDateDisplay).trim(), "DD/MM/YYYY");
          if (!dep.isValid()) {
            dep = null;
          }
        }
        if (!dep && it.departureDate) {
          dep = moment(it.departureDate);
        }

        // City name: ưu tiên departureCity, fallback đơn cũ locationFrom
        const cityId = it.departureCity || it.locationFrom || null;
        const departureCityName = cityId ? cityMap[String(cityId)] || "" : "";

        // Tính tiền hiển thị theo snapshot
        const pa = Number(it.priceNewAdult || 0);
        const pc = Number(it.priceNewChildren || 0);
        const pb = Number(it.priceNewBaby || 0);
        const mode = it.babyPricingMode || "fixed";
        const rules = Array.isArray(it.babyPricingRules)
          ? it.babyPricingRules
          : [];

        const moneyAdult = Number(it.quantityAdult || 0) * pa;
        const moneyChild = Number(it.quantityChildren || 0) * pc;
        const moneyBaby = babyTotalQty(
          Number(it.quantityBaby || 0),
          mode,
          rules,
          pa,
          pc,
          pb
        );
        const extraRoomCost = Number(it.extraRoomCost || 0);
        const lineTotal = moneyAdult + moneyChild + moneyBaby + extraRoomCost;

        flat.push({
          orderCode: o.code,
          paymentStatus: o.paymentStatus,
          orderStatus: o.status,
          name: it.name,
          slug: it.slug,
          avatar: it.avatar,
          companySlug: it.slug ? (companySlugMap[it.slug] || null) : null,

          // dùng field mới cho rõ nghĩa
          departureCityName,
          // alias cho template cũ nếu đang hiển thị locationFrom
          locationFrom: departureCityName,

          departureDate: dep ? dep.toDate() : null,
          departureDateFormat: dep ? dep.format("DD/MM/YYYY") : "",
          qtyA: it.quantityAdult || 0,
          qtyC: it.quantityChildren || 0,
          qtyB: it.quantityBaby || 0,
          total: lineTotal,
          extraRoomCost,
          roomSelections: Array.isArray(it.roomSelections) ? it.roomSelections : [],
          createdAt: o.createdAt,
        });
      }
    }

    totalTours = flat.length;

    // 4) Phân loại upcoming / history
    for (const r of flat) {
      const isCanceled = r.orderStatus === "canceled";

      if (!r.departureDate) {
        // nếu không có ngày, cho vào history để tránh kẹt trạng thái
        history.push(r);
      } else {
        const depDate = moment(r.departureDate).startOf("day");
        const isUpcoming = depDate.isAfter(now); // Ngày khởi hành > hôm nay (tương lai)
        
        // Chuyến đi sắp tới: ngày khởi hành > thời gian hiện tại (và không bị hủy)
        if (!isCanceled && isUpcoming) {
          upcoming.push(r);
        } 
        // Lịch sử: đã khởi hành (ngày khởi hành <= hôm nay) hoặc bị hủy
        else {
          history.push(r);
        }
      }
    }

    // 5) Lấy lịch sử đặt phòng khách sạn
    const rawBookings = await HotelBooking.find({ 
      userId: me._id,
      deleted: { $ne: true }
    })
      .sort({ createdAt: -1 })
      .lean();

    // Group bookings theo base code (HB123, HB123-1, HB123-2 -> gộp thành 1 đơn)
    const bookingGroups = {};
    rawBookings.forEach(booking => {
      // Extract base code (loại bỏ -1, -2, -3 nếu có)
      const baseCode = booking.code.replace(/-\d+$/, '');
      if (!bookingGroups[baseCode]) {
        bookingGroups[baseCode] = [];
      }
      bookingGroups[baseCode].push(booking);
    });

    // Format dữ liệu hotel bookings (mỗi group = 1 đơn)
    for (const [baseCode, group] of Object.entries(bookingGroups)) {
      const firstBooking = group[0];
      const checkInDate = firstBooking.checkIn ? moment(firstBooking.checkIn).format("DD/MM/YYYY") : "—";
      const checkOutDate = firstBooking.checkOut ? moment(firstBooking.checkOut).format("DD/MM/YYYY") : "—";
      const nights = firstBooking.totalNights || 0;
      
      // Tính tổng rooms, adults, children từ TẤT CẢ bookings trong group
      const totalRooms = group.reduce((sum, b) => sum + (b.rooms || 1), 0);
      const totalAdults = group.reduce((sum, b) => sum + (b.adults || 1), 0);
      const totalChildren = group.reduce((sum, b) => sum + (b.children || 0), 0);
      const totalAmount = group.reduce((sum, b) => sum + (b.totalAmount || 0), 0);
      const orderTotal = firstBooking.orderTotal || totalAmount;
      
      hotelBookings.push({
        code: baseCode, // Dùng base code (không có suffix)
        hotelName: firstBooking.hotel?.name || "Khách sạn không xác định",
        hotelThumbnail: firstBooking.hotel?.thumbnail || "",
        hotelAddress: firstBooking.hotel?.address || "",
        checkInDate,
        checkOutDate,
        nights,
        rooms: totalRooms,
        adults: totalAdults,
        children: totalChildren,
        totalAmount: orderTotal,
        paymentStatus: firstBooking.paymentStatus,
        paymentMethod: firstBooking.paymentMethod,
        status: firstBooking.status,
        createdAt: firstBooking.createdAt,
      });
    }
  }

  res.render("client/pages/profile", {
    pageTitle: "Tài khoản của bạn",
    user: { ...me, totalTours },
    tab, // để pug biết tab nào đang active
    upcoming,
    history,
    hotelBookings,
  });
};

module.exports.profilePatch = async (req, res) => {
  try {
    const id = req.account?._id || req.account?.id;

    if (!id) {
      return res.json({
        code: "error",
        message: "Không xác định người dùng!",
      });
    }

    const body = req.body || {};
    const $set = {};

    // Whitelist + chuẩn hoá
    if (typeof body.fullName === "string") {
      $set.fullName = body.fullName.trim();
    }

    if (typeof body.gender === "string") {
      const g = body.gender.trim();
      if (["male", "female", ""].includes(g)) $set.gender = g;
    }

    if (typeof body.birthday === "string") {
      if (body.birthday) {
        const d = new Date(body.birthday);
        if (!isNaN(d.getTime())) $set.birthday = d;
      } else {
        $set.birthday = null;
      }
    }

    if (typeof body.phone === "string") {
      $set.phone = body.phone.trim();
    }

    // KHÔNG cho đổi email tại đây

    if (typeof body.idNumber === "string") {
      const v = body.idNumber.trim();
      if (v && !/^(?:\d{9}|\d{12})$/.test(v)) {
        return res.json({
          code: "error",
          message: "CMND/CCCD phải là 9 hoặc 12 chữ số!",
        });
      }
      $set.idNumber = v;
    }

    if (typeof body.nationality === "string") {
      $set.nationality = body.nationality.trim();
    }

    if (typeof body.address === "string") {
      $set.address = body.address.trim();
    }

    $set.updatedBy = id;
    $set.updatedAt = new Date();

    await AccountUser.updateOne({ _id: id, deleted: { $ne: true } }, { $set });

    return res.json({
      code: "success",
      message: "Cập nhật tài khoản thành công!",
    });
  } catch (error) {
    console.error("profilePatch error:", error);
    return res.json({
      code: "error",
      message: "Dữ liệu không hợp lệ!",
    });
  }
};

module.exports.logoutPost = async (req, res) => {
  res.clearCookie("client_token");
  return res.json({
    code: "success",
    message: "Đã đăng xuất!",
  });
};
