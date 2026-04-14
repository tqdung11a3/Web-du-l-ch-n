const HotelLinkRequest = require("../../models/hotel-link-request.model");
const HotelBooking = require("../../models/hotel-booking.model");
const Hotel = require("../../models/hotel.model");
const TourSegment = require("../../models/tour-segment.model");
const Notification = require("../../models/notification.model");
const { getAvailableRoomsForType } = require("../../helpers/hotel-availability.helper");
const { generateRandomNumber } = require("../../helpers/generate.helper");
const { pathAdmin } = require("../../config/variable.config");
const moment = require("moment");

// ── Helper: enrich request list ─────────────────────────────────────────────
function enrichRequests(list) {
  for (const r of list) {
    r.departureDateDisplay = moment(r.departureDate).format("DD/MM/YYYY");
    r.endDateDisplay = r.endDate ? moment(r.endDate).format("DD/MM/YYYY") : "—";
    r.createdAtDisplay = moment(r.createdAt).format("DD/MM/YYYY HH:mm");
    r.totalRequestedRooms = r.requestedRooms.reduce((s, rr) => s + rr.assignedRooms, 0);
    r.totalApprovedRooms = (r.approvedRooms || []).reduce((s, ar) => s + ar.approvedRooms, 0);
    for (const rr of r.requestedRooms) {
      rr.fromDateDisplay = moment(rr.fromDate).format("DD/MM/YYYY");
      rr.toDateDisplay = moment(rr.toDate).format("DD/MM/YYYY");
    }
  }
}

// ── Yêu cầu nhận được (menu Khách sạn) ─────────────────────────────────────
module.exports.listReceived = async (req, res) => {
  try {
    const companyId = req.account.companyId;
    const hotelId = req.query.hotelId;

    const filter = { toCompanyId: companyId, status: { $ne: "cancelled" } };
    if (hotelId) filter.hotelId = hotelId;

    const receivedRequests = await HotelLinkRequest.find(filter)
      .sort({ createdAt: -1 })
      .lean();
    enrichRequests(receivedRequests);
    res.render("admin/pages/hotel-link-requests-received", {
      pageTitle: "Yêu cầu liên kết khách sạn",
      receivedRequests,
      selectedHotelId: hotelId || "",
      pathAdmin,
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
    const sentRequests = await HotelLinkRequest.find({ fromCompanyId: companyId })
      .sort({ createdAt: -1 })
      .lean();
    enrichRequests(sentRequests);
    res.render("admin/pages/hotel-link-requests-sent", {
      pageTitle: "Yêu cầu liên kết đã gửi",
      sentRequests,
      pathAdmin,
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

      const existingBookings = await HotelBooking.find({
        "hotel.hotelId": linkReq.hotelId,
        status: { $nin: ["cancelled", "checked_out"] },
        checkIn: { $lt: checkOut },
        checkOut: { $gt: checkIn },
      })
        .select("roomTypeId roomId rooms status checkIn checkOut")
        .lean();

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
          roomId,
          roomTypeId: rr.roomTypeId,
          hotel: {
            hotelId: linkReq.hotelId,
            name: linkReq.hotelName,
          },
          status: "confirmed",
          isTemporaryHold: false,
          tourSegmentId: linkReq.tourSegmentId,
          note: `[Tour Hold – Liên kết] ${tourName} | ${depDateFmt} – ${endDateFmt} | ${rr.roomTypeName}`,
          guest: { fullName: "[Tour Hold]", phone: "", email: "" },
        });
        newHoldIds.push(booking._id);
        totalApproved++;
      }
    }

    // Cập nhật link request
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

    await linkReq.save();

    // Cập nhật holdBookingIds của tourSegment
    tourSeg.holdBookingIds = [
      ...(tourSeg.holdBookingIds || []),
      ...newHoldIds,
    ];

    // Kiểm tra tất cả link requests của tourSegment đã xử lý chưa
    const pendingCount = await HotelLinkRequest.countDocuments({
      tourSegmentId: tourSeg._id,
      status: "pending",
    });

    if (pendingCount === 0) {
      tourSeg.status = "confirmed";
    }

    await tourSeg.save();

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
      link: `/admin/hotel/link-requests`,
    });

    let message = `Đã duyệt ${totalApproved} phòng.`;
    if (warnings.length > 0) {
      message += ` Cảnh báo: ${warnings.join("; ")}`;
    }

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

    const tourSeg = await TourSegment.findById(linkReq.tourSegmentId);
    if (tourSeg) {
      const pendingCount = await HotelLinkRequest.countDocuments({
        tourSegmentId: tourSeg._id,
        status: "pending",
      });

      if (pendingCount === 0 && tourSeg.status === "pending_approval") {
        tourSeg.status = "confirmed";
        await tourSeg.save();
      }
    }

    await Notification.create({
      companyId: linkReq.toCompanyId,
      type: "other",
      title: "Yêu cầu liên kết khách sạn đã bị thu hồi",
      content: `Yêu cầu giữ phòng tại ${linkReq.hotelName} cho tour "${linkReq.tourName || "Tour"}" đã được bên gửi thu hồi.`,
      link: `/admin/hotel/link-requests`,
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
    await linkReq.save();

    // Kiểm tra tất cả link requests của tourSegment đã xử lý chưa
    const tourSeg = await TourSegment.findById(linkReq.tourSegmentId);
    if (tourSeg) {
      const pendingCount = await HotelLinkRequest.countDocuments({
        tourSegmentId: tourSeg._id,
        status: "pending",
      });

      if (pendingCount === 0) {
        tourSeg.status = "confirmed";
        await tourSeg.save();
      }
    }

    // Gửi notification
    await Notification.create({
      companyId: linkReq.fromCompanyId,
      type: "other",
      title: "Yêu cầu liên kết khách sạn bị từ chối",
      content: `Yêu cầu giữ phòng tại ${linkReq.hotelName} cho tour "${linkReq.tourName}" đã bị từ chối.${responseNote ? " Lý do: " + responseNote : ""}`,
      link: `/admin/hotel/link-requests`,
    });

    return res.json({ success: true, message: "Đã từ chối yêu cầu" });
  } catch (err) {
    console.error("[hotel-link-request.reject]", err);
    return res.json({ success: false, message: "Lỗi server" });
  }
};
