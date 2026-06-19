// controllers/client/account.controller.js
const AccountUser = require("../../models/account-user.model");
const Order = require("../../models/order.model");
const City = require("../../models/city.model");
const HotelBooking = require("../../models/hotel-booking.model");
const TourSegment  = require("../../models/tour-segment.model");
const {
  resolvePassengersForAtomLabels,
  resolveSharedRoomDisplayStatus,
} = require("../../helpers/shared-room-passengers.helper");
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
  const highlight = req.query.highlight || null;
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
          orderId: String(o._id),
          paymentStatus: o.paymentStatus,
          orderStatus: o.status,
          name: it.name,
          slug: it.slug,
          avatar: it.avatar,
          companySlug: it.slug ? (companySlugMap[it.slug] || null) : null,
          accommodationMode: it.accommodationMode || "private",

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
          // passengers để render danh sách khách/phòng (private)
          passengers: Array.isArray(it.passengers) ? it.passengers : [],
          // assignments sẽ được gắn sau (ở ghép → sharedAssignments, ở riêng → privateAssignments)
          sharedAssignments: [],
          privateAssignments: [],
          createdAt: o.createdAt,
        });
      }
    }

    totalTours = flat.length;

    // 4a) Gắn phân công phòng cho các đơn ở ghép (shared)
    const sharedItems = flat.filter((r) => r.accommodationMode === "shared");
    if (sharedItems.length > 0) {
      const sharedOrderIds = sharedItems.map((r) => r.orderId);

      // Tìm tất cả TourSegment có assignment thuộc ít nhất 1 trong các orderId này
      const segs = await TourSegment.find({
        "assignments.orderId": { $in: sharedOrderIds },
      })
        .select("departureDate assignments")
        .lean();

      // Thu thập holdBookingIds để load HotelBooking.status
      const holdBookingIds = [];
      for (const seg of segs) {
        for (const a of seg.assignments || []) {
          if (a.holdBookingId) holdBookingIds.push(a.holdBookingId);
        }
      }
      const holdStatusMap = {};
      if (holdBookingIds.length > 0) {
        const holdDocs = await HotelBooking.find({ _id: { $in: holdBookingIds } })
          .select("_id status")
          .lean();
        for (const hb of holdDocs) holdStatusMap[String(hb._id)] = hb.status;
      }

      // Gom assignments theo orderId để tra nhanh
      const assignByOrderId = {};
      for (const seg of segs) {
        for (const a of seg.assignments || []) {
          const oid = String(a.orderId);
          if (!assignByOrderId[oid]) assignByOrderId[oid] = [];
          assignByOrderId[oid].push({
            hotelName:    a.hotelName    || "",
            roomNumber:   a.roomNumber   || "",
            roomTypeName: a.roomTypeName || "",
            accommodationMode: a.accommodationMode || "shared",
            guestStatus:  a.guestStatus  || "confirmed",
            bookingStatus: a.holdBookingId ? (holdStatusMap[String(a.holdBookingId)] || "confirmed") : "confirmed",
            numPeople:    a.numPeople    || 1,
            atomLabels:   Array.isArray(a.atomLabels) ? a.atomLabels : [],
            guestName:    a.guestName    || "",
          });
        }
      }

      for (const r of sharedItems) {
        const rawAssigns = assignByOrderId[r.orderId] || [];
        r.sharedAssignments = rawAssigns.map((a) => {
          const labels = a.atomLabels || [];
          let passengers = [];
          if (labels.length > 0 && (r.passengers || []).length > 0) {
            passengers = resolvePassengersForAtomLabels(
              r.passengers,
              labels
            );
          }
          if (passengers.length === 0 && a.guestName) {
            passengers = [{ name: a.guestName, type: "adult" }];
          }
          const displayStatus = resolveSharedRoomDisplayStatus(
            a.guestStatus,
            a.bookingStatus
          );
          return { ...a, passengers, displayStatus };
        });
      }
    }

    // 4b) Gắn phân công phòng cho các đơn ở riêng (private)
    const privateItems = flat.filter((r) => r.accommodationMode !== "shared");
    if (privateItems.length > 0) {
      const privateOrderIds = privateItems.map((r) => r.orderId);

      const privSegs = await TourSegment.find({
        "assignments.orderId": { $in: privateOrderIds },
        "assignments.accommodationMode": "private",
      })
        .select("assignments")
        .lean();

      // Gom theo orderId → mảng assignments (đã admin lưu)
      const privAssignByOrderId = {};
      for (const seg of privSegs) {
        for (const a of seg.assignments || []) {
          if (a.accommodationMode !== "private") continue;
          const oid = String(a.orderId);
          if (!privAssignByOrderId[oid]) privAssignByOrderId[oid] = [];
          privAssignByOrderId[oid].push({
            hotelName:    a.hotelName    || "",
            roomNumber:   a.roomNumber   || "",
            roomTypeName: a.roomTypeName || "",
            holdBookingId: a.holdBookingId ? String(a.holdBookingId) : null,
            numPeople:    a.numPeople    || 1,
            guestStatus:  a.guestStatus  || "confirmed",
          });
        }
      }

      // Load HotelBooking.status cho private holds
      const privHoldIds = [];
      for (const arr of Object.values(privAssignByOrderId)) {
        for (const a of arr) {
          if (a.holdBookingId) privHoldIds.push(a.holdBookingId);
        }
      }
      const privHoldStatusMap = {};
      if (privHoldIds.length > 0) {
        const privHolds = await HotelBooking.find({ _id: { $in: privHoldIds } })
          .select("_id status")
          .lean();
        for (const hb of privHolds) privHoldStatusMap[String(hb._id)] = hb.status;
      }

      for (const r of privateItems) {
        const rawAssigns = privAssignByOrderId[r.orderId] || [];
        if (rawAssigns.length === 0) continue;

        // Ghép danh sách khách vào từng phòng từ order item passengers + roomAssignments
        // roomSelections[].roomAssignments[i].passengerIdxs → passengers[].name
        // Mỗi TourSegment assignment tương ứng 1 phòng vật lý (theo thứ tự holdBookingId)
        // Vì không có mapping holdBookingId ↔ roomAssignments index trực tiếp,
        // ta gom tất cả passengers theo roomSelections[].roomAssignments thành 1 danh sách
        // rồi phân cho từng phòng theo số người (numPeople) từ admin assignment.
        const passengerMap = {};
        for (const p of r.passengers || []) {
          passengerMap[p.idx] = p;
        }

        // Tất cả logical slot assignments từ order (booking time)
        const allLogicalSlots = [];
        for (const rs of r.roomSelections || []) {
          for (const ra of rs.roomAssignments || []) {
            allLogicalSlots.push({
              roomTypeId: rs.roomTypeId,
              roomTypeName: rs.roomTypeName,
              hotelId: rs.hotelId,
              hotelName: rs.hotelName,
              fromDate: rs.fromDate,
              toDate: rs.toDate,
              passengerIdxs: Array.isArray(ra.passengerIdxs) ? ra.passengerIdxs : [],
            });
          }
        }

        // Match admin assignments với logical slots theo hotel+roomType
        r.privateAssignments = rawAssigns.map((a, i) => {
          // Tìm logical slot tương ứng (cùng hotel+roomType, theo thứ tự)
          const slot = allLogicalSlots.filter(
            (s) => s.hotelName === a.hotelName || s.roomTypeName === a.roomTypeName
          )[0] || allLogicalSlots[i] || null;

          const passengers = slot
            ? slot.passengerIdxs
                .map((idx) => passengerMap[idx])
                .filter(Boolean)
                .map((p) => ({
                  name: p.name || "Hành khách",
                  type: p.type || "adult",
                  age: p.age,
                }))
            : [];

          return {
            hotelName:    a.hotelName,
            roomNumber:   a.roomNumber,
            roomTypeName: a.roomTypeName,
            numPeople:    a.numPeople,
            guestStatus:  a.guestStatus,
            bookingStatus: a.holdBookingId
              ? (privHoldStatusMap[a.holdBookingId] || "confirmed")
              : "confirmed",
            passengers,
          };
        });
      }
    }

    // 4) Phân loại upcoming / history
    for (const r of flat) {
      const isCanceled = r.orderStatus === "cancel";
      const isDone     = r.orderStatus === "done";

      if (!r.departureDate) {
        history.push(r);
      } else {
        const depDate = moment(r.departureDate).startOf("day");
        const isUpcoming = depDate.isAfter(now);

        // Lịch sử: đã bị hủy, hoặc đã hoàn thành, hoặc ngày khởi hành đã qua
        if (isCanceled || isDone || !isUpcoming) {
          history.push(r);
        } else {
          upcoming.push(r);
        }
      }
    }

    // 5) Lấy lịch sử đặt phòng khách sạn (populate hotel để lấy roomTypes & rooms)
    const rawBookings = await HotelBooking.find({
      userId: me._id,
      deleted: { $ne: true },
    })
      .populate("hotel.hotelId", "name rooms roomTypes thumbnail address")
      .sort({ createdAt: -1 })
      .lean();

    // Group bookings theo base code
    // base code = code bỏ suffix -R\d+, -\d+
    const bookingGroups = {};
    rawBookings.forEach((booking) => {
      let baseCode = booking.code.replace(/-R\d+(-\d+)?$/, "");
      while (baseCode.match(/-\d+$/)) baseCode = baseCode.replace(/-\d+$/, "");
      if (!bookingGroups[baseCode]) bookingGroups[baseCode] = [];
      bookingGroups[baseCode].push(booking);
    });

    // Format dữ liệu hotel bookings (mỗi group = 1 đơn)
    for (const [baseCode, group] of Object.entries(bookingGroups)) {
      const firstBooking = group[0];
      const checkInDate = firstBooking.checkIn
        ? moment(firstBooking.checkIn).format("DD/MM/YYYY")
        : "—";
      const checkOutDate = firstBooking.checkOut
        ? moment(firstBooking.checkOut).format("DD/MM/YYYY")
        : "—";
      const nights = firstBooking.totalNights || 0;

      const totalRooms = group.reduce((sum, b) => sum + (b.rooms || 1), 0);
      const totalAdults = group.reduce((sum, b) => sum + (b.adults || 1), 0);
      const totalChildren = group.reduce((sum, b) => sum + (b.children || 0), 0);
      const orderTotal =
        firstBooking.orderTotal ||
        group.reduce((sum, b) => sum + (b.totalAmount || 0), 0);

      // Lấy số phòng vật lý từ hotel.rooms nếu đã xếp phòng
      const hotelDoc =
        firstBooking.hotel?.hotelId &&
        typeof firstBooking.hotel.hotelId === "object"
          ? firstBooking.hotel.hotelId
          : null;
      const hotelRooms = hotelDoc?.rooms || [];
      const hotelRoomTypes = hotelDoc?.roomTypes || [];

      const assignedRooms = group
        .filter((b) => b.roomId)
        .map((b) => {
          const room = hotelRooms.find(
            (r) => String(r._id) === String(b.roomId)
          );
          const rt = hotelRoomTypes.find(
            (t) => String(t._id) === String(b.roomTypeId)
          );
          return {
            roomNumber: room
              ? room.number || room.roomNumber || "—"
              : "—",
            floor: room ? room.floor || "" : "",
            roomType: rt ? rt.name || rt.title || "" : "",
          };
        });

      const HOTEL_STATUS_LABELS = {
        pending: "Chờ xác nhận",
        confirmed: "Đã xác nhận",
        checked_in: "Đã nhận phòng",
        checked_out: "Đã trả phòng",
        cancelled: "Đã hủy",
      };

      const PAYMENT_LABELS = {
        paid: "Đã thanh toán",
        unpaid: "Chưa thanh toán",
      };

      hotelBookings.push({
        code: baseCode,
        hotelName:
          hotelDoc?.name || firstBooking.hotel?.name || "Khách sạn không xác định",
        hotelThumbnail:
          hotelDoc?.thumbnail || firstBooking.hotel?.thumbnail || "",
        hotelAddress:
          hotelDoc?.address || firstBooking.hotel?.address || "",
        checkInDate,
        checkOutDate,
        nights,
        rooms: totalRooms,
        adults: totalAdults,
        children: totalChildren,
        totalAmount: orderTotal,
        paymentStatus: firstBooking.paymentStatus,
        paymentStatusLabel:
          PAYMENT_LABELS[firstBooking.paymentStatus] || firstBooking.paymentStatus,
        paymentMethod: firstBooking.paymentMethod,
        status: firstBooking.status,
        statusLabel: HOTEL_STATUS_LABELS[firstBooking.status] || firstBooking.status,
        createdAt: firstBooking.createdAt,
        assignedRooms, // số phòng vật lý đã xếp
        isHighlighted: highlight === baseCode,
      });
    }
  }

  res.render("client/pages/profile", {
    pageTitle: "Tài khoản của bạn",
    user: { ...me, totalTours },
    tab,
    highlight,
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
