const mongoose = require("mongoose");
const HotelLinkRequest = require("../../models/hotel-link-request.model");
const HotelBooking = require("../../models/hotel-booking.model");
const Hotel = require("../../models/hotel.model");
const TourSegment = require("../../models/tour-segment.model");
const Notification = require("../../models/notification.model");
const { getAvailableRoomsForType } = require("../../helpers/hotel-availability.helper");
const { generateRandomNumber } = require("../../helpers/generate.helper");
const { pathAdmin } = require("../../config/variable.config");
/** Trang “Yêu cầu nhận được” — công ty sở hữu khách sạn. */
const linkHotelLinkRequestsList = `/${pathAdmin}/hotel/link-requests`;
/** Trang “Yêu cầu đã gửi” — công ty tour (xem phản hồi / lý do từ chối). */
const linkTourHotelLinkRequestsList = `/${pathAdmin}/tour-hotel/link-requests`;
const moment = require("moment");
const {
  HOTEL_LINK_REQ_AUTO_BY_SENDING_COMPANY_TAG,
} = require("../../helpers/hotel-link-request-note.helper");
const auditLogHelper = require("../../helpers/audit-log.helper");

/**
 * Suy luận lại trạng thái của một TourSegment dựa trên toàn bộ HotelLinkRequest
 * liên quan. Dùng chung cho approve / reject / cancel / force-cancel.
 *
 * Quy ước:
 * - Còn bất kỳ request `pending` → segment `pending_approval`.
 * - Hết pending, có request `rejected` (công ty sở hữu KS từ chối) → segment
 *   `rejected` (để admin gửi tour biết rõ đã bị từ chối, và bởi công ty nào).
 * - Hết pending, có request `cancelled` nhưng không có request `rejected`
 *   → `draft` (bên gửi/Super Admin tự huỷ, segment cần cấu hình lại).
 * - Ngược lại (tất cả `approved` / `partially_approved`, hoặc không có
 *   link request nào) → `confirmed`.
 */
async function recomputeTourSegmentStatus(tourSegmentId) {
  if (!tourSegmentId) return;
  const tourSeg = await TourSegment.findById(tourSegmentId);
  if (!tourSeg) return;

  // Nếu segment đã bị admin huỷ thủ công (nút "Huỷ & Giải phóng phòng"),
  // không tự suy lại trạng thái từ link request để tránh ghi đè "cancelled".
  if (tourSeg.status === "cancelled") return;

  // Chỉ xét request mới nhất cho mỗi khách sạn — các request cũ (bị reject /
  // cancel ở lượt trước) được coi là lịch sử, không còn phản ánh trạng thái
  // hiện tại của segment sau khi admin cấu hình lại và gửi yêu cầu mới.
  const effectiveRequests = await pickLatestRequestPerHotel(tourSegmentId);

  const autoTag = HOTEL_LINK_REQ_AUTO_BY_SENDING_COMPANY_TAG;
  const isAutoClosed = (r) =>
    r.status === "rejected" &&
    autoTag &&
    (r.responseNote || "").indexOf(autoTag) === 0;

  const hasPending = effectiveRequests.some((r) => r.status === "pending");
  // Chỉ tính rejected THẬT (do KS bấm Từ chối). Auto-closed bởi bên gửi
  // được xem như cancelled cho mục đích phân loại segment status.
  const hasRejected = effectiveRequests.some(
    (r) => r.status === "rejected" && !isAutoClosed(r)
  );
  const hasCancelled = effectiveRequests.some(
    (r) => r.status === "cancelled" || isAutoClosed(r)
  );

  let nextStatus;
  if (hasPending) {
    nextStatus = "pending_approval";
  } else if (hasRejected) {
    nextStatus = "rejected";
  } else if (hasCancelled) {
    nextStatus = "draft";
  } else {
    nextStatus = "confirmed";
  }

  if (tourSeg.status !== nextStatus) {
    tourSeg.status = nextStatus;
    await tourSeg.save();
  }
}

/**
 * Với mỗi hotel trong segment, lấy HotelLinkRequest mới nhất (theo createdAt)
 * để dùng xét trạng thái hiệu dụng. Giúp khi admin "cấu hình lại và gửi mới"
 * thì những request cũ đã reject/cancel không còn ảnh hưởng.
 */
async function pickLatestRequestPerHotel(tourSegmentId) {
  const all = await HotelLinkRequest.find({ tourSegmentId })
    .select("status hotelId hotelName toCompanyName responseNote createdAt")
    .sort({ createdAt: -1 })
    .lean();
  // responseNote đã có sẵn trong select → đủ dữ liệu để check auto-tag.

  const seen = new Set();
  const latest = [];
  for (const r of all) {
    const key = String(r.hotelId);
    if (seen.has(key)) continue;
    seen.add(key);
    latest.push(r);
  }
  return latest;
}

module.exports._pickLatestRequestPerHotel = pickLatestRequestPerHotel;

module.exports._recomputeTourSegmentStatus = recomputeTourSegmentStatus;

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Tìm theo chuỗi trên tên tour, KS, công ty, ghi chú */
function buildTextSearchCondition(q) {
  const trimmed = (q && String(q).trim()) || "";
  if (!trimmed) return null;
  const re = new RegExp(escapeRegex(trimmed), "i");
  return {
    $or: [
      { tourName: re },
      { hotelName: re },
      { fromCompanyName: re },
      { toCompanyName: re },
      { note: re },
      { responseNote: re },
    ],
  };
}

function applyDepartureDateRange(filter, departureFrom, departureTo) {
  const range = {};
  if (departureFrom) {
    const m = moment(departureFrom, ["YYYY-MM-DD", moment.ISO_8601], true);
    if (m.isValid()) range.$gte = m.startOf("day").toDate();
  }
  if (departureTo) {
    const m = moment(departureTo, ["YYYY-MM-DD", moment.ISO_8601], true);
    if (m.isValid()) range.$lte = m.endOf("day").toDate();
  }
  if (Object.keys(range).length) filter.departureDate = range;
}

/**
 * UI chỉ 4 giá trị: Tất cả | pending | approved (gồm partially_approved) | rejected
 * - received + rỗng: ẩn cancelled (giữ hành vi “mặc định” trang nhận).
 * - sent + rỗng: không lọc status (mọi trạng thái, kể cả cancelled).
 */
function applyLinkRequestStatusFour(filter, statusParam, pageKind) {
  const s = (statusParam || "").trim().toLowerCase();
  if (!s) {
    if (pageKind === "received") filter.status = { $ne: "cancelled" };
    return;
  }
  if (s === "pending") {
    filter.status = "pending";
    return;
  }
  if (s === "rejected") {
    filter.status = "rejected";
    return;
  }
  if (s === "approved") {
    filter.status = { $in: ["approved", "partially_approved"] };
    return;
  }
  if (pageKind === "received") filter.status = { $ne: "cancelled" };
}

function readListFilters(req) {
  return {
    q: (req.query.q && String(req.query.q).trim()) || "",
    status: (req.query.status && String(req.query.status).trim()) || "",
    departureFrom: (req.query.departureFrom && String(req.query.departureFrom).trim()) || "",
    departureTo: (req.query.departureTo && String(req.query.departureTo).trim()) || "",
    hotelId: (req.query.hotelId && String(req.query.hotelId).trim()) || "",
  };
}

/** Khách sạn thuộc công ty — dùng lọc trang «Yêu cầu nhận được» (hotel company). */
async function loadHotelsOwnedByCompanyForFilter(companyId) {
  if (!companyId) return [];
  return Hotel.find({ companyId, deleted: { $ne: true } })
    .select("name")
    .sort({ name: 1 })
    .lean();
}

/** Toàn bộ khách sạn (lọc form trang «đã gửi» — tour chọn KS đích trong hệ thống). */
async function loadAllHotelsForLinkRequestFilter() {
  return Hotel.find({ deleted: { $ne: true } })
    .select("name")
    .sort({ name: 1 })
    .lean();
}

/**
 * Gom các khung check-in / check-out của khách sạn từ requestedRooms
 * (mỗi khung = một cặp fromDate–toDate admin cấu hình ở tour-hotel/detail).
 */
function buildHotelStayFrames(requestedRooms) {
  const seen = new Map();
  for (const rr of requestedRooms || []) {
    if (!rr.fromDate || !rr.toDate) continue;
    const fromKey = moment(rr.fromDate).format("YYYY-MM-DD");
    const toKey = moment(rr.toDate).format("YYYY-MM-DD");
    const key = `${fromKey}|${toKey}`;
    if (seen.has(key)) continue;
    seen.set(key, {
      fromDate: rr.fromDate,
      toDate: rr.toDate,
      fromDateDisplay: moment(rr.fromDate).format("DD/MM/YYYY"),
      toDateDisplay: moment(rr.toDate).format("DD/MM/YYYY"),
    });
  }
  return Array.from(seen.values()).sort(
    (a, b) => new Date(a.fromDate).getTime() - new Date(b.fromDate).getTime()
  );
}

// ── Helper: enrich request list ─────────────────────────────────────────────
function enrichRequests(list) {
  for (const r of list) {
    r.departureDateDisplay = moment(r.departureDate).format("DD/MM/YYYY");
    r.endDateDisplay = r.endDate ? moment(r.endDate).format("DD/MM/YYYY") : "—";
    r.createdAtDisplay = moment(r.createdAt).format("DD/MM/YYYY HH:mm");
    r.reviewedAtDisplay = r.reviewedAt ? moment(r.reviewedAt).format("DD/MM/YYYY HH:mm") : null;
    r.reviewerName = r.reviewedBy?.fullName || null;
    r.totalRequestedRooms = r.requestedRooms.reduce((s, rr) => s + rr.assignedRooms, 0);
    r.totalApprovedRooms = (r.approvedRooms || []).reduce((s, ar) => s + ar.approvedRooms, 0);
    r.hotelStayFrames = buildHotelStayFrames(r.requestedRooms);
    for (const rr of r.requestedRooms) {
      rr.fromDateDisplay = moment(rr.fromDate).format("DD/MM/YYYY");
      rr.toDateDisplay = moment(rr.toDate).format("DD/MM/YYYY");
      // Ưu tiên stayFrameIndex đã lưu trong DB (chứa đúng thứ tự khung gốc).
      // Fallback tính lại cho các bản ghi cũ chưa có field này.
      if (rr.stayFrameIndex == null) {
        const frame = (r.hotelStayFrames || []).find(
          (f) =>
            moment(f.fromDate).format("YYYY-MM-DD") ===
              moment(rr.fromDate).format("YYYY-MM-DD") &&
            moment(f.toDate).format("YYYY-MM-DD") ===
              moment(rr.toDate).format("YYYY-MM-DD")
        );
        rr.stayFrameIndex = frame ? r.hotelStayFrames.indexOf(frame) + 1 : null;
      }
    }
  }
}

/** Số phòng trống theo từng dòng requestedRooms (cùng logic với duyệt yêu cầu). */
async function enrichReceivedRequestsWithAvailability(list) {
  if (!list || list.length === 0) return;

  const hotelIds = [...new Set(list.map((r) => String(r.hotelId)).filter(Boolean))];
  const hotels = await Hotel.find({ _id: { $in: hotelIds } })
    .select("rooms")
    .lean();
  const hotelById = new Map(hotels.map((h) => [String(h._id), h]));

  const bookingsCache = new Map();

  async function bookingsOverlapping(hotelId, checkIn, checkOut) {
    const key = `${String(hotelId)}|${checkIn.getTime()}|${checkOut.getTime()}`;
    if (bookingsCache.has(key)) return bookingsCache.get(key);
    const rows = await HotelBooking.find({
      "hotel.hotelId": hotelId,
      status: { $nin: ["cancelled", "checked_out"] },
      checkIn: { $lt: checkOut },
      checkOut: { $gt: checkIn },
    })
      .select("roomTypeId roomId rooms status checkIn checkOut")
      .lean();
    bookingsCache.set(key, rows);
    return rows;
  }

  for (const r of list) {
    const hotel = hotelById.get(String(r.hotelId));
    if (!hotel || !Array.isArray(r.requestedRooms)) continue;

    for (const rr of r.requestedRooms) {
      const checkIn = new Date(rr.fromDate);
      const checkOut = new Date(rr.toDate);
      if (Number.isNaN(checkIn.getTime()) || Number.isNaN(checkOut.getTime())) {
        rr.availableFreeRooms = null;
        continue;
      }
      try {
        const bookings = await bookingsOverlapping(r.hotelId, checkIn, checkOut);
        const availableIds = getAvailableRoomsForType(
          hotel.rooms || [],
          rr.roomTypeId,
          bookings,
          checkIn,
          checkOut
        );
        rr.availableFreeRooms = availableIds.length;
      } catch {
        rr.availableFreeRooms = null;
      }
    }
  }
}

// ── Yêu cầu nhận được (menu Khách sạn) ─────────────────────────────────────
module.exports.listReceived = async (req, res) => {
  try {
    const companyId = req.account.companyId;
    const f = readListFilters(req);
    const hotelId =
      f.hotelId && mongoose.Types.ObjectId.isValid(f.hotelId) ? f.hotelId : undefined;

    const filter = { toCompanyId: companyId };
    applyLinkRequestStatusFour(filter, f.status, "received");
    if (hotelId) filter.hotelId = hotelId;

    const textCond = buildTextSearchCondition(f.q);
    if (textCond) Object.assign(filter, textCond);

    applyDepartureDateRange(filter, f.departureFrom, f.departureTo);

    const [receivedRequests, allHotelsForFilter] = await Promise.all([
      HotelLinkRequest.find(filter).sort({ createdAt: -1 }).lean(),
      loadHotelsOwnedByCompanyForFilter(companyId),
    ]);
    enrichRequests(receivedRequests);
    await enrichReceivedRequestsWithAvailability(receivedRequests);
    res.render("admin/pages/hotel-link-requests-received", {
      pageTitle: "Yêu cầu liên kết khách sạn",
      receivedRequests,
      selectedHotelId: hotelId || "",
      allHotelsForFilter,
      lrFilter: f,
      pathAdmin,
      hotelLinkAutoBySenderTag: HOTEL_LINK_REQ_AUTO_BY_SENDING_COMPANY_TAG,
    });
  } catch (err) {
    console.error("[hotel-link-request.listReceived]", err);
    res.render("admin/pages/error-404", { pageTitle: "Lỗi" });
  }
};

// ── Yêu cầu đã gửi (menu Tour du lịch) ─────────────────────────────────────
module.exports.listSent = async (req, res) => {
  try {
    const companyId = req.account.companyId;
    const f = readListFilters(req);

    const filter = { fromCompanyId: companyId };
    applyLinkRequestStatusFour(filter, f.status, "sent");
    if (f.hotelId && mongoose.Types.ObjectId.isValid(f.hotelId)) {
      filter.hotelId = f.hotelId;
    } else if (f.hotelId) {
      f.hotelId = "";
    }

    const textCond = buildTextSearchCondition(f.q);
    if (textCond) Object.assign(filter, textCond);

    applyDepartureDateRange(filter, f.departureFrom, f.departureTo);

    const [sentRequests, allHotelsForFilter] = await Promise.all([
      HotelLinkRequest.find(filter).sort({ createdAt: -1 }).lean(),
      loadAllHotelsForLinkRequestFilter(),
    ]);
    enrichRequests(sentRequests);
    res.render("admin/pages/hotel-link-requests-sent", {
      pageTitle: "Yêu cầu liên kết đã gửi",
      sentRequests,
      allHotelsForFilter,
      lrFilter: f,
      pathAdmin,
      hotelLinkAutoBySenderTag: HOTEL_LINK_REQ_AUTO_BY_SENDING_COMPANY_TAG,
    });
  } catch (err) {
    console.error("[hotel-link-request.listSent]", err);
    res.render("admin/pages/error-404", { pageTitle: "Lỗi" });
  }
};

// ── Duyệt yêu cầu ─────────────────────────────────────────────────────────
module.exports.approve = async (req, res) => {
  try {
    const companyId = req.account.companyId;
    const { requestId, approvedRooms, responseNote } = req.body;


    // Tìm request theo công ty
    const linkReq = await HotelLinkRequest.findOne({
      _id: requestId,
      toCompanyId: companyId,
      status: "pending",
    });

    if (!linkReq) {
      return res.json({ success: false, message: "Không tìm thấy yêu cầu hoặc đã xử lý" });
    }

    const hotel = await Hotel.findById(linkReq.hotelId)
      .select("name rooms roomTypes companyId")
      .lean();

    if (!hotel) {
      return res.json({ success: false, message: "Không tìm thấy khách sạn" });
    }

    const tourSeg = await TourSegment.findById(linkReq.tourSegmentId);
    if (!tourSeg) {
      return res.json({ success: false, message: "Không tìm thấy cấu hình tour segment" });
    }

    // Nếu không gửi approvedRooms → duyệt toàn bộ
    let parsedApprovedRooms;
    if (approvedRooms) {
      try {
        parsedApprovedRooms = typeof approvedRooms === "string"
          ? JSON.parse(approvedRooms)
          : approvedRooms;
      } catch {
        parsedApprovedRooms = null;
      }
    }

    if (!Array.isArray(parsedApprovedRooms)) {
      parsedApprovedRooms = linkReq.requestedRooms.map((rr) => ({
        roomTypeId: rr.roomTypeId,
        approvedRooms: rr.assignedRooms,
      }));
    }

    const approvedMap = {};
    for (const ar of parsedApprovedRooms) {
      approvedMap[String(ar.roomTypeId)] = Number(ar.approvedRooms) || 0;
    }

    const tourName = linkReq.tourName || "Tour";
    const depDateFmt = moment(linkReq.departureDate).format("DD/MM/YYYY");
    const endDateFmt = linkReq.endDate ? moment(linkReq.endDate).format("DD/MM/YYYY") : "—";

    const newHoldIds = [];
    let totalApproved = 0;
    let totalRequested = 0;
    const warnings = [];

    for (const rr of linkReq.requestedRooms) {
      totalRequested += rr.assignedRooms;
      const approved = Math.min(
        approvedMap[String(rr.roomTypeId)] || 0,
        rr.assignedRooms
      );

      if (approved <= 0) continue;

      const checkIn = new Date(rr.fromDate);
      const checkOut = new Date(rr.toDate);

      // Lấy ra các booking đang chiếm phòng trong khoảng đó, để ở dưới loại trừ
      // => Biết phòng nào đã bị khách khác hoặc tour khác giữ
      const existingBookings = await HotelBooking.find({
        "hotel.hotelId": linkReq.hotelId,
        status: { $nin: ["cancelled", "checked_out"] },
        checkIn: { $lt: checkOut },
        checkOut: { $gt: checkIn },
      })
        .select("roomTypeId roomId rooms status checkIn checkOut")
        .lean();

      // Tính số phòng trống theo loại phòng
      const availableRoomIds = getAvailableRoomsForType(
        hotel.rooms || [],
        rr.roomTypeId,
        existingBookings,
        checkIn,
        checkOut
      );

      const roomsToBook = Math.min(approved, availableRoomIds.length);

      if (roomsToBook < approved) {
        const rt = (hotel.roomTypes || []).find(
          (r) => String(r._id) === String(rr.roomTypeId)
        );
        warnings.push(
          `${rt?.name || rr.roomTypeName}: chỉ còn ${availableRoomIds.length} phòng trống (duyệt ${approved})`
        );
      }

      if (roomsToBook === 0) continue;

      const selectedRoomIds = availableRoomIds.slice(0, roomsToBook);
      for (const roomId of selectedRoomIds) {
        const holdCode = "TH" + generateRandomNumber(10);
        const booking = await HotelBooking.create({
          code: holdCode,
          checkIn,
          checkOut,
          rooms: 1,
          adults: rr.baseOccupancy || 2,
          roomId, // gán phòng vật lý cụ thể
          roomTypeId: rr.roomTypeId,
          hotel: {
            hotelId: linkReq.hotelId,
            name: linkReq.hotelName,
          },
          status: "confirmed",
          isTemporaryHold: false,
          tourSegmentId: linkReq.tourSegmentId, // tour segment cụ thể
          note: `[Tour Hold – Liên kết] ${tourName} | ${depDateFmt} – ${endDateFmt} | ${rr.roomTypeName}`,
          guest: { fullName: "[Tour Hold]", phone: "", email: "" },
        });
        newHoldIds.push(booking._id);
        totalApproved++;
      }
    }

    // Cập nhật link request
    // Cập nhật lại trạng thái liên kết khi admin duyệt hoặc từ chối
    linkReq.approvedRooms = parsedApprovedRooms;
    linkReq.holdBookingIds = newHoldIds;
    linkReq.responseNote = responseNote || "";

    if (totalApproved === 0) {
      linkReq.status = "rejected";
    } else if (totalApproved >= totalRequested) {
      linkReq.status = "approved";
    } else {
      linkReq.status = "partially_approved";
    }

    linkReq.reviewedBy = {
      accountId: req.account._id,
      fullName:  req.account.fullName || req.account.username || "",
    };
    linkReq.reviewedAt = new Date();

    await linkReq.save();

    // Cập nhật holdBookingIds của tourSegment
    tourSeg.holdBookingIds = [
      ...(tourSeg.holdBookingIds || []),
      ...newHoldIds,
    ];
    await tourSeg.save();

    // Suy luận lại trạng thái segment từ toàn bộ link request liên quan
    // (approved / partially_approved / rejected / cancelled / pending).
    await recomputeTourSegmentStatus(tourSeg._id);

    // Gửi notification cho company gửi yêu cầu
    const statusText = linkReq.status === "approved"
      ? "đã được duyệt"
      : linkReq.status === "partially_approved"
        ? "đã được duyệt một phần"
        : "đã bị từ chối";

    await Notification.create({
      companyId: linkReq.fromCompanyId,
      type: "other",
      title: "Phản hồi yêu cầu liên kết khách sạn",
      content: `Yêu cầu giữ phòng tại ${linkReq.hotelName} cho tour "${tourName}" ${statusText}. Đã duyệt ${totalApproved}/${totalRequested} phòng.`,
      link: linkTourHotelLinkRequestsList,
    });

    let message = `Đã duyệt ${totalApproved} phòng.`;
    if (warnings.length > 0) {
      message += ` Cảnh báo: ${warnings.join("; ")}`;
    }

    auditLogHelper.log(req, {
      action: "hotel-link-request.accept",
      resourceType: "HotelLinkRequest",
      resourceId: linkReq._id,
      resourceLabel: `${linkReq.hotelName || "KS"} – ${tourName}`,
      before: { status: "pending" },
      after: {
        status: linkReq.status,
        approvedRooms: totalApproved,
        requestedRooms: totalRequested,
      },
      summary: `Chấp nhận yêu cầu liên kết của tour "${tourName}" tại "${linkReq.hotelName}" (${totalApproved}/${totalRequested} phòng)`,
      metadata: { responseNote: responseNote || "" },
    });

    return res.json({ success: true, message });
  } catch (err) {
    console.error("[hotel-link-request.approve]", err);
    return res.json({ success: false, message: "Lỗi server" });
  }
};

// ── Thu hồi yêu cầu đã gửi (bên gửi tự hủy) ─────────────────────────────────
module.exports.cancel = async (req, res) => {
  try {
    const companyId = req.account.companyId;
    const { requestId } = req.body;

    const linkReq = await HotelLinkRequest.findOne({
      _id: requestId,
      fromCompanyId: companyId,
      status: "pending",
    });

    if (!linkReq) {
      return res.json({ success: false, message: "Không tìm thấy yêu cầu hoặc yêu cầu đã được xử lý" });
    }

    linkReq.status = "cancelled";
    await linkReq.save();

    auditLogHelper.log(req, {
      action: "hotel-link-request.cancel",
      resourceType: "HotelLinkRequest",
      resourceId: linkReq._id,
      resourceLabel: `${linkReq.hotelName || "KS"} – ${linkReq.tourName || "Tour"}`,
      before: { status: "pending" },
      after: { status: "cancelled" },
      summary: `Thu hồi yêu cầu liên kết gửi tới "${linkReq.hotelName || ""}"`,
    });

    await recomputeTourSegmentStatus(linkReq.tourSegmentId);

    await Notification.create({
      companyId: linkReq.toCompanyId,
      type: "other",
      title: "Yêu cầu liên kết khách sạn đã bị thu hồi",
      content: `Yêu cầu giữ phòng tại ${linkReq.hotelName} cho tour "${linkReq.tourName || "Tour"}" đã được bên gửi thu hồi.`,
      link: linkHotelLinkRequestsList,
    });

    return res.json({ success: true, message: "Đã thu hồi yêu cầu" });
  } catch (err) {
    console.error("[hotel-link-request.cancel]", err);
    return res.json({ success: false, message: "Lỗi server" });
  }
};

// ── Từ chối yêu cầu ────────────────────────────────────────────────────────
module.exports.reject = async (req, res) => {
  try {
    const companyId = req.account.companyId;
    const { requestId, responseNote } = req.body;

    const linkReq = await HotelLinkRequest.findOne({
      _id: requestId,
      toCompanyId: companyId,
      status: "pending",
    });

    if (!linkReq) {
      return res.json({ success: false, message: "Không tìm thấy yêu cầu hoặc đã xử lý" });
    }

    linkReq.status = "rejected";
    linkReq.responseNote = responseNote || "";
    linkReq.reviewedBy = {
      accountId: req.account._id,
      fullName:  req.account.fullName || req.account.username || "",
    };
    linkReq.reviewedAt = new Date();
    await linkReq.save();

    auditLogHelper.log(req, {
      action: "hotel-link-request.reject",
      resourceType: "HotelLinkRequest",
      resourceId: linkReq._id,
      resourceLabel: `${linkReq.hotelName || "KS"} – ${linkReq.tourName || "Tour"}`,
      before: { status: "pending" },
      after: { status: "rejected" },
      summary: `Từ chối yêu cầu liên kết từ tour "${linkReq.tourName || ""}" tại "${linkReq.hotelName || ""}"`,
      metadata: { responseNote: responseNote || "" },
    });

    // Cập nhật lại trạng thái segment (bao gồm cả trường hợp mọi request đều
    // bị từ chối → segment rơi về "draft" để admin cấu hình lại).
    await recomputeTourSegmentStatus(linkReq.tourSegmentId);

    // Gửi notification
    await Notification.create({
      companyId: linkReq.fromCompanyId,
      type: "other",
      title: "Yêu cầu liên kết khách sạn bị từ chối",
      content: `Yêu cầu giữ phòng tại ${linkReq.hotelName} cho tour "${linkReq.tourName}" đã bị từ chối.${responseNote ? " Lý do: " + responseNote : ""}`,
      link: linkTourHotelLinkRequestsList,
    });

    return res.json({ success: true, message: "Đã từ chối yêu cầu" });
  } catch (err) {
    console.error("[hotel-link-request.reject]", err);
    return res.json({ success: false, message: "Lỗi server" });
  }
};
