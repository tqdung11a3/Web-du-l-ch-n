// controllers/admin/tour-hotel.controller.js
//
// Quản lý "Liên kết Tour – Khách sạn": company admin chia tour thành các
// khung thời gian và phân bổ phòng khách sạn cho từng khung.

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
const auditLogHelper = require("../../helpers/audit-log.helper");

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
      if (segRequests.length > 0) {
        const hasPending = segRequests.some((r) => r.status === "pending");
        const rejectedReq = segRequests.find((r) => r.status === "rejected");
        const hasCancelled = segRequests.some((r) => r.status === "cancelled");
        if (hasPending) {
          effectiveStatus = "pending_approval";
        } else if (rejectedReq) {
          effectiveStatus = "rejected";
          rejectedByCompanyName = rejectedReq.toCompanyName || "";
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

    const hotels = await Hotel.find({ deleted: false, status: "active" })
      .select("name address companyId")
      .lean();

    const hotelCompanyIds = [...new Set(hotels.map((h) => String(h.companyId)).filter(Boolean))];
    const hotelCompanies = await Company.find({ _id: { $in: hotelCompanyIds } })
      .select("name")
      .lean();
    const companyNameById = {};
    for (const c of hotelCompanies) companyNameById[String(c._id)] = c.name || "";
    for (const h of hotels) {
      h.companyName = companyNameById[String(h.companyId)] || "";
    }

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

        // Heal DB status cho chính segment này theo luật latest-per-hotel —
        // tránh trường hợp DB còn mắc kẹt ở "rejected" cũ dù link request mới
        // đã được duyệt (dữ liệu trước khi helper được nâng cấp).
        if (existingSegment) {
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
        if (existingSegment) {
          const allRequests = await HotelLinkRequest.find({
            tourSegmentId: existingSegment._id,
          })
            .select("status toCompanyName hotelId hotelName responseNote createdAt")
            .sort({ createdAt: -1 })
            .lean();

          const seenHotels = new Set();
          const segRequests = [];
          for (const r of allRequests) {
            const key = String(r.hotelId);
            if (seenHotels.has(key)) continue;
            seenHotels.add(key);
            segRequests.push(r);
          }

          if (segRequests.length > 0) {
            const hasPending = segRequests.some((r) => r.status === "pending");
            const rejectedReq = segRequests.find((r) => r.status === "rejected");
            const hasCancelled = segRequests.some(
              (r) => r.status === "cancelled"
            );
            if (hasPending) {
              existingSegment.status = "pending_approval";
            } else if (rejectedReq) {
              existingSegment.status = "rejected";
              existingSegment.rejectedByCompanyName =
                rejectedReq.toCompanyName || "";
              existingSegment.rejectedHotelName = rejectedReq.hotelName || "";
              existingSegment.rejectedResponseNote =
                rejectedReq.responseNote || "";
            } else if (hasCancelled) {
              existingSegment.status = "draft";
            } else {
              existingSegment.status = "confirmed";
            }
          }
        }
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
      currentCompanyId: String(companyId),
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

    const hotel = await Hotel.findOne({ _id: hotelId, deleted: false })
      .select("name address roomTypes rooms companyId")
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

    const tourDoc = await TourModel.findById(tourId).select("name").lean();
    const tourName = tourDoc ? tourDoc.name : "Tour";
    const depDateFmt = moment(tourSeg.departureDate).format("DD/MM/YYYY");
    const endDateFmt = moment(tourSeg.endDate).format("DD/MM/YYYY");

    const fromCompany = await Company.findById(companyId).select("name").lean();
    const fromCompanyName = fromCompany ? fromCompany.name : "";

    // Huỷ TẤT CẢ booking hold cũ của segment này
    await HotelBooking.updateMany(
      { tourSegmentId: tourSeg._id, status: { $ne: "cancelled" } },
      { status: "cancelled" }
    );

    // Huỷ các link request cũ đang pending (ghi rõ: phía công ty gửi tour xác nhận lại, không phải đối tác từ chối)
    const pendingOldLink = await HotelLinkRequest.find({
      tourSegmentId: tourSeg._id,
      status: "pending",
    }).lean();
    const fromDisp = fromCompanyName || "công ty tổ chức tour";
    for (const lr of pendingOldLink) {
      const toName = lr.toCompanyName || "công ty chủ khách sạn";
      const hotel = lr.hotelName || "khách sạn";
      const body =
        `Company admin công ty «${fromDisp}» đã xác nhận lại cấu hình tour, nên yêu cầu cũ tới ${hotel} (thuộc công ty «${toName}») được hệ thống đóng để tạo yêu cầu mới theo cấu hình mới. ` +
        `Đây không phải do công ty «${toName}» từ chối trên màn hình «Yêu cầu nhận được».`;
      await HotelLinkRequest.updateOne(
        { _id: lr._id },
        { $set: { status: "rejected", responseNote: HOTEL_LINK_REQ_AUTO_BY_SENDING_COMPANY_TAG + body } }
      );
    }

    const newHoldIds = [];
    const newLinkRequestIds = [];
    let totalRoomsBlocked = 0;
    const warnings = [];
    let hasCrossCompanyHotel = false;

    // Collect cross-company requests grouped by hotel
    const crossCompanyRequests = {};

    for (const seg of tourSeg.segments) {
      const checkIn  = new Date(seg.fromDate);
      const checkOut = new Date(seg.toDate);

      for (const hotelEntry of seg.hotels) {
        const hotelDoc = await Hotel.findById(hotelEntry.hotelId)
          .select("name rooms roomTypes companyId")
          .lean();
        if (!hotelDoc) continue;

        const isSameCompany = String(hotelDoc.companyId) === String(companyId);

        if (isSameCompany) {
          // ── Hotel cùng company: tạo booking giữ phòng ngay ──
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
        } else {
          // ── Hotel khác company: thu thập để tạo HotelLinkRequest ──
          hasCrossCompanyHotel = true;
          const hotelKey = String(hotelDoc._id);
          if (!crossCompanyRequests[hotelKey]) {
            crossCompanyRequests[hotelKey] = {
              hotelDoc,
              requestedRooms: [],
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
            });
          }
        }
      }
    }

    // Tạo HotelLinkRequest cho mỗi hotel khác company
    for (const hotelKey of Object.keys(crossCompanyRequests)) {
      const { hotelDoc, requestedRooms } = crossCompanyRequests[hotelKey];
      if (requestedRooms.length === 0) continue;

      const toCompany = await Company.findById(hotelDoc.companyId).select("name").lean();
      const toCompanyName = toCompany ? toCompany.name : "";

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
        metadata: { requestedRooms: requestedRooms.length },
      });

      // Gửi notification cho company sở hữu khách sạn
      await Notification.create({
        companyId: hotelDoc.companyId,
        type: "other",
        title: "Yêu cầu liên kết khách sạn mới",
        content: `${fromCompanyName} yêu cầu giữ phòng tại ${hotelDoc.name} cho tour "${tourName}" (${depDateFmt} – ${endDateFmt})`,
        link: `/${pathAdmin}/hotel/link-requests`,
      });
    }

    // Xác định status của tourSegment
    if (hasCrossCompanyHotel) {
      tourSeg.status = "pending_approval";
    } else {
      tourSeg.status = "confirmed";
    }

    tourSeg.holdBookingIds = newHoldIds;
    tourSeg.linkRequestIds = newLinkRequestIds;
    await tourSeg.save();

    let message = "";
    if (totalRoomsBlocked > 0) {
      message += `Đã giữ thành công ${totalRoomsBlocked} phòng cho khách sạn cùng công ty.`;
    }
    if (newLinkRequestIds.length > 0) {
      message += ` Đã gửi ${newLinkRequestIds.length} yêu cầu duyệt tới công ty sở hữu khách sạn khác. Vui lòng chờ phê duyệt.`;
    }
    if (warnings.length > 0) {
      message += ` Cảnh báo: ${warnings.join("; ")}`;
    }
    if (!message) {
      message = "Không có phòng nào được giữ.";
    }

    return res.json({ success: true, message, hasPendingApproval: hasCrossCompanyHotel });
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

    const pendingLink = await HotelLinkRequest.find({
      tourSegmentId: tourSeg._id,
      status: "pending",
    }).lean();
    for (const lr of pendingLink) {
      const toName = lr.toCompanyName || "công ty chủ khách sạn";
      const hotel = lr.hotelName || "khách sạn";
      const body =
        `Company admin công ty «${fromCompanyName}» đã huỷ cấu hình tour (nút «Huỷ & Giải phóng phòng» / huỷ segment) cho lịch khởi hành này. ` +
        `Yêu cầu liên kết tới ${hotel} (thuộc công ty «${toName}») được hệ thống đóng tự động — không phải do công ty «${toName}» từ chối trên màn hình «Yêu cầu nhận được».`;
      await HotelLinkRequest.updateOne(
        { _id: lr._id },
        { $set: { status: "rejected", responseNote: HOTEL_LINK_REQ_AUTO_BY_SENDING_COMPANY_TAG + body } }
      );
    }

    tourSeg.status         = "cancelled";
    tourSeg.holdBookingIds = [];
    tourSeg.linkRequestIds = [];
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
      await HotelBooking.findByIdAndUpdate(hb._id, {
        orderCode: a.orderCode || "",
        "guest.fullName": a.guestName || "Khách tour",
        "guest.phone": a.phone || "",
        "guest.email": guestEmail,
        note: `[TOUR] Đơn #${a.orderCode} – ${a.guestName || ""} – ${a.numPeople} người/phòng (loại phòng)`,
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
