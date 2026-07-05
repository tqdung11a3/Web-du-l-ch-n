// controllers/admin/tour-hotel.controller.js
//
// Quản lý "Liên kết Tour – Khách sạn": company admin chia tour thành các
// khung thời gian và phân bổ phòng khách sạn cho từng khung.

const mongoose    = require("mongoose");
const Tour        = require("../../models/tour.model");
const Company     = require("../../models/company.model");
const Hotel       = require("../../models/hotel.model");
const HotelBooking= require("../../models/hotel-booking.model");
const TourSegment = require("../../models/tour-segment.model");
const HotelLinkRequest = require("../../models/hotel-link-request.model");
const Order       = require("../../models/order.model");
const AccountUser = require("../../models/account-user.model");

const { getAvailableRoomsForType } = require("../../helpers/hotel-availability.helper");
const { generateRandomNumber }     = require("../../helpers/generate.helper");
const { pathAdmin } = require("../../config/variable.config");
const moment = require("moment");
const {
  HOTEL_LINK_REQ_AUTO_BY_SENDING_COMPANY_TAG,
} = require("../../helpers/hotel-link-request-note.helper");
const { diffHotelsForConfirm, pickLatestRequestPerHotelMap } = require("../../helpers/tour-hotel-segment-diff.helper");
const auditLogHelper = require("../../helpers/audit-log.helper");
const { evaluateTourHotelQuotaPressure } = require("../../helpers/tour-hotel-quota-pressure.helper");
const {
  countPax,
  passengersForAtoms,
  mergePax,
  paxToHotelBookingSet,
} = require("../../helpers/hotel-booking-pax.helper");

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
    })
      .select("_id tourId departureDate status")
      .lean();

    // Chuẩn hoá trạng thái hiển thị từ link request thực tế. Với mỗi
    // (segment, hotelId) chỉ xét request mới nhất (sort theo createdAt DESC
    // và lọc trùng) để bỏ qua các request cũ đã reject/cancel ở vòng trước.
    //   pending     → "pending_approval" (Chờ duyệt KS khác)
    //   rejected    → "rejected"         (Bị <company> từ chối)
    //   cancelled   → "draft"            (Bản nháp, bên gửi/Super Admin huỷ)
    //   còn lại     → giữ trạng thái segment hiện tại (confirmed / draft).
    const segmentIds = existing.map((s) => s._id);
    const linkRequests = segmentIds.length
      ? await HotelLinkRequest.find({ tourSegmentId: { $in: segmentIds } })
          .select("tourSegmentId status toCompanyName hotelId createdAt")
          .sort({ createdAt: -1 })
          .lean()
      : [];
    const requestsBySegment = {};
    for (const r of linkRequests) {
      const key = String(r.tourSegmentId);
      const list = (requestsBySegment[key] = requestsBySegment[key] || {
        seenHotels: new Set(),
        latest: [],
      });
      const hotelKey = String(r.hotelId);
      if (list.seenHotels.has(hotelKey)) continue;
      list.seenHotels.add(hotelKey);
      list.latest.push(r);
    }

    const configuredMap = {};
    for (const seg of existing) {
      const key = String(seg.tourId);
      if (!configuredMap[key]) configuredMap[key] = [];

      const bucket = requestsBySegment[String(seg._id)];
      const segRequests = bucket ? bucket.latest : [];
      let effectiveStatus = seg.status;
      let rejectedByCompanyName = "";
      let rejectedByCompanyNames = [];
      if (seg.status === "cancelled") {
        effectiveStatus = "cancelled";
      } else if (segRequests.length > 0) {
        const hasPending = segRequests.some((r) => r.status === "pending");
        const rejectedReqs = segRequests.filter((r) => r.status === "rejected");
        const hasCancelled = segRequests.some((r) => r.status === "cancelled");
        if (hasPending) {
          effectiveStatus = "pending_approval";
        } else if (rejectedReqs.length > 0) {
          effectiveStatus = "rejected";
          rejectedByCompanyNames = [
            ...new Set(rejectedReqs.map((r) => r.toCompanyName).filter(Boolean)),
          ];
          rejectedByCompanyName = rejectedByCompanyNames.join(", ");
        } else if (hasCancelled) {
          effectiveStatus = "draft";
        } else {
          effectiveStatus = "confirmed";
        }
      }

      configuredMap[key].push({
        segmentId:             String(seg._id),
        departureDateStr:      moment(seg.departureDate).format("YYYY-MM-DD"),
        status:                effectiveStatus,
        rejectedByCompanyName,
        rejectedByCompanyNames,
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

    // 1. Lấy thông tin tour, departure từ params và query
    const companyId = req.account.companyId;
    const { tourId } = req.params;
    const departureDateParam = req.query.departure;

    const tour = await Tour.findOne({ _id: tourId, companyId, deleted: false }).lean();
    if (!tour) return res.redirect(`/${pathAdmin}/tour-hotel/list`);
    // End 1. Lấy thông tin tour, departure từ params và query

    // 2. Lấy danh sách khách sạn

    // Model Hotel chỉ lưu ID công ty, không lưu tên => Đầu tiên, lấy tất cả KS active
    const hotels = await Hotel.find({ deleted: false, status: "active" })
      .select("name address companyId")
      .lean();

    // Gom ID công ty (bỏ trùng)
    const hotelCompanyIds = [...new Set(hotels.map((h) => String(h.companyId)).filter(Boolean))];

    // Query Company một lần
    const hotelCompanies = await Company.find({ _id: { $in: hotelCompanyIds } })
      .select("name")
      .lean();

    // Map id → tên (tra cứu nhanh)
    const companyNameById = {};
    for (const c of hotelCompanies) companyNameById[String(c._id)] = c.name || "";

    // Gắn tên công ty vào từng KS
    for (const h of hotels) {
      h.companyName = companyNameById[String(h.companyId)] || "";
    }
    // End 2. Lấy danh sách khách sạn

    let selectedDeparture = null;
    let existingSegment   = null;

    if (departureDateParam) {
      // 3. Tìm departure tương ứng trong tour.departures
      selectedDeparture = (tour.departures || []).find(
        (d) => moment(d.departureDate).format("YYYY-MM-DD") === departureDateParam
      );

      if (selectedDeparture) {

        // Trạng thái "Đã xác nhận" từ TourSegment + HotelLinkRequest
        // Lấy thông tin tour segment từ TourSegment, bao gồm status, rejectedByCompanyName, rejectedByCompanyNames, rejectedHotelName, rejectedResponseNote
        existingSegment = await TourSegment.findOne({
          tourId,
          departureDate: new Date(departureDateParam),
        }).lean();

        // Heal DB status cho chính segment này theo luật latest-per-hotel —
        // tránh trường hợp DB còn mắc kẹt ở "rejected" cũ dù link request mới
        // đã được duyệt (dữ liệu trước khi helper được nâng cấp).
        if (existingSegment && existingSegment.status !== "cancelled") {
          try {
            const {
              _recomputeTourSegmentStatus,
            } = require("./hotel-link-request.controller");
            await _recomputeTourSegmentStatus(existingSegment._id);
            existingSegment = await TourSegment.findById(existingSegment._id).lean();
          } catch (healErr) {
            console.error(
              "[tour-hotel.detail] heal status error:",
              healErr
            );
          }
        }

        // Đồng bộ trạng thái hiển thị với link request thực tế. Chỉ xét request
        // mới nhất theo createdAt cho mỗi hotel để các request cũ đã
        // reject/cancel ở vòng trước không đè lên kết quả sau khi admin gửi
        // lại và được chấp nhận.
        if (existingSegment && existingSegment.status !== "cancelled") {
          const allRequests = await HotelLinkRequest.find({
            tourSegmentId: existingSegment._id,
          })
            .select("status toCompanyName hotelId hotelName responseNote createdAt")
            .sort({ createdAt: -1 })
            .lean();

          // Chỉ giữ request mới nhất mỗi KS (theo createdAt DESC) ở phía trên
          const seenHotels = new Set();
          const segRequests = [];
          for (const r of allRequests) {
            const key = String(r.hotelId);
            if (seenHotels.has(key)) continue;
            seenHotels.add(key);
            segRequests.push(r);
          }

          if (segRequests.length > 0) {
            const autoTag = HOTEL_LINK_REQ_AUTO_BY_SENDING_COMPANY_TAG;
            const isAutoClosed = (r) =>
              r.status === "rejected" &&
              autoTag &&
              (r.responseNote || "").indexOf(autoTag) === 0;

            const hasPending = segRequests.some((r) => r.status === "pending");
            // Chỉ xét rejected THẬT (do KS bấm Từ chối), bỏ qua auto-closed
            // bởi chính bên gửi (khi admin tour cấu hình lại).

            // Reject do khách sạn từ chối
            const rejectedReqs = segRequests.filter(
              (r) => r.status === "rejected" && !isAutoClosed(r)
            );

            // admin tour cấu hình lại
            const hasCancelled = segRequests.some(
              (r) => r.status === "cancelled" || isAutoClosed(r)
            );
            if (hasPending) {
              existingSegment.status = "pending_approval"; // Chờ duyệt KS khác
            } else if (rejectedReqs.length > 0) {
              existingSegment.status = "rejected"; // ít nhất 1 KS từ chối
              // Gom tên tất cả công ty đã từ chối (loại trùng)
              const uniqueCompanies = [
                ...new Set(rejectedReqs.map((r) => r.toCompanyName).filter(Boolean)),
              ];
              existingSegment.rejectedByCompanyNames = uniqueCompanies;
              existingSegment.rejectedByCompanyName = uniqueCompanies.join(", ");
              existingSegment.rejectedHotelName = rejectedReqs.map((r) => r.hotelName).filter(Boolean).join(", ");
              existingSegment.rejectedResponseNote =
                rejectedReqs[0].responseNote || "";
            } else if (hasCancelled) {
              existingSegment.status = "draft"; // Request bị huỷ / auto-closed, cần cấu hình lại
            } else {
              existingSegment.status = "confirmed"; // Các KS liên quan đã duyệt 
            }
          }
        }
      }
    }

    // Danh sách lịch khởi hành
    tour.departuresFormatted = (tour.departures || []).map((d) => ({
      departureDateStr:     moment(d.departureDate).format("YYYY-MM-DD"),
      departureDateDisplay: moment(d.departureDate).format("DD/MM/YYYY"),
      endDateDisplay:       d.endDate ? moment(d.endDate).format("DD/MM/YYYY") : "—",
      endDateStr:           d.endDate ? moment(d.endDate).format("YYYY-MM-DD") : "",
    }));

    const isTourOnlyAdmin =
      !req.account.isSuperAdmin &&
      (req.account.tabAccessScope === "tour_only" ||
        req.account.tabAccessScope === "tour_staff" ||
        (req.tabAccess?.restricted === true &&
          req.tabAccess?.hasTour &&
          !req.tabAccess?.hasHotel));

    // Tính áp lực quota phòng cho banner cảnh báo (chỉ khi có segment confirmed/pending)
    let quotaPressure = null;
    if (existingSegment && ["confirmed", "pending_approval"].includes(existingSegment.status)) {
      try {
        quotaPressure = await evaluateTourHotelQuotaPressure({
          tourSegmentId: String(existingSegment._id),
        });
      } catch (pressureErr) {
        console.error("[tour-hotel.detail] quotaPressure error:", pressureErr);
      }
    }

    // Build map hotelId → trạng thái link request mới nhất để hiển thị badge
    // trên từng hotel card trong khung lưu trú.
    // Các status cần phân biệt: pending | approved | partially_approved | rejected | cancelled | none
    // Auto-closed (rejected bởi bên gửi) → hiển thị như "cancelled" (không show đỏ "từ chối").
    const hotelLinkStatusMap = {};
    if (existingSegment && existingSegment.status !== "cancelled") {
      try {
        const autoTag = HOTEL_LINK_REQ_AUTO_BY_SENDING_COMPANY_TAG;
        const allLrForMap = await HotelLinkRequest.find({
          tourSegmentId: existingSegment._id,
        })
          .select("hotelId status responseNote createdAt")
          .sort({ createdAt: -1 })
          .lean();
        const seenForMap = new Set();
        for (const r of allLrForMap) {
          const hid = String(r.hotelId);
          if (seenForMap.has(hid)) continue;
          seenForMap.add(hid);
          const isAutoClosed =
            r.status === "rejected" &&
            autoTag &&
            (r.responseNote || "").indexOf(autoTag) === 0;
          hotelLinkStatusMap[hid] = isAutoClosed ? "cancelled" : r.status;
        }
      } catch (mapErr) {
        console.error("[tour-hotel.detail] hotelLinkStatusMap error:", mapErr);
      }
    }

    res.render("admin/pages/tour-hotel-detail", {
      pageTitle: "Cấu hình khung thời gian – Khách sạn",
      tour,
      hotels,
      selectedDeparture,
      existingSegment,
      departureDateParam,
      pathAdmin,
      moment,
      currentCompanyId: String(companyId),
      isTourOnlyAdmin,
      quotaPressure,
      hotelLinkStatusMap,
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

    // Lấy thông tin khách sạn, ngày checkin, checkout, và tour segment id (nếu có)
    const { hotelId, fromDate, toDate, excludeTourSegmentId } = req.query;

    if (!hotelId || !fromDate || !toDate) {
      return res.json({ success: false, message: "Thiếu tham số" });
    }

    // Lấy ngày checkin, checkout
    const checkIn  = new Date(fromDate);
    const checkOut = new Date(toDate);

    if (isNaN(checkIn) || isNaN(checkOut) || checkIn >= checkOut) {
      return res.json({ success: false, message: "Khoảng ngày không hợp lệ" });
    }

    // Lấy thông tin khách sạn
    const hotel = await Hotel.findOne({ _id: hotelId, deleted: false })
      .select("name address roomTypes rooms companyId")
      .lean();

    if (!hotel) {
      return res.json({ success: false, message: "Không tìm thấy khách sạn" });
    }

    // Tìm booking đang chiếm phòng ( trừ tour hiện tại)
    const bookingQuery = {
      "hotel.hotelId": hotelId,
      status: { $nin: ["cancelled", "checked_out"] },
      checkIn:  { $lt: checkOut },
      checkOut: { $gt: checkIn },
    };
    // Loại các HotelBooking thuộc CHÍNH tour segment đang chỉnh sửa
    // (Tour Hold của chính tour này không nên bị tính là "đã đặt từ khách lạ"
    // → tránh ép giảm assignedRooms đã cấu hình xuống 0).
    if (excludeTourSegmentId) {
      bookingQuery.tourSegmentId = { $ne: excludeTourSegmentId };
    }

    // Những booking đã tồn tại, tìm theo bookingQuery ở trên
    // Để có gì, hệ thống sẽ trừ đi những booking đã tồn tại khỏi số phòng trống của hotel
    const existingBookings = await HotelBooking.find(bookingQuery)
      .select("roomTypeId roomId rooms status checkIn checkOut")
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

      const hotel = await Hotel.findOne({ _id: h.hotelId, deleted: false })
        .select("name roomTypes rooms companyId")
        .lean();
      if (!hotel) continue;

      const bookings = await HotelBooking.find({
        "hotel.hotelId": h.hotelId,
        status: { $nin: ["cancelled", "checked_out"] },
        checkIn:  { $lt: checkOut },
        checkOut: { $gt: checkIn },
      })
        .select("roomTypeId roomId rooms status checkIn checkOut")
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

    if (isNaN(depDate.getTime()) || isNaN(endDateD.getTime())) {
      return res.json({ success: false, message: "Ngày khởi hành / kết thúc tour không hợp lệ" });
    }
    if (depDate > endDateD) {
      return res.json({ success: false, message: "Ngày khởi hành tour phải ≤ ngày kết thúc tour" });
    }

    // Chặn khung thời gian nằm ngoài khoảng [departureDate, endDate] của tour,
    // hoặc có fromDate > toDate. So sánh theo mốc ngày (bỏ giờ) để tránh lệch múi giờ.
    const _dayStart = (d) => {
      const x = new Date(d);
      x.setHours(0, 0, 0, 0);
      return x.getTime();
    };
    const tourFromMs = _dayStart(depDate);
    const tourToMs   = _dayStart(endDateD);
    const tourFromLabel = moment(depDate).format("DD/MM/YYYY");
    const tourToLabel   = moment(endDateD).format("DD/MM/YYYY");

    for (let i = 0; i < segmentsArr.length; i++) {
      const s = segmentsArr[i];
      if (!s || !s.fromDate || !s.toDate) continue;
      const f = new Date(s.fromDate);
      const t = new Date(s.toDate);
      if (isNaN(f.getTime()) || isNaN(t.getTime())) {
        return res.json({
          success: false,
          message: `Khung ${i + 1}: ngày không hợp lệ`,
        });
      }
      const fMs = _dayStart(f);
      const tMs = _dayStart(t);
      if (fMs > tMs) {
        return res.json({
          success: false,
          message: `Khung ${i + 1}: "Từ ngày" phải ≤ "Đến ngày"`,
        });
      }
      if (fMs < tourFromMs || tMs > tourToMs) {
        return res.json({
          success: false,
          message:
            `Khung ${i + 1}: ngày ${moment(f).format("DD/MM/YYYY")} → ${moment(t).format("DD/MM/YYYY")} ` +
            `phải nằm trong khoảng tour ${tourFromLabel} → ${tourToLabel}.`,
        });
      }
    }

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

    const TourModel = require("../../models/tour.model");
    const Notification = require("../../models/notification.model");
    const { _recomputeTourSegmentStatus } = require("./hotel-link-request.controller");

    const tourDoc = await TourModel.findById(tourId).select("name").lean();
    const tourName = tourDoc ? tourDoc.name : "Tour";
    const depDateFmt = moment(tourSeg.departureDate).format("DD/MM/YYYY");
    const endDateFmt = moment(tourSeg.endDate).format("DD/MM/YYYY");

    const fromCompany = await Company.findById(companyId).select("name").lean();
    const fromCompanyName = fromCompany ? fromCompany.name : "";
    const fromDisp = fromCompanyName || "công ty tổ chức tour";

    const allLinkRequests = await HotelLinkRequest.find({ tourSegmentId: tourSeg._id })
      .select("hotelId hotelName status requestedRooms createdAt toCompanyName")
      .sort({ createdAt: -1 })
      .lean();

    const hotelDiff = diffHotelsForConfirm({
      currentSegments: tourSeg.segments,
      linkRequests: allLinkRequests,
    });

    const {
      unchangedHotelIds,
      changedHotelIds,
      addedHotelIds,
      removedHotelIds,
      affectedHotelIds,
      needsNewRequestHotelIds,
    } = hotelDiff;

    const needsNewSet = new Set(needsNewRequestHotelIds.map(String));
    const closeRequestHotelIds = [
      ...new Set([...changedHotelIds, ...removedHotelIds].map(String)),
    ];

    // Chỉ hủy hold tại các KS bị thay đổi / gỡ / thêm lại (không đụng KS không đổi)
    if (affectedHotelIds.length > 0) {
      await HotelBooking.updateMany(
        {
          tourSegmentId: tourSeg._id,
          "hotel.hotelId": { $in: affectedHotelIds },
          status: { $ne: "cancelled" },
        },
        { status: "cancelled" }
      );
    }

    const latestByHotel = pickLatestRequestPerHotelMap(allLinkRequests);
    const removedSet = new Set(removedHotelIds.map(String));

    for (const hotelId of closeRequestHotelIds) {
      const latest = latestByHotel.get(String(hotelId));
      if (!latest) continue;
      if (!["pending", "approved", "partially_approved"].includes(latest.status)) {
        continue;
      }

      const toName = latest.toCompanyName || "công ty chủ khách sạn";
      const hotelLabel = latest.hotelName || "khách sạn";
      let body;

      if (removedSet.has(String(hotelId))) {
        body =
          `Company admin công ty «${fromDisp}» đã gỡ ${hotelLabel} khỏi cấu hình tour khi xác nhận lại. ` +
          `Yêu cầu liên kết tới ${hotelLabel} (thuộc công ty «${toName}») được hệ thống đóng và giải phóng phòng đã giữ (nếu có). ` +
          `Đây không phải do công ty «${toName}» từ chối trên màn hình «Yêu cầu nhận được».`;
      } else {
        body =
          `Company admin công ty «${fromDisp}» đã xác nhận lại cấu hình tour, nên yêu cầu cũ tới ${hotelLabel} (thuộc công ty «${toName}») được hệ thống đóng để tạo yêu cầu mới theo cấu hình mới. ` +
          `Đây không phải do công ty «${toName}» từ chối trên màn hình «Yêu cầu nhận được».`;
      }

      await HotelLinkRequest.updateOne(
        { _id: latest._id },
        {
          $set: {
            status: "rejected",
            responseNote: HOTEL_LINK_REQ_AUTO_BY_SENDING_COMPANY_TAG + body,
          },
        }
      );
    }

    const newLinkRequestIds = [];
    const crossCompanyRequests = {};

    for (let segIdx = 0; segIdx < tourSeg.segments.length; segIdx++) {
      const seg = tourSeg.segments[segIdx];
      const checkIn = new Date(seg.fromDate);
      const checkOut = new Date(seg.toDate);
      const frameIndex = segIdx + 1;

      for (const hotelEntry of seg.hotels) {
        const hotelKey = String(hotelEntry.hotelId);
        if (!needsNewSet.has(hotelKey)) continue;

        const hotelDoc = await Hotel.findById(hotelEntry.hotelId)
          .select("name rooms roomTypes companyId")
          .lean();
        if (!hotelDoc) continue;

        const isSameCompany = String(hotelDoc.companyId) === String(companyId);

        if (!crossCompanyRequests[hotelKey]) {
          crossCompanyRequests[hotelKey] = {
            hotelDoc,
            requestedRooms: [],
            isSameCompany,
          };
        }
        for (const ra of hotelEntry.roomAllocations) {
          if (!ra.assignedRooms || ra.assignedRooms <= 0) continue;
          crossCompanyRequests[hotelKey].requestedRooms.push({
            roomTypeId: ra.roomTypeId,
            roomTypeName: ra.roomTypeName || "",
            baseOccupancy: ra.baseOccupancy || 2,
            assignedRooms: ra.assignedRooms,
            fromDate: checkIn,
            toDate: checkOut,
            stayFrameIndex: frameIndex,
          });
        }
      }
    }

    for (const hotelKey of Object.keys(crossCompanyRequests)) {
      const { hotelDoc, requestedRooms, isSameCompany: sameComp } =
        crossCompanyRequests[hotelKey];
      if (requestedRooms.length === 0) continue;

      const toCompany = await Company.findById(hotelDoc.companyId).select("name").lean();
      const toCompanyName = toCompany ? toCompany.name : "";

      // Tạo yêu cầu liên kết mới
      const linkRequest = await HotelLinkRequest.create({
        fromCompanyId: companyId,
        fromCompanyName,
        toCompanyId: hotelDoc.companyId,
        toCompanyName,
        tourSegmentId: tourSeg._id,
        tourId,
        tourName,
        departureDate: tourSeg.departureDate,
        endDate: tourSeg.endDate,
        hotelId: hotelDoc._id,
        hotelName: hotelDoc.name,
        requestedRooms,
        status: "pending",
      });

      newLinkRequestIds.push(linkRequest._id);

      auditLogHelper.log(req, {
        action: "hotel-link-request.create",
        resourceType: "HotelLinkRequest",
        resourceId: linkRequest._id,
        resourceLabel: `${hotelDoc.name} – ${tourName}`,
        after: {
          status: "pending",
          fromCompanyId: String(companyId),
          toCompanyId: String(hotelDoc.companyId),
          hotelId: String(hotelDoc._id),
          tourId: String(tourId),
        },
        summary: `Gửi yêu cầu liên kết khách sạn "${hotelDoc.name}" cho tour "${tourName}"`,
        metadata: { requestedRooms: requestedRooms.length, sameCompany: !!sameComp },
      });

      await Notification.create({
        companyId: hotelDoc.companyId,
        type: "other",
        title: "Yêu cầu liên kết khách sạn mới",
        content: `${fromCompanyName} yêu cầu giữ phòng tại ${hotelDoc.name} cho tour "${tourName}" (${depDateFmt} – ${endDateFmt})`,
        link: `/${pathAdmin}/hotel/link-requests`,
      });
    }

    const activeHolds = await HotelBooking.find({
      tourSegmentId: tourSeg._id,
      status: { $nin: ["cancelled", "checked_out"] },
    })
      .select("_id")
      .lean();

    const existingLinkIds = (tourSeg.linkRequestIds || []).map((id) => String(id));
    for (const id of newLinkRequestIds) {
      const sid = String(id);
      if (!existingLinkIds.includes(sid)) {
        existingLinkIds.push(sid);
      }
    }

    // Cập nhật holdBookingIds và linkRequestIds
    tourSeg.holdBookingIds = activeHolds.map((b) => b._id);
    tourSeg.linkRequestIds = existingLinkIds;
    await tourSeg.save();

    await _recomputeTourSegmentStatus(tourSeg._id);

    const nameIds = [
      ...unchangedHotelIds,
      ...changedHotelIds,
      ...addedHotelIds,
      ...removedHotelIds,
    ];
    const nameRows =
      nameIds.length > 0
        ? await Hotel.find({ _id: { $in: nameIds } }).select("name").lean()
        : [];
    const nameById = Object.fromEntries(
      nameRows.map((h) => [String(h._id), h.name || ""])
    );
    const pickNames = (ids) =>
      ids.map((id) => nameById[String(id)] || "Khách sạn").filter(Boolean);

    const summary = {
      unchanged: pickNames(unchangedHotelIds),
      updated: pickNames([...changedHotelIds, ...addedHotelIds]),
      removed: pickNames(removedHotelIds),
    };

    let message = "";
    if (unchangedHotelIds.length > 0) {
      message += `${unchangedHotelIds.length} khách sạn giữ nguyên yêu cầu hiện tại.`;
    }
    if (newLinkRequestIds.length > 0) {
      message += `${message ? " " : ""}Đã gửi ${newLinkRequestIds.length} yêu cầu liên kết mới. Vui lòng vào mục "Yêu cầu nhận được" để duyệt hoặc từ chối.`;
    }
    if (removedHotelIds.length > 0) {
      message += `${message ? " " : ""}Đã gỡ ${removedHotelIds.length} khách sạn khỏi cấu hình và đóng yêu cầu tương ứng.`;
    }
    if (!message) {
      message = "Đã xác nhận cấu hình.";
    }

    const refreshed = await TourSegment.findById(tourSeg._id).select("status").lean();
    const hasPendingApproval = refreshed?.status === "pending_approval";

    return res.json({
      success: true,
      message,
      hasPendingApproval,
      summary,
    });
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

    const fromCo = await Company.findById(companyId).select("name").lean();
    const fromCompanyName = fromCo?.name || "công ty tổ chức tour";

    // Vô hiệu hoá TOÀN BỘ link request còn hiệu lực (pending / approved /
    // partially_approved). Nếu chỉ huỷ pending, các request đã approved sẽ bị
    // diffHotelsForConfirm coi là "unchanged" khi admin cấu hình lại → bỏ qua
    // bước duyệt → trạng thái lại quay về "Đã xác nhận". Cancel toàn bộ để
    // mọi cấu hình mới đều phải gửi yêu cầu duyệt lại.
    const activeLinks = await HotelLinkRequest.find({
      tourSegmentId: tourSeg._id,
      status: { $in: ["pending", "approved", "partially_approved"] },
    }).lean();
    for (const lr of activeLinks) {
      const toName = lr.toCompanyName || "công ty chủ khách sạn";
      const hotel = lr.hotelName || "khách sạn";
      const body =
        `Company admin công ty «${fromCompanyName}» đã huỷ cấu hình tour (nút «Huỷ & Giải phóng phòng» / huỷ segment) cho lịch khởi hành này. ` +
        `Yêu cầu liên kết tới ${hotel} (thuộc công ty «${toName}») được hệ thống đóng tự động — không phải do công ty «${toName}» từ chối trên màn hình «Yêu cầu nhận được».`;
      await HotelLinkRequest.updateOne(
        { _id: lr._id },
        { $set: { status: "cancelled", responseNote: HOTEL_LINK_REQ_AUTO_BY_SENDING_COMPANY_TAG + body } }
      );
    }

    tourSeg.status         = "cancelled";
    tourSeg.holdBookingIds = [];
    tourSeg.linkRequestIds = [];
    await tourSeg.save();

    // Tour đang Hoạt động → chuyển sang Tạm dừng ngay khi admin huỷ cấu hình lịch
    await Tour.updateOne(
      { _id: tourId, status: "active" },
      { $set: { status: "inactive" } }
    );

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

    if (tourSeg.status !== "confirmed" && tourSeg.status !== "pending_approval") {
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
        accommodationMode:
          matchedItem.accommodationMode === "shared" ? "shared" : "private",
        roomSelections:       Array.isArray(matchedItem.roomSelections) ? matchedItem.roomSelections : [],
        sharedRoomRequest:    Array.isArray(matchedItem.sharedRoomRequest) ? matchedItem.sharedRoomRequest : [],
        passengers:           Array.isArray(matchedItem.passengers) ? matchedItem.passengers : [],
        extraRoomCost:        Number(matchedItem.extraRoomCost || 0),
      });
    }

    // Sức chứa chuẩn / phòng theo từng booking giữ chỗ (để hiển thị & lưu numPeople đúng, không dùng tổng đơn)
    const holdOccByBookingId = {};
    for (const hb of enrichedHolds) {
      const occ = Number(hb.baseOccupancy);
      holdOccByBookingId[String(hb._id)] =
        !Number.isNaN(occ) && occ > 0 ? Math.round(occ) : 2;
    }

    // Map existing assignments
    const existingAssignments = (tourSeg.assignments || []).map((a) => {
      const bid = a.holdBookingId ? String(a.holdBookingId) : "";
      const fromHold = bid ? holdOccByBookingId[bid] : undefined;
      const numPeople =
        fromHold != null ? fromHold : Math.max(1, Math.round(Number(a.numPeople) || 1));
      return {
        ...a,
        orderId:       String(a.orderId),
        hotelId:       String(a.hotelId),
        roomId:        String(a.roomId),
        holdBookingId: a.holdBookingId ? String(a.holdBookingId) : null,
        numPeople,
      };
    });

    const { orderId } = req.query;

    if (orderId) {
      // Detail mode: show single customer + room grid for assignment
      const targetCust = customers.find((c) => c.orderId === orderId);
      if (!targetCust) return res.redirect(`/${pathAdmin}/tour-hotel/assign/${segmentId}`);

      res.render("admin/pages/tour-hotel-assign-detail", {
        pageTitle:   "Phân công phòng – " + (targetCust.guestName || targetCust.orderCode),
        tourSeg,
        tour,
        customer: targetCust,
        customers,
        holdsByHotel: Object.values(holdsByHotel),
        existingAssignments,
        departureDateDisplay,
        pathAdmin,
        moment,
        readOnly: true,
      });
    } else {
      // List mode: show all customers with assignment status
      const custWithStatus = customers.map((cust) => {
        const myAssigns = existingAssignments.filter((a) => a.orderId === cust.orderId);
        let assignStatus = "none";
        if (cust.roomSelections && cust.roomSelections.length > 0) {
          const needed = {};
          cust.roomSelections.forEach((rs) => {
            const k = (rs.hotelId||'') + '|' + (rs.roomTypeId||'') + '|' + (rs.fromDate||'') + '|' + (rs.toDate||'');
            if (!needed[k]) needed[k] = 0;
            needed[k] += rs.selectedRooms;
          });
          let allOk = myAssigns.length > 0;
          let hasShortfall = false;
          let hasExcess = false;

          const holdsByHotelArr = Object.values(holdsByHotel);
          const assigned = {};
          const toDateStr = (d) => d ? moment(d).format('YYYY-MM-DD') : '';
          myAssigns.forEach((a) => {
            let holdRoom = null;
            holdsByHotelArr.forEach((hg) => {
              (hg.rooms || []).forEach((r) => {
                if (String(r._id) === a.holdBookingId) holdRoom = r;
              });
            });
            if (!holdRoom) return;
            const hId = String(holdRoom.hotel?.hotelId || '');
            const rtId = holdRoom.roomTypeId ? String(holdRoom.roomTypeId) : '';
            const ci = toDateStr(holdRoom.checkIn);
            const co = toDateStr(holdRoom.checkOut);
            Object.keys(needed).forEach((k) => {
              const parts = k.split('|');
              const nFrom = toDateStr(parts[2]);
              const nTo = toDateStr(parts[3]);
              if (hId === parts[0] && rtId === parts[1] && ci === nFrom && co === nTo) {
                assigned[k] = (assigned[k] || 0) + 1;
              }
            });
          });

          Object.keys(needed).forEach((k) => {
            const got = assigned[k] || 0;
            if (got < needed[k]) { hasShortfall = true; allOk = false; }
            else if (got > needed[k]) { hasExcess = true; allOk = false; }
          });

          if (allOk) assignStatus = "complete";
          else if (hasExcess) assignStatus = "excess";
          else if (myAssigns.length > 0) assignStatus = "partial";
          else assignStatus = "none";
        } else {
          if (myAssigns.length > 0) assignStatus = "complete";
        }
        return { ...cust, assignedCount: myAssigns.length, assignStatus };
      });

      res.render("admin/pages/tour-hotel-assign", {
        pageTitle:   "Phân công phòng – " + (tour?.name || ""),
        tourSeg,
        tour,
        customers: custWithStatus,
        departureDateDisplay,
        pathAdmin,
        moment,
        readOnly: true,
      });
    }
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

      const occFromType =
        rtEntry && rtEntry.baseOccupancy != null && !Number.isNaN(Number(rtEntry.baseOccupancy))
          ? Math.round(Number(rtEntry.baseOccupancy))
          : null;
      const numPeople =
        occFromType != null && occFromType > 0
          ? occFromType
          : Math.max(1, Math.round(Number(a.numPeople) || 1));

      return {
        orderId:       a.orderId,
        orderCode:     a.orderCode || "",
        guestName:     a.guestName || "",
        phone:         a.phone || "",
        numPeople,
        hotelId:       holdBooking ? holdBooking.hotel.hotelId : a.hotelId,
        hotelName:     hotel?.name || a.hotelName || "",
        roomId:        physicalRoomId,
        roomNumber:    room?.roomNumber || a.roomNumber || "",
        roomTypeName:  rtEntry?.name || a.roomTypeName || "",
        holdBookingId: holdBooking ? holdBooking._id : null,
      };
    });

    // ── Đồng bộ guest info + orderCode vào HotelBooking ─────────────────────
    const assignOrderIds = [
      ...new Set(cleanAssignments.map((x) => x.orderId).filter(Boolean)),
    ];
    const assignOrders =
      assignOrderIds.length > 0
        ? await Order.find({ _id: { $in: assignOrderIds } })
            .select("_id email userId")
            .lean()
        : [];
    const assignOrderById = Object.fromEntries(
      assignOrders.map((o) => [String(o._id), o])
    );
    const assignUserIds = [
      ...new Set(
        assignOrders
          .filter((o) => !String(o.email || "").trim() && o.userId)
          .map((o) => String(o.userId))
      ),
    ];
    let assignUserEmailById = {};
    if (assignUserIds.length) {
      const urows = await AccountUser.find({ _id: { $in: assignUserIds } })
        .select("email")
        .lean();
      assignUserEmailById = Object.fromEntries(
        urows.map((u) => [String(u._id), String(u.email || "").trim()])
      );
    }

    // Full order items để recompute NL/TE/EB thật cho từng phòng (private:
    // khớp roomAssignments theo numPeople; shared: theo atomAnchorIdxs nếu có).
    const _depDisplay = moment(tourSeg.departureDate).format("DD/MM/YYYY");
    const _findItem = (order) =>
      (order?.items || []).find((it) => {
        if (String(it.tourId) !== String(tourSeg.tourId)) return false;
        if (it.departureDateDisplay) return it.departureDateDisplay === _depDisplay;
        if (it.departureDate)
          return moment(it.departureDate).format("DD/MM/YYYY") === _depDisplay;
        return false;
      });
    const fullOrders =
      assignOrderIds.length > 0
        ? await Order.find({ _id: { $in: assignOrderIds } }).select("items").lean()
        : [];
    const fullOrderById = Object.fromEntries(
      fullOrders.map((o) => [String(o._id), o])
    );
    const privateRoomQueueByOrder = {};
    const _getPrivateRoomQueue = (orderId) => {
      const k = String(orderId);
      if (privateRoomQueueByOrder[k]) return privateRoomQueueByOrder[k];
      const order = fullOrderById[k];
      const queue = [];
      if (order) {
        const item = _findItem(order);
        const paxByIdx = new Map();
        for (const p of item?.passengers || []) {
          if (typeof p.idx === "number") paxByIdx.set(p.idx, p);
        }
        for (const sel of item?.roomSelections || []) {
          for (const ra of sel.roomAssignments || []) {
            const subset = (ra.passengerIdxs || [])
              .map((idx) => paxByIdx.get(idx))
              .filter(Boolean);
            if (subset.length) queue.push(subset);
          }
        }
      }
      privateRoomQueueByOrder[k] = queue;
      return queue;
    };
    const _popPrivateRoom = (orderId, numPeople) => {
      const queue = _getPrivateRoomQueue(orderId);
      if (!queue.length) return [];
      let idx = queue.findIndex((s) => s.length === Number(numPeople));
      if (idx < 0) idx = 0;
      return queue.splice(idx, 1)[0] || [];
    };

    // Dựng nhãn chi tiết NL/TE/EB cho note từ passengers thực tế của phòng:
    //   "Tên NL (+ TE Tên, EB Tên, NL khác (tuổi))".
    const _fmtRoomDetailLabel = (passengers) => {
      const list = (passengers || []).map((p) => ({
        name: String(p.name || "?").trim() || "?",
        type: p.type === "child" || p.type === "baby" ? p.type : "adult",
        age: Math.max(0, Math.floor(Number(p.age) || 0)),
      }));
      if (!list.length) return "";
      const anchor = list.find((p) => p.type === "adult") || list[0];
      const deps = list
        .filter((p) => p !== anchor)
        .map((m) =>
          m.type === "child"
            ? `TE ${m.name}`
            : m.type === "baby"
            ? `EB ${m.name}`
            : `${m.name} (${m.age}t)`
        );
      return deps.length ? `${anchor.name} (+ ${deps.join(", ")})` : anchor.name;
    };

    const newAssignedBookingIds = new Set();
    for (const a of cleanAssignments) {
      const hb = holdMap[String(a.holdBookingId)] || null;
      if (!hb) continue;
      newAssignedBookingIds.add(String(hb._id));
      const oa = assignOrderById[String(a.orderId)] || null;
      let guestEmail = (oa?.email && String(oa.email).trim()) || "";
      if (!guestEmail && oa?.userId) {
        guestEmail = assignUserEmailById[String(oa.userId)] || "";
      }

      // NL/TE/EB thật của phòng (best-effort theo roomAssignments của đơn).
      let roomPassengers = _popPrivateRoom(a.orderId, a.numPeople);
      if (!roomPassengers.length && Array.isArray(a.atomAnchorIdxs) && a.atomAnchorIdxs.length) {
        const order = fullOrderById[String(a.orderId)];
        roomPassengers = passengersForAtoms(
          _findItem(order)?.passengers,
          a.atomAnchorIdxs
        );
      }
      const pax = countPax(roomPassengers);
      const paxSet =
        pax.adults + pax.children + pax.babies > 0
          ? paxToHotelBookingSet(pax)
          : null;

      // Giữ chi tiết NL/TE/EB trong note (ưu tiên passengers thực tế, fallback
      // atomLabels client gửi) — không để mất khi admin đổi phòng.
      let detailStr = _fmtRoomDetailLabel(roomPassengers);
      if (!detailStr && Array.isArray(a.atomLabels) && a.atomLabels.length) {
        detailStr = a.atomLabels.filter(Boolean).join(" || ");
      }

      await HotelBooking.findByIdAndUpdate(hb._id, {
        orderCode: a.orderCode || "",
        "guest.fullName": a.guestName || "Khách tour",
        "guest.phone": a.phone || "",
        "guest.email": guestEmail,
        note: `[TOUR] Đơn #${a.orderCode} – ${a.guestName || ""} – ${a.numPeople} người/phòng (loại phòng)${
          detailStr ? ` | ${detailStr}` : ""
        }`,
        ...(paxSet || {}),
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

    // Reset toàn diện: ngoài fullName/phone/note/status còn phải clear email,
    // orderCode, holdExpiresAt, userId — nếu không, Tour Hold sẽ vẫn còn
    // `orderCode` cũ → đơn ở ghép mới không bind được (query có điều kiện
    // orderCode rỗng).
    const idsToReset = Object.keys(holdMap).filter(
      (hbId) => !newAssignedBookingIds.has(hbId)
    );
    if (idsToReset.length > 0) {
      await HotelBooking.updateMany(
        { _id: { $in: idsToReset } },
        {
          $set: {
            "guest.fullName": "[Tour Hold]",
            "guest.phone":    "",
            "guest.email":    "",
            note:             resetNote,
            status:           "confirmed",
            isTemporaryHold:  false,
            // Phòng trống trở lại → xoá NL/TE/EB của khách cũ.
            children:         0,
            babies:           0,
          },
          $unset: {
            orderCode:     "",
            holdExpiresAt: "",
            userId:        "",
            childrenDetails: "",
            babiesDetails:   "",
          },
        }
      );
      // Đưa adults về sức chứa cơ bản của loại phòng (nếu tra được).
      for (const hbId of idsToReset) {
        const hb = holdMap[hbId];
        if (!hb) continue;
        const hot = hotelMap[String(hb.hotel?.hotelId)] || null;
        const rt = hot
          ? (hot.roomTypes || []).find(
              (x) => String(x._id) === String(hb.roomTypeId)
            )
          : null;
        const base =
          rt && Number.isFinite(Number(rt.baseOccupancy))
            ? Math.max(1, Math.round(Number(rt.baseOccupancy)))
            : 1;
        await HotelBooking.updateOne({ _id: hbId }, { $set: { adults: base } });
      }
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

// ── API: Yêu cầu bổ sung phòng cho tour segment ──────────────────────────────
// POST /admin/tour-hotel/api/request-additional-rooms
// Body: { tourSegmentId, items: [{ hotelId, fromDate, toDate, roomTypeId, additionalRooms, note? }] }

// Tour đã xác nhận nhưng quota phòng KS không đủ so với số ghế còn lại
// Yêu cầu bổ sung phòng cho tour segment
module.exports.requestAdditionalRooms = async (req, res) => {
  try {
    const companyId = req.account.companyId;
    const fromCompanyName = req.account.companyName || "";
    const { tourSegmentId, items } = req.body;

    if (!tourSegmentId || !Array.isArray(items) || items.length === 0) {
      return res.json({ success: false, message: "Thiếu dữ liệu bắt buộc." });
    }

    const tourSeg = await TourSegment.findOne({ _id: tourSegmentId, companyId }).lean();
    if (!tourSeg) {
      return res.json({ success: false, message: "Không tìm thấy tour segment." });
    }
    if (!["confirmed", "pending_approval"].includes(tourSeg.status)) {
      return res.json({ success: false, message: "Segment chưa được xác nhận." });
    }

    const tourDoc = await Tour.findById(tourSeg.tourId).select("name").lean();
    const tourName = tourDoc?.name || "";
    const depDateFmt = moment(tourSeg.departureDate).format("DD/MM/YYYY");
    const endDateFmt = moment(tourSeg.endDate).format("DD/MM/YYYY");

    // Validate items
    for (const item of items) {
      if (!item.hotelId || !item.roomTypeId || !item.fromDate || !item.toDate) {
        return res.json({ success: false, message: "Mỗi mục phải có hotelId, roomTypeId, fromDate, toDate." });
      }
      const rooms = Number(item.additionalRooms);
      if (!Number.isInteger(rooms) || rooms < 1) {
        return res.json({ success: false, message: "additionalRooms phải là số nguyên >= 1." });
      }
      // Kiểm tra hotel + roomType có thuộc segment này không
      let found = false;
      const fromStr = String(item.fromDate).slice(0, 10);
      const toStr = String(item.toDate).slice(0, 10);
      for (const seg of tourSeg.segments || []) {
        const segFrom = moment(seg.fromDate).format("YYYY-MM-DD");
        const segTo = moment(seg.toDate).format("YYYY-MM-DD");
        if (segFrom !== fromStr || segTo !== toStr) continue;
        for (const h of seg.hotels || []) {
          if (String(h.hotelId) !== String(item.hotelId)) continue;
          for (const ra of h.roomAllocations || []) {
            if (String(ra.roomTypeId) === String(item.roomTypeId)) {
              found = true;
            }
          }
        }
      }
      if (!found) {
        return res.json({
          success: false,
          message: `Loại phòng hoặc khách sạn không thuộc cấu hình segment này.`,
        });
      }
    }

    // Nhóm items theo hotelId
    const byHotel = {};
    for (const item of items) {
      const hotelKey = String(item.hotelId);
      if (!byHotel[hotelKey]) byHotel[hotelKey] = [];
      byHotel[hotelKey].push(item);
    }

    const { _recomputeTourSegmentStatus } = require("./hotel-link-request.controller");
    const { maybeNotifyTourQuotaPressure, evaluateTourHotelQuotaPressure } = require("../../helpers/tour-hotel-quota-pressure.helper");

    const createdRequestIds = [];

    for (const hotelKey of Object.keys(byHotel)) {
      const hotelItems = byHotel[hotelKey];
      const hotelId = hotelItems[0].hotelId;

      // Kiểm tra có pending request nào cho cùng hotel + segment chưa
      const existingPending = await HotelLinkRequest.findOne({
        tourSegmentId,
        hotelId,
        status: "pending",
      }).lean();
      if (existingPending) {
        return res.json({
          success: false,
          message: `Đang có yêu cầu chờ duyệt cho khách sạn này. Vui lòng đợi hoặc hủy yêu cầu cũ trước.`,
        });
      }

      const hotelDoc = await Hotel.findById(hotelId).select("name companyId").lean();
      if (!hotelDoc) continue;

      const toCompany = await Company.findById(hotelDoc.companyId).select("name").lean();
      const toCompanyName = toCompany?.name || "";

      // Tăng assignedRooms trực tiếp trên TourSegment (delta)
      for (const item of hotelItems) {
        const delta = Number(item.additionalRooms);
        const fromStr = String(item.fromDate).slice(0, 10);
        const toStr = String(item.toDate).slice(0, 10);
        // Dùng positional operator để update đúng room allocation

        // Cộng thêm phòng vào TourSegment
        await TourSegment.updateOne(
          {
            _id: tourSegmentId,
            "segments.fromDate": new Date(fromStr),
            "segments.toDate": new Date(toStr),
          },
          {
            $inc: {
              "segments.$[seg].hotels.$[hot].roomAllocations.$[ra].assignedRooms": delta,
              "segments.$[seg].hotels.$[hot].roomAllocations.$[ra].totalPeople": delta * (item.baseOccupancy || 2),
            },
          },
          {
            arrayFilters: [
              { "seg.fromDate": new Date(fromStr), "seg.toDate": new Date(toStr) },
              { "hot.hotelId": new mongoose.Types.ObjectId(String(hotelId)) },
              { "ra.roomTypeId": new mongoose.Types.ObjectId(String(item.roomTypeId)) },
            ],
          }
        );
      }

      // Tạo HotelLinkRequest delta
      const requestedRooms = hotelItems.map((item) => {
        const fromStr = String(item.fromDate).slice(0, 10);
        const toStr = String(item.toDate).slice(0, 10);
        const segIdx = (tourSeg.segments || []).findIndex(
          (s) =>
            moment(s.fromDate).format("YYYY-MM-DD") === fromStr &&
            moment(s.toDate).format("YYYY-MM-DD") === toStr
        );
        return {
          roomTypeId: item.roomTypeId,
          roomTypeName: item.roomTypeName || "",
          baseOccupancy: item.baseOccupancy || 2,
          assignedRooms: Number(item.additionalRooms),
          fromDate: new Date(fromStr),
          toDate: new Date(toStr),
          stayFrameIndex: segIdx >= 0 ? segIdx + 1 : null,
        };
      });

      // Tạo HotelLinkRequest
      const linkRequest = await HotelLinkRequest.create({
        fromCompanyId: companyId,
        fromCompanyName,
        toCompanyId: hotelDoc.companyId,
        toCompanyName,
        tourSegmentId,
        tourId: tourSeg.tourId,
        tourName,
        departureDate: tourSeg.departureDate,
        endDate: tourSeg.endDate,
        hotelId: hotelDoc._id,
        hotelName: hotelDoc.name,
        requestedRooms,
        note: hotelItems[0].note || "",
        status: "pending",
      });

      createdRequestIds.push(linkRequest._id);

      // Cập nhật linkRequestIds trên segment
      await TourSegment.updateOne(
        { _id: tourSegmentId },
        { $addToSet: { linkRequestIds: linkRequest._id } }
      );

      auditLogHelper.log(req, {
        action: "tour-hotel.request-additional-rooms",
        resourceType: "HotelLinkRequest",
        resourceId: linkRequest._id,
        resourceLabel: `${hotelDoc.name} – ${tourName}`,
        after: { status: "pending", additionalRooms: requestedRooms.length },
        summary: `Yêu cầu bổ sung phòng tại "${hotelDoc.name}" cho tour "${tourName}" (${depDateFmt} – ${endDateFmt})`,
      });

      // Thông báo cho admin KS
      await Notification.create({
        companyId: hotelDoc.companyId,
        type: "other",
        title: "Yêu cầu bổ sung phòng",
        content: `${fromCompanyName} yêu cầu bổ sung phòng tại ${hotelDoc.name} cho tour "${tourName}" (${depDateFmt} – ${endDateFmt})`,
        link: `/${pathAdmin}/hotel/link-requests`,
      });
    }

    await _recomputeTourSegmentStatus(tourSegmentId);

    // Cập nhật lại áp lực quota cho admin tour
    try {
      const pressure = await evaluateTourHotelQuotaPressure({ tourSegmentId: String(tourSegmentId) });
      await maybeNotifyTourQuotaPressure(pressure);
    } catch (_) {}

    return res.json({
      success: true,
      message: "Đã gửi yêu cầu bổ sung phòng thành công.",
      linkRequestIds: createdRequestIds.map(String),
      linkRequestsUrl: `/${pathAdmin}/tour-hotel/link-requests`,
    });
  } catch (err) {
    console.error("[tour-hotel.requestAdditionalRooms]", err);
    return res.json({ success: false, message: "Lỗi server." });
  }
};
