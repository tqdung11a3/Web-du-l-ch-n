// controllers/admin/super-admin/hotel-link-request.controller.js
const HotelLinkRequest = require("../../../models/hotel-link-request.model");
const Company = require("../../../models/company.model");
const Tour = require("../../../models/tour.model");
const Hotel = require("../../../models/hotel.model");
const TourSegment = require("../../../models/tour-segment.model");
const HotelBooking = require("../../../models/hotel-booking.model");
const Notification = require("../../../models/notification.model");
const moment = require("moment");
const auditLogHelper = require("../../../helpers/audit-log.helper");
const {
  _recomputeTourSegmentStatus: recomputeTourSegmentStatus,
} = require("../hotel-link-request.controller");
const { pathAdmin } = require("../../../config/variable.config");
const linkHotelLinkRequestsList = `/${pathAdmin}/hotel/link-requests`;
const linkTourHotelLinkRequestsList = `/${pathAdmin}/tour-hotel/link-requests`;

function enrich(r) {
  r.departureDateDisplay = r.departureDate
    ? moment(r.departureDate).format("DD/MM/YYYY")
    : "—";
  r.endDateDisplay = r.endDate
    ? moment(r.endDate).format("DD/MM/YYYY")
    : "—";
  r.createdAtDisplay = moment(r.createdAt).format("DD/MM/YYYY HH:mm");
  r.totalRequestedRooms = (r.requestedRooms || []).reduce(
    (s, rr) => s + (rr.assignedRooms || 0),
    0
  );
  r.totalApprovedRooms = (r.approvedRooms || []).reduce(
    (s, ar) => s + (ar.approvedRooms || 0),
    0
  );
  for (const rr of r.requestedRooms || []) {
    rr.fromDateDisplay = rr.fromDate
      ? moment(rr.fromDate).format("DD/MM/YYYY")
      : "";
    rr.toDateDisplay = rr.toDate ? moment(rr.toDate).format("DD/MM/YYYY") : "";
  }
  return r;
}

/**
 * GET /admin/super-admin/hotel-link-requests
 */
module.exports.list = async (req, res) => {
  try {
    const filter = {};
    if (req.query.fromCompanyId) filter.fromCompanyId = req.query.fromCompanyId;
    if (req.query.toCompanyId) filter.toCompanyId = req.query.toCompanyId;
    if (req.query.status) filter.status = req.query.status;

    const limitItems = 20;
    const page =
      req.query.page && parseInt(req.query.page, 10) > 0
        ? parseInt(req.query.page, 10)
        : 1;
    const skip = (page - 1) * limitItems;

    const totalRecord = await HotelLinkRequest.countDocuments(filter);
    const items = await HotelLinkRequest.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitItems)
      .lean();

    items.forEach(enrich);

    const totalPage = Math.ceil(totalRecord / limitItems) || 1;
    const pagination = {
      currentPage: page,
      limitItems,
      skip,
      totalRecord,
      totalPage,
    };

    const allCompanies = await Company.find({ deleted: false })
      .select("_id name")
      .sort({ name: 1 })
      .lean();

    res.render("admin/pages/super-admin/hotel-link-request-list", {
      pageTitle: "Yêu cầu liên kết khách sạn",
      items,
      pagination,
      allCompanies,
      fromCompanyId: req.query.fromCompanyId || "",
      toCompanyId: req.query.toCompanyId || "",
      statusFilter: req.query.status || "",
    });
  } catch (error) {
    console.error("Super Admin HotelLinkRequest List Error:", error);
    res.status(500).send("Có lỗi xảy ra!");
  }
};

/**
 * GET /admin/super-admin/hotel-link-requests/:id
 */
module.exports.detail = async (req, res) => {
  try {
    const doc = await HotelLinkRequest.findById(req.params.id).lean();
    if (!doc) {
      return res.redirect(
        `/${require("../../../config/variable.config").pathAdmin}/super-admin/hotel-link-requests`
      );
    }
    enrich(doc);

    let tour = null;
    if (doc.tourId) {
      tour = await Tour.findById(doc.tourId).select("title code").lean();
    }
    let segment = null;
    if (doc.tourSegmentId) {
      segment = await TourSegment.findById(doc.tourSegmentId).lean();
    }

    let holdBookings = [];
    if ((doc.holdBookingIds || []).length) {
      holdBookings = await HotelBooking.find({
        _id: { $in: doc.holdBookingIds },
      })
        .select("code checkIn checkOut status note roomId roomTypeId")
        .lean();
    }

    let hotel = null;
    if (doc.hotelId) {
      const hotelSelect =
        holdBookings.length > 0 ? "name address roomTypes" : "name address";
      hotel = await Hotel.findById(doc.hotelId).select(hotelSelect).lean();
    }

    if (hotel && hotel.roomTypes && holdBookings.length) {
      const rtMap = Object.fromEntries(
        (hotel.roomTypes || []).map((rt) => [String(rt._id), rt.name || ""])
      );
      for (const b of holdBookings) {
        b.roomTypeName = b.roomTypeId
          ? rtMap[String(b.roomTypeId)] || "(không rõ loại phòng)"
          : "—";
      }
    } else if (holdBookings.length) {
      for (const b of holdBookings) {
        b.roomTypeName = b.roomTypeId ? "(không rõ loại phòng)" : "—";
      }
    }

    res.render("admin/pages/super-admin/hotel-link-request-detail", {
      pageTitle: "Chi tiết yêu cầu liên kết",
      doc,
      tour,
      hotel,
      segment,
      holdBookings,
    });
  } catch (error) {
    console.error("Super Admin HotelLinkRequest Detail Error:", error);
    res.status(500).send("Có lỗi xảy ra!");
  }
};

/**
 * PATCH /admin/super-admin/hotel-link-requests/:id/force-cancel
 * body: { reason }
 *
 * Super Admin huỷ cưỡng chế một yêu cầu đang ở bất kỳ trạng thái nào.
 * - Đánh dấu status = "cancelled"
 * - Xoá mềm các hold booking đi kèm (nếu còn pending/confirmed)
 * - Gửi notification cho cả hai công ty
 * - Ghi audit log
 */
module.exports.forceCancel = async (req, res) => {
  try {
    const { reason } = req.body;
    const linkReq = await HotelLinkRequest.findById(req.params.id);
    if (!linkReq) {
      return res.json({ code: "error", message: "Không tìm thấy yêu cầu" });
    }

    const prevStatus = linkReq.status;
    linkReq.status = "cancelled";
    linkReq.responseNote =
      (linkReq.responseNote ? linkReq.responseNote + "\n" : "") +
      "[SUPER ADMIN FORCE CANCEL] " +
      (reason || "Không có lý do");
    await linkReq.save();

    // Huỷ hold bookings nếu có
    if ((linkReq.holdBookingIds || []).length) {
      await HotelBooking.updateMany(
        {
          _id: { $in: linkReq.holdBookingIds },
          status: { $nin: ["cancelled", "checked_out"] },
        },
        { status: "cancelled" }
      );
    }

    // Suy luận lại trạng thái segment tour liên quan — tránh tình trạng
    // "Đã xác nhận" sai khi yêu cầu bị Super Admin ép huỷ.
    await recomputeTourSegmentStatus(linkReq.tourSegmentId);

    const content = `Super Admin đã huỷ yêu cầu liên kết tại ${linkReq.hotelName} cho tour "${
      linkReq.tourName || ""
    }". Lý do: ${reason || "—"}`;
    await Notification.insertMany([
      {
        companyId: linkReq.fromCompanyId,
        type: "other",
        title: "Yêu cầu liên kết bị Super Admin huỷ",
        content,
        link: linkTourHotelLinkRequestsList,
      },
      {
        companyId: linkReq.toCompanyId,
        type: "other",
        title: "Yêu cầu liên kết bị Super Admin huỷ",
        content,
        link: linkHotelLinkRequestsList,
      },
    ]);

    await auditLogHelper.log(req, {
      action: "hotel-link-request.force-cancel",
      resourceType: "HotelLinkRequest",
      resourceId: linkReq._id,
      metadata: { prevStatus, reason },
    });

    res.json({ code: "success", message: "Đã huỷ yêu cầu!" });
  } catch (error) {
    console.error("Super Admin HotelLinkRequest forceCancel Error:", error);
    res.json({ code: "error", message: "Có lỗi xảy ra!" });
  }
};
