// controllers/admin/super-admin/order.controller.js
const mongoose = require("mongoose");
const moment = require("moment");
const Company = require("../../../models/company.model");
const Order = require("../../../models/order.model");
const Tour = require("../../../models/tour.model");
const Hotel = require("../../../models/hotel.model");
const HotelBooking = require("../../../models/hotel-booking.model");
const orderAdminController = require("../order.controller");
const hotelController = require("../hotel.controller");
const {
  pathAdmin,
  paymentMethodList,
  paymentStatusList,
  statusList,
} = require("../../../config/variable.config");

// --- Giống order.controller list: baby pricing snapshot / fallback tour ---
function normalizeRules(rawRules) {
  if (!Array.isArray(rawRules)) return [];
  return rawRules
    .map((r) => ({
      from: Number(r.from),
      to: r.to === "inf" || r.to === Infinity ? "inf" : Number(r.to),
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

function getBabyPricingCtx(item, tourById) {
  const tour = tourById?.[String(item.tourId)] || null;
  const priceNewAdult =
    Number(item.priceNewAdult ?? (tour ? tour.priceNewAdult : 0)) || 0;
  const priceNewChildren =
    Number(item.priceNewChildren ?? (tour ? tour.priceNewChildren : 0)) || 0;
  const priceNewBaby =
    Number(item.priceNewBaby ?? (tour ? tour.priceNewBaby : 0)) || 0;
  const mode = (
    item.babyPricingMode ??
    tour?.babyPricingMode ??
    "fixed"
  ).trim();
  const rules = normalizeRules(
    (item.babyPricingRules && item.babyPricingRules.length
      ? item.babyPricingRules
      : tour?.babyPricingRules) || []
  );
  return { priceNewAdult, priceNewChildren, priceNewBaby, mode, rules };
}

function babyUnitAt(ctx, idx) {
  const { mode, rules, priceNewAdult, priceNewChildren, priceNewBaby } = ctx;
  if (mode !== "tiered" || !rules.length) return priceNewBaby;
  const rule = rules.find((r) => {
    const from = Number(r.from);
    const to = r.to === "inf" ? Infinity : Number(r.to);
    return Number.isFinite(from) && idx >= from && idx <= to;
  });
  if (!rule) return 0;
  const base = rule.ref === "adult" ? priceNewAdult : priceNewChildren;
  const pct = Number(rule.percent) || 0;
  return Math.round((base * pct) / 100);
}

function bookingBaseCode(code) {
  let baseCode = code || "";
  baseCode = baseCode.replace(/-R\d+(-\d+)?$/, "");
  while (baseCode.match(/-\d+$/)) {
    baseCode = baseCode.replace(/-\d+$/, "");
  }
  return baseCode;
}

/**
 * GET /super-admin/orders — danh sách công ty
 */
module.exports.companyList = async (req, res) => {
  try {
    const find = { deleted: { $ne: true } };
    if (req.query.keyword) {
      find.name = new RegExp(req.query.keyword.trim(), "i");
    }
    if (req.query.status) {
      find.status = req.query.status;
    }

    const companies = await Company.find(find)
      .select("name logo status email hotline")
      .sort({ name: 1 })
      .lean();

    const tourAgg = await Order.aggregate([
      { $match: { deleted: false } },
      { $unwind: "$items" },
      {
        $match: {
          "items.companyId": { $exists: true, $ne: null },
        },
      },
      {
        $group: {
          _id: "$items.companyId",
          orderIds: { $addToSet: "$_id" },
        },
      },
      {
        $project: {
          tourOrderCount: { $size: "$orderIds" },
        },
      },
    ]);
    const tourCountMap = new Map(
      tourAgg.map((x) => [String(x._id), x.tourOrderCount || 0])
    );

    for (const c of companies) {
      c.tourOrderCount = tourCountMap.get(String(c._id)) || 0;
      const hotelIds = await Hotel.find({
        companyId: c._id,
        deleted: false,
      })
        .distinct("_id");
      c.hotelBookingRowCount =
        hotelIds.length === 0
          ? 0
          : await HotelBooking.countDocuments({
              tourSegmentId: null,
              "hotel.hotelId": { $in: hotelIds },
            });
    }

    res.render("admin/pages/super-admin/order-companies", {
      pageTitle: "Đơn hàng theo công ty",
      companies,
      keyword: req.query.keyword || "",
      statusFilter: req.query.status || "",
    });
  } catch (error) {
    console.error("Super Admin - Order company list error:", error);
    res.status(500).send("Có lỗi xảy ra!");
  }
};

/**
 * GET /super-admin/orders/company/:companyId — chọn loại đơn
 */
module.exports.companyHub = async (req, res) => {
  try {
    const companyId = req.params.companyId;
    if (!mongoose.Types.ObjectId.isValid(String(companyId))) {
      return res.redirect(`/${pathAdmin}/super-admin/orders`);
    }

    const company = await Company.findOne({
      _id: companyId,
      deleted: { $ne: true },
    })
      .select("name logo status")
      .lean();

    if (!company) {
      return res.redirect(`/${pathAdmin}/super-admin/orders`);
    }

    res.render("admin/pages/super-admin/order-company-hub", {
      pageTitle: `Đơn hàng — ${company.name}`,
      company,
    });
  } catch (error) {
    console.error("Super Admin - Order company hub error:", error);
    res.status(500).send("Có lỗi xảy ra!");
  }
};

/**
 * GET .../tours — danh sách đơn tour (giao diện giống /admin/order/list)
 */
module.exports.tourOrdersList = async (req, res) => {
  try {
    const companyId = req.params.companyId;
    if (!mongoose.Types.ObjectId.isValid(String(companyId))) {
      return res.redirect(`/${pathAdmin}/super-admin/orders`);
    }

    const company = await Company.findOne({
      _id: companyId,
      deleted: { $ne: true },
    })
      .select("name logo status")
      .lean();

    if (!company) {
      return res.redirect(`/${pathAdmin}/super-admin/orders`);
    }

    const cOid = new mongoose.Types.ObjectId(String(companyId));
    const find = { deleted: false, "items.companyId": cOid };

    const keyword = (req.query.keyword || "").trim();
    const searchName = (req.query.searchName || "").trim();
    const searchPhone = (req.query.searchPhone || "").trim();
    const searchTour = (req.query.searchTour || "").trim();

    const searchConditions = [];
    if (keyword) {
      searchConditions.push({ code: { $regex: keyword, $options: "i" } });
    }
    if (searchName) {
      searchConditions.push({ fullName: { $regex: searchName, $options: "i" } });
    }
    if (searchPhone) {
      searchConditions.push({ phone: { $regex: searchPhone, $options: "i" } });
    }
    if (searchTour) {
      searchConditions.push({ "items.name": { $regex: searchTour, $options: "i" } });
    }
    if (searchConditions.length === 1) {
      Object.assign(find, searchConditions[0]);
    } else if (searchConditions.length > 1) {
      find.$and = searchConditions;
    }

    const limitItems = 10;
    let page = 1;
    if (req.query.page && parseInt(req.query.page, 10) > 0) {
      page = parseInt(req.query.page, 10);
    }
    const skip = (page - 1) * limitItems;

    const totalRecord = await Order.countDocuments(find);
    const totalPage = Math.ceil(totalRecord / limitItems) || 1;
    const pagination = {
      currentPage: page,
      skip,
      totalRecord,
      totalPage,
    };

    const rawOrders = await Order.find(find)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitItems)
      .lean();

    const needTourIds = new Set();
    for (const o of rawOrders) {
      const items = o.items || [];
      items.forEach((it) => {
        const hasRules =
          (it.babyPricingMode && it.babyPricingMode !== "fixed") ||
          (Array.isArray(it.babyPricingRules) && it.babyPricingRules.length > 0);
        if (!hasRules && it.tourId) needTourIds.add(String(it.tourId));
      });
    }

    let tourById = {};
    if (needTourIds.size) {
      const tours = await Tour.find({
        _id: { $in: Array.from(needTourIds) },
        status: "active",
        deleted: false,
      })
        .select(
          "_id priceNewAdult priceNewChildren priceNewBaby babyPricingMode babyPricingRules"
        )
        .lean();
      tourById = tours.reduce((acc, t) => {
        acc[String(t._id)] = t;
        return acc;
      }, {});
    }

    const orderList = rawOrders.map((o) => {
      const visibleItems = (o.items || []).filter(
        (it) => String(it.companyId) === String(cOid)
      );

      let subTotalView = 0;
      const itemsForView = visibleItems.map((it) => {
        const qAdult = Number(it.quantityAdult || 0);
        const qChild = Number(it.quantityChildren || 0);
        const qBaby = Number(it.quantityBaby || 0);
        const unitAdult = Number(it.priceNewAdult || 0);
        const unitChild = Number(it.priceNewChildren || 0);
        const ctx = getBabyPricingCtx(it, tourById);
        let babyTotal = 0;
        for (let i = 1; i <= qBaby; i++) {
          babyTotal += babyUnitAt(ctx, i);
        }
        const babyUnitForUi = babyUnitAt(ctx, Math.max(1, qBaby || 1));
        const extraRoomCost = Number(it.extraRoomCost || 0);
        subTotalView +=
          qAdult * unitAdult + qChild * unitChild + babyTotal + extraRoomCost;
        return { ...it, babyUnitForUi };
      });

      const discountView = 0;
      const totalView = subTotalView - discountView;

      const pm = paymentMethodList.find((i) => i.value === o.paymentMethod);
      const ps = paymentStatusList.find((i) => i.value === o.paymentStatus);
      const st = statusList.find((i) => i.value === o.status);

      return {
        ...o,
        items: itemsForView,
        subTotalView,
        discountView,
        totalView,
        paymentMethodName: pm ? pm.label : "Không xác định",
        paymentStatusName: ps ? ps.label : "Không xác định",
        statusInfo: st || { label: "Không xác định", color: "secondary" },
        createdAtTime: moment(o.createdAt).format("HH:mm"),
        createdAtDate: moment(o.createdAt).format("DD/MM/YYYY"),
      };
    });

    return res.render("admin/pages/order-list", {
      pageTitle: `Đơn tour — ${company.name}`,
      orderList,
      companyContext: company,
      pagination,
      keyword,
      searchName,
      searchPhone,
      searchTour,
      pathAdmin,
    });
  } catch (error) {
    console.error("Super Admin - Tour orders list error:", error);
    res.status(500).send("Có lỗi xảy ra!");
  }
};

/**
 * GET .../tour/:orderId — chi tiết đơn tour (giao diện order-edit, read-only)
 */
module.exports.tourOrderDetail = async (req, res) => {
  try {
    const companyId = req.params.companyId;
    const orderId = req.params.orderId;
    if (
      !mongoose.Types.ObjectId.isValid(String(companyId)) ||
      !mongoose.Types.ObjectId.isValid(String(orderId))
    ) {
      return res.redirect(`/${pathAdmin}/super-admin/orders`);
    }

    const cOid = new mongoose.Types.ObjectId(String(companyId));
    const vm = await orderAdminController.buildOrderEditLocals(
      String(orderId),
      cOid
    );
    if (!vm) {
      return res.redirect(
        `/${pathAdmin}/super-admin/orders/company/${companyId}/tours`
      );
    }

    const orderListBackUrl = `/${pathAdmin}/super-admin/orders/company/${companyId}/tours`;

    return res.render("admin/pages/order-edit", {
      pageTitle: vm.pageTitle,
      orderDetail: vm.orderDetail,
      paymentMethodList,
      paymentStatusList,
      statusList,
      readOnly: true,
      orderListBackUrl,
    });
  } catch (error) {
    console.error("Super Admin - Tour order detail error:", error);
    res.status(500).send("Có lỗi xảy ra!");
  }
};

/**
 * GET .../hotel-bookings — danh sách đặt phòng (theo công ty)
 */
module.exports.hotelBookingsList = async (req, res) => {
  try {
    const companyId = req.params.companyId;
    if (!mongoose.Types.ObjectId.isValid(String(companyId))) {
      return res.redirect(`/${pathAdmin}/super-admin/orders`);
    }

    const company = await Company.findOne({
      _id: companyId,
      deleted: { $ne: true },
    })
      .select("name logo status")
      .lean();

    if (!company) {
      return res.redirect(`/${pathAdmin}/super-admin/orders`);
    }

    const cOid = new mongoose.Types.ObjectId(String(companyId));
    const hotels = await Hotel.find({ companyId: cOid, deleted: false })
      .select("_id name address roomTypes")
      .lean();

    const hotelById = Object.fromEntries(
      hotels.map((h) => [String(h._id), h])
    );
    const hotelIds = hotels.map((h) => h._id);

    if (!hotelIds.length) {
      return res.render("admin/pages/super-admin/hotel-bookings-list", {
        pageTitle: `Đặt phòng — ${company.name}`,
        company,
        bookings: [],
        searchQuery: (req.query.search || "").trim(),
        pagination: null,
      });
    }

    const searchQuery = (req.query.search || "").trim();
    const bookingFilter = {
      "hotel.hotelId": { $in: hotelIds },
      tourSegmentId: null,
    };
    if (searchQuery) {
      bookingFilter.$or = [
        { code: new RegExp(searchQuery, "i") },
        { "guest.fullName": new RegExp(searchQuery, "i") },
        { "guest.email": new RegExp(searchQuery, "i") },
      ];
    }

    const rawBookings = await HotelBooking.find(bookingFilter)
      .sort({ createdAt: -1 })
      .lean();

    const bookingGroups = {};
    rawBookings.forEach((b) => {
      const baseCode = bookingBaseCode(b.code);
      if (!bookingGroups[baseCode]) bookingGroups[baseCode] = [];
      bookingGroups[baseCode].push(b);
    });

    let bookings = Object.entries(bookingGroups).map(([baseCode, group]) => {
      const b = group[0];
      const nights =
        b.totalNights ||
        (b.checkIn && b.checkOut
          ? Math.max(
              1,
              moment(b.checkOut)
                .startOf("day")
                .diff(moment(b.checkIn).startOf("day"), "days")
            )
          : 1);

      const hid = b.hotel?.hotelId ? String(b.hotel.hotelId) : "";
      const hotelDoc = hid ? hotelById[hid] : null;
      const hotelName =
        hotelDoc?.name || b.hotel?.name || "Khách sạn";

      const roomTypeCountMap = {};
      let totalRoomCount = 0;
      if (hotelDoc && Array.isArray(hotelDoc.roomTypes)) {
        group.forEach((booking) => {
          if (booking.roomTypeId) {
            const roomTypeIdStr = String(booking.roomTypeId);
            const roomsInBooking = booking.rooms || 1;
            if (!roomTypeCountMap[roomTypeIdStr]) {
              const rt = hotelDoc.roomTypes.find(
                (rt) => String(rt._id) === roomTypeIdStr
              );
              roomTypeCountMap[roomTypeIdStr] = {
                name: rt?.name || "Loại phòng",
                count: 0,
              };
            }
            roomTypeCountMap[roomTypeIdStr].count += roomsInBooking;
            totalRoomCount += roomsInBooking;
          }
        });
      }
      const roomTypeNames = Object.values(roomTypeCountMap)
        .map((rt) => `${rt.name} (${rt.count} phòng)`)
        .join(", ");
      const roomTypeName = roomTypeNames || "Loại phòng";
      const roomCount = totalRoomCount || group.length;

      const totalAmount = Number(b.orderTotal || b.totalAmount || 0);

      let paymentStatusText = "Chưa thanh toán";
      let paymentStatusColor = "yellow";
      if (b.paymentStatus === "paid") {
        paymentStatusText = "Đã thanh toán";
        paymentStatusColor = "green";
      }

      let statusText = "Chờ xác nhận";
      let statusColor = "blue";
      if (b.status === "confirmed") {
        statusText = "Đã xác nhận";
        statusColor = "green";
      } else if (b.status === "checked_in") {
        statusText = "Đã nhận phòng";
        statusColor = "blue";
      } else if (b.status === "checked_out") {
        statusText = "Đã trả phòng";
        statusColor = "gray";
      } else if (b.status === "cancelled") {
        statusText = "Đã hủy";
        statusColor = "red";
      }

      let paymentMethodName = "Tiền mặt";
      if (b.paymentMethod === "bank") {
        paymentMethodName = "Chuyển khoản ngân hàng";
      } else if (b.paymentMethod === "vnpay") {
        paymentMethodName = "VNPay";
      }

      return {
        bookingId: baseCode,
        _id: b._id,
        hotelName,
        customerName: b.guest?.fullName || "Khách lẻ",
        customerEmail: b.guest?.email || "",
        createdAtFormat: b.createdAt
          ? moment(b.createdAt).format("DD/MM/YYYY HH:mm")
          : "—",
        checkIn: b.checkIn ? moment(b.checkIn).format("DD/MM/YYYY") : "—",
        nights,
        roomType: roomTypeName,
        roomCount,
        adults: group.reduce((sum, booking) => sum + (booking.adults || 1), 0),
        children: group.reduce(
          (sum, booking) => sum + (booking.children || 0),
          0
        ),
        totalAmount,
        paymentStatus: paymentStatusText,
        paymentStatusColor,
        status: statusText,
        statusColor,
        paymentMethod: paymentMethodName,
        groupCount: group.length,
      };
    });

    bookings.sort((a, b) => {
      const ta = moment(a.createdAtFormat, "DD/MM/YYYY HH:mm").valueOf();
      const tb = moment(b.createdAtFormat, "DD/MM/YYYY HH:mm").valueOf();
      return tb - ta;
    });

    const limitItems = 10;
    let page = 1;
    if (req.query.page && parseInt(req.query.page, 10) > 0) {
      page = parseInt(req.query.page, 10);
    }
    const totalRecord = bookings.length;
    const totalPage = Math.ceil(totalRecord / limitItems) || 1;
    const skip = (page - 1) * limitItems;
    bookings = bookings.slice(skip, skip + limitItems);

    const pagination = {
      currentPage: page,
      skip,
      totalRecord,
      totalPage,
    };

    return res.render("admin/pages/super-admin/hotel-bookings-list", {
      pageTitle: `Đặt phòng — ${company.name}`,
      company,
      bookings,
      searchQuery,
      pagination: totalPage > 1 ? pagination : null,
    });
  } catch (error) {
    console.error("Super Admin - Hotel bookings list error:", error);
    res.status(500).send("Có lỗi xảy ra!");
  }
};

/**
 * GET .../hotel-booking/:bookingId — chi tiết (delegate hotel.controller)
 */
module.exports.hotelBookingDetail = async (req, res) => {
  req.bookingDetailContext = {
    enforceCompanyId: req.params.companyId,
    bookingDetailReadOnly: true,
    bookingListBackUrl: `/${pathAdmin}/super-admin/orders/company/${req.params.companyId}/hotel-bookings`,
  };
  return hotelController.bookingDetail(req, res);
};
