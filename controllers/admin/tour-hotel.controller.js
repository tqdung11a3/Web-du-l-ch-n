// controllers/admin/tour-hotel.controller.js
//
// Quản lý "Liên kết Tour – Khách sạn": company admin chia tour thành các
// khung thời gian và phân bổ phòng khách sạn cho từng khung.

const Tour        = require("../../models/tour.model");
const Hotel       = require("../../models/hotel.model");
const HotelBooking= require("../../models/hotel-booking.model");
const TourSegment = require("../../models/tour-segment.model");
const Order       = require("../../models/order.model");
const { getAvailableRoomsForType } = require("../../helpers/hotel-availability.helper");
const { generateRandomNumber }     = require("../../helpers/generate.helper");
const { pathAdmin } = require("../../config/variable.config");
const moment = require("moment");

// ── Danh sách tour của company ───────────────────────────────────────────────
module.exports.list = async (req, res) => {
  try {
    const companyId = req.account.companyId;

    const tours = await Tour.find({ companyId, deleted: false })
      .select("name avatar departures seatsTotal status slug")
      .sort({ createdAt: -1 })
      .lean();

    const tourIds = tours.map((t) => t._id);
    const existing = await TourSegment.find({
      tourId: { $in: tourIds },
      status: { $ne: "cancelled" },
    })
      .select("_id tourId departureDate status")
      .lean();

    const configuredMap = {};
    for (const seg of existing) {
      const key = String(seg.tourId);
      if (!configuredMap[key]) configuredMap[key] = [];
      configuredMap[key].push({
        segmentId:        String(seg._id),
        departureDateStr: moment(seg.departureDate).format("YYYY-MM-DD"),
        status:           seg.status,
      });
    }

    for (const tour of tours) {
      tour.configuredDepartures = configuredMap[String(tour._id)] || [];
      tour.departuresFormatted = (tour.departures || []).map((d) => ({
        departureDateStr:     moment(d.departureDate).format("YYYY-MM-DD"),
        departureDateDisplay: moment(d.departureDate).format("DD/MM/YYYY"),
        endDateDisplay:       d.endDate ? moment(d.endDate).format("DD/MM/YYYY") : "—",
        seatsTotal:           d.seatsTotal ?? null,
      }));
    }

    res.render("admin/pages/tour-hotel-list", {
      pageTitle: "Liên kết Tour – Khách sạn",
      tours,
      pathAdmin,
    });
  } catch (err) {
    console.error("[tour-hotel.list]", err);
    res.render("admin/pages/error-404", { pageTitle: "Lỗi" });
  }
};

// ── Trang cấu hình segment cho 1 tour + 1 departure ─────────────────────────
module.exports.detail = async (req, res) => {
  try {
    const companyId = req.account.companyId;
    const { tourId } = req.params;
    const departureDateParam = req.query.departure;

    const tour = await Tour.findOne({ _id: tourId, companyId, deleted: false }).lean();
    if (!tour) return res.redirect(`/${pathAdmin}/tour-hotel/list`);

    const hotels = await Hotel.find({ companyId, deleted: false, status: "active" })
      .select("name address")
      .lean();

    let selectedDeparture = null;
    let existingSegment   = null;

    if (departureDateParam) {
      selectedDeparture = (tour.departures || []).find(
        (d) => moment(d.departureDate).format("YYYY-MM-DD") === departureDateParam
      );

      if (selectedDeparture) {
        existingSegment = await TourSegment.findOne({
          tourId,
          departureDate: new Date(departureDateParam),
        }).lean();
      }
    }

    tour.departuresFormatted = (tour.departures || []).map((d) => ({
      departureDateStr:     moment(d.departureDate).format("YYYY-MM-DD"),
      departureDateDisplay: moment(d.departureDate).format("DD/MM/YYYY"),
      endDateDisplay:       d.endDate ? moment(d.endDate).format("DD/MM/YYYY") : "—",
      endDateStr:           d.endDate ? moment(d.endDate).format("YYYY-MM-DD") : "",
    }));

    res.render("admin/pages/tour-hotel-detail", {
      pageTitle: "Cấu hình khung thời gian – Khách sạn",
      tour,
      hotels,
      selectedDeparture,
      existingSegment,
      departureDateParam,
      pathAdmin,
      moment,
    });
  } catch (err) {
    console.error("[tour-hotel.detail]", err);
    res.render("admin/pages/error-404", { pageTitle: "Lỗi" });
  }
};

// ── API: Lấy tình trạng phòng của 1 hotel trong 1 khoảng ngày ───────────────
module.exports.hotelAvailability = async (req, res) => {
  try {
    const companyId = req.account.companyId;
    const { hotelId, fromDate, toDate } = req.query;

    if (!hotelId || !fromDate || !toDate) {
      return res.json({ success: false, message: "Thiếu tham số" });
    }

    const checkIn  = new Date(fromDate);
    const checkOut = new Date(toDate);

    if (isNaN(checkIn) || isNaN(checkOut) || checkIn >= checkOut) {
      return res.json({ success: false, message: "Khoảng ngày không hợp lệ" });
    }

    const hotel = await Hotel.findOne({ _id: hotelId, companyId, deleted: false })
      .select("name address roomTypes rooms")
      .lean();

    if (!hotel) {
      return res.json({ success: false, message: "Không tìm thấy khách sạn" });
    }

    const existingBookings = await HotelBooking.find({
      "hotel.hotelId": hotelId,
      status: { $nin: ["cancelled", "checked_out"] },
      checkIn:  { $lt: checkOut },
      checkOut: { $gt: checkIn },
    })
      .select("roomTypeId rooms status checkIn checkOut")
      .lean();

    const roomTypes = (hotel.roomTypes || []).map((rt) => {
      const availableRoomIds = getAvailableRoomsForType(
        hotel.rooms || [],
        rt._id,
        existingBookings,
        checkIn,
        checkOut
      );
      const availableRooms = availableRoomIds.length;
      const baseOccupancy  = rt.baseOccupancy || 2;

      return {
        roomTypeId:    String(rt._id),
        roomTypeName:  rt.name,
        baseOccupancy,
        availableRooms,
        capacity: availableRooms * baseOccupancy,
      };
    });

    const totalCapacity = roomTypes.reduce((s, rt) => s + rt.capacity, 0);

    return res.json({
      success: true,
      hotel: { _id: hotel._id, name: hotel.name, address: hotel.address },
      roomTypes,
      totalCapacity,
    });
  } catch (err) {
    console.error("[tour-hotel.hotelAvailability]", err);
    return res.json({ success: false, message: "Lỗi server" });
  }
};

// ── Gợi ý phân bổ phòng tối thiểu (Greedy) ──────────────────────────────────
module.exports.suggestAllocation = async (req, res) => {
  try {
    const companyId = req.account.companyId;
    const { fromDate, toDate, paxRequired, hotels: hotelsJson } = req.query;

    const checkIn  = new Date(fromDate);
    const checkOut = new Date(toDate);
    const pax      = parseInt(paxRequired, 10) || 0;
    let hotelsInput;
    try {
      hotelsInput = JSON.parse(hotelsJson);
    } catch {
      return res.json({ success: false, message: "Dữ liệu hotels không hợp lệ" });
    }

    if (!pax || isNaN(checkIn) || isNaN(checkOut)) {
      return res.json({ success: false, message: "Thiếu tham số" });
    }

    const sorted = [...hotelsInput].sort((a, b) =>
      (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0)
    );

    let remaining = pax;
    const result  = [];

    for (const h of sorted) {
      if (remaining <= 0) break;

      const hotel = await Hotel.findOne({ _id: h.hotelId, companyId, deleted: false })
        .select("name roomTypes rooms")
        .lean();
      if (!hotel) continue;

      const bookings = await HotelBooking.find({
        "hotel.hotelId": h.hotelId,
        status: { $nin: ["cancelled", "checked_out"] },
        checkIn:  { $lt: checkOut },
        checkOut: { $gt: checkIn },
      })
        .select("roomTypeId rooms status checkIn checkOut")
        .lean();

      const roomTypes = (hotel.roomTypes || [])
        .map((rt) => {
          const avail = getAvailableRoomsForType(
            hotel.rooms || [], rt._id, bookings, checkIn, checkOut
          ).length;
          return { ...rt, availableRooms: avail };
        })
        .filter((rt) => rt.availableRooms > 0)
        .sort((a, b) => (b.baseOccupancy || 2) - (a.baseOccupancy || 2));

      const hotelResult = { hotelId: h.hotelId, hotelName: hotel.name, isPrimary: h.isPrimary, roomAllocations: [] };

      for (const rt of roomTypes) {
        if (remaining <= 0) break;
        const occ         = rt.baseOccupancy || 2;
        const roomsNeeded = Math.ceil(remaining / occ);
        const roomsToTake = Math.min(roomsNeeded, rt.availableRooms);
        hotelResult.roomAllocations.push({
          roomTypeId:    String(rt._id),
          roomTypeName:  rt.name,
          baseOccupancy: occ,
          assignedRooms: roomsToTake,
          totalPeople:   roomsToTake * occ,
        });
        remaining -= roomsToTake * occ;
      }

      if (hotelResult.roomAllocations.length > 0) {
        hotelResult.totalPeople = hotelResult.roomAllocations.reduce(
          (s, r) => s + r.totalPeople, 0
        );
        result.push(hotelResult);
      }
    }

    return res.json({
      success:   true,
      remaining: Math.max(0, remaining),
      status:    remaining <= 0 ? "ok" : "partial",
      hotels:    result,
    });
  } catch (err) {
    console.error("[tour-hotel.suggestAllocation]", err);
    return res.json({ success: false, message: "Lỗi server" });
  }
};

// ── Lưu bản nháp segments ────────────────────────────────────────────────────
module.exports.saveSegments = async (req, res) => {
  try {
    const companyId = req.account.companyId;
    const { tourId, departureDate, endDate, paxRequired, segments } = req.body;

    let segmentsArr;
    try {
      segmentsArr = typeof segments === "string" ? JSON.parse(segments) : segments;
    } catch {
      return res.json({ success: false, message: "Dữ liệu segments không hợp lệ" });
    }

    const depDate  = new Date(departureDate);
    const endDateD = new Date(endDate);

    const existing = await TourSegment.findOne({ tourId, departureDate: depDate });
    if (existing) {
      existing.endDate     = endDateD;
      existing.paxRequired = Number(paxRequired) || 0;
      existing.segments    = segmentsArr;
      existing.status      = "draft";
      await existing.save();
    } else {
      await TourSegment.create({
        tourId,
        companyId,
        departureDate: depDate,
        endDate:       endDateD,
        paxRequired:   Number(paxRequired) || 0,
        segments:      segmentsArr,
        status:        "draft",
      });
    }

    return res.json({ success: true, message: "Đã lưu bản nháp thành công" });
  } catch (err) {
    console.error("[tour-hotel.saveSegments]", err);
    return res.json({ success: false, message: "Lỗi server" });
  }
};

// ── Xác nhận segments + giữ phòng ───────────────────────────────────────────
module.exports.confirmSegments = async (req, res) => {
  try {
    const companyId = req.account.companyId;
    const { tourId, departureDate } = req.body;

    const depDate = new Date(departureDate);
    const tourSeg = await TourSegment.findOne({ tourId, departureDate: depDate, companyId });
    if (!tourSeg) {
      return res.json({ success: false, message: "Không tìm thấy cấu hình" });
    }

    const Tour = require("../../models/tour.model");
    const tourDoc = await Tour.findById(tourId).select("name").lean();
    const tourName = tourDoc ? tourDoc.name : "Tour";
    const depDateFmt = moment(tourSeg.departureDate).format("DD/MM/YYYY");
    const endDateFmt = moment(tourSeg.endDate).format("DD/MM/YYYY");

    // Huỷ TẤT CẢ booking hold cũ của segment này
    await HotelBooking.updateMany(
      { tourSegmentId: tourSeg._id, status: { $ne: "cancelled" } },
      { status: "cancelled" }
    );

    const newHoldIds = [];
    let totalRoomsBlocked = 0;
    const warnings = [];

    for (const seg of tourSeg.segments) {
      const checkIn  = new Date(seg.fromDate);
      const checkOut = new Date(seg.toDate);

      for (const hotelEntry of seg.hotels) {
        const hotelDoc = await Hotel.findById(hotelEntry.hotelId)
          .select("name rooms roomTypes")
          .lean();
        if (!hotelDoc) continue;

        const existingBookings = await HotelBooking.find({
          "hotel.hotelId": hotelEntry.hotelId,
          status: { $nin: ["cancelled", "checked_out"] },
          checkIn:  { $lt: checkOut },
          checkOut: { $gt: checkIn },
        })
          .select("roomTypeId roomId rooms status checkIn checkOut tourSegmentId")
          .lean();

        for (const ra of hotelEntry.roomAllocations) {
          if (!ra.assignedRooms || ra.assignedRooms <= 0) continue;

          const availableRoomIds = getAvailableRoomsForType(
            hotelDoc.rooms || [],
            ra.roomTypeId,
            existingBookings,
            checkIn,
            checkOut
          );

          const roomsToBook = Math.min(ra.assignedRooms, availableRoomIds.length);

          if (roomsToBook < ra.assignedRooms) {
            warnings.push(
              `${hotelDoc.name} / ${ra.roomTypeName}: chỉ còn ${availableRoomIds.length} phòng thực trống (cần ${ra.assignedRooms})`
            );
          }

          if (roomsToBook === 0) continue;

          const selectedRoomIds = availableRoomIds.slice(0, roomsToBook);
          for (const roomId of selectedRoomIds) {
            const holdCode = "TH" + generateRandomNumber(10);
            const booking = await HotelBooking.create({
              code:       holdCode,
              checkIn,
              checkOut,
              rooms:      1,
              adults:     ra.baseOccupancy || 2,
              roomId,
              roomTypeId: ra.roomTypeId,
              hotel: {
                hotelId: hotelEntry.hotelId,
                name:    hotelEntry.hotelName,
              },
              status:          "confirmed",
              isTemporaryHold: false,
              tourSegmentId:   tourSeg._id,
              note: `[Tour Hold] ${tourName} | ${depDateFmt} – ${endDateFmt} | ${ra.roomTypeName}`,
              guest: { fullName: "[Tour Hold]", phone: "", email: "" },
            });
            newHoldIds.push(booking._id);
            totalRoomsBlocked++;

            existingBookings.push({
              roomTypeId: ra.roomTypeId,
              roomId,
              rooms: 1,
              status: "confirmed",
              checkIn,
              checkOut,
            });
          }
        }
      }
    }

    tourSeg.status         = "confirmed";
    tourSeg.holdBookingIds = newHoldIds;
    await tourSeg.save();

    let message = `Đã giữ thành công ${totalRoomsBlocked} phòng vật lý cho tour.`;
    if (warnings.length > 0) {
      message += ` Cảnh báo: ${warnings.join("; ")}`;
    }

    return res.json({ success: true, message });
  } catch (err) {
    console.error("[tour-hotel.confirmSegments]", err);
    return res.json({ success: false, message: "Lỗi server" });
  }
};

// ── Huỷ cấu hình + giải phóng phòng đã giữ ──────────────────────────────────
module.exports.cancelSegments = async (req, res) => {
  try {
    const companyId = req.account.companyId;
    const { tourId, departureDate } = req.body;

    const depDate = new Date(departureDate);
    const tourSeg = await TourSegment.findOne({ tourId, departureDate: depDate, companyId });
    if (!tourSeg) {
      return res.json({ success: false, message: "Không tìm thấy cấu hình" });
    }

    await HotelBooking.updateMany(
      { tourSegmentId: tourSeg._id, status: { $ne: "cancelled" } },
      { status: "cancelled" }
    );

    tourSeg.status         = "cancelled";
    tourSeg.holdBookingIds = [];
    await tourSeg.save();

    return res.json({ success: true, message: "Đã huỷ và giải phóng phòng" });
  } catch (err) {
    console.error("[tour-hotel.cancelSegments]", err);
    return res.json({ success: false, message: "Lỗi server" });
  }
};

// ── Trang phân công phòng cho khách hàng ─────────────────────────────────────
module.exports.assign = async (req, res) => {
  try {
    const companyId    = req.account.companyId;
    const { segmentId } = req.params;

    const tourSeg = await TourSegment.findOne({ _id: segmentId, companyId }).lean();
    if (!tourSeg) return res.redirect(`/${pathAdmin}/tour-hotel/list`);

    if (tourSeg.status !== "confirmed") {
      return res.redirect(
        `/${pathAdmin}/tour-hotel/detail/${tourSeg.tourId}?departure=${moment(tourSeg.departureDate).format("YYYY-MM-DD")}`
      );
    }

    const tour = await Tour.findById(tourSeg.tourId).select("name avatar").lean();

    // Lấy tour hold bookings có roomId (phòng cụ thể đã giữ)
    const holdBookingsRaw = await HotelBooking.find({
      tourSegmentId: tourSeg._id,
      status: { $ne: "cancelled" },
      roomId: { $ne: null },
      code: { $ne: null },
    })
      .select("code roomId roomTypeId hotel checkIn checkOut adults note guest status")
      .sort({ _id: -1 }) // mới nhất trước
      .lean();

    // Deduplicate theo (roomId + checkIn): cùng phòng nhưng khác khoảng thời gian
    // (tour qua lại cùng KS nhiều đợt) → giữ cả 2 booking, phân biệt nhau bằng ngày
    const seenKeys = new Set();
    const holdBookings = holdBookingsRaw.filter((b) => {
      const key = String(b.roomId) + "_" + String(b.checkIn);
      if (seenKeys.has(key)) return false;
      seenKeys.add(key);
      return true;
    });

    // Lấy tất cả hotel liên quan để biết roomNumber + ageBands cho tính occupancy
    const hotelIds = [...new Set(holdBookings.map((b) => String(b.hotel?.hotelId)).filter(Boolean))];
    const hotels   = await Hotel.find({ _id: { $in: hotelIds } })
      .select("name address rooms roomTypes ageBands")
      .lean();

    const hotelMap = {};
    for (const h of hotels) hotelMap[String(h._id)] = h;

    // Enrich hold bookings với roomNumber + roomTypeName + capacity
    const enrichedHolds = holdBookings.map((b) => {
      const hotel   = hotelMap[String(b.hotel?.hotelId)] || null;
      const room    = (hotel?.rooms || []).find((r) => String(r._id) === String(b.roomId));
      const rtEntry = (hotel?.roomTypes || []).find(
        (rt) => String(rt._id) === String(b.roomTypeId)
      );
      return {
        ...b,
        roomId:        String(b.roomId),
        hotelName:     hotel?.name || b.hotel?.name || "",
        roomNumber:    room?.roomNumber || "?",
        floor:         room?.floor || "",
        roomTypeName:  rtEntry?.name || "",
        baseOccupancy: rtEntry?.baseOccupancy ?? b.adults ?? 2,
        maxOccupancy:  rtEntry?.maxOccupancy  ?? rtEntry?.baseOccupancy ?? b.adults ?? 2,
      };
    });

    // Nhóm hold bookings theo khách sạn, kèm ageBands để JS tính effective occupancy
    const holdsByHotel = {};
    for (const hb of enrichedHolds) {
      const key = String(hb.hotel?.hotelId);
      if (!holdsByHotel[key]) {
        const hotelDoc = hotelMap[key] || null;
        holdsByHotel[key] = {
          hotelId:   key,
          hotelName: hb.hotelName,
          ageBands:  (hotelDoc?.ageBands || []).map((b) => ({
            bandName:         b.bandName        || "",
            bandType:         b.bandType        || "adult",
            minAge:           b.minAge          ?? 0,
            maxAge:           b.maxAge          ?? null,
            countInOccupancy: b.countInOccupancy ?? true,
            occupancyWeight:  b.occupancyWeight  ?? 1,
          })),
          rooms: [],
        };
      }
      holdsByHotel[key].rooms.push(hb);
    }

    // Lấy đơn hàng đã thanh toán chứa tour này + đúng lịch khởi hành
    // Điều kiện "đã thanh toán": paymentStatus = "paid" HOẶC status = "done"
    const departureDateDisplay = moment(tourSeg.departureDate).format("DD/MM/YYYY");
    const rawOrders = await Order.find({
      "items.tourId": String(tourSeg.tourId),
      $or: [{ paymentStatus: "paid" }, { status: "done" }],
      status: { $ne: "cancel" },
      deleted: { $ne: true },
    })
      .select("code fullName phone note items userId paymentStatus status")
      .lean();

    // Lọc và trích xuất đúng item khớp lịch khởi hành
    const customers = [];
    for (const order of rawOrders) {
      const matchedItem = (order.items || []).find((it) => {
        if (String(it.tourId) !== String(tourSeg.tourId)) return false;
        // Ưu tiên so sánh theo departureDateDisplay (do client gửi lên khi đặt)
        if (it.departureDateDisplay) {
          return it.departureDateDisplay === departureDateDisplay;
        }
        // Fallback cho đơn cũ: so sánh theo departureDate (trường đơn lẻ cũ)
        if (it.departureDate) {
          return moment(it.departureDate).format("DD/MM/YYYY") === departureDateDisplay;
        }
        // Không có thông tin ngày → không khớp segment nào cụ thể
        return false;
      });
      if (!matchedItem) continue;

      const quantityAdult    = matchedItem.quantityAdult    || 0;
      const quantityChildren = matchedItem.quantityChildren || 0;
      const quantityBaby     = matchedItem.quantityBaby     || 0;
      const totalPeople      = quantityAdult + quantityChildren + quantityBaby;

      const childrenAges = Array.isArray(matchedItem.childrenAges) ? matchedItem.childrenAges : [];
      const babyAges     = Array.isArray(matchedItem.babyAges)     ? matchedItem.babyAges     : [];

      const allocation = matchedItem.hotelAllocation || null;

      customers.push({
        orderId:              String(order._id),
        orderCode:            order.code || String(order._id).slice(-6).toUpperCase(),
        guestName:            order.fullName || "",
        phone:                order.phone || "",
        note:                 order.note || "",
        totalPeople,
        quantityAdult,
        quantityChildren,
        quantityBaby,
        childrenAges,
        babyAges,
        paymentStatus:        order.paymentStatus || "unpaid",
        orderStatus:          order.status || "initial",
        departureDateDisplay: matchedItem.departureDateDisplay || "",
        suggestedHotelId:     allocation?.allocations?.[0]?.hotelId || null,
        suggestedHotelName:   allocation?.allocations?.[0]?.hotelName || "",
        hotelAllocation:      allocation,
      });
    }

    // Map existing assignments
    const existingAssignments = (tourSeg.assignments || []).map((a) => ({
      ...a,
      orderId:       String(a.orderId),
      hotelId:       String(a.hotelId),
      roomId:        String(a.roomId),
      holdBookingId: a.holdBookingId ? String(a.holdBookingId) : null,
    }));

    res.render("admin/pages/tour-hotel-assign", {
      pageTitle:   "Phân công phòng – " + (tour?.name || ""),
      tourSeg,
      tour,
      customers,
      holdsByHotel: Object.values(holdsByHotel),
      existingAssignments,
      departureDateDisplay,
      pathAdmin,
      moment,
    });
  } catch (err) {
    console.error("[tour-hotel.assign]", err);
    res.render("admin/pages/error-404", { pageTitle: "Lỗi" });
  }
};

// ── API: Lưu phân công phòng ─────────────────────────────────────────────────
module.exports.saveAssignments = async (req, res) => {
  try {
    const companyId    = req.account.companyId;
    const { segmentId } = req.params;

    const tourSeg = await TourSegment.findOne({ _id: segmentId, companyId });
    if (!tourSeg) {
      return res.json({ success: false, message: "Không tìm thấy cấu hình" });
    }

    let assignments;
    try {
      assignments = typeof req.body.assignments === "string"
        ? JSON.parse(req.body.assignments)
        : req.body.assignments;
    } catch {
      return res.json({ success: false, message: "Dữ liệu không hợp lệ" });
    }

    if (!Array.isArray(assignments)) {
      return res.json({ success: false, message: "assignments phải là mảng" });
    }

    // Lấy assignments cũ để biết booking nào cần reset về Tour Hold
    const oldAssignedBookingIds = new Set(
      (tourSeg.assignments || [])
        .map((a) => a.holdBookingId)
        .filter(Boolean)
        .map(String)
    );

    // Xác thực: roomId phải thuộc holdBookings của segment này
    const holdBookings = await HotelBooking.find({
      tourSegmentId: tourSeg._id,
      status: { $ne: "cancelled" },
      roomId: { $ne: null },
    })
      .select("_id roomId roomTypeId hotel")
      .lean();

    // Key theo booking _id (để xử lý đúng khi cùng phòng vật lý có nhiều hold khác thời gian)
    const holdMap = {};
    for (const hb of holdBookings) holdMap[String(hb._id)] = hb;

    const hotelIds = [...new Set(holdBookings.map((b) => String(b.hotel?.hotelId)).filter(Boolean))];
    const hotels   = await Hotel.find({ _id: { $in: hotelIds } }).select("name rooms roomTypes").lean();
    const hotelMap = {};
    for (const h of hotels) hotelMap[String(h._id)] = h;

    const cleanAssignments = assignments.map((a) => {
      // Dùng holdBookingId (HotelBooking._id) làm key tra cứu
      const holdBooking = holdMap[String(a.holdBookingId)] || holdMap[String(a.roomId)] || null;
      const hotel       = holdBooking ? hotelMap[String(holdBooking.hotel?.hotelId)] : null;
      const physicalRoomId = holdBooking?.roomId || a.roomId;
      const room        = (hotel?.rooms || []).find((r) => String(r._id) === String(physicalRoomId));
      const rtEntry     = hotel
        ? (hotel.roomTypes || []).find((rt) => String(rt._id) === String(holdBooking?.roomTypeId))
        : null;

      return {
        orderId:       a.orderId,
        orderCode:     a.orderCode || "",
        guestName:     a.guestName || "",
        phone:         a.phone || "",
        numPeople:     Number(a.numPeople) || 1,
        hotelId:       holdBooking ? holdBooking.hotel.hotelId : a.hotelId,
        hotelName:     hotel?.name || a.hotelName || "",
        roomId:        physicalRoomId,
        roomNumber:    room?.roomNumber || a.roomNumber || "",
        roomTypeName:  rtEntry?.name || a.roomTypeName || "",
        holdBookingId: holdBooking ? holdBooking._id : null,
      };
    });

    // ── Đồng bộ guest info vào HotelBooking ──────────────────────────────────
    const newAssignedBookingIds = new Set();
    for (const a of cleanAssignments) {
      const hb = holdMap[String(a.holdBookingId)] || null;
      if (!hb) continue;
      newAssignedBookingIds.add(String(hb._id));
      await HotelBooking.findByIdAndUpdate(hb._id, {
        "guest.fullName": a.guestName || "Khách tour",
        "guest.phone":    a.phone || "",
        note: `[TOUR] Đơn #${a.orderCode} – ${a.guestName || ""} – ${a.numPeople} người`,
      });
    }

    // Booking bị xoá khỏi phân công → reset về placeholder Tour Hold
    // Dùng holdMap keys (tất cả hold booking của segment) để tìm booking cần reset:
    // bất kỳ hold booking nào KHÔNG có trong newAssignedBookingIds → reset
    const Tour = require("../../models/tour.model");
    const tourDoc = await Tour.findById(tourSeg.tourId).select("name").lean();
    const _tourName   = tourDoc ? tourDoc.name : "Tour";
    const _depDateFmt = moment(tourSeg.departureDate).format("DD/MM/YYYY");
    const _endDateFmt = moment(tourSeg.endDate).format("DD/MM/YYYY");
    const resetNote   = `[Tour Hold] ${_tourName} | ${_depDateFmt} – ${_endDateFmt}`;

    for (const hbId of Object.keys(holdMap)) {
      if (newAssignedBookingIds.has(hbId)) continue;
      const doc = await HotelBooking.findById(hbId);
      if (!doc) continue;
      doc.guest.fullName = "[Tour Hold]";
      doc.guest.phone    = "";
      doc.note   = resetNote;
      doc.status = "confirmed";
      await doc.save();
    }

    tourSeg.assignments = cleanAssignments;
    await tourSeg.save();

    // Safety net: đảm bảo mọi booking chưa gán khách đều có status "confirmed"
    await HotelBooking.collection.updateMany(
      {
        tourSegmentId: tourSeg._id,
        "guest.fullName": "[Tour Hold]",
        status: { $nin: ["confirmed", "cancelled"] },
      },
      { $set: { status: "confirmed" } }
    );

    return res.json({
      success: true,
      message: `Đã lưu phân công ${cleanAssignments.length} mục và cập nhật thông tin khách thành công`,
    });
  } catch (err) {
    console.error("[tour-hotel.saveAssignments]", err);
    return res.json({ success: false, message: "Lỗi server" });
  }
};
