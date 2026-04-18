const { generateRandomNumber } = require("../../helpers/generate.helper");
const Order = require("../../models/order.model");
const Tour = require("../../models/tour.model");
const City = require("../../models/city.model");
const {
  paymentMethodList,
  paymentStatusList,
  statusList,
  pathAdmin,
} = require("../../config/variable.config");
const moment = require("moment");
const {
  allocateHotelsForGroup,
  estimateCheckOut,
} = require("../../helpers/hotel-allocation.helper");
const HotelBooking = require("../../models/hotel-booking.model");
const Notification = require("../../models/notification.model");
const TourSegment = require("../../models/tour-segment.model");

// === Helpers: tính giá em bé theo bậc (theo vị trí bé #1, #2, ...) ===
function babyUnitAt(idx, mode, rules, priceAdult, priceChild, priceBabyFixed) {
  if (mode !== "tiered" || !Array.isArray(rules) || !rules.length) {
    return Number(priceBabyFixed || 0);
  }
  const found = rules.find((r) => {
    const from = Number(r.from);
    const to = r.to === "inf" ? Infinity : Number(r.to);
    return Number.isFinite(from) && idx >= from && idx <= to;
  });
  if (!found) return 0;
  const base =
    found.ref === "adult" ? Number(priceAdult || 0) : Number(priceChild || 0);
  const pct = Number(found.percent || 0);
  return Math.round((base * pct) / 100);
}

function babyTotalQty(
  qty,
  mode,
  rules,
  priceAdult,
  priceChild,
  priceBabyFixed
) {
  let sum = 0;
  qty = Number(qty || 0);
  for (let i = 1; i <= qty; i++) {
    sum += babyUnitAt(i, mode, rules, priceAdult, priceChild, priceBabyFixed);
  }
  return sum;
}

// ── Helper: hủy đơn hold và trả lại ghế cho tour ─────────────────────────────
async function _cancelHoldAndRestoreSeats(order) {
  try {
    // Chỉ hủy nếu chưa thanh toán
    if (order.paymentStatus === "paid") return;

    // Khôi phục ghế cho từng tour item
    for (const item of order.items || []) {
      if (!item.tourId) continue;

      const seatsToRestore =
        Number(item.quantityAdult    || 0) +
        Number(item.quantityChildren || 0) +
        (item.babySeat ? Number(item.quantityBaby || 0) : 0);

      // 1. Khôi phục top-level seatsRemaining
      await Tour.updateOne(
        { _id: item.tourId },
        { $inc: { seatsRemaining: seatsToRestore } }
      );

      // 2. Khôi phục seatsRemaining cho đúng ngày khởi hành trong departures[]
      if (item.departureDateDisplay && seatsToRestore > 0) {
        const depMoment = moment(item.departureDateDisplay, "DD/MM/YYYY");
        if (depMoment.isValid()) {
          await Tour.updateOne(
            { _id: item.tourId },
            { $inc: { "departures.$[dep].seatsRemaining": seatsToRestore } },
            {
              arrayFilters: [{
                "dep.departureDate": {
                  $gte: depMoment.startOf("day").toDate(),
                  $lte: depMoment.endOf("day").toDate(),
                },
              }],
            }
          );
        }
      }
    }

    await Order.updateOne(
      { _id: order._id },
      { status: "cancel", isTemporaryHold: false, holdExpiresAt: null }
    );
  } catch (err) {
    console.error("_cancelHoldAndRestoreSeats error:", err);
  }
}

module.exports.createPost = async (req, res) => {
  try {
    const body = req.body || {};
    const incomingItems = Array.isArray(body.items) ? body.items : [];
    if (!incomingItems.length) {
      return res.json({ code: "error", message: "Không có tour nào để đặt!" });
    }

    // Nhóm item theo companyId
    const groups = Object.create(null);

    for (const raw of incomingItems) {
      const { tourId } = raw || {};
      if (!tourId) continue;

      // Tour đang active
      const tourInfo = await Tour.findOne({
        _id: tourId,
        deleted: false,
        status: "active",
      }).lean();
      if (!tourInfo) continue;

      // Chuẩn hoá số lượng
      const quantityAdult = Number(raw.quantityAdult || 0);
      const quantityChildren = Number(raw.quantityChildren || 0);
      const quantityBaby = Number(raw.quantityBaby || 0);
      const babySeat = !!raw.babySeat;

      // Tuổi từng trẻ em / em bé (do client cung cấp)
      const childrenAges = Array.isArray(raw.childrenAges)
        ? raw.childrenAges.map(Number).slice(0, quantityChildren)
        : [];
      const babyAges = Array.isArray(raw.babyAges)
        ? raw.babyAges.map(Number).slice(0, quantityBaby)
        : [];

      // Chụp thông tin giá tại thời điểm đặt
      const priceAdult = Number(tourInfo.priceNewAdult || 0);
      const priceChild = Number(tourInfo.priceNewChildren || 0);
      const priceBabyFix = Number(tourInfo.priceNewBaby || 0);

      // Cấu hình tiered (nếu có)
      const babyMode = (tourInfo.babyPricingMode || "fixed").trim();
      const babyRules = Array.isArray(tourInfo.babyPricingRules)
        ? tourInfo.babyPricingRules
        : [];

      // ==== TÍNH TIỀN DÒNG ====
      const moneyAdult = quantityAdult * priceAdult;
      const moneyChild = quantityChildren * priceChild;
      const moneyBaby = babyTotalQty(
        quantityBaby,
        babyMode,
        babyRules,
        priceAdult,
        priceChild,
        priceBabyFix
      );
      const extraRoomCost = Number(raw.extraRoomCost || 0);
      const lineSubTotal = moneyAdult + moneyChild + moneyBaby + extraRoomCost;

      // ==== TÍNH GHẾ & CẬP NHẬT ATOMIC ====
      // seatsUsed = số ghế thực sự chiếm trên xe / máy bay
      const seatsUsed =
        quantityAdult + quantityChildren + (babySeat ? quantityBaby : 0);

      // ── Kiểm tra & giảm ghế bằng atomic conditional update ──────────────────
      // Điều kiện: seatsRemaining >= seatsUsed (tránh race condition khi nhiều
      // user cùng đặt tour còn ít chỗ).
      // $inc giảm nguyên tử → chỉ 1 request thắng nếu ghế vừa đủ.
      const seatUpdateResult = await Tour.updateOne(
        {
          _id:            tourInfo._id,
          deleted:        false,
          status:         "active",
          seatsRemaining: { $gte: seatsUsed }, // CHỈ update nếu còn đủ ghế
        },
        {
          $inc: { seatsRemaining: -seatsUsed },
        }
      );

      // Nếu không có bản ghi nào được cập nhật → tour đã hết chỗ
      if (seatUpdateResult.modifiedCount === 0) {
        return res.json({
          code:    "error",
          message: `Tour "${tourInfo.name}" vừa hết chỗ! Vui lòng chọn chuyến khác hoặc liên hệ tư vấn viên.`,
        });
      }

      // Giảm seatsRemaining cho đúng ngày khởi hành trong departures[]
      const departureDateDisplay = raw.departureDateDisplay;
      if (departureDateDisplay && seatsUsed > 0) {
        const depMoment = moment(departureDateDisplay, "DD/MM/YYYY");
        if (depMoment.isValid()) {
          await Tour.updateOne(
            { _id: tourInfo._id },
            { $inc: { "departures.$[dep].seatsRemaining": -seatsUsed } },
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

      // Gom theo công ty
      const companyId = String(tourInfo.companyId || "");
      if (!groups[companyId]) groups[companyId] = { items: [], subTotal: 0 };

      // === LỚP TRUNG GIAN: Greedy phân bổ đoàn vào các khách sạn của tour ===
      // Số người cần chỗ ở = người lớn + trẻ em (em bé thường không tính phòng riêng)
      const totalPeopleForHotel = quantityAdult + quantityChildren;

      let hotelAllocation = {
        status: "no_hotels",
        totalPeople: totalPeopleForHotel,
        totalAssigned: 0,
        remaining: totalPeopleForHotel,
        checkIn: null,
        checkOut: null,
        allocations: [],
      };

      const tourAccommodations = Array.isArray(tourInfo.accommodations)
        ? tourInfo.accommodations
        : [];

      if (tourAccommodations.length > 0 && totalPeopleForHotel > 0) {
        // Xác định ngày nhận phòng từ ngày khởi hành khách đã chọn
        const checkIn = raw.departureDateDisplay
          ? moment(raw.departureDateDisplay, "DD/MM/YYYY").toDate()
          : tourInfo.departureDate
          ? new Date(tourInfo.departureDate)
          : new Date();

        // Tìm ngày kết thúc tương ứng trong mảng departures của tour
        let checkOut = null;
        if (Array.isArray(tourInfo.departures) && tourInfo.departures.length > 0) {
          const matched = tourInfo.departures.find((d) => {
            if (!d.departureDate) return false;
            const depStr = moment(d.departureDate).format("DD/MM/YYYY");
            return depStr === (raw.departureDateDisplay || "");
          });
          if (matched && matched.endDate) {
            checkOut = new Date(matched.endDate);
          }
        }
        // Fallback: ước tính từ chuỗi time nếu không tìm được endDate
        if (!checkOut) {
          checkOut = estimateCheckOut(checkIn, tourInfo.time);
        }

        // Chạy thuật toán Greedy phân bổ
        const allocationResult = await allocateHotelsForGroup(
          totalPeopleForHotel,
          tourAccommodations,
          checkIn,
          checkOut
        );

        hotelAllocation = {
          ...allocationResult,
          totalPeople: totalPeopleForHotel,
          checkIn,
          checkOut,
        };
      }

      groups[companyId].items.push({
        tourId: String(tourInfo._id),

        // KHÔNG dùng locationFrom nữa, lưu departureCity
        departureCity: tourInfo.departureCity || null,

        // Lưu lại ngày khởi hành mà client đã chọn (nếu có)
        departureDateDisplay:
          (raw.departureDateDisplay &&
            String(raw.departureDateDisplay).trim()) || null,

        quantityAdult,
        quantityChildren,
        quantityBaby,
        babySeat,
        childrenAges,
        babyAges,

        // Giá snapshot
        priceNewAdult: priceAdult,
        priceNewChildren: priceChild,
        priceNewBaby: priceBabyFix,

        // Chụp cấu hình tính giá em bé để các màn hiển thị dùng lại
        babyPricingMode: babyMode,
        babyPricingRules: babyRules,

        // Thông tin render
        departureDate: tourInfo.departureDate,
        avatar: tourInfo.avatar,
        name: tourInfo.name,
        slug: tourInfo.slug,

        // Quyền theo công ty
        companyId: tourInfo.companyId || null,

        // Kết quả phân bổ Greedy: ai ở khách sạn nào
        hotelAllocation,

        // Phòng khách sạn khách chọn từ tour-hotel liên kết
        roomSelections: Array.isArray(raw.roomSelections) ? raw.roomSelections : [],

        // Chi phí phòng dư (nếu khách chọn nhiều hơn nhu cầu)
        extraRoomCost: extraRoomCost || 0,
      });

      groups[companyId].subTotal += lineSubTotal;
    }

    const companyIds = Object.keys(groups);
    if (!companyIds.length) {
      return res.json({
        code: "error",
        message: "Các tour bạn chọn hiện không khả dụng!",
      });
    }

    // ── Kiểm tra phòng khách sạn trước khi tạo đơn (race condition check) ──
    const allRoomSelections = [];
    for (const cid of companyIds) {
      for (const item of groups[cid].items) {
        if (!Array.isArray(item.roomSelections) || item.roomSelections.length === 0) continue;
        for (const sel of item.roomSelections) {
          allRoomSelections.push(sel);
        }
      }
    }

    if (allRoomSelections.length > 0) {
      for (const sel of allRoomSelections) {
        const checkIn = new Date(sel.fromDate);
        const checkOut = new Date(sel.toDate);

        const ts = await TourSegment.findById(sel.tourSegmentId).lean();
        if (!ts || (ts.status !== "confirmed" && ts.status !== "pending_approval")) {
          return res.json({
            code: "room_unavailable",
            message: `Tour segment không còn khả dụng. Vui lòng tải lại trang và chọn lại.`,
          });
        }

        let assignedRooms = 0;
        for (const seg of (ts.segments || [])) {
          for (const h of (seg.hotels || [])) {
            if (String(h.hotelId) !== String(sel.hotelId)) continue;
            for (const ra of (h.roomAllocations || [])) {
              if (String(ra.roomTypeId) === String(sel.roomTypeId)) {
                assignedRooms += ra.assignedRooms || 0;
              }
            }
          }
        }

        const clientBookedForTour = await HotelBooking.countDocuments({
          tourSegmentId: ts._id,
          "hotel.hotelId": sel.hotelId,
          roomTypeId: sel.roomTypeId,
          status: { $nin: ["cancelled", "checked_out"] },
          checkIn: { $lt: checkOut },
          checkOut: { $gt: checkIn },
          note: /\[Tour Booking\]/,
        });

        const availableForClient = Math.max(0, assignedRooms - clientBookedForTour);
        if (sel.selectedRooms > availableForClient) {
          return res.json({
            code: "room_unavailable",
            message: `Loại phòng "${sel.roomTypeName}" tại ${sel.hotelName} chỉ còn ${availableForClient} phòng. Vui lòng chọn lại.`,
          });
        }
      }
    }

    // Lấy user đang đăng nhập (nếu có) từ middleware attachUser
    const currentUser = req.account || null;
    const userId = currentUser?._id || null;
    const userName = currentUser?.fullName || currentUser?.email || "";

    const holdExpiresAt = moment().add(15, "minutes").toDate();

    // Tạo đơn cho từng công ty
    const createdOrders = [];
    for (const cid of companyIds) {
      const { items, subTotal } = groups[cid];

      const code = "OD" + generateRandomNumber(10);
      const discount = 0;
      const total = subTotal - discount;

      const newRecord = new Order({
        code,
        fullName: (body.fullName || "").trim(),
        phone: (body.phone || "").trim(),
        email: (body.email || "").trim(),
        cccdImages: Array.isArray(body.cccdImages) ? body.cccdImages : [],
        note: body.note || "",
        items,
        subTotal,
        discount,
        total,
        paymentMethod: body.paymentMethod,
        paymentStatus: "unpaid",
        status: "initial",

        ...(userId ? { userId } : {}),
        ...(userName ? { userName } : {}),

        isTemporaryHold: true,
        holdExpiresAt,
      });

      await newRecord.save();

      // ── Tạo HotelBooking hold cho roomSelections ──
      for (const item of items) {
        if (!Array.isArray(item.roomSelections) || item.roomSelections.length === 0) continue;
        for (const sel of item.roomSelections) {
          for (let i = 0; i < sel.selectedRooms; i++) {
            await new HotelBooking({
              code: "HB" + generateRandomNumber(10),
              guest: {
                fullName: (body.fullName || "").trim(),
                phone: (body.phone || "").trim(),
                email: (body.email || "").trim(),
              },
              checkIn: new Date(sel.fromDate),
              checkOut: new Date(sel.toDate),
              adults: sel.baseOccupancy || 2,
              children: 0,
              rooms: 1,
              roomTypeId: sel.roomTypeId,
              hotel: {
                hotelId: sel.hotelId,
                name: sel.hotelName,
              },
              status: "pending",
              paymentStatus: "unpaid",
              paymentMethod: body.paymentMethod || "money",
              note: `[Tour Booking] Đặt phòng qua tour - Đơn ${code}`,
              tourSegmentId: sel.tourSegmentId,
              isTemporaryHold: true,
              holdExpiresAt,
              ...(userId ? { userId } : {}),
            }).save();
          }
        }
      }

      createdOrders.push({
        orderCode: code,
        companyId: cid || null,
        phone: body.phone,
        total,
      });

      // ── Gửi thông báo cho company admin ──
      if (cid && body.paymentMethod !== "vnpay") {
        try {
          const pmName =
            body.paymentMethod === "bank" ? "Chuyển khoản ngân hàng" : "Tiền mặt";
          const tourNames = items.map((i) => i.name).filter(Boolean).join(", ");
          const fullName = (body.fullName || "").trim();
          await Notification.create({
            companyId: cid,
            type: "order",
            title: "Đơn tour mới",
            content: `${fullName} đã đặt tour: ${tourNames} (${pmName})`,
            link: `/${pathAdmin}/order/edit/${newRecord._id}`,
            metadata: {
              bookingCode: code,
              customerName: fullName,
              paymentMethod: pmName,
              amount: total,
            },
          });
        } catch (notifErr) {
          console.error("Error creating order notification:", notifErr);
        }
      }
    }

    return res.json({
      code: "success",
      message: "Tạo đơn hàng thành công!",
      isMulti: createdOrders.length > 1,
      orders: createdOrders,
    });
  } catch (error) {
    console.error("order.createPost error:", error);
    return res.json({ code: "error", message: "Dữ liệu không hợp lệ!" });
  }
};

/**
 * GET /order/pending?orderCode=...&phone=...
 * Hiển thị trang đơn tour đang chờ xác nhận / thanh toán
 */
module.exports.pending = async (req, res) => {
  try {
    const { orderCode, phone } = req.query;

    if (!orderCode || !phone) {
      return res.redirect("/");
    }

    const orderDetail = await Order.findOne({
      code: orderCode,
      phone: phone,
      deleted: false,
    }).lean();

    if (!orderDetail) {
      return res.redirect("/");
    }

    // Nếu đã thanh toán → chuyển thẳng sang trang thành công
    if (orderDetail.paymentStatus === "paid") {
      return res.redirect(
        `/order/success?orderCode=${orderDetail.code}&phone=${phone}`
      );
    }

    // Nếu đơn tạm đã hết hạn mà chưa thanh toán → tự động hủy và restore ghế
    if (
      orderDetail.isTemporaryHold &&
      orderDetail.paymentStatus === "unpaid" &&
      orderDetail.holdExpiresAt &&
      new Date() > new Date(orderDetail.holdExpiresAt)
    ) {
      await _cancelHoldAndRestoreSeats(orderDetail);
      return res.redirect("/?expired=1");
    }

    // Gắn tên hiển thị cho phương thức thanh toán
    const pm = paymentMethodList.find((item) => item.value === orderDetail.paymentMethod);
    orderDetail.paymentMethodName = pm ? pm.label : "Không xác định";

    orderDetail.createdAtFormat = moment(orderDetail.createdAt).format("HH:mm - DD/MM/YYYY");

    // Format ngày khởi hành và tên thành phố cho từng item
    for (const item of orderDetail.items) {
      const departureDisplay =
        (item.departureDateDisplay && String(item.departureDateDisplay).trim()) ||
        (item.departureDate ? moment(item.departureDate).format("DD/MM/YYYY") : "");
      item.departureDateFormat = departureDisplay;

      const cityId = item.departureCity || item.locationFrom || null;
      if (cityId) {
        const city = await City.findOne({ _id: cityId });
        item.cityName = city ? city.name : "";
      } else {
        item.cityName = "";
      }
    }

    return res.render("client/pages/order-pending", {
      pageTitle: "Đơn tour đang chờ xác nhận",
      orderDetail,
      phone,
      transferProofImages: orderDetail.transferProofImages || [],
    });
  } catch (error) {
    console.error("order.pending error:", error);
    return res.redirect("/");
  }
};

/**
 * GET /order/success?orderCode=...&phone=...
 * Hiển thị trang "Đặt hàng thành công"
 */
module.exports.success = async (req, res) => {
  try {
    const { orderCode, phone } = req.query;

    if (!orderCode || !phone) {
      return res.redirect("/");
    }

    const orderDetail = await Order.findOne({
      code: orderCode,
      phone: phone,
      deleted: false,
    });

    if (!orderDetail) {
      return res.redirect("/");
    }

    // Gắn tên hiển thị cho method/status (tránh lỗi khi không tìm thấy)
    const pm = paymentMethodList.find(
      (item) => item.value === orderDetail.paymentMethod
    );
    const ps = paymentStatusList.find(
      (item) => item.value === orderDetail.paymentStatus
    );
    const st = statusList.find((item) => item.value === orderDetail.status);

    orderDetail.paymentMethodName = pm ? pm.label : "Không xác định";
    orderDetail.paymentStatusName = ps ? ps.label : "Không xác định";
    orderDetail.statusName = st ? st.label : "Không xác định";

    orderDetail.createdAtFormat = moment(orderDetail.createdAt).format(
      "HH:mm - DD/MM/YYYY"
    );

    // Lấy company slugs cho các tour
    const tourSlugs = orderDetail.items
      .map((it) => it.slug)
      .filter(Boolean);
    let companySlugMap = {};
    if (tourSlugs.length > 0) {
      const Tour = require("../../models/tour.model");
      const Company = require("../../models/company.model");
      const tours = await Tour.find({ slug: { $in: tourSlugs } })
        .select("slug companyId")
        .lean();
      const companyIds = [...new Set(tours.map((t) => t.companyId).filter(Boolean))];
      if (companyIds.length > 0) {
        const companies = await Company.find({ _id: { $in: companyIds } })
          .select("_id slug")
          .lean();
        const companyMap = Object.fromEntries(
          companies.map((c) => [String(c._id), c.slug])
        );
        companySlugMap = Object.fromEntries(
          tours.map((t) => [t.slug, companyMap[String(t.companyId)] || null])
        );
      }
    }

    // Bổ sung cityName + format ngày khởi hành cho từng item
    for (const item of orderDetail.items) {
      // Ưu tiên ngày khởi hành mà khách đã chọn khi đặt (departureDateDisplay),
      // nếu không có thì fallback về departureDate (ngày mặc định của tour)
      const departureDisplay =
        (item.departureDateDisplay &&
          String(item.departureDateDisplay).trim()) ||
        (item.departureDate
          ? moment(item.departureDate).format("DD/MM/YYYY")
          : "");
      item.departureDateFormat = departureDisplay;

      // Ưu tiên departureCity, fallback locationFrom để không lỗi đơn cũ
      const cityId = item.departureCity || item.locationFrom || null;

      if (cityId) {
        const city = await City.findOne({ _id: cityId });
        item.cityName = city ? city.name : "";
      } else {
        item.cityName = "";
      }

      // Thêm company slug
      item.companySlug = item.slug ? (companySlugMap[item.slug] || null) : null;
    }

    return res.render("client/pages/order-success", {
      pageTitle: "Đặt hàng thành công",
      orderDetail,
    });
  } catch (error) {
    console.error("order.success error:", error);
    return res.redirect("/");
  }
};

module.exports.paymentVNPay = async (req, res) => {
  try {
    const { orderCode, phone } = req.query;

    if (!orderCode && !phone) {
      res.redirect("/");
      return;
    }

    const orderDetail = await Order.findOne({
      code: orderCode,
      phone: phone,
      deleted: false,
    });

    if (!orderDetail) {
      res.redirect("/");
      return;
    }

    let date = new Date();
    let createDate = moment(date).utcOffset(7).format("YYYYMMDDHHmmss");

    let ipAddr =
      req.headers["x-forwarded-for"] ||
      req.connection.remoteAddress ||
      req.socket.remoteAddress ||
      req.connection.socket.remoteAddress;

    let tmnCode = process.env.VNPAY_TMNCODE;
    let secretKey = process.env.VNPAY_SECRET;
    let vnpUrl = process.env.VNPAY_URL;
    let returnUrl = `${process.env.WEBSITE_DOMAIN}/order/payment-vnpay-result`;
    let orderId = `${orderCode}-${phone}-${Date.now()}`;
    let amount = orderDetail.total;
    let bankCode = "";

    let locale = "vn";
    let currCode = "VND";
    let vnp_Params = {};
    vnp_Params["vnp_Version"] = "2.1.0";
    vnp_Params["vnp_Command"] = "pay";
    vnp_Params["vnp_TmnCode"] = tmnCode;
    vnp_Params["vnp_Locale"] = locale;
    vnp_Params["vnp_CurrCode"] = currCode;
    vnp_Params["vnp_TxnRef"] = orderId;
    vnp_Params["vnp_OrderInfo"] = "Thanh toan cho ma GD:" + orderId;
    vnp_Params["vnp_OrderType"] = "other";
    vnp_Params["vnp_Amount"] = amount * 100;
    vnp_Params["vnp_ReturnUrl"] = returnUrl;
    vnp_Params["vnp_IpAddr"] = ipAddr;
    vnp_Params["vnp_CreateDate"] = createDate;
    if (bankCode !== null && bankCode !== "") {
      vnp_Params["vnp_BankCode"] = bankCode;
    }

    vnp_Params = sortObject(vnp_Params);

    let querystring = require("qs");
    let signData = querystring.stringify(vnp_Params, { encode: false });
    let crypto = require("crypto");
    let hmac = crypto.createHmac("sha512", secretKey);
    let signed = hmac.update(new Buffer(signData, "utf-8")).digest("hex");
    vnp_Params["vnp_SecureHash"] = signed;
    vnpUrl += "?" + querystring.stringify(vnp_Params, { encode: false });

    res.redirect(vnpUrl);
  } catch (error) {
    console.log(error);
    res.redirect("/");
  }
};

module.exports.paymentVNPayResult = async (req, res) => {
  try {
    let vnp_Params = req.query;

    let secureHash = vnp_Params["vnp_SecureHash"];

    delete vnp_Params["vnp_SecureHash"];
    delete vnp_Params["vnp_SecureHashType"];

    vnp_Params = sortObject(vnp_Params);

    let secretKey = process.env.VNPAY_SECRET;

    let querystring = require("qs");
    let signData = querystring.stringify(vnp_Params, { encode: false });
    let crypto = require("crypto");
    let hmac = crypto.createHmac("sha512", secretKey);
    let signed = hmac.update(new Buffer(signData, "utf-8")).digest("hex");

    if (secureHash === signed) {
      //Kiem tra xem du lieu trong db co hop le hay khong va thong bao ket qua
      const [orderCode, phone] = vnp_Params["vnp_TxnRef"].split("-");
      
      // Kiểm tra mã phản hồi từ VNPay
      const responseCode = vnp_Params["vnp_ResponseCode"];
      
      if (responseCode === "00") {
        // Giao dịch thành công
        await Order.updateOne(
          { code: orderCode, phone: phone },
          {
            paymentStatus:   "paid",
            isTemporaryHold: false,
            holdExpiresAt:   null,
          }
        );
        return res.redirect(
          `${process.env.WEBSITE_DOMAIN}/order/success?orderCode=${orderCode}&phone=${phone}`
        );
      } else {
        // Giao dịch thất bại
        console.log("VNPay payment failed with response code:", responseCode);
        return res.redirect("/?message=Thanh toán không thành công. Vui lòng thử lại.");
      }
    } else {
      // Chữ ký không hợp lệ - có thể bị giả mạo
      console.error("VNPay signature verification failed");
      return res.redirect("/?message=Xác thực thanh toán thất bại. Vui lòng liên hệ hỗ trợ.");
    }
  } catch (error) {
    console.log(error);
    res.redirect("/");
  }
};

/**
 * GET /order/cancel-hold?orderCode=...&phone=...
 * Hủy đơn tạm (được gọi từ client khi countdown về 0 hoặc khi khách chủ động hủy)
 */
module.exports.cancelHold = async (req, res) => {
  try {
    // Hỗ trợ cả GET (query string) và POST (sendBeacon gửi body dạng text/plain)
    let orderCode = req.query.orderCode || req.body?.orderCode;
    let phone     = req.query.phone     || req.body?.phone;

    // sendBeacon gửi body dạng "orderCode=X&phone=Y" (URLSearchParams)
    if (!orderCode && req.body && typeof req.body === "string") {
      const params = new URLSearchParams(req.body);
      orderCode = params.get("orderCode");
      phone     = params.get("phone");
    }
    if (!orderCode || !phone) {
      return res.json({ code: "error", message: "Thiếu tham số" });
    }

    const order = await Order.findOne({
      code: orderCode,
      phone: phone,
      deleted: false,
    }).lean();

    if (!order) {
      return res.json({ code: "error", message: "Không tìm thấy đơn hàng" });
    }

    if (order.paymentStatus === "paid") {
      return res.json({ code: "error", message: "Đơn đã thanh toán, không thể hủy" });
    }

    if (order.status === "cancel") {
      return res.json({ code: "ok", message: "Đơn đã hủy trước đó" });
    }

    // Nếu đơn còn trong thời hạn hold VÀ request đến từ sendBeacon (không phải
    // user chủ động hủy), giữ nguyên đơn — cron sẽ xử lý khi hết hạn.
    // Phân biệt: user chủ động hủy qua nút → gửi thêm header X-Cancel-Reason: explicit
    const isExplicit = req.headers["x-cancel-reason"] === "explicit" ||
                       req.method === "GET"; // GET = gọi từ countdown hoặc nút "Hủy đơn"
    const isExpired  = order.holdExpiresAt && new Date() > new Date(order.holdExpiresAt);

    if (!isExpired && !isExplicit) {
      // sendBeacon gửi do refresh hoặc điều hướng trong khi đơn chưa hết hạn
      // → KHÔNG hủy, để giữ cho user có thể quay lại thanh toán
      return res.json({ code: "skipped", message: "Đơn chưa hết hạn, giữ nguyên" });
    }

    await _cancelHoldAndRestoreSeats(order);

    return res.json({ code: "success", message: "Đã hủy đơn và hoàn lại ghế" });
  } catch (err) {
    console.error("order.cancelHold error:", err);
    return res.json({ code: "error", message: "Lỗi server" });
  }
};

/**
 * PATCH /order/transfer-proof
 * Lưu ảnh chứng từ chuyển khoản do khách hàng gửi lên
 * Body: { orderCode, phone, images: [url, ...] }
 */
module.exports.saveTransferProof = async (req, res) => {
  try {
    const { orderCode, phone, images } = req.body;

    if (!orderCode || !phone || !Array.isArray(images) || images.length === 0) {
      return res.json({ code: "error", message: "Dữ liệu không hợp lệ" });
    }

    const order = await Order.findOne({
      code: orderCode,
      phone: phone,
      deleted: false,
    });

    if (!order) {
      return res.json({ code: "error", message: "Không tìm thấy đơn hàng" });
    }

    if (order.paymentStatus === "paid") {
      return res.json({ code: "error", message: "Đơn đã thanh toán" });
    }

    await Order.updateOne(
      { _id: order._id },
      { $push: { transferProofImages: { $each: images } } }
    );

    return res.json({ code: "ok", message: "Đã lưu ảnh chứng từ thành công" });
  } catch (err) {
    console.error("order.saveTransferProof error:", err);
    return res.json({ code: "error", message: "Lỗi server" });
  }
};

/**
 * GET /order/check-payment-status?orderCode=...&phone=...
 * Trả về trạng thái thanh toán của đơn hàng (dùng cho polling phía client)
 */
module.exports.checkPaymentStatus = async (req, res) => {
  try {
    const { orderCode, phone } = req.query;

    if (!orderCode || !phone) {
      return res.json({ code: "error", message: "Thiếu tham số" });
    }

    const order = await Order.findOne({
      code: orderCode,
      phone: phone,
      deleted: false,
    })
      .select("paymentStatus")
      .lean();

    if (!order) {
      return res.json({ code: "error", message: "Không tìm thấy đơn hàng" });
    }

    return res.json({ code: "ok", paymentStatus: order.paymentStatus });
  } catch (err) {
    console.error("order.checkPaymentStatus error:", err);
    return res.json({ code: "error", message: "Lỗi server" });
  }
};

function sortObject(obj) {
  if (typeof obj !== "object" || obj === null) {
    throw new TypeError("Input must be a plain object");
  }

  let sorted = {};
  let str = [];
  let key;

  // Duyệt qua các thuộc tính của đối tượng
  for (key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      str.push(encodeURIComponent(key));
    }
  }

  // Sắp xếp các khóa
  str.sort();

  // Tạo đối tượng mới với các khóa đã sắp xếp
  for (key = 0; key < str.length; key++) {
    sorted[str[key]] = encodeURIComponent(obj[str[key]]).replace(/%20/g, "+");
  }

  return sorted;
}
