// helpers/tour-hotel-quota-pressure.helper.js
//
// Đo "áp lực quota phòng KS" cho một lịch khởi hành của tour:
//   pressureLevel = 'ok' | 'low' | 'exhausted'
//
//   exhausted: tổng availableRooms = 0 và còn ghế tour
//   low:       sức chứa phòng còn lại < ghế tour còn lại
//   ok:        còn đủ
//
// Cũng xuất maybeNotifyTourQuotaPressure (dedupe 24h / per-segment / per-level).

const moment = require("moment");
const TourSegment = require("../models/tour-segment.model");
const Tour = require("../models/tour.model");
const Order = require("../models/order.model");
const HotelBooking = require("../models/hotel-booking.model");
const Notification = require("../models/notification.model");
const { pathAdmin } = require("../config/variable.config");

// ─── Đếm phòng đã book theo loại (giống logic tour.controller.js ~440–537) ───

async function _countBookedByRoomType({ tourSegmentId, hotelId, fromDateStr, toDateStr, tsAssignments }) {
  const now = new Date();
  // Đếm ở riêng qua Order.items.roomSelections
  const conflictOrders = await Order.find({
    deleted: { $ne: true },
    status: { $ne: "cancel" },
    $or: [
      {
        "items.roomSelections.tourSegmentId": String(tourSegmentId),
        "items.roomSelections.hotelId": String(hotelId),
      },
      {
        "items.sharedRoomRequest.tourSegmentId": String(tourSegmentId),
        "items.sharedRoomRequest.hotelAllocations.hotelId": String(hotelId),
      },
    ],
  })
    .select("paymentStatus isTemporaryHold holdExpiresAt items")
    .lean();

  const bookedByRoomType = {};
  for (const ord of conflictOrders) {
    const isPaid = ord.paymentStatus === "paid";
    const isActiveHold =
      ord.isTemporaryHold &&
      (!ord.holdExpiresAt || new Date(ord.holdExpiresAt) > now);
    if (!isPaid && !isActiveHold) continue;

    for (const it of ord.items || []) {
      for (const rs of it.roomSelections || []) {
        if (
          String(rs.tourSegmentId) !== String(tourSegmentId) ||
          String(rs.hotelId) !== String(hotelId)
        ) continue;
        const rsFrom = rs.fromDate ? String(rs.fromDate).slice(0, 10) : "";
        const rsTo = rs.toDate ? String(rs.toDate).slice(0, 10) : "";
        if (rsFrom !== fromDateStr || rsTo !== toDateStr) continue;
        const rtKey = String(rs.roomTypeId);
        bookedByRoomType[rtKey] = (bookedByRoomType[rtKey] || 0) + Number(rs.selectedRooms || 0);
      }
    }
  }

  // Đếm ở ghép qua tourSeg.assignments (dedupe theo holdBookingId)
  const segAssignsShared = (tsAssignments || []).filter(
    (a) =>
      String(a.hotelId) === String(hotelId) &&
      a.holdBookingId &&
      a.accommodationMode === "shared"
  );
  if (segAssignsShared.length > 0) {
    const holdIds = [...new Set(segAssignsShared.map((a) => String(a.holdBookingId)))];
    const holdRows = await HotelBooking.find({
      _id: { $in: holdIds },
      status: { $ne: "cancelled" },
      "hotel.hotelId": String(hotelId),
    })
      .select("_id roomTypeId checkIn checkOut")
      .lean();

    const holdMap = {};
    for (const hb of holdRows) {
      const ci = hb.checkIn ? moment(hb.checkIn).format("YYYY-MM-DD") : "";
      const co = hb.checkOut ? moment(hb.checkOut).format("YYYY-MM-DD") : "";
      if (ci !== fromDateStr || co !== toDateStr) continue;
      holdMap[String(hb._id)] = String(hb.roomTypeId || "");
    }
    const holdsPerRt = {};
    for (const a of segAssignsShared) {
      const rtId = holdMap[String(a.holdBookingId)];
      if (!rtId) continue;
      if (!holdsPerRt[rtId]) holdsPerRt[rtId] = new Set();
      holdsPerRt[rtId].add(String(a.holdBookingId));
    }
    for (const rtId of Object.keys(holdsPerRt)) {
      bookedByRoomType[rtId] = (bookedByRoomType[rtId] || 0) + holdsPerRt[rtId].size;
    }
  }

  return bookedByRoomType;
}

// ─── Hàm chính: đánh giá áp lực quota ────────────────────────────────────────

/**
 * @param {{ tourSegmentId?: string, tourId?: string, departureDate?: string }} input
 *   Truyền tourSegmentId, hoặc cặp tourId + departureDate (YYYY-MM-DD).
 * @returns {Promise<{
 *   ok: boolean,
 *   pressureLevel: 'ok'|'low'|'exhausted'|'no_segment',
 *   seatsRemaining: number,
 *   totalAvailableRooms: number,
 *   personCapacityAvailable: number,
 *   paxRequired: number,
 *   tourSegmentId: string,
 *   tourId: string,
 *   tourName: string,
 *   departureDate: string,
 *   companyId: string,
 *   frames: Array<{
 *     fromDate: string, toDate: string,
 *     hotels: Array<{ hotelId: string, hotelName: string, roomTypes: Array<{
 *       roomTypeId: string, roomTypeName: string, baseOccupancy: number,
 *       assignedRooms: number, bookedRooms: number, availableRooms: number
 *     }> }>
 *   }>,
 * }>}
 */
async function evaluateTourHotelQuotaPressure({ tourSegmentId, tourId, departureDate }) {
  let tourSeg;
  if (tourSegmentId) {
    tourSeg = await TourSegment.findById(tourSegmentId).lean();
  } else if (tourId && departureDate) {
    tourSeg = await TourSegment.findOne({
      tourId,
      departureDate: new Date(departureDate),
    }).lean();
  }

  if (!tourSeg || !["confirmed", "pending_approval"].includes(tourSeg.status)) {
    return {
      ok: false,
      pressureLevel: "no_segment",
      seatsRemaining: 0,
      totalAvailableRooms: 0,
      personCapacityAvailable: 0,
      paxRequired: 0,
      tourSegmentId: tourSegmentId || "",
      tourId: tourId || "",
      tourName: "",
      departureDate: departureDate || "",
      companyId: "",
      frames: [],
    };
  }

  // Lấy seatsRemaining từ Tour.departures
  const tourDoc = await Tour.findById(tourSeg.tourId)
    .select("name departures seatsRemaining")
    .lean();
  const depDateStr = moment(tourSeg.departureDate).format("YYYY-MM-DD");
  const dep = (tourDoc?.departures || []).find(
    (d) => moment(d.departureDate).format("YYYY-MM-DD") === depDateStr
  );
  const seatsRemaining = dep ? Math.max(0, Number(dep.seatsRemaining) || 0) : Math.max(0, Number(tourDoc?.seatsRemaining) || 0);

  const frames = [];
  let totalAvailableRooms = 0;
  let personCapacityAvailable = 0;

  for (const seg of tourSeg.segments || []) {
    const fromDateStr = seg.fromDate ? moment(seg.fromDate).format("YYYY-MM-DD") : "";
    const toDateStr = seg.toDate ? moment(seg.toDate).format("YYYY-MM-DD") : "";
    if (!fromDateStr || !toDateStr) continue;

    const frameHotels = [];
    for (const hotelEntry of seg.hotels || []) {
      if (!hotelEntry.roomAllocations || hotelEntry.roomAllocations.length === 0) continue;

      const bookedByRoomType = await _countBookedByRoomType({
        tourSegmentId: tourSeg._id,
        hotelId: hotelEntry.hotelId,
        fromDateStr,
        toDateStr,
        tsAssignments: tourSeg.assignments,
      });

      const roomTypes = [];
      for (const ra of hotelEntry.roomAllocations) {
        if (!ra.assignedRooms || ra.assignedRooms <= 0) continue;
        const booked = bookedByRoomType[String(ra.roomTypeId)] || 0;
        const available = Math.max(0, ra.assignedRooms - booked);
        totalAvailableRooms += available;
        personCapacityAvailable += available * (ra.baseOccupancy || 2);
        roomTypes.push({
          roomTypeId: String(ra.roomTypeId),
          roomTypeName: ra.roomTypeName || "",
          baseOccupancy: ra.baseOccupancy || 2,
          assignedRooms: ra.assignedRooms,
          bookedRooms: booked,
          availableRooms: available,
        });
      }
      if (roomTypes.length > 0) {
        frameHotels.push({
          hotelId: String(hotelEntry.hotelId),
          hotelName: hotelEntry.hotelName || "",
          roomTypes,
        });
      }
    }
    if (frameHotels.length > 0) {
      frames.push({ fromDate: fromDateStr, toDate: toDateStr, hotels: frameHotels });
    }
  }

  // Tính pressureLevel
  let pressureLevel = "ok";
  if (frames.length > 0) {
    if (totalAvailableRooms === 0 && seatsRemaining > 0) {
      pressureLevel = "exhausted";
    } else if (personCapacityAvailable < seatsRemaining) {
      pressureLevel = "low";
    }
  }

  return {
    ok: true,
    pressureLevel,
    seatsRemaining,
    totalAvailableRooms,
    personCapacityAvailable,
    paxRequired: tourSeg.paxRequired || 0,
    tourSegmentId: String(tourSeg._id),
    tourId: String(tourSeg.tourId),
    tourName: tourDoc?.name || "",
    departureDate: depDateStr,
    companyId: String(tourSeg.companyId),
    frames,
  };
}

// ─── Gửi notification có dedupe ───────────────────────────────────────────────

/**
 * Tạo notification cho admin công ty tour nếu:
 *   - Chưa có bản ghi tour_hotel_quota unread trong 24h với cùng mức,
 *   - Hoặc mức chuyển từ low → exhausted (cần thông báo ngay).
 *
 * @param {object} pressure - kết quả từ evaluateTourHotelQuotaPressure
 */
async function maybeNotifyTourQuotaPressure(pressure) {
  if (!pressure || !pressure.ok) return;
  if (pressure.pressureLevel === "ok" || pressure.pressureLevel === "no_segment") return;
  if (!pressure.companyId) return;

  const { pressureLevel, companyId, tourName, departureDate, tourSegmentId, seatsRemaining, personCapacityAvailable, tourId } = pressure;

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Tìm notification chưa đọc, cùng segment, trong 24h
  const existing = await Notification.findOne({
    companyId,
    type: "tour_hotel_quota",
    deleted: { $ne: true },
    isRead: false,
    createdAt: { $gte: since24h },
    "metadata.tourSegmentId": String(tourSegmentId),
  }).lean();

  if (existing) {
    const existingLevel = existing.metadata?.pressureLevel;
    // Chỉ upgrade nếu mức nghiêm trọng hơn (low → exhausted)
    if (existingLevel === pressureLevel) return;
    if (existingLevel === "exhausted") return; // không downgrade
    if (pressureLevel !== "exhausted") return; // chỉ tạo mới khi lên exhausted
  }

  const depDisplay = moment(departureDate, "YYYY-MM-DD").format("DD/MM/YYYY");
  const link = `/${pathAdmin}/tour-hotel/detail/${tourId}?departure=${departureDate}`;

  let title, content;
  if (pressureLevel === "exhausted") {
    title = "Hết phòng lưu trú trong quota tour";
    content =
      `Tour "${tourName}" (${depDisplay}) vẫn còn ${seatsRemaining} ghế nhưng đã hết phòng trống trong quota khách sạn. ` +
      `Vui lòng yêu cầu bổ sung phòng từ khách sạn.`;
  } else {
    title = "Quota phòng KS sắp không đủ cho tour";
    content =
      `Tour "${tourName}" (${depDisplay}) còn ${seatsRemaining} ghế nhưng sức chứa phòng KS trong quota chỉ còn ~${personCapacityAvailable} chỗ. ` +
      `Vui lòng kiểm tra và bổ sung phòng nếu cần.`;
  }

  await Notification.create({
    companyId,
    type: "tour_hotel_quota",
    title,
    content,
    link,
    metadata: {
      tourSegmentId: String(tourSegmentId),
      pressureLevel,
    },
  });
}

module.exports = {
  evaluateTourHotelQuotaPressure,
  maybeNotifyTourQuotaPressure,
};
