// controllers/admin/hotel-tour-assignment.controller.js
//
// Hotel-admin phân khách tour vào phòng vật lý. Chỉ thao tác trong phạm vi
// khách sạn thuộc công ty của account đang đăng nhập. Đây là bản tách chuyên
// trách từ phần "assign" cũ trong tour-hotel.controller.js.

const Tour         = require("../../models/tour.model");
const Hotel        = require("../../models/hotel.model");
const HotelBooking = require("../../models/hotel-booking.model");
const TourSegment  = require("../../models/tour-segment.model");
const Order        = require("../../models/order.model");
const Notification = require("../../models/notification.model");

const { pathAdmin } = require("../../config/variable.config");
const moment = require("moment");

// ── Helper: lấy danh sách hotelId của company đang đăng nhập ───────────────
async function getMyHotelIds(companyId) {
  const hotels = await Hotel.find({ companyId, deleted: false })
    .select("_id name")
    .lean();
  return {
    hotelIds: hotels.map((h) => String(h._id)),
    hotelMapById: Object.fromEntries(hotels.map((h) => [String(h._id), h])),
  };
}

// ── Trang danh sách tour-segment có hold booking tại hotel của company ─────
module.exports.list = async (req, res) => {
  try {
    const companyId = req.account.companyId;
    const { hotelIds, hotelMapById } = await getMyHotelIds(companyId);

    if (hotelIds.length === 0) {
      return res.render("admin/pages/hotel-tour-assignment-list", {
        pageTitle: "Phân phòng cho tour",
        rows: [],
        selectedHotelId: "",
        pathAdmin,
      });
    }

    const selectedHotelId = (req.query.hotelId || "").trim();
    const scopeHotelIds = selectedHotelId && hotelIds.includes(selectedHotelId)
      ? [selectedHotelId]
      : hotelIds;

    const segmentIds = await HotelBooking.distinct("tourSegmentId", {
      "hotel.hotelId": { $in: scopeHotelIds },
      tourSegmentId: { $ne: null },
      status: { $ne: "cancelled" },
    });

    if (segmentIds.length === 0) {
      return res.render("admin/pages/hotel-tour-assignment-list", {
        pageTitle: "Phân phòng cho tour",
        rows: [],
        selectedHotelId,
        pathAdmin,
      });
    }

    const tourSegs = await TourSegment.find({ _id: { $in: segmentIds } })
      .select("_id tourId companyId departureDate endDate status assignments")
      .lean();

    const tourIds = [...new Set(tourSegs.map((s) => String(s.tourId)))];
    const tours = await Tour.find({ _id: { $in: tourIds } })
      .select("name avatar")
      .lean();
    const tourById = Object.fromEntries(tours.map((t) => [String(t._id), t]));

    // Lấy hold booking (chỉ thuộc hotels của company) để đếm
    const holds = await HotelBooking.find({
      tourSegmentId: { $in: segmentIds },
      "hotel.hotelId": { $in: hotelIds },
      status: { $ne: "cancelled" },
      roomId: { $ne: null },
    })
      .select("tourSegmentId hotel.hotelId roomId")
      .lean();

    const holdsBySeg = {};
    for (const b of holds) {
      const k = String(b.tourSegmentId);
      if (!holdsBySeg[k]) holdsBySeg[k] = [];
      holdsBySeg[k].push(b);
    }

    const rows = tourSegs
      .map((ts) => {
        const key = String(ts._id);
        const holdBookings = holdsBySeg[key] || [];
        const myHoldIds = new Set(holdBookings.map((b) => String(b._id)));

        const myAssignments = (ts.assignments || []).filter((a) =>
          hotelIds.includes(String(a.hotelId))
        );
        const assignedBookingIds = new Set(
          myAssignments
            .map((a) => (a.holdBookingId ? String(a.holdBookingId) : ""))
            .filter(Boolean)
        );

        const holdCount = holdBookings.length;
        const assignedCount = [...assignedBookingIds].filter((id) =>
          myHoldIds.has(id)
        ).length;

        const hotelsInScope = [
          ...new Set(holdBookings.map((b) => String(b.hotel?.hotelId))),
        ]
          .map((hid) => hotelMapById[hid])
          .filter(Boolean);

        const tour = tourById[String(ts.tourId)];

        return {
          segmentId: key,
          tourId: String(ts.tourId),
          tourName: tour ? tour.name : "Tour",
          tourAvatar: tour ? tour.avatar : "",
          departureDateDisplay: moment(ts.departureDate).format("DD/MM/YYYY"),
          endDateDisplay: ts.endDate
            ? moment(ts.endDate).format("DD/MM/YYYY")
            : "—",
          status: ts.status,
          holdCount,
          assignedCount,
          pendingCount: Math.max(0, holdCount - assignedCount),
          hotelsInScope,
        };
      })
      .sort((a, b) => {
        // ưu tiên segment còn nhiều phòng chưa gán lên đầu
        if (b.pendingCount !== a.pendingCount) {
          return b.pendingCount - a.pendingCount;
        }
        return 0;
      });

    return res.render("admin/pages/hotel-tour-assignment-list", {
      pageTitle: "Phân phòng cho tour",
      rows,
      selectedHotelId,
      pathAdmin,
    });
  } catch (err) {
    console.error("[hotel-tour-assignment.list]", err);
    return res.render("admin/pages/error-404", { pageTitle: "Lỗi" });
  }
};

// ── Trang chi tiết: phân khách vào phòng (scope theo công ty) ──────────────
module.exports.detail = async (req, res) => {
  try {
    const companyId = req.account.companyId;
    const { segmentId } = req.params;

    const { hotelIds, hotelMapById } = await getMyHotelIds(companyId);
    if (hotelIds.length === 0) {
      return res.redirect(`/${pathAdmin}/hotel/tour-assignments`);
    }

    const tourSeg = await TourSegment.findOne({ _id: segmentId }).lean();
    if (!tourSeg) {
      return res.redirect(`/${pathAdmin}/hotel/tour-assignments`);
    }

    // Quyền truy cập: phải có ít nhất 1 hold booking thuộc hotel của company
    const mySegHolds = await HotelBooking.countDocuments({
      tourSegmentId: tourSeg._id,
      "hotel.hotelId": { $in: hotelIds },
      status: { $ne: "cancelled" },
    });
    if (mySegHolds === 0) {
      return res.redirect(`/${pathAdmin}/hotel/tour-assignments`);
    }

    if (
      tourSeg.status !== "confirmed" &&
      tourSeg.status !== "pending_approval"
    ) {
      return res.redirect(`/${pathAdmin}/hotel/tour-assignments`);
    }

    const tour = await Tour.findById(tourSeg.tourId)
      .select("name avatar")
      .lean();

    // Lấy hold bookings CHỈ thuộc hotels của company, có roomId cụ thể
    const holdBookingsRaw = await HotelBooking.find({
      tourSegmentId: tourSeg._id,
      "hotel.hotelId": { $in: hotelIds },
      status: { $ne: "cancelled" },
      roomId: { $ne: null },
      code: { $ne: null },
    })
      .select("code roomId roomTypeId hotel checkIn checkOut adults note guest status")
      .sort({ _id: -1 })
      .lean();

    // Deduplicate (roomId + checkIn)
    const seenKeys = new Set();
    const holdBookings = holdBookingsRaw.filter((b) => {
      const key = String(b.roomId) + "_" + String(b.checkIn);
      if (seenKeys.has(key)) return false;
      seenKeys.add(key);
      return true;
    });

    // Cần Hotel docs (scoped to company) cho roomNumber + ageBands
    const uniqueHotelIdsInHolds = [
      ...new Set(holdBookings.map((b) => String(b.hotel?.hotelId)).filter(Boolean)),
    ];
    const hotels = await Hotel.find({ _id: { $in: uniqueHotelIdsInHolds } })
      .select("name address rooms roomTypes ageBands companyId")
      .lean();
    const hotelMap = {};
    for (const h of hotels) hotelMap[String(h._id)] = h;

    // Enrich holds
    const enrichedHolds = holdBookings.map((b) => {
      const hotel = hotelMap[String(b.hotel?.hotelId)] || null;
      const room = (hotel?.rooms || []).find(
        (r) => String(r._id) === String(b.roomId)
      );
      const rtEntry = (hotel?.roomTypes || []).find(
        (rt) => String(rt._id) === String(b.roomTypeId)
      );
      return {
        ...b,
        roomId: String(b.roomId),
        hotelName: hotel?.name || b.hotel?.name || "",
        roomNumber: room?.roomNumber || "?",
        floor: room?.floor || "",
        roomTypeName: rtEntry?.name || "",
        baseOccupancy: rtEntry?.baseOccupancy ?? b.adults ?? 2,
        maxOccupancy:
          rtEntry?.maxOccupancy ?? rtEntry?.baseOccupancy ?? b.adults ?? 2,
      };
    });

    // Group theo khách sạn
    const holdsByHotel = {};
    for (const hb of enrichedHolds) {
      const key = String(hb.hotel?.hotelId);
      if (!holdsByHotel[key]) {
        const hotelDoc = hotelMap[key] || null;
        holdsByHotel[key] = {
          hotelId: key,
          hotelName: hb.hotelName,
          ageBands: (hotelDoc?.ageBands || []).map((b) => ({
            bandName: b.bandName || "",
            bandType: b.bandType || "adult",
            minAge: b.minAge ?? 0,
            maxAge: b.maxAge ?? null,
            countInOccupancy: b.countInOccupancy ?? true,
            occupancyWeight: b.occupancyWeight ?? 1,
          })),
          rooms: [],
        };
      }
      holdsByHotel[key].rooms.push(hb);
    }

    // Khối «Phòng đang giữ chỗ»: chỉ khách sạn đang chọn ở hotel-selector-bar (?hotelId=)
    const filterHotelFromQuery = (req.query.hotelId || "").trim();
    const holdsByHotelAllList = Object.values(holdsByHotel);
    let holdsByHotelForView = holdsByHotelAllList;
    if (filterHotelFromQuery && hotelIds.includes(filterHotelFromQuery)) {
      const one = holdsByHotel[filterHotelFromQuery];
      if (one) {
        holdsByHotelForView = [one];
      } else {
        holdsByHotelForView = [
          {
            hotelId: filterHotelFromQuery,
            hotelName: hotelMapById[filterHotelFromQuery]?.name || "",
            ageBands: [],
            rooms: [],
          },
        ];
      }
    }

    const filterHotelOk =
      Boolean(filterHotelFromQuery) && hotelIds.includes(filterHotelFromQuery);

    // Danh sách khách hàng đã thanh toán khớp lịch khởi hành
    const departureDateDisplay = moment(tourSeg.departureDate).format("DD/MM/YYYY");
    const rawOrders = await Order.find({
      "items.tourId": String(tourSeg.tourId),
      $or: [{ paymentStatus: "paid" }, { status: "done" }],
      status: { $ne: "cancel" },
      deleted: { $ne: true },
    })
      .select("code fullName phone note items userId paymentStatus status")
      .lean();

    const customers = [];
    for (const order of rawOrders) {
      const matchedItem = (order.items || []).find((it) => {
        if (String(it.tourId) !== String(tourSeg.tourId)) return false;
        if (it.departureDateDisplay) {
          return it.departureDateDisplay === departureDateDisplay;
        }
        if (it.departureDate) {
          return moment(it.departureDate).format("DD/MM/YYYY") === departureDateDisplay;
        }
        return false;
      });
      if (!matchedItem) continue;

      const quantityAdult = matchedItem.quantityAdult || 0;
      const quantityChildren = matchedItem.quantityChildren || 0;
      const quantityBaby = matchedItem.quantityBaby || 0;
      const totalPeople = quantityAdult + quantityChildren + quantityBaby;

      const childrenAges = Array.isArray(matchedItem.childrenAges)
        ? matchedItem.childrenAges
        : [];
      const babyAges = Array.isArray(matchedItem.babyAges)
        ? matchedItem.babyAges
        : [];

      const allocation = matchedItem.hotelAllocation || null;

      // Chỉ giữ roomSelections thuộc hotels của company (để hotel-admin không
      // phải check đơn đặt của khách sạn khác trong cùng tour).
      const myRoomSelections = Array.isArray(matchedItem.roomSelections)
        ? matchedItem.roomSelections.filter((rs) =>
            hotelIds.includes(String(rs.hotelId))
          )
        : [];

      // Bỏ customer không có phần liên quan tới hotels của company (trừ khi
      // họ đã có assignment cũ thuộc company — giữ lại để xem/huỷ).
      // Khi có ?hotelId=: chỉ giữ khách có đặt hoặc đã gán tại đúng khách sạn đó.
      const myRoomSelectionsVisible = filterHotelOk
        ? myRoomSelections.filter(
            (rs) => String(rs.hotelId) === String(filterHotelFromQuery)
          )
        : myRoomSelections;
      const hasMyAssignmentThisHotel = filterHotelOk
        ? (tourSeg.assignments || []).some(
            (a) =>
              String(a.orderId) === String(order._id) &&
              String(a.hotelId) === String(filterHotelFromQuery)
          )
        : (tourSeg.assignments || []).some(
            (a) =>
              String(a.orderId) === String(order._id) &&
              hotelIds.includes(String(a.hotelId))
          );
      if (myRoomSelectionsVisible.length === 0 && !hasMyAssignmentThisHotel) {
        continue;
      }

      customers.push({
        orderId: String(order._id),
        orderCode:
          order.code || String(order._id).slice(-6).toUpperCase(),
        guestName: order.fullName || "",
        phone: order.phone || "",
        note: order.note || "",
        totalPeople,
        quantityAdult,
        quantityChildren,
        quantityBaby,
        childrenAges,
        babyAges,
        paymentStatus: order.paymentStatus || "unpaid",
        orderStatus: order.status || "initial",
        departureDateDisplay:
          matchedItem.departureDateDisplay || "",
        suggestedHotelId: allocation?.allocations?.[0]?.hotelId || null,
        suggestedHotelName: allocation?.allocations?.[0]?.hotelName || "",
        hotelAllocation: allocation,
        roomSelections: myRoomSelectionsVisible,
        extraRoomCost: Number(matchedItem.extraRoomCost || 0),
      });
    }

    // Sức chứa chuẩn / phòng cho mỗi booking
    const holdOccByBookingId = {};
    for (const hb of enrichedHolds) {
      const occ = Number(hb.baseOccupancy);
      holdOccByBookingId[String(hb._id)] =
        !Number.isNaN(occ) && occ > 0 ? Math.round(occ) : 2;
    }

    // Tất cả assignments hiển thị cho user — chỉ những cái thuộc hotel của
    // company mình (không cho sửa của người khác).
    const existingAssignments = (tourSeg.assignments || [])
      .filter((a) => hotelIds.includes(String(a.hotelId)))
      .map((a) => {
        const bid = a.holdBookingId ? String(a.holdBookingId) : "";
        const fromHold = bid ? holdOccByBookingId[bid] : undefined;
        const numPeople =
          fromHold != null
            ? fromHold
            : Math.max(1, Math.round(Number(a.numPeople) || 1));
        return {
          ...a,
          orderId: String(a.orderId),
          hotelId: String(a.hotelId),
          roomId: String(a.roomId),
          holdBookingId: a.holdBookingId ? String(a.holdBookingId) : null,
          numPeople,
        };
      });

    const { orderId } = req.query;

    if (orderId) {
      const targetCust = customers.find((c) => c.orderId === orderId);
      if (!targetCust) {
        const qs = new URLSearchParams();
        if (filterHotelFromQuery) qs.set("hotelId", filterHotelFromQuery);
        const q = qs.toString();
        return res.redirect(
          `/${pathAdmin}/hotel/tour-assignments/${segmentId}${q ? `?${q}` : ""}`
        );
      }

      const existingAssignmentsForView = existingAssignments.filter((a) => {
        if (String(a.orderId) !== String(targetCust.orderId)) return false;
        if (filterHotelOk && String(a.hotelId) !== String(filterHotelFromQuery)) {
          return false;
        }
        return true;
      });

      return res.render("admin/pages/hotel-tour-assignment-detail", {
        pageTitle: "Phân phòng – " + (targetCust.guestName || targetCust.orderCode),
        tourSeg,
        tour,
        customer: targetCust,
        customers,
        holdsByHotel: holdsByHotelForView,
        existingAssignments: existingAssignmentsForView,
        departureDateDisplay,
        pathAdmin,
        moment,
        selectedHotelId: filterHotelFromQuery,
      });
    }

    // List mode: bảng khách hàng — status theo scope (cả công ty hoặc theo ?hotelId=)
    const custWithStatus = customers.map((cust) => {
      const myAssigns = existingAssignments.filter((a) => {
        if (a.orderId !== cust.orderId) return false;
        if (filterHotelOk && String(a.hotelId) !== String(filterHotelFromQuery)) {
          return false;
        }
        return true;
      });
      let assignStatus = "none";
      if (cust.roomSelections && cust.roomSelections.length > 0) {
        const needed = {};
        cust.roomSelections.forEach((rs) => {
          const k =
            (rs.hotelId || "") +
            "|" +
            (rs.roomTypeId || "") +
            "|" +
            (rs.fromDate || "") +
            "|" +
            (rs.toDate || "");
          if (!needed[k]) needed[k] = 0;
          needed[k] += rs.selectedRooms;
        });
        let allOk = myAssigns.length > 0;
        let hasShortfall = false;
        let hasExcess = false;

        const holdsByHotelArr = holdsByHotelAllList;
        const assigned = {};
        const toDateStr = (d) => (d ? moment(d).format("YYYY-MM-DD") : "");
        myAssigns.forEach((a) => {
          let holdRoom = null;
          holdsByHotelArr.forEach((hg) => {
            (hg.rooms || []).forEach((r) => {
              if (String(r._id) === a.holdBookingId) holdRoom = r;
            });
          });
          if (!holdRoom) return;
          const hId = String(holdRoom.hotel?.hotelId || "");
          const rtId = holdRoom.roomTypeId ? String(holdRoom.roomTypeId) : "";
          const ci = toDateStr(holdRoom.checkIn);
          const co = toDateStr(holdRoom.checkOut);
          Object.keys(needed).forEach((k) => {
            const parts = k.split("|");
            const nFrom = toDateStr(parts[2]);
            const nTo = toDateStr(parts[3]);
            if (hId === parts[0] && rtId === parts[1] && ci === nFrom && co === nTo) {
              assigned[k] = (assigned[k] || 0) + 1;
            }
          });
        });

        Object.keys(needed).forEach((k) => {
          const got = assigned[k] || 0;
          if (got < needed[k]) {
            hasShortfall = true;
            allOk = false;
          } else if (got > needed[k]) {
            hasExcess = true;
            allOk = false;
          }
        });

        if (allOk) assignStatus = "complete";
        else if (hasExcess) assignStatus = "excess";
        else if (myAssigns.length > 0) assignStatus = "partial";
        else assignStatus = "none";
      } else if (myAssigns.length > 0) {
        assignStatus = "complete";
      }
      return { ...cust, assignedCount: myAssigns.length, assignStatus };
    });

    const existingAssignmentsListView = filterHotelOk
      ? existingAssignments.filter(
          (a) => String(a.hotelId) === String(filterHotelFromQuery)
        )
      : existingAssignments;

    return res.render("admin/pages/hotel-tour-assignment-detail", {
      pageTitle: "Phân phòng – " + (tour?.name || ""),
      tourSeg,
      tour,
      customer: null,
      customers: custWithStatus,
      holdsByHotel: holdsByHotelForView,
      existingAssignments: existingAssignmentsListView,
      departureDateDisplay,
      pathAdmin,
      moment,
      selectedHotelId: filterHotelFromQuery,
    });
  } catch (err) {
    console.error("[hotel-tour-assignment.detail]", err);
    return res.render("admin/pages/error-404", { pageTitle: "Lỗi" });
  }
};

// ── Lưu phân công (chỉ thay thế phần thuộc company, giữ nguyên phần khác) ──
module.exports.save = async (req, res) => {
  try {
    const companyId = req.account.companyId;
    const { segmentId } = req.params;

    const { hotelIds, hotelMapById } = await getMyHotelIds(companyId);
    const myHotelIdSet = new Set(hotelIds);
    if (hotelIds.length === 0) {
      return res.json({
        success: false,
        message: "Công ty chưa có khách sạn nào",
      });
    }

    const tourSeg = await TourSegment.findOne({ _id: segmentId });
    if (!tourSeg) {
      return res.json({ success: false, message: "Không tìm thấy cấu hình" });
    }

    // Quyền: phải có hold booking thuộc hotel của company trong segment này
    const mySegHolds = await HotelBooking.countDocuments({
      tourSegmentId: tourSeg._id,
      "hotel.hotelId": { $in: hotelIds },
      status: { $ne: "cancelled" },
    });
    if (mySegHolds === 0) {
      return res.json({
        success: false,
        message: "Bạn không có quyền với segment này",
      });
    }

    let assignments;
    try {
      assignments =
        typeof req.body.assignments === "string"
          ? JSON.parse(req.body.assignments)
          : req.body.assignments;
    } catch {
      return res.json({ success: false, message: "Dữ liệu không hợp lệ" });
    }
    if (!Array.isArray(assignments)) {
      return res.json({
        success: false,
        message: "assignments phải là mảng",
      });
    }

    // Lưu theo một khách sạn (body/query hotelId) hoặc toàn bộ KS của company
    let scopeHotelId = (req.body.hotelId || req.query.hotelId || "").trim();
    if (typeof scopeHotelId !== "string") scopeHotelId = "";
    const narrowScoped =
      Boolean(scopeHotelId) && hotelIds.includes(scopeHotelId);

    // Lấy hold bookings: chỉ KS đang lưu khi narrowScoped, ngược lại mọi KS company
    const holdBookings = await HotelBooking.find({
      tourSegmentId: tourSeg._id,
      "hotel.hotelId": narrowScoped ? scopeHotelId : { $in: hotelIds },
      status: { $ne: "cancelled" },
      roomId: { $ne: null },
    })
      .select("_id roomId roomTypeId hotel")
      .lean();

    const holdMap = {};
    for (const hb of holdBookings) holdMap[String(hb._id)] = hb;

    const hotelsInHolds = await Hotel.find({
      _id: { $in: [...new Set(holdBookings.map((b) => String(b.hotel?.hotelId)))] },
    })
      .select("name rooms roomTypes")
      .lean();
    const hotelMap = {};
    for (const h of hotelsInHolds) hotelMap[String(h._id)] = h;

    // Sanitize & ép scope
    const cleanAssignments = [];
    for (const a of assignments) {
      const holdBooking =
        holdMap[String(a.holdBookingId)] || holdMap[String(a.roomId)] || null;
      // Bắt buộc hold booking phải thuộc hotels của company
      if (!holdBooking) continue;
      const hotelOfBooking = String(holdBooking.hotel?.hotelId || "");
      if (!myHotelIdSet.has(hotelOfBooking)) continue;

      const hotel = hotelMap[hotelOfBooking] || null;
      const physicalRoomId = holdBooking.roomId || a.roomId;
      const room = (hotel?.rooms || []).find(
        (r) => String(r._id) === String(physicalRoomId)
      );
      const rtEntry = hotel
        ? (hotel.roomTypes || []).find(
            (rt) => String(rt._id) === String(holdBooking.roomTypeId)
          )
        : null;

      const occFromType =
        rtEntry &&
        rtEntry.baseOccupancy != null &&
        !Number.isNaN(Number(rtEntry.baseOccupancy))
          ? Math.round(Number(rtEntry.baseOccupancy))
          : null;
      const numPeople =
        occFromType != null && occFromType > 0
          ? occFromType
          : Math.max(1, Math.round(Number(a.numPeople) || 1));

      cleanAssignments.push({
        orderId: a.orderId,
        orderCode: a.orderCode || "",
        guestName: a.guestName || "",
        phone: a.phone || "",
        numPeople,
        hotelId: hotelOfBooking,
        hotelName: hotel?.name || a.hotelName || "",
        roomId: physicalRoomId,
        roomNumber: room?.roomNumber || a.roomNumber || "",
        roomTypeName: rtEntry?.name || a.roomTypeName || "",
        holdBookingId: holdBooking._id,
      });
    }

    // Gộp: (1) tour company khác, (2) KS cùng company nhưng không nằm trong phạm vi lần lưu này, (3) bản ghi mới
    const outsideCompany = (tourSeg.assignments || []).filter(
      (a) => !myHotelIdSet.has(String(a.hotelId))
    );
    const myCompanyOtherHotels = narrowScoped
      ? (tourSeg.assignments || []).filter(
          (a) =>
            myHotelIdSet.has(String(a.hotelId)) &&
            String(a.hotelId) !== String(scopeHotelId)
        )
      : [];

    const newAssignedBookingIds = new Set(
      cleanAssignments.map((a) => String(a.holdBookingId))
    );

    // Cập nhật guest info trong HotelBooking của hotels company cho các
    // assignment mới.
    for (const a of cleanAssignments) {
      const hb = holdMap[String(a.holdBookingId)];
      if (!hb) continue;
      await HotelBooking.findByIdAndUpdate(hb._id, {
        "guest.fullName": a.guestName || "Khách tour",
        "guest.phone": a.phone || "",
        note: `[TOUR] Đơn #${a.orderCode} – ${a.guestName || ""} – ${a.numPeople} người/phòng (loại phòng)`,
      });
    }

    // Reset placeholder cho booking thuộc company mà KHÔNG còn được gán
    const Tour = require("../../models/tour.model");
    const tourDoc = await Tour.findById(tourSeg.tourId).select("name").lean();
    const tourName = tourDoc ? tourDoc.name : "Tour";
    const depDateFmt = moment(tourSeg.departureDate).format("DD/MM/YYYY");
    const endDateFmt = tourSeg.endDate
      ? moment(tourSeg.endDate).format("DD/MM/YYYY")
      : "—";
    const resetNote = `[Tour Hold] ${tourName} | ${depDateFmt} – ${endDateFmt}`;

    for (const hbId of Object.keys(holdMap)) {
      if (newAssignedBookingIds.has(hbId)) continue;
      const doc = await HotelBooking.findById(hbId);
      if (!doc) continue;
      doc.guest.fullName = "[Tour Hold]";
      doc.guest.phone = "";
      doc.note = resetNote;
      doc.status = "confirmed";
      await doc.save();
    }

    tourSeg.assignments = narrowScoped
      ? [...outsideCompany, ...myCompanyOtherHotels, ...cleanAssignments]
      : [...outsideCompany, ...cleanAssignments];
    await tourSeg.save();

    // Safety net
    await HotelBooking.collection.updateMany(
      {
        tourSegmentId: tourSeg._id,
        "hotel.hotelId": narrowScoped ? scopeHotelId : { $in: hotelIds },
        "guest.fullName": "[Tour Hold]",
        status: { $nin: ["confirmed", "cancelled"] },
      },
      { $set: { status: "confirmed" } }
    );

    // Notification cho công ty sở hữu tour để tour-admin biết đã có cập nhật phân phòng
    try {
      if (tourSeg.companyId) {
        const myHotelNames = [
          ...new Set(
            cleanAssignments
              .map((a) => hotelMapById[String(a.hotelId)]?.name)
              .filter(Boolean)
          ),
        ].join(", ");
        await Notification.create({
          companyId: tourSeg.companyId,
          type: "other",
          title: "Cập nhật phân phòng tour",
          content: `${myHotelNames || "Khách sạn"} đã cập nhật phân phòng cho tour "${tourName}" (khởi hành ${depDateFmt}). ${cleanAssignments.length} khách đã được gán.`,
          link: `/${pathAdmin}/tour-hotel/assign/${tourSeg._id}`,
        });
      }
    } catch (notifErr) {
      console.error(
        "[hotel-tour-assignment.save] notification error:",
        notifErr
      );
    }

    return res.json({
      success: true,
      message: `Đã lưu phân công ${cleanAssignments.length} mục và cập nhật thông tin khách thành công`,
    });
  } catch (err) {
    console.error("[hotel-tour-assignment.save]", err);
    return res.json({ success: false, message: "Lỗi server" });
  }
};
