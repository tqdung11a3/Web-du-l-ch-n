// controllers/admin/order.controller.js
const mongoose = require("mongoose");
const Order = require("../../models/order.model");
const Tour = require("../../models/tour.model");
const City = require("../../models/city.model");
const TourSegment  = require("../../models/tour-segment.model");
const HotelBooking = require("../../models/hotel-booking.model");
const {
  pathAdmin,
  paymentMethodList,
  paymentStatusList,
  statusList,
} = require("../../config/variable.config");
const moment = require("moment");

// Chuẩn hoá rules như phía client/cart.controller.js
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

// Lấy context pricing cho 1 item: ưu tiên dữ liệu snapshot trong item; thiếu thì fallback sang Tour
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

// Đơn giá cho em bé thứ idx (1-based)
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

module.exports.list = async (req, res) => {
  const account = req.account || {};
  const companyId = account.companyId || null;
  const keyword     = (req.query.keyword     || "").trim();
  const searchName  = (req.query.searchName  || "").trim();
  const searchPhone = (req.query.searchPhone || "").trim();
  const searchTour  = (req.query.searchTour  || "").trim();

  const find = { deleted: false };
  if (companyId) {
    find["items.companyId"] = companyId;
  }

  // Gộp tất cả điều kiện tìm kiếm bằng $and để mỗi trường lọc độc lập
  const searchConditions = [];
  if (keyword)     searchConditions.push({ code:          { $regex: keyword,     $options: "i" } });
  if (searchName)  searchConditions.push({ fullName:       { $regex: searchName,  $options: "i" } });
  if (searchPhone) searchConditions.push({ phone:          { $regex: searchPhone, $options: "i" } });
  if (searchTour)  searchConditions.push({ "items.name":  { $regex: searchTour,  $options: "i" } });

  if (searchConditions.length === 1) {
    Object.assign(find, searchConditions[0]);
  } else if (searchConditions.length > 1) {
    find.$and = searchConditions;
  }

  const rawOrders = await Order.find(find).sort({ createdAt: "desc" }).lean();

  // Thu thập các tourId cần fallback rule (nếu item không có rule/mode)
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
    // subset item theo công ty (nếu có companyId)
    const visibleItems = companyId
      ? (o.items || []).filter(
          (it) => String(it.companyId) === String(companyId)
        )
      : o.items || [];

    let subTotalView = 0;

    // Tính lại từng item (gắn thêm babyUnitForUi để PUG hiển thị)
    const itemsForView = visibleItems.map((it) => {
      const qAdult = Number(it.quantityAdult || 0);
      const qChild = Number(it.quantityChildren || 0);
      const qBaby = Number(it.quantityBaby || 0);

      const unitAdult = Number(it.priceNewAdult || 0);
      const unitChild = Number(it.priceNewChildren || 0);

      const ctx = getBabyPricingCtx(it, tourById);

      // Cộng dồn tiền em bé theo bậc
      let babyTotal = 0;
      for (let i = 1; i <= qBaby; i++) {
        babyTotal += babyUnitAt(ctx, i);
      }

      const babyUnitForUi = babyUnitAt(ctx, Math.max(1, qBaby || 1));

      // Cộng vào tạm tính
      subTotalView += qAdult * unitAdult + qChild * unitChild + babyTotal;

      return {
        ...it,
        babyUnitForUi, // dùng cho dòng hiển thị "Em bé: q x ..."
      };
    });

    const discountView = 0;
    const totalView = subTotalView - discountView;

    // gắn lại các nhãn trạng thái
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
    pageTitle: "Quản lý đơn hàng",
    orderList,
    keyword,
    searchName,
    searchPhone,
    searchTour,
    pathAdmin,
  });
};

module.exports.edit = async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.redirect(`/${pathAdmin}/order/list`);
    }

    const companyId = req.account?.companyId || null;
    const filter = { _id: id, deleted: false };
    if (companyId) filter["items.companyId"] = companyId;

    // Lấy đơn hàng
    const o = await Order.findOne(filter).lean();
    if (!o) return res.redirect(`/${pathAdmin}/order/list`);

    // Chỉ giữ item thuộc công ty (nếu có companyId)
    const visibleItems = companyId
      ? (o.items || []).filter(
          (it) => String(it.companyId) === String(companyId)
        )
      : o.items || [];

    // ===== cityMap: ưu tiên departureCity, fallback locationFrom (đơn cũ) =====
    const cityIds = visibleItems
      .map((i) => i.departureCity || i.locationFrom)
      .filter(Boolean);

    let cityMap = {};
    if (cityIds.length) {
      const cities = await City.find({ _id: { $in: cityIds } })
        .select("_id name")
        .lean();
      cityMap = Object.fromEntries(cities.map((c) => [String(c._id), c.name]));
    }

    // Chuẩn bị tourById để fallback rule em bé (giống hàm list)
    const needTourIds = new Set();
    for (const it of visibleItems) {
      const hasRules =
        (it.babyPricingMode && it.babyPricingMode !== "fixed") ||
        (Array.isArray(it.babyPricingRules) && it.babyPricingRules.length > 0);
      if (!hasRules && it.tourId) {
        needTourIds.add(String(it.tourId));
      }
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

    // Tính lại tiền cho subset item với rule em bé bậc thang
    let subTotalView = 0;

    const items = visibleItems.map((i) => {
      // Ưu tiên departureDateDisplay (đã lưu sẵn DD/MM/YYYY từ client),
      // fallback về departureDate cũ cho các đơn hàng trước đây
      const departureDateFormat = i.departureDateDisplay
        || (i.departureDate ? moment(i.departureDate).format("DD/MM/YYYY") : "");

      const cityId = i.departureCity || i.locationFrom || null;
      const cityName = cityId ? cityMap[String(cityId)] || "" : "";

      const qAdult = Number(i.quantityAdult || 0);
      const qChild = Number(i.quantityChildren || 0);
      const qBaby = Number(i.quantityBaby || 0);

      const unitAdult = Number(i.priceNewAdult || 0);
      const unitChild = Number(i.priceNewChildren || 0);

      // Lấy context rule em bé (ưu tiên snapshot trong item, thiếu thì lấy từ Tour)
      const ctx = getBabyPricingCtx(i, tourById);

      // Cộng dồn tiền em bé theo từng bậc
      let babyTotal = 0;
      for (let idx = 1; idx <= qBaby; idx++) {
        babyTotal += babyUnitAt(ctx, idx);
      }

      // Đơn giá em bé để hiển thị (nếu cần dùng ở UI)
      const babyUnitForUi = babyUnitAt(ctx, Math.max(1, qBaby || 1));

      // Cộng vào tạm tính
      subTotalView += qAdult * unitAdult + qChild * unitChild + babyTotal;

      return {
        ...i,
        departureDateFormat,
        cityName,
        babyUnitForUi,
      };
    });

    const discountView = 0;
    const totalView = subTotalView - discountView;

    const orderDetail = {
      ...o,
      items,
      createdAtFormat: moment(o.createdAt).format("YYYY-MM-DDTHH:mm"),
      subTotalView,
      discountView,
      totalView,
    };

    return res.render("admin/pages/order-edit", {
      pageTitle: `Đơn hàng: ${orderDetail.code}`,
      orderDetail,
      paymentMethodList,
      paymentStatusList,
      statusList,
    });
  } catch (e) {
    return res.redirect(`/${pathAdmin}/order/list`);
  }
};

module.exports.editPatch = async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.json({ code: "error", message: "ID không hợp lệ!" });
    }

    const companyId = req.account?.companyId || null;

    // WHITELIST các trường cho phép sửa từ màn hình admin
    const allow = {};
    if (typeof req.body.note === "string") allow.note = req.body.note;

    if (req.body.paymentMethod) {
      const ok = paymentMethodList.some(
        (m) => m.value === req.body.paymentMethod
      );
      if (ok) allow.paymentMethod = req.body.paymentMethod;
    }
    if (req.body.paymentStatus) {
      const ok = paymentStatusList.some(
        (s) => s.value === req.body.paymentStatus
      );
      if (ok) allow.paymentStatus = req.body.paymentStatus;
    }
    if (req.body.status) {
      const ok = statusList.some((s) => s.value === req.body.status);
      if (ok) allow.status = req.body.status;
    }

    // Ví dụ: nếu chuyển sang "paid" thì set paidAt
    if (allow.paymentStatus === "paid") {
      allow.paidAt = new Date();
    }

    // Bảo vệ theo công ty (chỉ cập nhật đơn có ít nhất 1 item thuộc công ty)
    const filter = { _id: id, deleted: false };
    if (companyId) filter["items.companyId"] = companyId;

    // Đọc đơn hàng trước khi cập nhật để lấy dữ liệu cho việc khôi phục ghế/phòng
    const orderBefore = allow.status === "cancel"
      ? await Order.findOne({ ...filter, status: { $ne: "cancel" } }).lean()
      : null;

    const result = await Order.updateOne(filter, {
      $set: { ...allow, updatedBy: req.account.id, updatedAt: new Date() },
    });

    if (result.matchedCount === 0) {
      return res.json({
        code: "error",
        message: "Không tìm thấy đơn hàng hoặc bạn không có quyền!",
      });
    }

    // Khi hủy đơn tour → khôi phục ghế và giải phóng phòng khách sạn
    if (allow.status === "cancel" && orderBefore) {
      try {
        await restoreSeatsForOrder(orderBefore);
      } catch (err) {
        console.error("[editPatch] restoreSeatsForOrder error:", err);
      }
      try {
        await releaseHotelHoldsForOrder(id);
      } catch (err) {
        console.error("[editPatch] releaseHotelHoldsForOrder error:", err);
      }
    }

    return res.json({
      code: "success",
      message: "Cập nhật đơn hàng thành công!",
    });
  } catch (error) {
    return res.json({ code: "error", message: "Dữ liệu không hợp lệ!" });
  }
};

/**
 * Khôi phục số ghế còn lại cho từng tour item trong đơn hàng bị hủy.
 * Logic giống client-side _cancelHoldAndRestoreSeats nhưng không kiểm tra paymentStatus.
 */
async function restoreSeatsForOrder(order) {
  for (const item of order.items || []) {
    if (!item.tourId) continue;

    const seatsToRestore =
      Number(item.quantityAdult    || 0) +
      Number(item.quantityChildren || 0) +
      (item.babySeat ? Number(item.quantityBaby || 0) : 0);

    if (seatsToRestore <= 0) continue;

    // Khôi phục top-level seatsRemaining và stock (tương thích ngược)
    await Tour.updateOne(
      { _id: item.tourId },
      {
        $inc: {
          stockAdult:     Number(item.quantityAdult    || 0),
          stockChildren:  Number(item.quantityChildren || 0),
          stockBaby:      Number(item.quantityBaby     || 0),
          seatsRemaining: seatsToRestore,
        },
      }
    );

    // Khôi phục seatsRemaining cho đúng ngày khởi hành trong departures[]
    const depDisplay = item.departureDateDisplay
      || (item.departureDate ? moment(item.departureDate).format("DD/MM/YYYY") : "");
    if (depDisplay) {
      const depMoment = moment(depDisplay, "DD/MM/YYYY");
      if (depMoment.isValid()) {
        await Tour.updateOne(
          { _id: item.tourId },
          { $inc: { "departures.$[dep].seatsRemaining": seatsToRestore } },
          {
            arrayFilters: [{
              "dep.departureDate": {
                $gte: depMoment.clone().startOf("day").toDate(),
                $lte: depMoment.clone().endOf("day").toDate(),
              },
            }],
          }
        );
      }
    }
  }
}

/**
 * Giải phóng các phòng khách sạn đã được phân công cho một đơn hàng tour.
 * - Xoá entry trong TourSegment.assignments
 * - Reset HotelBooking về trạng thái "[Tour Hold]" (chưa gán khách)
 */
async function releaseHotelHoldsForOrder(orderId) {
  // Tìm tất cả TourSegment có assignment cho đơn này
  const segments = await TourSegment.find({
    "assignments.orderId": orderId,
  }).select("_id tourId departureDate endDate assignments").lean();

  if (!segments.length) return;

  for (const seg of segments) {
    // Lấy các holdBookingId cần reset
    const toRelease = (seg.assignments || []).filter(
      (a) => String(a.orderId) === String(orderId)
    );
    const holdBookingIds = toRelease
      .map((a) => a.holdBookingId)
      .filter(Boolean);

    // Xoá assignment khỏi TourSegment
    await TourSegment.updateOne(
      { _id: seg._id },
      { $pull: { assignments: { orderId: new mongoose.Types.ObjectId(orderId) } } }
    );

    // Reset các HotelBooking về placeholder Tour Hold
    if (holdBookingIds.length) {
      const tourDoc = await Tour.findById(seg.tourId).select("name").lean();
      const tourName   = tourDoc?.name || "Tour";
      const depDateFmt = moment(seg.departureDate).format("DD/MM/YYYY");
      const endDateFmt = moment(seg.endDate).format("DD/MM/YYYY");
      const resetNote  = `[Tour Hold] ${tourName} | ${depDateFmt} – ${endDateFmt}`;

      await HotelBooking.updateMany(
        { _id: { $in: holdBookingIds } },
        {
          $set: {
            "guest.fullName": "[Tour Hold]",
            "guest.phone":    "",
            note:             resetNote,
            status:           "confirmed",
          },
        }
      );
    }
  }
}

module.exports.deletePatch = async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.json({ code: "error", message: "ID không hợp lệ!" });
    }

    const companyId = req.account?.companyId || null;

    // Bảo vệ theo công ty (chỉ xóa đơn có ít nhất 1 item thuộc công ty)
    const filter = { _id: id, deleted: false };
    if (companyId) filter["items.companyId"] = companyId;

    const order = await Order.findOne(filter);
    if (!order) {
      return res.json({
        code: "error",
        message: "Không tìm thấy đơn hàng hoặc bạn không có quyền!",
      });
    }

    // Soft delete
    await Order.updateOne(
      { _id: id },
      {
        $set: {
          deleted: true,
          deletedAt: new Date(),
          deletedBy: req.account.id,
        },
      }
    );

    return res.json({
      code: "success",
      message: "Xóa đơn hàng thành công!",
    });
  } catch (error) {
    console.error("admin order deletePatch error:", error);
    return res.json({ code: "error", message: "Có lỗi xảy ra!" });
  }
};
