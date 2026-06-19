// controllers/admin/order.controller.js
const mongoose = require("mongoose");
const Order = require("../../models/order.model");
const Tour = require("../../models/tour.model");
const City = require("../../models/city.model");
const TourSegment  = require("../../models/tour-segment.model");
const HotelBooking = require("../../models/hotel-booking.model");
const Hotel        = require("../../models/hotel.model");
const {
  pathAdmin,
  paymentMethodList,
  paymentStatusList,
  statusList,
} = require("../../config/variable.config");
const moment = require("moment");
const auditLogHelper = require("../../helpers/audit-log.helper");
const {
  notifyCustomerOrderUpdate,
  diffChanges,
  buildTourOrderProfileLink,
} = require("../../helpers/customer-order-notify.helper");
const {
  enrichItemBabySeatsDisplay,
} = require("../../helpers/order-baby-seats-display.helper");

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

      const extraRoomCost = Number(it.extraRoomCost || 0);

      // Cộng vào tạm tính
      subTotalView += qAdult * unitAdult + qChild * unitChild + babyTotal + extraRoomCost;

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

/**
 * Chuẩn bị dữ liệu màn hình order-edit (dùng cho company admin và super admin).
 * @param {string} id - Order _id
 * @param {string|import("mongoose").Types.ObjectId|null} companyId - null = tất cả item (super admin không lọc theo công ty)
 */
async function buildOrderEditLocals(id, companyId) {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const filter = { _id: id, deleted: false };
  if (companyId) filter["items.companyId"] = companyId;

  const o = await Order.findOne(filter).lean();
  if (!o) return null;

  const visibleItems = companyId
    ? (o.items || []).filter(
        (it) => String(it.companyId) === String(companyId)
      )
    : o.items || [];

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

  let subTotalView = 0;

  const items = visibleItems.map((i) => {
    const departureDateFormat =
      i.departureDateDisplay ||
      (i.departureDate ? moment(i.departureDate).format("DD/MM/YYYY") : "");

    const cityId = i.departureCity || i.locationFrom || null;
    const cityName = cityId ? cityMap[String(cityId)] || "" : "";

    const qAdult = Number(i.quantityAdult || 0);
    const qChild = Number(i.quantityChildren || 0);
    const qBaby = Number(i.quantityBaby || 0);

    const unitAdult = Number(i.priceNewAdult || 0);
    const unitChild = Number(i.priceNewChildren || 0);

    const ctx = getBabyPricingCtx(i, tourById);

    let babyTotal = 0;
    for (let idx = 1; idx <= qBaby; idx++) {
      babyTotal += babyUnitAt(ctx, idx);
    }

    const babyUnitForUi = babyUnitAt(ctx, Math.max(1, qBaby || 1));

    const extraRoomCost = Number(i.extraRoomCost || 0);
    const babySeatFeeTotal = Number(i.babySeatFeeTotal || 0);

    subTotalView +=
      qAdult * unitAdult +
      qChild * unitChild +
      babyTotal +
      extraRoomCost +
      babySeatFeeTotal;

    const enriched = enrichItemBabySeatsDisplay({
      ...i,
      departureDateFormat,
      cityName,
      babyUnitForUi,
    });

    return enriched;
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

  return {
    orderDetail,
    pageTitle: `Đơn hàng: ${orderDetail.code}`,
  };
}

module.exports.buildOrderEditLocals = buildOrderEditLocals;

module.exports.edit = async (req, res) => {
  try {
    const id = req.params.id;
    const companyId = req.account?.companyId || null;
    const vm = await buildOrderEditLocals(id, companyId);
    if (!vm) return res.redirect(`/${pathAdmin}/order/list`);

    return res.render("admin/pages/order-edit", {
      pageTitle: vm.pageTitle,
      orderDetail: vm.orderDetail,
      paymentMethodList,
      paymentStatusList,
      statusList,
      readOnly: false,
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

    // Đọc đơn hàng đầy đủ trước khi cập nhật
    // (cho audit + khôi phục/trừ ghế/phòng khi đổi trạng thái)
    const orderSnapshot = await Order.findOne(filter)
      .select("code status paymentStatus paymentMethod note userId email fullName items")
      .lean();

    // Đọc đầy đủ items cho 2 trường hợp:
    //   A) cancel (lần đầu) → cần items để restore ghế
    //   B) bỏ cancel (từ cancel → trạng thái khác) → cần items để trừ ghế lại
    const isGoingToCancel =
      allow.status === "cancel" &&
      orderSnapshot &&
      orderSnapshot.status !== "cancel";

    const isLeavingCancel =
      allow.status &&
      allow.status !== "cancel" &&
      orderSnapshot &&
      orderSnapshot.status === "cancel";

    const orderBefore =
      (isGoingToCancel || isLeavingCancel)
        ? await Order.findOne({ _id: id, deleted: false }).lean()
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

    if (orderSnapshot) {
      const isCancel = allow.status === "cancel";
      const beforeAudit = {
        status: orderSnapshot.status,
        paymentStatus: orderSnapshot.paymentStatus,
        paymentMethod: orderSnapshot.paymentMethod,
        note: orderSnapshot.note,
      };
      const afterAudit = {
        status: allow.status ?? orderSnapshot.status,
        paymentStatus: allow.paymentStatus ?? orderSnapshot.paymentStatus,
        paymentMethod: allow.paymentMethod ?? orderSnapshot.paymentMethod,
        note: "note" in allow ? allow.note : orderSnapshot.note,
      };
      auditLogHelper.log(req, {
        action: isCancel ? "order.cancel" : "order.update",
        resourceType: "Order",
        resourceId: id,
        resourceLabel: orderSnapshot.code || "",
        before: beforeAudit,
        after: afterAudit,
        summary: isCancel
          ? `Hủy đơn hàng "${orderSnapshot.code || ""}"`
          : `Cập nhật đơn hàng "${orderSnapshot.code || ""}"`,
      });
    }

    // Khi hủy đơn tour → khôi phục ghế và giải phóng phòng khách sạn
    if (isGoingToCancel && orderBefore) {
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
      // Xoá HotelBooking hold đã tạo khi khách đặt (cả private lẫn shared)
      try {
        if (orderBefore.code) {
          await HotelBooking.deleteMany({ orderCode: orderBefore.code });
        }
      } catch (err) {
        console.error("[editPatch] deleteHotelBookings error:", err);
      }
    }

    // Khi bỏ hủy (cancel → trạng thái khác) → trừ lại ghế + tái tạo HotelBooking hold
    if (isLeavingCancel && orderBefore) {
      try {
        await deductSeatsForOrder(orderBefore);
      } catch (err) {
        console.error("[editPatch] deductSeatsForOrder error:", err);
      }
      try {
        await recreateHotelHoldsForOrder(orderBefore);
      } catch (err) {
        console.error("[editPatch] recreateHotelHoldsForOrder error:", err);
      }
    }

    if (orderSnapshot) {
      const afterState = {
        status: allow.status ?? orderSnapshot.status,
        paymentStatus: allow.paymentStatus ?? orderSnapshot.paymentStatus,
        paymentMethod: allow.paymentMethod ?? orderSnapshot.paymentMethod,
        note: "note" in allow ? allow.note : orderSnapshot.note,
      };
      const beforeState = {
        status: orderSnapshot.status,
        paymentStatus: orderSnapshot.paymentStatus,
        paymentMethod: orderSnapshot.paymentMethod,
        note: orderSnapshot.note,
      };
      const changes = diffChanges(beforeState, afterState, [
        "status",
        "paymentStatus",
        "paymentMethod",
        "note",
      ]);
      if (changes.length > 0) {
        try {
          const tourNameFromOrder = (orderSnapshot.items || [])
            .map((i) => i.name).filter(Boolean)[0] || "";
          await notifyCustomerOrderUpdate({
            userId: orderSnapshot.userId,
            email: orderSnapshot.email,
            customerName: orderSnapshot.fullName,
            type: "tour_order",
            tourName: tourNameFromOrder,
            resourceLabel: orderSnapshot.code || "Đơn tour",
            orderCode: orderSnapshot.code,
            orderId: id,
            link: buildTourOrderProfileLink(
              orderSnapshot.code,
              afterState.status
            ),
            changes,
            introLine: tourNameFromOrder
              ? `Đơn tour "${tourNameFromOrder}" của bạn đã được cập nhật.`
              : "Đơn tour của bạn đã được cập nhật bởi nhân viên quản trị.",
          });
        } catch (notifyErr) {
          console.error("[editPatch] notifyCustomerOrderUpdate:", notifyErr);
        }
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

    // Khôi phục top-level seatsRemaining
    await Tour.updateOne(
      { _id: item.tourId },
      { $inc: { seatsRemaining: seatsToRestore } }
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
 * Trừ ghế cho các tour item trong đơn hàng (đối xứng với restoreSeatsForOrder).
 * Dùng khi admin "bỏ hủy" đơn (cancel → trạng thái khác).
 */
async function deductSeatsForOrder(order) {
  for (const item of order.items || []) {
    if (!item.tourId) continue;

    const seatsToDeduct =
      Number(item.quantityAdult    || 0) +
      Number(item.quantityChildren || 0) +
      (item.babySeat ? Number(item.quantityBaby || 0) : 0);

    if (seatsToDeduct <= 0) continue;

    await Tour.updateOne(
      { _id: item.tourId },
      { $inc: { seatsRemaining: -seatsToDeduct } }
    );

    const depDisplay = item.departureDateDisplay
      || (item.departureDate ? moment(item.departureDate).format("DD/MM/YYYY") : "");
    if (depDisplay) {
      const depMoment = moment(depDisplay, "DD/MM/YYYY");
      if (depMoment.isValid()) {
        await Tour.updateOne(
          { _id: item.tourId },
          { $inc: { "departures.$[dep].seatsRemaining": -seatsToDeduct } },
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
 * Tái tạo HotelBooking hold cho đơn hàng khi admin "bỏ hủy".
 * Tạo lại HotelBooking [Tour Booking] cho cả mode private (roomSelections)
 * lẫn mode shared (sharedRoomRequest.hotelAllocations.roomAssignments).
 */
async function recreateHotelHoldsForOrder(order) {
  if (!order || !Array.isArray(order.items)) return;

  // Hold 15 phút từ thời điểm khôi phục (giống flow tạo đơn mới)
  const holdExpiresAt = moment().add(15, "minutes").toDate();
  const { generateRandomNumber } = require("../../helpers/generate.helper");

  for (const item of order.items || []) {
    // Mode private: tạo lại từ roomSelections
    if (item.accommodationMode !== "shared") {
      for (const sel of item.roomSelections || []) {
        for (let i = 0; i < (sel.selectedRooms || 1); i++) {
          await new HotelBooking({
            code: "HB" + generateRandomNumber(10),
            guest: {
              fullName: (order.fullName || "").trim(),
              phone:    (order.phone    || "").trim(),
              email:    (order.email    || "").trim(),
            },
            checkIn:       new Date(sel.fromDate),
            checkOut:      new Date(sel.toDate),
            adults:        sel.baseOccupancy || 2,
            children:      0,
            rooms:         1,
            roomTypeId:    sel.roomTypeId,
            hotel: {
              hotelId: sel.hotelId,
              name:    sel.hotelName,
            },
            status:        "pending",
            paymentStatus: "unpaid",
            paymentMethod: order.paymentMethod || "money",
            note:          `[Tour Booking] Đặt phòng qua tour - Đơn ${order.code}`,
            tourSegmentId: sel.tourSegmentId,
            isTemporaryHold: true,
            holdExpiresAt,
            orderCode:     order.code,
          }).save();
        }
      }
      continue;
    }

    // Mode shared: rebind TH (Tour Hold) + push lại TourSegment.assignments
    // (giống flow tạo đơn mới ở controllers/client/order.controller.js).
    const _segCacheById = {};
    const _hotelDocCache = {};
    const pendingSegPushes = {};

    const _getSegmentCache = async (segId) => {
      const k = String(segId);
      if (_segCacheById[k]) return _segCacheById[k];
      const doc = await TourSegment.findById(k).select("assignments").lean();
      const used = new Set(
        (doc?.assignments || [])
          .map((a) => (a.holdBookingId ? String(a.holdBookingId) : ""))
          .filter(Boolean)
      );
      _segCacheById[k] = { usedHoldIds: used };
      return _segCacheById[k];
    };
    const _getHotelDoc = async (hotelId) => {
      const k = String(hotelId);
      if (_hotelDocCache[k]) return _hotelDocCache[k];
      const doc = await Hotel.findById(k).select("rooms name").lean();
      _hotelDocCache[k] = doc || null;
      return doc || null;
    };

    for (const r of item.sharedRoomRequest || []) {
      const segCache = await _getSegmentCache(r.tourSegmentId);
      for (const alloc of r.hotelAllocations || []) {
        const hotelDoc = await _getHotelDoc(alloc.hotelId);
        for (const ra of alloc.roomAssignments || []) {
          const noteTxt = `[Tour Booking - Ở ghép] Đặt phòng qua tour - Đơn ${order.code}${
            Array.isArray(ra.atomLabels) && ra.atomLabels.length
              ? " | " + ra.atomLabels.join(" || ")
              : ""
          }`;
          const guestFullName =
            (order.fullName || "").trim() || "Khách tour";

          // Reuse TH (cross-order share) hay chiếm TH mới?
          let pickedTh = null;
          if (ra._reuseThId) {
            const reuse = await HotelBooking.findById(ra._reuseThId)
              .select("_id roomId roomTypeId hotel guest note")
              .lean();
            if (reuse) {
              pickedTh = reuse;
              const appendStr = `|| Đơn ${order.code}: ${
                Array.isArray(ra.atomLabels) && ra.atomLabels.length
                  ? ra.atomLabels.join(" || ")
                  : guestFullName
              }`;
              await HotelBooking.findByIdAndUpdate(reuse._id, {
                $set: { note: (reuse.note || "") + " " + appendStr },
              });
            }
          }

          if (!pickedTh) {
            const candidates = await HotelBooking.find({
              tourSegmentId: String(r.tourSegmentId),
              "hotel.hotelId": alloc.hotelId,
              roomTypeId: ra.roomTypeId,
              roomId: { $ne: null },
              checkIn: new Date(r.fromDate),
              checkOut: new Date(r.toDate),
              status: { $nin: ["cancelled", "checked_out"] },
              "guest.fullName": "[Tour Hold]",
              $or: [
                { orderCode: { $in: [null, ""] } },
                { orderCode: { $exists: false } },
              ],
            })
              .select("_id roomId roomTypeId hotel")
              .lean();

            for (const cand of candidates) {
              const cid = String(cand._id);
              if (segCache.usedHoldIds.has(cid)) continue;
              pickedTh = cand;
              segCache.usedHoldIds.add(cid);
              break;
            }

            if (pickedTh) {
              await HotelBooking.findByIdAndUpdate(pickedTh._id, {
                $set: {
                  "guest.fullName": guestFullName,
                  "guest.phone": (order.phone || "").trim(),
                  "guest.email": (order.email || "").trim(),
                  orderCode: order.code,
                  note: noteTxt,
                  paymentStatus: "unpaid",
                  paymentMethod: order.paymentMethod || "money",
                },
              });
            }
          }

          if (pickedTh) {
            let roomNumber = "";
            if (hotelDoc && Array.isArray(hotelDoc.rooms)) {
              const rDoc = hotelDoc.rooms.find(
                (rr) => String(rr._id) === String(pickedTh.roomId)
              );
              if (rDoc) roomNumber = rDoc.roomNumber || "";
            }
            const segKey = String(r.tourSegmentId);
            if (!pendingSegPushes[segKey]) pendingSegPushes[segKey] = [];
            pendingSegPushes[segKey].push({
              orderId: order._id,
              orderCode: order.code,
              guestName: guestFullName,
              phone: (order.phone || "").trim(),
              numPeople:
                Number(ra.usedCapacity) || Number(ra.baseOccupancy) || 2,
              hotelId: new mongoose.Types.ObjectId(alloc.hotelId),
              hotelName: alloc.hotelName || hotelDoc?.name || "",
              roomId: pickedTh.roomId,
              roomNumber,
              roomTypeName: ra.roomTypeName || "",
              holdBookingId: pickedTh._id,
              accommodationMode: "shared",
              gender: ra.gender || null,
              atomLabels: Array.isArray(ra.atomLabels) ? ra.atomLabels : [],
            });
          } else {
            await new HotelBooking({
              code: "HB" + generateRandomNumber(10),
              guest: {
                fullName: guestFullName,
                phone: (order.phone || "").trim(),
                email: (order.email || "").trim(),
              },
              checkIn: new Date(r.fromDate),
              checkOut: new Date(r.toDate),
              adults: ra.baseOccupancy || 2,
              children: 0,
              rooms: 1,
              roomTypeId: ra.roomTypeId,
              hotel: {
                hotelId: alloc.hotelId,
                name: alloc.hotelName,
              },
              status: "pending",
              paymentStatus: "unpaid",
              paymentMethod: order.paymentMethod || "money",
              note: noteTxt,
              tourSegmentId: r.tourSegmentId,
              isTemporaryHold: true,
              holdExpiresAt,
              orderCode: order.code,
            }).save();
          }
        }
      }
    }

    for (const segId of Object.keys(pendingSegPushes)) {
      const arr = pendingSegPushes[segId];
      if (!arr.length) continue;
      await TourSegment.updateOne(
        { _id: segId },
        { $push: { assignments: { $each: arr } } }
      );
    }
  }
}

/**
 * Giải phóng các phòng khách sạn đã được phân công cho một đơn hàng tour.
 * - Xoá entry trong TourSegment.assignments
 * - Reset HotelBooking về trạng thái "[Tour Hold]" (chưa gán khách)
 */
async function releaseHotelHoldsForOrder(orderId) {
  // Tìm tất cả TourSegment có assignment cho đơn này. Lưu ý: 1 TH có thể
  // được nhiều đơn (shared cross-order) cùng share — khi release đơn này
  // chỉ pull entries của đơn ra, và CHỈ reset TH về [Tour Hold] nếu sau
  // khi pull không còn đơn khác nào tham chiếu.
  const segments = await TourSegment.find({
    "assignments.orderId": orderId,
  }).select("_id tourId departureDate endDate assignments").lean();

  if (!segments.length) return;

  for (const seg of segments) {
    // Lấy các holdBookingId thuộc đơn này
    const toRelease = (seg.assignments || []).filter(
      (a) => String(a.orderId) === String(orderId)
    );
    const holdBookingIdsAll = toRelease
      .map((a) => a.holdBookingId)
      .filter(Boolean);

    // Phân loại: TH chỉ thuộc đơn này (cần reset) vs TH share với đơn khác
    // (chỉ rebuild note, giữ nguyên guest/orderCode của đơn còn lại).
    const holdToReset = [];
    const holdToKeep = []; // [{thId, remainingEntries[]}]
    for (const thId of holdBookingIdsAll) {
      const remaining = (seg.assignments || []).filter(
        (a) =>
          String(a.holdBookingId || "") === String(thId) &&
          String(a.orderId) !== String(orderId)
      );
      if (remaining.length === 0) {
        holdToReset.push(thId);
      } else {
        holdToKeep.push({ thId, remaining });
      }
    }

    // Xoá assignment khỏi TourSegment (cho đơn này)
    await TourSegment.updateOne(
      { _id: seg._id },
      { $pull: { assignments: { orderId: new mongoose.Types.ObjectId(orderId) } } }
    );

    // Reset TH không còn đơn nào dùng
    if (holdToReset.length) {
      const tourDoc = await Tour.findById(seg.tourId).select("name").lean();
      const tourName   = tourDoc?.name || "Tour";
      const depDateFmt = moment(seg.departureDate).format("DD/MM/YYYY");
      const endDateFmt = moment(seg.endDate).format("DD/MM/YYYY");
      const resetNote  = `[Tour Hold] ${tourName} | ${depDateFmt} – ${endDateFmt}`;

      await HotelBooking.updateMany(
        { _id: { $in: holdToReset } },
        {
          $set: {
            "guest.fullName": "[Tour Hold]",
            "guest.phone":    "",
            "guest.email":    "",
            note:             resetNote,
            status:           "confirmed",
            isTemporaryHold:  false,
          },
          $unset: {
            orderCode:     "",
            holdExpiresAt: "",
            userId:        "",
          },
        }
      );
    }

    // Rebuild note cho TH còn share — guest/orderCode giữ theo đơn còn lại
    // đầu tiên (sort theo orderCode để stable).
    for (const { thId, remaining } of holdToKeep) {
      const sorted = [...remaining].sort((a, b) =>
        String(a.orderCode || "").localeCompare(String(b.orderCode || ""))
      );
      const primary = sorted[0];
      const noteParts = sorted.map((entry) => {
        const labels = Array.isArray(entry.atomLabels) && entry.atomLabels.length
          ? entry.atomLabels.join(" || ")
          : entry.guestName || "";
        return `Đơn ${entry.orderCode || "?"}: ${labels}`;
      });
      const newNote = `[Tour Booking - Ở ghép] Share phòng | ${noteParts.join(" || ")}`;
      await HotelBooking.findByIdAndUpdate(thId, {
        $set: {
          "guest.fullName": primary.guestName || "Khách tour",
          "guest.phone": primary.phone || "",
          orderCode: primary.orderCode || "",
          note: newNote,
        },
      });
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

    // Soft delete đơn
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

    // ── Dọn dữ liệu phụ thuộc của đơn vừa xoá ──
    // Nếu không xoá đồng thời, các bản ghi sau vẫn "trôi nổi" trong hệ thống
    // và làm sai lệch các trang quản trị (ví dụ /admin/hotel/booking/tour-holds
    // vẫn hiện khách của đơn đã bị xoá; số phòng còn trống ở /company/.../tour
    // bị tính nhầm; tour-assignments giữ entry rỗng tham chiếu Order đã xoá).
    try {
      // 1) Trả lại ghế cho tour — CHỈ khi đơn chưa hủy. Nếu đơn đã ở
      //    trạng thái "cancel" thì ghế đã được trả về lúc editPatch chuyển
      //    sang cancel rồi, không được restore thêm lần nữa (double-restore).
      if (order.status !== "cancel") {
        await restoreSeatsForOrder(order);
      }

      // 2) Reset các TH (Tour Hold) đang được gán cho đơn này về placeholder
      //    + xóa entry assignments — phải làm BƯỚC NÀY trước bước 3 để
      //    deleteMany ở bước 3 không xóa nhầm các TH đang giữ quota tour.
      await releaseHotelHoldsForOrder(order._id);

      // 3) Xoá các HotelBooking giữ chỗ tour của đơn này (link qua orderCode)
      //    để chúng không còn xuất hiện ở trang "Giữ phòng Tour".
      //    Sau bước 2, TH đã bị clear orderCode → chỉ HotelBooking khách-tự-tạo
      //    (HB...) còn orderCode và sẽ bị xóa.
      if (order.code) {
        await HotelBooking.deleteMany({ orderCode: order.code });
      }
    } catch (cleanupErr) {
      // Không chặn flow xoá đơn — chỉ log để admin truy vết.
      console.error(
        "admin order deletePatch cleanup error:",
        cleanupErr
      );
    }

    return res.json({
      code: "success",
      message: "Xóa đơn hàng thành công!",
    });
  } catch (error) {
    console.error("admin order deletePatch error:", error);
    return res.json({ code: "error", message: "Có lỗi xảy ra!" });
  }
};
