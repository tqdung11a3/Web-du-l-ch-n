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
const AccountUser  = require("../../models/account-user.model");
const Notification = require("../../models/notification.model");

const { pathAdmin } = require("../../config/variable.config");
const moment = require("moment");
const {
  notifyCustomerOrderUpdate,
  buildTourOrderProfileLink,
} = require("../../helpers/customer-order-notify.helper");

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

function findOrderItemForSegment(order, tourSeg) {
  const departureDateDisplay = moment(tourSeg.departureDate).format("DD/MM/YYYY");
  return (order.items || []).find((it) => {
    if (String(it.tourId) !== String(tourSeg.tourId)) return false;
    if (it.departureDateDisplay) {
      return it.departureDateDisplay === departureDateDisplay;
    }
    if (it.departureDate) {
      return moment(it.departureDate).format("DD/MM/YYYY") === departureDateDisplay;
    }
    return false;
  });
}

/** Số phòng vật lý tối đa (từ Order.sharedRoomRequest.roomAssignments) tại một KS. */
function countExpectedSharedRoomsAtHotel(sharedRoomRequest, hotelId) {
  if (!Array.isArray(sharedRoomRequest)) return 0;
  let total = 0;
  for (const sr of sharedRoomRequest) {
    const allocs =
      Array.isArray(sr.hotelAllocations) && sr.hotelAllocations.length > 0
        ? sr.hotelAllocations
        : sr.hotelId
          ? [
              {
                hotelId: sr.hotelId,
                roomAssignments: sr.roomAssignments || [],
              },
            ]
          : [];
    for (const alloc of allocs) {
      if (hotelId && String(alloc.hotelId) !== String(hotelId)) continue;
      total += (alloc.roomAssignments || []).length;
    }
  }
  return total;
}

/** Khách đặt có liên quan tới phạm vi khách sạn (và hotelId lọc nếu có). */
function orderItemRelevantToHotelScope(
  matchedItem,
  orderId,
  assignments,
  companyHotelIds,
  filterHotelId
) {
  const filterHotelOk =
    Boolean(filterHotelId) && companyHotelIds.includes(String(filterHotelId));

  const myRoomSelections = Array.isArray(matchedItem.roomSelections)
    ? matchedItem.roomSelections.filter((rs) =>
        companyHotelIds.includes(String(rs.hotelId))
      )
    : [];

  const mySharedRequests = Array.isArray(matchedItem.sharedRoomRequest)
    ? matchedItem.sharedRoomRequest.filter((sr) => {
        if (Array.isArray(sr.hotelAllocations) && sr.hotelAllocations.length > 0) {
          return sr.hotelAllocations.some((a) =>
            companyHotelIds.includes(String(a.hotelId))
          );
        }
        return companyHotelIds.includes(String(sr.hotelId));
      })
    : [];

  const myRoomSelectionsVisible = filterHotelOk
    ? myRoomSelections.filter(
        (rs) => String(rs.hotelId) === String(filterHotelId)
      )
    : myRoomSelections;

  const mySharedRequestsVisible = filterHotelOk
    ? mySharedRequests.filter((sr) => {
        if (Array.isArray(sr.hotelAllocations) && sr.hotelAllocations.length > 0) {
          return sr.hotelAllocations.some(
            (a) => String(a.hotelId) === String(filterHotelId)
          );
        }
        return String(sr.hotelId) === String(filterHotelId);
      })
    : mySharedRequests;

  const hasMyAssignmentThisHotel = filterHotelOk
    ? (assignments || []).some(
        (a) =>
          String(a.orderId) === String(orderId) &&
          String(a.hotelId) === String(filterHotelId)
      )
    : (assignments || []).some(
        (a) =>
          String(a.orderId) === String(orderId) &&
          companyHotelIds.includes(String(a.hotelId))
      );

  return (
    myRoomSelectionsVisible.length > 0 ||
    mySharedRequestsVisible.length > 0 ||
    hasMyAssignmentThisHotel
  );
}

function countCustomersForSegmentAtHotels(
  tourSeg,
  orders,
  companyHotelIds,
  filterHotelId
) {
  const departureDateDisplay = moment(tourSeg.departureDate).format("DD/MM/YYYY");
  let count = 0;
  for (const order of orders) {
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
    if (
      orderItemRelevantToHotelScope(
        matchedItem,
        order._id,
        tourSeg.assignments,
        companyHotelIds,
        filterHotelId
      )
    ) {
      count += 1;
    }
  }
  return count;
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
        searchKeyword: req.query.q || "",
        pathAdmin,
      });
    }

    const selectedHotelId = (req.query.hotelId || "").trim();
    const q = (req.query.q || "").trim().toLowerCase();
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
        searchKeyword: req.query.q || "",
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

    const rawOrders = await Order.find({
      "items.tourId": { $in: tourIds },
      $or: [{ paymentStatus: "paid" }, { status: "done" }],
      status: { $ne: "cancel" },
      deleted: { $ne: true },
    })
      .select("items")
      .lean();

    const filterHotelIdForCustomers =
      selectedHotelId && hotelIds.includes(selectedHotelId)
        ? selectedHotelId
        : "";

    // Lấy hold booking theo scope khách sạn đang xem để đếm chính xác các cột
    // "Số phòng giữ / Đã phân / Còn lại" trên list.
    const holds = await HotelBooking.find({
      tourSegmentId: { $in: segmentIds },
      "hotel.hotelId": { $in: scopeHotelIds },
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
          scopeHotelIds.includes(String(a.hotelId))
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

        // Khi người dùng đang lọc theo 1 hotelId cụ thể, chỉ hiển thị đúng
        // khách sạn đó trong cột "Khách sạn (của bạn)".
        const distinctHotelIds = [
          ...new Set(holdBookings.map((b) => String(b.hotel?.hotelId))),
        ].filter((hid) =>
          !selectedHotelId || hid === selectedHotelId
        );
        const hotelsInScope = distinctHotelIds
          .map((hid) => hotelMapById[hid])
          .filter(Boolean);

        const tour = tourById[String(ts.tourId)];
        const customerCount = countCustomersForSegmentAtHotels(
          ts,
          rawOrders,
          hotelIds,
          filterHotelIdForCustomers
        );

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
          customerCount,
          hasCustomers: customerCount > 0,
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

    const filteredRows = q
      ? rows.filter((r) => String(r.tourName || "").toLowerCase().includes(q))
      : rows;

    return res.render("admin/pages/hotel-tour-assignment-list", {
      pageTitle: "Phân phòng cho tour",
      rows: filteredRows,
      selectedHotelId,
      selectedHotelName: filterHotelIdForCustomers
        ? hotelMapById[filterHotelIdForCustomers]?.name || ""
        : "",
      searchKeyword: req.query.q || "",
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
      const accommodationMode =
        matchedItem.accommodationMode === "shared" ? "shared" : "private";

      // Chỉ giữ roomSelections thuộc hotels của company (để hotel-admin không
      // phải check đơn đặt của khách sạn khác trong cùng tour).
      const myRoomSelections = Array.isArray(matchedItem.roomSelections)
        ? matchedItem.roomSelections.filter((rs) =>
            hotelIds.includes(String(rs.hotelId))
          )
        : [];

      // Yêu cầu ở ghép thuộc hotels của company hiện tại. Đơn mới có thể có
      // `hotelAllocations[]` chia ra nhiều hotel khác nhau cùng segment ⇒
      // nếu BẤT KỲ allocation nào nằm trong company hotels thì vẫn liên quan.
      const mySharedRequests = Array.isArray(matchedItem.sharedRoomRequest)
        ? matchedItem.sharedRoomRequest.filter((sr) => {
            if (Array.isArray(sr.hotelAllocations) && sr.hotelAllocations.length > 0) {
              return sr.hotelAllocations.some((a) =>
                hotelIds.includes(String(a.hotelId))
              );
            }
            return hotelIds.includes(String(sr.hotelId));
          })
        : [];

      // Bỏ customer không có phần liên quan tới hotels của company (trừ khi
      // họ đã có assignment cũ thuộc company — giữ lại để xem/huỷ).
      // Khi có ?hotelId=: chỉ giữ khách có đặt hoặc đã gán tại đúng khách sạn đó.
      const myRoomSelectionsVisible = filterHotelOk
        ? myRoomSelections.filter(
            (rs) => String(rs.hotelId) === String(filterHotelFromQuery)
          )
        : myRoomSelections;
      const mySharedRequestsVisible = filterHotelOk
        ? mySharedRequests.filter((sr) => {
            if (Array.isArray(sr.hotelAllocations) && sr.hotelAllocations.length > 0) {
              return sr.hotelAllocations.some(
                (a) => String(a.hotelId) === String(filterHotelFromQuery)
              );
            }
            return String(sr.hotelId) === String(filterHotelFromQuery);
          })
        : mySharedRequests;
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
      if (
        myRoomSelectionsVisible.length === 0 &&
        mySharedRequestsVisible.length === 0 &&
        !hasMyAssignmentThisHotel
      ) {
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
        accommodationMode,
        roomSelections: myRoomSelectionsVisible,
        sharedRoomRequest: mySharedRequestsVisible,
        passengers: Array.isArray(matchedItem.passengers)
          ? matchedItem.passengers
          : [],
        extraRoomCost: Number(matchedItem.extraRoomCost || 0),
      });
    }

    // ── Lazy backfill: với khách shared mode đã có roomAssignments logic
    //   nhưng chưa có entry trong tourSeg.assignments (đơn cũ tạo trước khi
    //   bind TH tự động) → tự gắn ngay tại đây để UI hiển thị đúng phòng. ──
    {
      const mongoose = require("mongoose");
      const usedHoldIds = new Set(
        (tourSeg.assignments || [])
          .map((a) => (a.holdBookingId ? String(a.holdBookingId) : ""))
          .filter(Boolean)
      );
      const pendingPushes = [];
      const hotelDocCache = {};
      const _getHotel = async (hid) => {
        const k = String(hid);
        if (hotelDocCache[k] !== undefined) return hotelDocCache[k];
        const doc = await Hotel.findById(k).select("rooms name").lean();
        hotelDocCache[k] = doc || null;
        return doc || null;
      };

      for (const cust of customers) {
        if (cust.accommodationMode !== "shared") continue;
        if (!Array.isArray(cust.sharedRoomRequest)) continue;

        // Lấy order gốc để biết toàn bộ allocations (kể cả KS không thuộc
        // company hiện tại) — backfill tổng thể nhằm tránh trạng thái nửa
        // vời (chỉ KS công ty mình mới được gán).
        const fullOrder = rawOrders.find(
          (o) => String(o._id) === String(cust.orderId)
        );
        if (!fullOrder) continue;
        const fullItem = (fullOrder.items || []).find((it) => {
          if (String(it.tourId) !== String(tourSeg.tourId)) return false;
          if (it.departureDateDisplay) {
            return it.departureDateDisplay === departureDateDisplay;
          }
          if (it.departureDate) {
            return (
              moment(it.departureDate).format("DD/MM/YYYY") ===
              departureDateDisplay
            );
          }
          return false;
        });
        if (!fullItem || !Array.isArray(fullItem.sharedRoomRequest)) continue;

        for (const r of fullItem.sharedRoomRequest) {
          for (const alloc of r.hotelAllocations || []) {
            const allocAssignments = alloc.roomAssignments || [];
            if (allocAssignments.length === 0) continue;

            // Đếm assignments hiện có của order này tại hotel + segment dates.
            const existingForBucket = (tourSeg.assignments || []).filter(
              (a) =>
                String(a.orderId) === String(cust.orderId) &&
                String(a.hotelId) === String(alloc.hotelId)
            ).length;
            const missing = allocAssignments.length - existingForBucket;
            if (missing <= 0) continue;

            const hotelDoc = await _getHotel(alloc.hotelId);

            // Mỗi ra (logical room) cần 1 TH vật lý. Bind theo thứ tự, bắt
            // đầu từ những ra chưa được map (giả định backfill toàn phần khi
            // chưa có gì).
            const assignmentsToBind = allocAssignments.slice(
              existingForBucket
            );

            for (const ra of assignmentsToBind) {
              const guestFullName =
                (cust.guestName || "").trim() || "Khách tour";
              const noteTxt = `[Tour Booking - Ở ghép] Đặt phòng qua tour - Đơn ${cust.orderCode}${
                Array.isArray(ra.atomLabels) && ra.atomLabels.length
                  ? " | " + ra.atomLabels.join(" || ")
                  : ""
              }`;

              // Reuse TH (cross-order share) hay chiếm TH mới?
              let pickedTh = null;
              if (ra._reuseThId) {
                const reuse = await HotelBooking.findById(ra._reuseThId)
                  .select("_id roomId roomTypeId hotel guest note")
                  .lean();
                if (reuse) {
                  pickedTh = reuse;
                  const appendStr = `|| Đơn ${cust.orderCode}: ${
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
                  if (usedHoldIds.has(cid)) continue;
                  pickedTh = cand;
                  usedHoldIds.add(cid);
                  break;
                }
                if (!pickedTh) continue;

                await HotelBooking.findByIdAndUpdate(pickedTh._id, {
                  $set: {
                    "guest.fullName": guestFullName,
                    "guest.phone": cust.phone || "",
                    orderCode: cust.orderCode,
                    note: noteTxt,
                  },
                });
              }

              let roomNumber = "";
              if (hotelDoc && Array.isArray(hotelDoc.rooms)) {
                const rDoc = hotelDoc.rooms.find(
                  (rr) => String(rr._id) === String(pickedTh.roomId)
                );
                if (rDoc) roomNumber = rDoc.roomNumber || "";
              }

              const newEntry = {
                orderId: new mongoose.Types.ObjectId(cust.orderId),
                orderCode: cust.orderCode,
                guestName: guestFullName,
                phone: cust.phone || "",
                numPeople:
                  Number(ra.usedCapacity) ||
                  Number(ra.baseOccupancy) ||
                  2,
                hotelId: new mongoose.Types.ObjectId(alloc.hotelId),
                hotelName: alloc.hotelName || hotelDoc?.name || "",
                roomId: pickedTh.roomId,
                roomNumber,
                roomTypeName: ra.roomTypeName || "",
                holdBookingId: pickedTh._id,
                accommodationMode: "shared",
                gender: ra.gender || null,
                atomLabels: Array.isArray(ra.atomLabels) ? ra.atomLabels : [],
              };
              pendingPushes.push(newEntry);
              // Push ngay vào in-memory để các bước render dưới biết.
              tourSeg.assignments = tourSeg.assignments || [];
              tourSeg.assignments.push(newEntry);
            }
          }
        }
      }

      if (pendingPushes.length > 0) {
        await TourSegment.updateOne(
          { _id: tourSeg._id },
          { $push: { assignments: { $each: pendingPushes } } }
        );
      }
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
    // Đếm số đơn share cùng 1 holdBookingId — nếu > 1 thì chắc chắn là shared
    // cross-order (kể cả với đơn cũ chưa có field `accommodationMode`).
    const assignsPerHold = {};
    for (const a of (tourSeg.assignments || [])) {
      const bid = a.holdBookingId ? String(a.holdBookingId) : "";
      if (!bid) continue;
      assignsPerHold[bid] = (assignsPerHold[bid] || 0) + 1;
    }

    // Map orderId → accommodationMode lấy từ Order gốc (nguồn authoritative).
    // Một số entry tourSeg.assignments cũ có thể thiếu các field mở rộng nên
    // ta đối chiếu với mode của đơn để biết chính xác là shared hay private.
    const orderModeById = {};
    for (const c of customers) {
      if (c && c.orderId) {
        orderModeById[String(c.orderId)] = c.accommodationMode === "shared" ? "shared" : "private";
      }
    }

    // Build danh sách roomAssignments (ra) chuẩn (nguồn sự thật) lấy từ
    // customer.sharedRoomRequest. Dùng để override numPeople của tourSeg
    // .assignments cho shared (đề phòng dữ liệu cũ lưu sai numPeople).
    const orderRaListById = {};
    for (const c of customers) {
      if (!c || c.accommodationMode !== "shared") continue;
      const list = [];
      for (const sr of c.sharedRoomRequest || []) {
        const allocs = Array.isArray(sr.hotelAllocations) && sr.hotelAllocations.length
          ? sr.hotelAllocations
          : [{ hotelId: sr.hotelId, hotelName: sr.hotelName, roomAssignments: sr.roomAssignments || [] }];
        for (const alloc of allocs) {
          for (const ra of alloc.roomAssignments || []) {
            list.push({
              hotelId: String(alloc.hotelId || sr.hotelId || ""),
              roomTypeName: String(ra.roomTypeName || ""),
              fromDate: String(sr.fromDate || alloc.fromDate || "").slice(0, 10),
              toDate: String(sr.toDate || alloc.toDate || "").slice(0, 10),
              gender: ra.gender || null,
              usedCapacity: Math.max(1, Math.round(Number(ra.usedCapacity) || 1)),
              atomLabels: Array.isArray(ra.atomLabels) ? ra.atomLabels.map(String) : [],
              _claimed: false,
            });
          }
        }
      }
      orderRaListById[String(c.orderId)] = list;
    }

    function pickMatchingRa(orderId, hotelId, roomTypeName, gender, atomLabels) {
      const list = orderRaListById[String(orderId)];
      if (!list || !list.length) return null;
      const norm = (s) => String(s || "").toLowerCase();
      // 1) match đầy đủ atomLabels (nếu có)
      if (Array.isArray(atomLabels) && atomLabels.length) {
        const setA = new Set(atomLabels.map(String));
        const idx = list.findIndex(
          (x) =>
            !x._claimed &&
            x.hotelId === String(hotelId || "") &&
            x.atomLabels.length === setA.size &&
            x.atomLabels.every((y) => setA.has(String(y)))
        );
        if (idx >= 0) {
          list[idx]._claimed = true;
          return list[idx];
        }
      }
      // 2) match hotelId + roomTypeName + gender
      let idx = list.findIndex(
        (x) =>
          !x._claimed &&
          x.hotelId === String(hotelId || "") &&
          norm(x.roomTypeName) === norm(roomTypeName) &&
          (gender ? x.gender === gender : true)
      );
      if (idx >= 0) {
        list[idx]._claimed = true;
        return list[idx];
      }
      // 3) chỉ match hotelId + gender (fallback rộng)
      idx = list.findIndex(
        (x) =>
          !x._claimed &&
          x.hotelId === String(hotelId || "") &&
          (gender ? x.gender === gender : true)
      );
      if (idx >= 0) {
        list[idx]._claimed = true;
        return list[idx];
      }
      return null;
    }

    const existingAssignments = (tourSeg.assignments || [])
      .filter((a) => hotelIds.includes(String(a.hotelId)))
      .map((a) => {
        const bid = a.holdBookingId ? String(a.holdBookingId) : "";
        const fromHold = bid ? holdOccByBookingId[bid] : undefined;
        const orderMode = orderModeById[String(a.orderId)] || null;
        const isShared =
          orderMode === "shared" ||
          a.accommodationMode === "shared" ||
          a.gender === "male" ||
          a.gender === "female" ||
          (Array.isArray(a.atomLabels) && a.atomLabels.length > 0) ||
          (bid && assignsPerHold[bid] > 1);
        // Tính numPeople:
        //  - Shared: ưu tiên usedCapacity từ customer.sharedRoomRequest (nguồn
        //    sự thật). Nếu không tìm được match thì dùng `a.numPeople` đã lưu;
        //    nếu vẫn không có thì 1.
        //  - Private: 1 đơn chiếm trọn phòng → dùng baseOccupancy nếu có; nếu
        //    không thì lấy numPeople đã lưu; cuối cùng là 1.
        const stored = Number(a.numPeople);
        const hasStored = !Number.isNaN(stored) && stored > 0;
        let numPeople;
        if (isShared) {
          const matched = pickMatchingRa(
            a.orderId,
            a.hotelId,
            a.roomTypeName,
            a.gender,
            Array.isArray(a.atomLabels) ? a.atomLabels : []
          );
          if (matched) {
            numPeople = matched.usedCapacity;
          } else if (hasStored) {
            numPeople = Math.round(stored);
          } else {
            numPeople = 1;
          }
        } else {
          numPeople =
            fromHold != null
              ? fromHold
              : hasStored
              ? Math.round(stored)
              : 1;
        }
        return {
          ...a,
          orderId: String(a.orderId),
          hotelId: String(a.hotelId),
          roomId: String(a.roomId),
          holdBookingId: a.holdBookingId ? String(a.holdBookingId) : null,
          accommodationMode: isShared ? "shared" : (a.accommodationMode || "private"),
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

      // Truyền TOÀN BỘ assignments của các khách trong cùng tour-segment (đã
      // scope theo công ty + theo hotelId được chọn nếu có) để UI có thể đánh
      // dấu phòng đã bị khách khác gán → không cho phép trùng lặp.
      const existingAssignmentsForView = existingAssignments.filter((a) => {
        if (filterHotelOk && String(a.hotelId) !== String(filterHotelFromQuery)) {
          return false;
        }
        return true;
      });

      // Build currentAssignmentsByHotel: source-of-truth từ tourSeg.assignments
      // sau khi admin đổi phòng. Group theo hotelId, mỗi entry chứa đủ thông
      // tin phòng hiện tại để template render "Phòng đã phân" chính xác.
      {
        const custSegAssigns = existingAssignments.filter(
          (a) => a.orderId === targetCust.orderId && a.accommodationMode === "shared"
        );

        // Build lookup pool từ Order: list các ra entries (mỗi entry có
        // atomLabels + atomAnchorIdxs + gender + roomTypeName + usedCapacity
        // + primaryName = tên adult ở đầu atomLabels[0]) chưa được claim.
        const parsePrimaryName = (lbl) => {
          const m = String(lbl || "").match(/^(.+?)(?:\s+\(.*\))?$/);
          return m ? m[1].trim().toLowerCase() : String(lbl || "").trim().toLowerCase();
        };
        const orderRaPool = [];
        for (const sr of targetCust.sharedRoomRequest || []) {
          for (const alloc of sr.hotelAllocations || []) {
            for (const ra of alloc.roomAssignments || []) {
              if (!Array.isArray(ra.atomLabels) || ra.atomLabels.length === 0) continue;
              orderRaPool.push({
                hotelId:        String(alloc.hotelId),
                roomTypeName:   ra.roomTypeName || "",
                gender:         ra.gender || null,
                usedCapacity:   Number(ra.usedCapacity) || 0,
                atomLabels:     ra.atomLabels,
                atomAnchorIdxs: Array.isArray(ra.atomAnchorIdxs) ? ra.atomAnchorIdxs : [],
                primaryName:    parsePrimaryName(ra.atomLabels[0]),
                _claimed:       false,
              });
            }
          }
        }
        // Pick ra trong pool theo nhiều mức ưu tiên giảm dần (chưa claim).
        // ƯU TIÊN TUYỆT ĐỐI: match theo guestName (admin swap loại phòng nhưng
        // giữ nguyên khách). Sau đó fallback rộng dần.
        const pickRa = (hid, roomTypeName, gender, numPeople, guestName) => {
          const gName = (guestName || "").trim().toLowerCase();
          if (gName) {
            const byName = orderRaPool.find((x) => !x._claimed && x.hotelId === hid && x.primaryName === gName);
            if (byName) { byName._claimed = true; return byName; }
          }
          const tries = [
            (x) => x.hotelId === hid && x.roomTypeName === roomTypeName && x.gender === gender && x.usedCapacity === numPeople,
            (x) => x.hotelId === hid && x.roomTypeName === roomTypeName && x.gender === gender,
            (x) => x.hotelId === hid && x.roomTypeName === roomTypeName && x.usedCapacity === numPeople,
            (x) => x.hotelId === hid && x.roomTypeName === roomTypeName,
            (x) => x.hotelId === hid && x.gender === gender && x.usedCapacity === numPeople,
            (x) => x.hotelId === hid && x.usedCapacity === numPeople,
            (x) => x.hotelId === hid && x.gender === gender,
            (x) => x.hotelId === hid,
          ];
          for (const match of tries) {
            const found = orderRaPool.find((x) => !x._claimed && match(x));
            if (found) {
              found._claimed = true;
              return found;
            }
          }
          return null;
        };

        const byHotel = {};
        for (const a of custSegAssigns) {
          const hid = String(a.hotelId);
          if (!byHotel[hid]) {
            byHotel[hid] = {
              hotelId: hid,
              hotelName: a.hotelName || "",
              rooms: [],
            };
          }

          let atomLabels = Array.isArray(a.atomLabels) && a.atomLabels.length > 0
            ? a.atomLabels
            : null;
          let gender = a.gender || null;
          // Ưu tiên đọc atomAnchorIdxs đã lưu trực tiếp trong assignment
          // (schema mới). Đơn cũ chưa có field này → fallback các bước phía dưới.
          let atomAnchorIdxs = Array.isArray(a.atomAnchorIdxs) && a.atomAnchorIdxs.length > 0
            ? a.atomAnchorIdxs.map(Number).filter((n) => Number.isFinite(n))
            : null;

          // Nếu atomLabels rỗng → tìm ra trong Order pool theo nhiều mức ưu tiên,
          // đồng thời lấy luôn gender + atomAnchorIdxs khi assignment chưa có
          // (gán thủ công / đổi loại phòng).
          if (!atomLabels) {
            const matched = pickRa(hid, a.roomTypeName || "", a.gender || null, a.numPeople || 0, a.guestName || "");
            if (matched) {
              atomLabels = matched.atomLabels;
              if (!atomAnchorIdxs || atomAnchorIdxs.length === 0) {
                atomAnchorIdxs = matched.atomAnchorIdxs;
              }
              if (!gender) gender = matched.gender || null;
            }
          }

          // Fallback cuối: build atom label từ danh sách passengers của đơn
          // Tìm adult có tên khớp guestName → lấy cả người phụ thuộc (kids).
          if (!atomLabels) {
            const gName = (a.guestName || "").trim().toLowerCase();
            const passengers = targetCust.passengers || [];
            const adult = passengers.find(
              (p) => p.type === "adult" && String(p.name || "").trim().toLowerCase() === gName
            );
            if (adult) {
              const kids = passengers.filter(
                (p) => p.type !== "adult" && p.guardianIdx === adult.idx
              );
              const typeShort = { child: "TE", baby: "EB" };
              let label = adult.name || gName;
              if (kids.length > 0) {
                label += " (+ " + kids.map((k) => `${typeShort[k.type] || k.type} ${k.name || ""}`).join(", ") + ")";
              }
              atomLabels = [label];
              atomAnchorIdxs = [adult.idx];
              if (!gender) gender = adult.gender || null;
            }
          }

          // Đảm bảo có atomAnchorIdxs cho UI render passengers: parse từ
          // atomLabels (tên adult ở đầu mỗi label) → map sang idx trong
          // passengers của đơn.
          if ((!atomAnchorIdxs || atomAnchorIdxs.length === 0) && Array.isArray(atomLabels) && atomLabels.length > 0) {
            const passengers = targetCust.passengers || [];
            const adultByName = {};
            for (const p of passengers) {
              if (p.type === "adult" && p.name) {
                adultByName[String(p.name).trim().toLowerCase()] = p.idx;
              }
            }
            const derivedIdxs = [];
            for (const lbl of atomLabels) {
              // Lấy phần adult name ở đầu label: "Tên (+ ...)" hoặc "Tên (NL·...)"
              const m = String(lbl).match(/^(.+?)(?:\s+\(.*\))?$/);
              const nm = m ? m[1].trim().toLowerCase() : String(lbl).trim().toLowerCase();
              if (adultByName[nm] !== undefined) derivedIdxs.push(adultByName[nm]);
            }
            if (derivedIdxs.length > 0) atomAnchorIdxs = derivedIdxs;
          }

          byHotel[hid].rooms.push({
            roomId:         String(a.roomId),
            holdBookingId:  a.holdBookingId ? String(a.holdBookingId) : "",
            roomNumber:     a.roomNumber || "",
            roomTypeName:   a.roomTypeName || "",
            gender:         gender,
            numPeople:      a.numPeople || 1,
            guestName:      a.guestName || targetCust.guestName || "",
            atomLabels:     atomLabels || [],
            atomAnchorIdxs: atomAnchorIdxs || [],
          });
        }
        targetCust.currentAssignmentsByHotel = Object.values(byHotel);
      }

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

    // Khi UI mở chế độ phân phòng cho 1 khách cụ thể, payload sẽ kèm
    // scopeOrderId — dùng để báo số phòng đã lưu cho riêng khách đó (tránh
    // đếm cả assignment của khách khác mà UI gửi kèm để giữ nguyên dữ liệu).
    const scopeOrderId = String(req.body.scopeOrderId || "").trim();

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

    // ── Recompute helper: cho atomLabels của 1 đơn, tra ra atomAnchorIdxs +
    //   effectiveSize + gender CHÍNH XÁC theo passengers đơn đó + ageBands của
    //   hotel hiện tại. Tránh lệ thuộc vào numPeople do client gửi (có thể sai
    //   khi admin assign nhiều atom có size khác nhau).
    const {
      buildAtomsFromPassengers,
    } = require("../../helpers/passenger-atom.helper");

    const sharedOrderIds = [
      ...new Set(
        (Array.isArray(assignments) ? assignments : [])
          .filter((a) => a && a.accommodationMode === "shared" && a.orderId)
          .map((a) => String(a.orderId))
      ),
    ];
    const sharedOrders = sharedOrderIds.length
      ? await Order.find({ _id: { $in: sharedOrderIds } })
          .select("items")
          .lean()
      : [];
    const sharedOrderById = Object.fromEntries(
      sharedOrders.map((o) => [String(o._id), o])
    );
    const hotelAgeBandsCache = {};
    const _getHotelAgeBands = async (hid) => {
      const k = String(hid);
      if (hotelAgeBandsCache[k] !== undefined) return hotelAgeBandsCache[k];
      const h = hotelMap[k] || (await Hotel.findById(k).select("ageBands").lean());
      const bands = (h?.ageBands || []).map((ab) => ({
        bandName: ab.bandName || "",
        minAge: typeof ab.minAge === "number" ? ab.minAge : 0,
        maxAge:
          ab.maxAge === null || ab.maxAge === undefined ? null : ab.maxAge,
        countInOccupancy: !!ab.countInOccupancy,
        occupancyWeight: ab.countInOccupancy ? ab.occupancyWeight ?? 1 : 0,
      }));
      hotelAgeBandsCache[k] = bands;
      return bands;
    };
    // Cache atoms per (orderId, hotelId): danh sách Atom đầy đủ của đơn tại
    // hotel (đã reweight theo ageBands hotel) — dùng để match atomLabels.
    const atomsByOrderHotel = {};
    const _getAtomsForOrderHotel = async (orderId, hotelId, tourSegDoc) => {
      const k = `${orderId}|${hotelId}`;
      if (atomsByOrderHotel[k]) return atomsByOrderHotel[k];
      const order = sharedOrderById[String(orderId)];
      if (!order) {
        atomsByOrderHotel[k] = [];
        return [];
      }
      const matchedItem = findOrderItemForSegment(order, tourSegDoc);
      const passengers = matchedItem?.passengers || [];
      if (!passengers.length) {
        atomsByOrderHotel[k] = [];
        return [];
      }
      const bands = await _getHotelAgeBands(hotelId);
      let atoms = [];
      try {
        atoms = buildAtomsFromPassengers(passengers, bands);
      } catch {
        atoms = [];
      }
      atomsByOrderHotel[k] = atoms;
      return atoms;
    };

    /**
     * Cho 1 assignment (đã có orderId/hotelId/atomLabels/atomAnchorIdxs), tra
     * danh sách atoms của đơn tại hotel → trả về { anchorIdxs, effectiveSize,
     * gender } CHÍNH XÁC theo ageBands hotel. Match theo:
     *   1) atomAnchorIdxs (nếu client gửi xuống) — chính xác tuyệt đối.
     *   2) atomLabels (so sánh chuỗi label do helper sinh).
     *   3) Fallback: trả về null → caller dùng client values.
     */
    const _resolveAssignmentAtoms = async (a) => {
      const atoms = await _getAtomsForOrderHotel(a.orderId, a.hotelId, tourSeg);
      if (!atoms.length) return null;
      const wantedIdxs = Array.isArray(a.atomAnchorIdxs)
        ? a.atomAnchorIdxs.map(Number).filter((n) => Number.isFinite(n))
        : [];
      const wantedLabels = Array.isArray(a.atomLabels)
        ? a.atomLabels.map((x) => String(x).trim()).filter(Boolean)
        : [];
      let picked = [];
      if (wantedIdxs.length) {
        const setI = new Set(wantedIdxs);
        picked = atoms.filter((x) => setI.has(x.anchorIdx));
      }
      if (picked.length === 0 && wantedLabels.length) {
        const setL = new Set(wantedLabels);
        picked = atoms.filter((x) => setL.has(String(x.label || "").trim()));
      }
      if (picked.length === 0) return null;
      const effectiveSize = picked.reduce(
        (s, x) => s + (Number(x.effectiveSize) || 0),
        0
      );
      const genders = new Set(picked.map((x) => x.gender).filter(Boolean));
      const gender = genders.size === 1 ? [...genders][0] : null;
      return {
        anchorIdxs: picked.map((x) => x.anchorIdx),
        labels: picked.map((x) => x.label),
        effectiveSize,
        gender,
      };
    };

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
      const isSharedAssignment = a.accommodationMode === "shared";

      // Shared: ưu tiên RECOMPUTE numPeople + gender từ atomLabels/anchorIdxs +
      // passengers + ageBands hotel — vì client gửi numPeople = inferCustomer
      // SizePerRoom (ras[0].usedCapacity, hằng số) có thể sai khi đơn có nhiều
      // atom kích thước khác nhau.
      // Private: 1 đơn chiếm trọn phòng → fallback baseOccupancy.
      let numPeople;
      let resolvedGender = a.gender === "male" || a.gender === "female" ? a.gender : null;
      let resolvedAtomLabels = Array.isArray(a.atomLabels)
        ? a.atomLabels.filter((x) => typeof x === "string")
        : [];
      let resolvedAnchorIdxs = Array.isArray(a.atomAnchorIdxs)
        ? a.atomAnchorIdxs.map(Number).filter((n) => Number.isFinite(n))
        : [];

      if (isSharedAssignment) {
        let resolved = null;
        try {
          resolved = await _resolveAssignmentAtoms({
            orderId: a.orderId,
            hotelId: hotelOfBooking,
            atomAnchorIdxs: resolvedAnchorIdxs,
            atomLabels: resolvedAtomLabels,
          });
        } catch {
          resolved = null;
        }
        if (resolved) {
          numPeople = Math.max(1, Math.round(resolved.effectiveSize || 1));
          // Chỉ override gender khi atom đoán được; nếu hỗn hợp (gender=null)
          // giữ nguyên giá trị client (đa số trường hợp valid: 1 atom = 1 gender).
          if (resolved.gender) resolvedGender = resolved.gender;
          if (resolved.labels && resolved.labels.length) {
            resolvedAtomLabels = resolved.labels.map(String);
          }
          if (resolved.anchorIdxs && resolved.anchorIdxs.length) {
            resolvedAnchorIdxs = resolved.anchorIdxs;
          }
        } else {
          // Fallback: client gửi usedCapacity (set bởi _reconcileCurrentAssignments
          // = numPeople đúng của room đã claim trước đó). Nếu không có thì dùng
          // numPeople; cuối cùng là 1.
          const clientUsed = Number(a.usedCapacity);
          const clientNum = Number(a.numPeople);
          const pick = Number.isFinite(clientUsed) && clientUsed > 0
            ? clientUsed
            : Number.isFinite(clientNum) && clientNum > 0
            ? clientNum
            : 1;
          numPeople = Math.max(1, Math.round(pick));
        }
      } else {
        numPeople = occFromType != null && occFromType > 0
          ? occFromType
          : Math.max(1, Math.round(Number(a.numPeople) || 1));
      }

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
        // Mở rộng: cross-order share (shared mode)
        accommodationMode: isSharedAssignment ? "shared" : "private",
        gender: resolvedGender,
        atomLabels: resolvedAtomLabels,
        atomAnchorIdxs: resolvedAnchorIdxs,
      });
    }

    // ── Cross-check sau khi clean: với mỗi (hotelId, holdBookingId) là phòng
    //   ghép nhiều đơn, tổng numPeople KHÔNG được vượt sức chứa phòng (vì admin
    //   có thể click overcapacity dù UI canSharedJoinRoom đã kiểm — myNeed
    //   trong UI là hằng số nên có thể trượt).
    {
      const groupedByHold = {};
      for (const ca of cleanAssignments) {
        if (ca.accommodationMode !== "shared") continue;
        const k = String(ca.holdBookingId);
        if (!groupedByHold[k]) groupedByHold[k] = [];
        groupedByHold[k].push(ca);
      }
      for (const hbId of Object.keys(groupedByHold)) {
        const list = groupedByHold[hbId];
        if (list.length === 0) continue;
        const hb = holdMap[hbId];
        if (!hb) continue;
        const hot = hotelMap[String(hb.hotel?.hotelId)] || null;
        const rt = hot
          ? (hot.roomTypes || []).find(
              (x) => String(x._id) === String(hb.roomTypeId)
            )
          : null;
        const cap = rt && Number.isFinite(Number(rt.baseOccupancy))
          ? Math.round(Number(rt.baseOccupancy))
          : 0;
        if (cap <= 0) continue;
        const used = list.reduce((s, ca) => s + (Number(ca.numPeople) || 0), 0);
        if (used > cap) {
          return res.json({
            success: false,
            message:
              `Phòng ${list[0].roomNumber || ""} vượt sức chứa: ` +
              `sức chứa ${cap}, đang gán ${used} chỗ. Vui lòng điều chỉnh lại.`,
          });
        }
        // Đồng thời chặn trộn giới tính trong cùng phòng ghép.
        const genders = new Set(
          list.map((ca) => ca.gender).filter((g) => g === "male" || g === "female")
        );
        if (genders.size > 1) {
          return res.json({
            success: false,
            message:
              `Phòng ${list[0].roomNumber || ""} đang ghép cả khách nam và nữ. ` +
              `Phòng ở ghép phải cùng giới tính.`,
          });
        }
      }
    }

    // Khách ở ghép: không cho lưu nếu số phòng gán vượt quá roomAssignments trên đơn
    const sharedExcessMsg =
      "Số lượng phòng được gán vượt quá số phòng vật lý tối đa cho khách ở ghép. Vui lòng điều chỉnh lại phân phòng.";
    const pairsToValidate = new Map();
    if (scopeOrderId && narrowScoped) {
      pairsToValidate.set(`${scopeOrderId}|${scopeHotelId}`, {
        orderId: scopeOrderId,
        hotelId: scopeHotelId,
      });
    } else {
      for (const a of cleanAssignments) {
        if (a.accommodationMode !== "shared") continue;
        const key = `${a.orderId}|${a.hotelId}`;
        if (!pairsToValidate.has(key)) {
          pairsToValidate.set(key, {
            orderId: String(a.orderId),
            hotelId: String(a.hotelId),
          });
        }
      }
    }
    if (pairsToValidate.size > 0) {
      const orderIdsForValidate = [
        ...new Set([...pairsToValidate.values()].map((p) => p.orderId)),
      ];
      const ordersForValidate = await Order.find({
        _id: { $in: orderIdsForValidate },
      })
        .select("items")
        .lean();
      const orderById = Object.fromEntries(
        ordersForValidate.map((o) => [String(o._id), o])
      );
      for (const { orderId, hotelId } of pairsToValidate.values()) {
        const orderDoc = orderById[orderId];
        if (!orderDoc) continue;
        const matchedItem = findOrderItemForSegment(orderDoc, tourSeg);
        if (!matchedItem || matchedItem.accommodationMode !== "shared") continue;
        const expected = countExpectedSharedRoomsAtHotel(
          matchedItem.sharedRoomRequest,
          hotelId
        );
        if (expected <= 0) continue;
        const bound = cleanAssignments.filter(
          (a) =>
            String(a.orderId) === String(orderId) &&
            String(a.hotelId) === String(hotelId)
        ).length;
        if (bound > expected) {
          return res.json({ success: false, message: sharedExcessMsg });
        }
      }
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

    const assignOrderIds = [
      ...new Set(cleanAssignments.map((a) => a.orderId).filter(Boolean)),
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

    // Gom theo holdBookingId để xử lý multi-share (shared cross-order).
    const assignsByHold = {};
    for (const a of cleanAssignments) {
      const k = String(a.holdBookingId);
      if (!assignsByHold[k]) assignsByHold[k] = [];
      assignsByHold[k].push(a);
    }

    for (const hbId of Object.keys(assignsByHold)) {
      const list = assignsByHold[hbId];
      const hb = holdMap[hbId];
      if (!hb) continue;

      // Sắp xếp ổn định theo orderCode để chọn "primary" nhất quán.
      list.sort((x, y) =>
        String(x.orderCode || "").localeCompare(String(y.orderCode || ""))
      );
      const primary = list[0];
      const oa = assignOrderById[String(primary.orderId)] || null;
      let guestEmail = (oa?.email && String(oa.email).trim()) || "";
      if (!guestEmail && oa?.userId) {
        guestEmail = assignUserEmailById[String(oa.userId)] || "";
      }

      let note;
      if (list.length === 1) {
        note = `[TOUR] Đơn #${primary.orderCode} – ${primary.guestName || ""} – ${primary.numPeople} người/phòng (loại phòng)`;
      } else {
        const parts = list.map((x) => {
          const lbls = (x.atomLabels || []).filter(Boolean).join(" || ");
          const tail = lbls ? ` – ${lbls}` : "";
          return `Đơn #${x.orderCode} (${x.guestName || ""}, ${x.numPeople} chỗ)${tail}`;
        });
        note = `[TOUR][Ở GHÉP] Phòng ghép ${list.length} đơn || ${parts.join(" || ")}`;
      }

      await HotelBooking.findByIdAndUpdate(hb._id, {
        orderCode: primary.orderCode || "",
        "guest.fullName": primary.guestName || "Khách tour",
        "guest.phone": primary.phone || "",
        "guest.email": guestEmail,
        note,
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
            "guest.phone": "",
            "guest.email": "",
            note: resetNote,
            status: "confirmed",
            isTemporaryHold: false,
          },
          $unset: {
            orderCode: "",
            holdExpiresAt: "",
            userId: "",
          },
        }
      );
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

    // Thông báo + email cho từng khách được phân công phòng
    try {
      const tourDoc2 = tourDoc || await require("../../models/tour.model").findById(tourSeg.tourId).select("name").lean();
      const tourName2 = tourDoc2?.name || "Tour";
      const depFmt = moment(tourSeg.departureDate).format("DD/MM/YYYY");

      // Gom theo orderId để gửi 1 thông báo/email cho mỗi đơn
      const byOrder = {};
      for (const a of cleanAssignments) {
        const oid = String(a.orderId);
        if (!byOrder[oid]) {
          byOrder[oid] = { rooms: [], orderCode: a.orderCode };
        }
        byOrder[oid].rooms.push(a);
      }

      for (const [oid, { rooms, orderCode }] of Object.entries(byOrder)) {
        const oa = assignOrderById[oid];
        if (!oa) continue;
        const email = (oa.email && String(oa.email).trim()) ||
          (oa.userId ? (assignUserEmailById[String(oa.userId)] || "") : "");
        if (!oa.userId && !email) continue;

        const roomLines = rooms.map((a) => {
          const hotelLabel = hotelMapById[String(a.hotelId)]?.name || a.hotelName || "KS";
          const roomLabel = a.roomNumber ? `Phòng ${a.roomNumber}` : "Phòng đã xác định";
          return `${hotelLabel} — ${roomLabel}${a.roomTypeName ? ` (${a.roomTypeName})` : ""}`;
        });

        const changes = roomLines.map((line) => ({
          field: "room_assignment",
          label: "Phòng được xếp",
          from: null,
          to: line,
        }));

        await notifyCustomerOrderUpdate({
          userId: oa.userId,
          email,
          customerName: rooms[0]?.guestName || "",
          type: "tour_assignment",
          tourName: tourName2,
          resourceLabel: orderCode || tourName2,
          orderCode,
          orderId: oid,
          link: buildTourOrderProfileLink(orderCode, "initial"),
          changes,
          introLine: `Bạn đã được xếp phòng cho tour "${tourName2}" (khởi hành ${depFmt}).`,
        });
      }
    } catch (notifyErr) {
      console.error("[hotel-tour-assignment.save] notifyCustomer:", notifyErr);
    }

    const reportedCount = scopeOrderId
      ? cleanAssignments.filter((a) => String(a.orderId) === scopeOrderId).length
      : cleanAssignments.length;

    return res.json({
      success: true,
      message: `Đã lưu phân công ${reportedCount} mục và cập nhật thông tin khách thành công`,
    });
  } catch (err) {
    console.error("[hotel-tour-assignment.save]", err);
    return res.json({ success: false, message: "Lỗi server" });
  }
};
