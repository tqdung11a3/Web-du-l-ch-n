// controllers/client/tour.controller.js
const mongoose = require("mongoose");
const Tour = require("../../models/tour.model");
const City = require("../../models/city.model");
const categoryHelper = require("../../helpers/category.helper");
const moment = require("moment");

const Company = require("../../models/company.model");
const Review = require("../../models/review.model");

// ========= HELPER: gắn ratingAvg + ratingCount =========
async function attachRatings(tours) {
  if (!Array.isArray(tours) || tours.length === 0) return tours;

  const ids = tours
    .map((t) => t && (t._id || t.id))
    .filter(Boolean)
    .map((id) => new mongoose.Types.ObjectId(String(id)));

  if (ids.length === 0) return tours;

  const stats = await Review.aggregate([
    { $match: { deleted: false, tourId: { $in: ids } } },
    {
      $group: {
        _id: "$tourId",
        count: { $sum: 1 },
        avg: { $avg: "$rating" },
      },
    },
  ]);

  const map = Object.fromEntries(
    stats.map((s) => [String(s._id), { count: s.count, avg: s.avg }])
  );

  tours.forEach((t) => {
    const key = String(t._id || t.id);
    const st = map[key];
    t.ratingAvg = st ? st.avg : 0;
    t.ratingCount = st ? st.count : 0;
  });

  return tours;
}

// ========= CHI TIẾT TOUR =========
module.exports.detail = async (req, res) => {
  // Nếu có slug và tourSlug -> route mới /company/:slug/tour/detail/:tourSlug
  // Nếu chỉ có slug -> route cũ /tour/detail/:slug (redirect đến route mới)
  const { slug, tourSlug } = req.params;
  const companySlug = slug; // Trong route /company/:slug/tour/detail/:tourSlug, slug là companySlug
  const finalSlug = tourSlug || slug;

  console.log(`[Tour Detail] Request params:`, { companySlug, tourSlug, slug, finalSlug, url: req.url });

  let company = null;
  let tourDetailDoc = null;

  if (companySlug && tourSlug) {
    // Route mới: /company/:slug/tour/detail/:tourSlug
    company = await Company.findOne({
      slug: companySlug,
      status: "active",
      deleted: { $ne: true },
    }).lean();

    if (!company) {
      console.log(`[Tour Detail] Company not found: ${companySlug}`);
      return res
        .status(404)
        .render("client/pages/404", { pageTitle: "Không tìm thấy công ty" });
    }

    // Tìm tour với slug (không cần kiểm tra companyId chặt chẽ vì URL đã có company slug)
    // Nếu tour có companyId khác, vẫn hiển thị (có thể là dữ liệu cũ hoặc tour đã chuyển công ty)

    // 1. Tìm tour
    tourDetailDoc = await Tour.findOne({
      slug: tourSlug,
      deleted: false,
      status: "active",
    });

    if (!tourDetailDoc) {
      console.log(`[Tour Detail] Tour not found: slug=${tourSlug}, companySlug=${companySlug}`);
      // Thử tìm tour với các điều kiện khác để debug
      const tourWithoutStatus = await Tour.findOne({
        slug: tourSlug,
        deleted: false,
      });
      if (tourWithoutStatus) {
        console.log(`[Tour Detail] Tour exists but status is: ${tourWithoutStatus.status}`);
      } else {
        const tourWithDeleted = await Tour.findOne({ slug: tourSlug });
        if (tourWithDeleted) {
          console.log(`[Tour Detail] Tour exists but deleted: ${tourWithDeleted.deleted}`);
        } else {
          console.log(`[Tour Detail] Tour does not exist in database`);
        }
      }
    }
  } else if (slug) {
    // Route cũ: /tour/detail/:slug -> redirect đến route mới
    tourDetailDoc = await Tour.findOne({
      slug: slug,
      deleted: false,
      status: "active",
    })
      .populate("companyId", "slug")
      .lean();

    if (!tourDetailDoc) {
      return res
        .status(404)
        .render("client/pages/404", { pageTitle: "Không tìm thấy tour" });
    }

    // Redirect đến route mới
    const companySlugFromTour = tourDetailDoc.companyId?.slug;
    if (companySlugFromTour) {
      return res.redirect(
        `/company/${companySlugFromTour}/tour/detail/${slug}`
      );
    } else {
      // Nếu không có company, vẫn hiển thị nhưng với route cũ (fallback)
      company = null;
      // tourDetailDoc đã là lean object, không cần toObject()
    }
  }

  if (!tourDetailDoc) {
    return res
      .status(404)
      .render("client/pages/404", { pageTitle: "Không tìm thấy tour" });
  }

  // Convert to object nếu là Mongoose document
  let tourDetail;
  if (tourDetailDoc && tourDetailDoc.toObject) {
    tourDetail = tourDetailDoc.toObject();
  } else {
    tourDetail = tourDetailDoc;
  }

  // Gắn thông tin công ty tổ chức cho tourDetail để view hiển thị
  try {
    if (company) {
      // Đã có company từ slug trong URL (company đã được fetch đầy đủ ở trên)
      // Cần fetch lại với tourAgeBands nếu company chỉ có một số field

      // 2. Gắn công ty tổ chức tour
      const companyFull = await Company.findById(company._id)
        .select("name slug logo hotline address tourAgeBands")
        .lean();
      tourDetail.company = {
        _id: company._id,
        name: company.name,
        slug: company.slug,
        logo: company.logo || "",
        hotline: company.hotline || "",
        address: company.address || "",
      };

      // 3. Gán mốc tuổi NL/TE/EB cho tour
      tourDetail.tourAgeBands = companyFull?.tourAgeBands || { babyMaxAge: 3, childrenMaxAge: 11 };
    } else if (tourDetail.companyId) {
      // Fallback: lấy theo companyId của tour (phòng trường hợp dùng route cũ)
      const companyDoc = await Company.findById(tourDetail.companyId)
        .select("name slug logo hotline address tourAgeBands")
        .lean();
      if (companyDoc) {
        tourDetail.company = {
          _id: companyDoc._id,
          name: companyDoc.name,
          slug: companyDoc.slug,
          logo: companyDoc.logo || "",
          hotline: companyDoc.hotline || "",
          address: companyDoc.address || "",
        };
        tourDetail.tourAgeBands = companyDoc.tourAgeBands || { babyMaxAge: 3, childrenMaxAge: 11 };
      }
    }
    // Đảm bảo luôn có giá trị mặc định
    if (!tourDetail.tourAgeBands) {
      tourDetail.tourAgeBands = { babyMaxAge: 3, childrenMaxAge: 11 };
    }
  } catch (e) {
    console.error("tour.detail attach company error:", e);
  }

  // Breadcrumb
  const breadcrumb = [];

  if (tourDetail.category) {
    const categoryList = await categoryHelper.getCategoryParent(
      tourDetail.category
    );
    for (const item of categoryList) {
      breadcrumb.push(item);
    }
  }

  breadcrumb.push({
    id: tourDetailDoc.id, // virtual id
    name: tourDetail.name,
    avatar: tourDetail.avatar,
    slug: tourDetail.slug,
  });

  // Ngày khởi hành format
  // 4. Format ngày khởi hành cho tour
  if (tourDetail.departureDate) {
    tourDetail.departureDateFormat = moment(tourDetail.departureDate).format(
      "DD/MM/YYYY"
    );
  }

  // Format mảng departures (cặp ngày khởi hành - kết thúc) để view hiển thị
  if (Array.isArray(tourDetail.departures) && tourDetail.departures.length > 0) {
    const validDeps = tourDetail.departures.filter((d) => d && d.departureDate);

    tourDetail.departureDatesFormatted = validDeps.map((d) =>
      moment(d.departureDate).format("DD/MM/YYYY")
    );

    // Map date string -> { seatsTotal, seatsRemaining } để hiển thị số chỗ khi chọn ngày

    // 5. Gán số chỗ còn lại cho từng ngày khởi hành
    
    tourDetail.departureSeatsByDate = {};
    for (const d of validDeps) {
      const key = moment(d.departureDate).format("DD/MM/YYYY");
      tourDetail.departureSeatsByDate[key] = {
        seatsTotal: d.seatsTotal ?? 0,
        seatsRemaining: d.seatsRemaining ?? 0,
      };
    }

    // Nếu chưa có departureDateFormat thì lấy ngày đầu tiên
    if (
      (!tourDetail.departureDateFormat ||
        String(tourDetail.departureDateFormat).trim() === "") &&
      tourDetail.departureDatesFormatted.length > 0
    ) {
      tourDetail.departureDateFormat = tourDetail.departureDatesFormatted[0];
    }
  }

  // ====== ĐIỂM KHỞI HÀNH (departureCity) ======

  // 6. Gán tên điểm khởi hành cho tour
  if (tourDetail.departureCity) {
    try {
      const depCity = await City.findById(tourDetail.departureCity).lean();
      if (depCity) {
        tourDetail.departureCity = String(depCity._id);
        tourDetail.departureCityName = depCity.name;
      }
    } catch (e) {
      // ignore
    }
  }

  // ====== CHUẨN HOÁ LOCATIONS + CITYLIST ======
  let cityList = [];
  const normalizedLocations = [];
  const cityIdSet = new Set();

  if (Array.isArray(tourDetail.locations) && tourDetail.locations.length > 0) {
    tourDetail.locations.forEach((loc) => {
      if (!loc) return;

      // loc có thể là subdocument/POJO
      const cityIdRaw = loc.cityId || loc.city || loc._id || null;
      const cityIdStr = cityIdRaw ? String(cityIdRaw) : null;

      // spots: mảng hoặc string nhiều dòng
      let spotsArr = [];
      if (Array.isArray(loc.spots)) {
        spotsArr = loc.spots;
      } else if (typeof loc.spots === "string") {
        spotsArr = loc.spots
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean);
      }

      if (cityIdStr && mongoose.Types.ObjectId.isValid(cityIdStr)) {
        cityIdSet.add(cityIdStr);
      }

      normalizedLocations.push({
        cityId: cityIdStr,
        cityName: loc.cityName || loc.cityLabel || null,
        spots: spotsArr,
      });
    });

    const cityIds = Array.from(cityIdSet);
    if (cityIds.length > 0) {
      cityList = await City.find({ _id: { $in: cityIds } })
        .sort({ name: "asc" })
        .lean();

      const cityNameMap = {};
      cityList.forEach((c) => {
        cityNameMap[String(c._id)] = c.name;
      });

      normalizedLocations.forEach((loc) => {
        if (!loc.cityName && loc.cityId && cityNameMap[loc.cityId]) {
          loc.cityName = cityNameMap[loc.cityId];
        }
      });
    }
  }

  // Gán lại cho object tourDetail để view sử dụng
  tourDetail.locations = normalizedLocations;
  tourDetail.cityList = cityList;

  // ⬇️ PHẦN: Lấy khách sạn liên kết tour từ TourSegment (đã xác nhận)
  let tourHotels = [];   // Tab "Khách sạn" — danh sách KS
  let tourRoomOptions = []; // Form chọn phòng khi đặt tour
  let hotelAccommodationRequired = false; // Tour bắt buộc chọn phòng KS?
  try {
    const TourSegment = require("../../models/tour-segment.model");
    const Hotel = require("../../models/hotel.model");
    const Order = require("../../models/order.model"); // đếm phòng ở riêng
    const HotelBooking = require("../../models/hotel-booking.model"); // đếm phòng ở ghép

    // Tự heal trạng thái segment dựa vào link request mới nhất-per-hotel:
    // dữ liệu cũ từng bị đánh dấu "rejected" trước khi helper recompute được
    // áp có thể không được cập nhật sang "confirmed" dù vòng mới đã được
    // công ty chủ KS duyệt. Gọi helper cho mọi segment của tour trước khi
    // query để đảm bảo filter status dưới đây phản ánh đúng thực tế.
    try {
      const {
        _recomputeTourSegmentStatus,
      } = require("../../controllers/admin/hotel-link-request.controller");
      const staleSegs = await TourSegment.find({ tourId: tourDetail._id })
        .select("_id")
        .lean();
      await Promise.all(
        staleSegs.map((s) => _recomputeTourSegmentStatus(s._id))
      );
    } catch (healErr) {
      console.error("tour.detail heal tourSegment status error:", healErr);
    }

    // Trả ra dữ liệu Tour Segment đã được duyệt ở trang chi tiết tour
    const tourSegs = await TourSegment.find({
      tourId: tourDetail._id,
      status: { $in: ["confirmed", "pending_approval"] },
    }).lean();

    if (tourSegs.length > 0) {
      hotelAccommodationRequired = tourSegs.some((ts) =>
        (ts.segments || []).some((seg) =>
          (seg.hotels || []).some((h) =>
            (h.roomAllocations || []).some((ra) => ra.assignedRooms > 0)
          )
        )
      );
      const hotelIdSet = new Set();
      tourSegs.forEach((ts) => {
        (ts.segments || []).forEach((seg) => {
          (seg.hotels || []).forEach((h) => {
            if (h.hotelId) hotelIdSet.add(String(h.hotelId));
          });
        });
      });

      const hotelIds = Array.from(hotelIdSet);
      if (hotelIds.length > 0) {
        // Lấy ra các thông tin khách sạn ở model Hotel, để trả ra tab Khách sạn
        const hotelDocs = await Hotel.find({ _id: { $in: hotelIds }, deleted: false })
          .select("_id name avatar images address starRating basePrice ratingOverall currency rooms roomTypes ageBands companyId")
          .lean();
        const hotelsMap = {};
        hotelDocs.forEach((h) => { hotelsMap[String(h._id)] = h; });

        // ── Chặn khách sạn thuộc công ty khác nhưng chưa được duyệt ──
        // (Tour chỉ được phép show KS cross-company khi HotelLinkRequest đã "approved" / "partially_approved")
        const HotelLinkRequest = require("../../models/hotel-link-request.model");
        const tourSegIds = tourSegs.map((ts) => ts._id);
        const linkReqs = tourSegIds.length
          ? await HotelLinkRequest.find({ tourSegmentId: { $in: tourSegIds } })
              .select("tourSegmentId hotelId status")
              .lean()
          : [];
        // Key: tourSegmentId|hotelId → status tốt nhất (approved > partially_approved > rejected/...)
        const linkStatusMap = {};
        const rank = { approved: 3, partially_approved: 2, pending: 1 };
        for (const r of linkReqs) {
          const k = String(r.tourSegmentId) + "|" + String(r.hotelId);
          const cur = linkStatusMap[k];
          if (!cur || (rank[r.status] || 0) > (rank[cur] || 0)) {
            linkStatusMap[k] = r.status;
          }
        }
        const isHotelApprovedForSeg = (tsId, hotel) => {
          // Cùng công ty với tour → luôn hiển thị
          if (hotel.companyId && String(hotel.companyId) === String(tourDetail.companyId)) {
            return true;
          }
          const k = String(tsId) + "|" + String(hotel._id);
          const st = linkStatusMap[k];
          return st === "approved" || st === "partially_approved";
        };

        const seen = new Set();
        tourSegs.forEach((ts) => {
          (ts.segments || []).forEach((seg) => {
            (seg.hotels || []).forEach((h) => {
              const hid = String(h.hotelId);
              const hotel = hotelsMap[hid];
              if (!hotel) return;
              if (!isHotelApprovedForSeg(ts._id, hotel)) return;
              const key = hid + "|" + (seg.fromDate ? seg.fromDate.toISOString() : "") + "|" + (seg.toDate ? seg.toDate.toISOString() : "");
              if (seen.has(key)) return;
              seen.add(key);

              const fromStr = seg.fromDate ? moment(seg.fromDate).format("DD/MM/YYYY") : "";
              const toStr = seg.toDate ? moment(seg.toDate).format("DD/MM/YYYY") : "";
              const note = fromStr && toStr ? fromStr + " → " + toStr : "";

              tourHotels.push({
                _id: hotel._id,
                name: hotel.name,
                avatar: hotel.avatar || (hotel.images && hotel.images[0]) || "",
                address: hotel.address || "",
                starRating: hotel.starRating || 0,
                basePrice: hotel.basePrice || 0,
                ratingOverall: hotel.ratingOverall || 0,
                currency: hotel.currency || "VND",
                note: note,
              });
            });
          });
        });

        // Tính room options cho từng segment/hotel/roomAllocation
        for (const ts of tourSegs) {
          for (const seg of (ts.segments || [])) {
            const checkIn = new Date(seg.fromDate);
            const checkOut = new Date(seg.toDate);
            const fromStr = seg.fromDate ? moment(seg.fromDate).format("DD/MM/YYYY") : "";
            const toStr = seg.toDate ? moment(seg.toDate).format("DD/MM/YYYY") : "";

            for (const hotelEntry of (seg.hotels || [])) {
              const hotel = hotelsMap[String(hotelEntry.hotelId)];
              if (!hotel) continue;
              if (!isHotelApprovedForSeg(ts._id, hotel)) continue;
              if (!hotelEntry.roomAllocations || hotelEntry.roomAllocations.length === 0) continue;

              // Đếm phòng đã được khách khác giữ chỗ / thanh toán theo
              // Order — không dùng HotelBooking [Tour Booking] vì các bản ghi
              // này có TTL 15 phút và không được cập nhật khi đơn paid, dẫn
              // đến sau 15 phút phòng "trống ảo" trong khi đơn vẫn còn hiệu lực.

              // Nói chung là lấy các đơn tour có chọn phòng KS trong segment này
              const conflictOrders = await Order.find({
                deleted: { $ne: true },
                status: { $ne: "cancel" },
                $or: [
                  // Đơn ở riêng
                  {
                    "items.roomSelections.tourSegmentId": String(ts._id),
                    "items.roomSelections.hotelId": String(hotelEntry.hotelId),
                  },
                  // Đơn ở ghép
                  {
                    "items.sharedRoomRequest.tourSegmentId": String(ts._id),
                    "items.sharedRoomRequest.hotelAllocations.hotelId": String(
                      hotelEntry.hotelId
                    ),
                  },
                ],
              })
                .select("paymentStatus isTemporaryHold holdExpiresAt items")
                .lean();

              const _now = new Date();
              const _segFromStr = seg.fromDate
                ? moment(seg.fromDate).format("YYYY-MM-DD")
                : "";
              const _segToStr = seg.toDate
                ? moment(seg.toDate).format("YYYY-MM-DD")
                : "";
              const bookedByRoomType = {};

              // Lọc đơn còn chiếm phòng
              // Chỉ những đơn paid hoặc đang giữ chỗ tạm (isTemporaryHold + chưa hết holdExpiresAt)
              for (const ord of conflictOrders) {
                const isPaid = ord.paymentStatus === "paid";
                const isActiveHold =
                  ord.isTemporaryHold && // Đang giữ chỗ tạm (isTemporaryHold + chưa hết holdExpiresAt)
                  (!ord.holdExpiresAt ||
                    new Date(ord.holdExpiresAt) > _now);
                if (!isPaid && !isActiveHold) continue;

                // Sau khi qua lọc, mới cộng phòng riêng cho tour hiện tại
                for (const it of ord.items || []) { // duyệt từng tour trong đơn
                  for (const rs of it.roomSelections || []) { // duyệt từng phòng trong tour
                    if (
                      String(rs.tourSegmentId) !== String(ts._id) ||
                      String(rs.hotelId) !== String(hotelEntry.hotelId)
                    ) {
                      continue;
                    }
                    const rsFrom = rs.fromDate
                      ? String(rs.fromDate).slice(0, 10)
                      : "";
                    const rsTo = rs.toDate
                      ? String(rs.toDate).slice(0, 10)
                      : "";
                    if (rsFrom !== _segFromStr || rsTo !== _segToStr) continue;
                    const rtKey = String(rs.roomTypeId); // id loại phòng
                    bookedByRoomType[rtKey] = // đếm số phòng đã được chọn
                      (bookedByRoomType[rtKey] || 0) +
                      Number(rs.selectedRooms || 0);
                  }
                }
              }

              // Đếm phòng vật lý đã giữ cho khách "ở ghép": dùng
              // tourSeg.assignments làm nguồn sự thật (nhiều đơn shared có thể
              // dùng chung 1 phòng vật lý — cross-order). Cần lọc theo segment
              // hiện tại bằng cách map qua HotelBooking (TH) tương ứng để lấy
              // checkIn/checkOut + roomTypeId, rồi dedupe holdBookingId.

              // Đếm phòng shared

              // 1. Lọc assignments shared của tour segment hiện tại
              const _segAssignsShared = (ts.assignments || []).filter(
                (a) =>
                  String(a.hotelId) === String(hotelEntry.hotelId) &&
                  a.holdBookingId &&
                  a.accommodationMode === "shared"
              );
              if (_segAssignsShared.length > 0) { // Chỉ chạy nếu có khách ở ghép
                // Mỗi assignment trỏ tới một phòng vật lý qua holdBookingId.
                // Nhiều khách cùng phòng → nhiều assignment, cùng một holdBookingId.
                // Set → mỗi booking chỉ query một lần (tránh trùng, query gọn).
                // Ví dụ: An và Bình chung phòng 101 → 2 assignment, 1 holdBookingId → _holdIds = ["HB-101"].

                // 2. Gom các holdBookingId
                const _holdIds = [
                  ...new Set(_segAssignsShared.map((a) => String(a.holdBookingId))),
                ];

                // 3. Query HotelBooking
                // Assignment chỉ nói: “khách X nằm trên booking Y”.
                // HotelBooking mới nói: loại phòng gì, check-in/out khi nào.
                const _holdRows = await HotelBooking.find({
                  _id: { $in: _holdIds },
                  status: { $ne: "cancelled" },
                  "hotel.hotelId": String(hotelEntry.hotelId),
                })
                  .select("_id roomTypeId checkIn checkOut")
                  .lean();
                const _holdMap = {};
                for (const hb of _holdRows) {
                  const ci = hb.checkIn ? moment(hb.checkIn).format("YYYY-MM-DD") : "";
                  const co = hb.checkOut ? moment(hb.checkOut).format("YYYY-MM-DD") : "";
                  if (ci !== _segFromStr || co !== _segToStr) continue;
                  _holdMap[String(hb._id)] = String(hb.roomTypeId || "");
                }

                // 4. Dedupe — đếm phòng, không đếm người
                const _holdsPerRt = {};
                for (const a of _segAssignsShared) {
                  const rtId = _holdMap[String(a.holdBookingId)];
                  if (!rtId) continue;
                  if (!_holdsPerRt[rtId]) _holdsPerRt[rtId] = new Set();
                  _holdsPerRt[rtId].add(String(a.holdBookingId)); // Nhóm theo loại phòng, mỗi loại dùng Set chứa holdBookingId (mỗi ID = 1 phòng vật lý).
                  // _holdsPerRt = {
                  //   "deluxe": Set { "HB-101", "HB-102" }   // size = 2
                  // }
                }
                for (const rtId of Object.keys(_holdsPerRt)) {
                  bookedByRoomType[rtId] =
                    (bookedByRoomType[rtId] || 0) + _holdsPerRt[rtId].size; // bookedByRoomType là từ Order
                    // Tức là, đoạn này cộng cả Order và HotelBooking lại
                }
              }

              const roomTypes = [];
              for (const ra of hotelEntry.roomAllocations) {
                if (!ra.assignedRooms || ra.assignedRooms <= 0) continue;

                const clientBookedCount =
                  bookedByRoomType[String(ra.roomTypeId)] || 0;

                const availableForClient = Math.max(0, ra.assignedRooms - clientBookedCount);
                // Thì đoạn này, sẽ trừ cả Order và HotelBooking lại

                if (availableForClient > 0) { // Chỉ hiển thị phòng còn trống thực tế
                  const matchedRoomType = (hotel.roomTypes || []).find(
                    (rt) => String(rt._id) === String(ra.roomTypeId)
                  );
                  const pricePerNight = matchedRoomType ? (matchedRoomType.basePrice || 0) : 0;

                  // Thêm vào form chọn phòng khi đặt tour
                  roomTypes.push({
                    roomTypeId: String(ra.roomTypeId),
                    roomTypeName: ra.roomTypeName || "",
                    baseOccupancy: ra.baseOccupancy || 2,
                    availableRooms: availableForClient,
                    maxCapacity: availableForClient * (ra.baseOccupancy || 2),
                    pricePerNight,
                  });
                }
              }

              if (roomTypes.length > 0) {
                const hotelAgeBands = (hotel.ageBands || []).map((ab) => ({
                  bandName: ab.bandName || "",
                  minAge: typeof ab.minAge === "number" ? ab.minAge : 0,
                  maxAge: ab.maxAge === null || ab.maxAge === undefined ? null : ab.maxAge,
                  countInOccupancy: !!ab.countInOccupancy,
                  occupancyWeight: ab.countInOccupancy ? (ab.occupancyWeight ?? 1) : 0,
                }));

                // Thêm vào form chọn phòng khi đặt tour
                tourRoomOptions.push({
                  segmentLabel: fromStr && toStr ? fromStr + " → " + toStr : "",
                  hotelId: String(hotel._id),
                  hotelName: hotel.name || "",
                  fromDate: seg.fromDate ? moment(seg.fromDate).format("YYYY-MM-DD") : "",
                  toDate: seg.toDate ? moment(seg.toDate).format("YYYY-MM-DD") : "",
                  tourSegmentId: String(ts._id),
                  roomTypes: roomTypes,
                  ageBands: hotelAgeBands,
                });
              }
            }
          }
        }
      }
    }
  } catch (e) {
    console.error("tour.detail fetch tourHotels error:", e);
  }

  // Nhóm tourRoomOptions theo khung thời gian lưu trú
  const _segMap = {};
  for (const opt of tourRoomOptions) {
    const key = opt.fromDate + "|" + opt.toDate;
    if (!_segMap[key]) {
      _segMap[key] = {
        segmentLabel: opt.segmentLabel,
        fromDate: opt.fromDate,
        toDate: opt.toDate,
        hotels: [],
      };
    }
    _segMap[key].hotels.push({
      hotelId: opt.hotelId,
      hotelName: opt.hotelName,
      tourSegmentId: opt.tourSegmentId,
      ageBands: opt.ageBands,
      roomTypes: opt.roomTypes,
    });
  }
  const tourRoomSegments = Object.values(_segMap);

  res.render("client/pages/tour-detail", {
    pageTitle: tourDetail.name,
    breadcrumb: breadcrumb,
    tourDetail: tourDetail,
    tourHotels: tourHotels,
    tourRoomOptions: tourRoomOptions,
    tourRoomSegments: tourRoomSegments,
    hotelAccommodationRequired,
  });
};

/**
 * POST — Kiểm tra khả thi ở ghép (NL + TE/EB) trước khi đặt tour.
 * Body: { passengers: [...], frames: [{ tourSegmentId, fromDate, toDate, candidateHotels }] }
 */
module.exports.checkSharedFeasibility = async (req, res) => {
  try {
    const { evaluateSharedFeasibilityV2Multi } = require("../../helpers/tour-shared-room.helper");

    const passengers = Array.isArray(req.body.passengers)
      ? req.body.passengers
      : [];
    const frames = Array.isArray(req.body.frames) ? req.body.frames : [];

    if (frames.length === 0) {
      return res.json({
        code: "success",
        ok: true,
        message: "Không có khung lưu trú cần kiểm tra.",
      });
    }

    const failures = [];
    for (const frame of frames) {
      const tourSegmentId = frame.tourSegmentId;
      const fromDate = frame.fromDate;
      const toDate = frame.toDate;
      const candidateHotels = Array.isArray(frame.candidateHotels)
        ? frame.candidateHotels
        : [];

      if (!tourSegmentId || !fromDate || !toDate) continue;

      const fea = await evaluateSharedFeasibilityV2Multi({
        tourSegmentId: String(tourSegmentId),
        fromDate,
        toDate,
        hotels: candidateHotels.map((h) => ({
          hotelId: String(h.hotelId || ""),
          hotelName: h.hotelName || "",
        })),
        passengers,
        excludeOrderId: null,
      });

      if (!fea.ok) {
        failures.push({
          tourSegmentId: String(tourSegmentId),
          fromDate,
          toDate,
          reason: fea.reason || "cannot_fit",
          message: fea.message || "Phương án ở ghép không khả thi.",
        });
      }
    }

    if (failures.length > 0) {
      return res.json({
        code: "error",
        ok: false,
        reason: failures[0].reason,
        message: failures[0].message,
        failures,
      });
    }

    return res.json({ code: "success", ok: true });
  } catch (err) {
    console.error("tour.checkSharedFeasibility error:", err);
    return res.json({
      code: "error",
      ok: false,
      message: "Không thể kiểm tra phương án ở ghép. Vui lòng thử lại.",
    });
  }
};

// ========= DANH SÁCH TẤT CẢ TOUR ĐANG KHUYẾN MÃI =========
// /tour/discount?page=1&sort=price_asc|price_desc|rating
module.exports.listDiscount = async (req, res) => {
  try {
    const breadcrumb = [
      { name: "Trang chủ", slug: "/" },
      { name: "Tour đang khuyến mãi", slug: "/tour/discount" },
    ];

    const sort = req.query.sort || "default";
    const basePath = "/tour/discount";
    const sortHrefs = {
      priceAsc: `${basePath}?sort=price_asc`,
      priceDesc: `${basePath}?sort=price_desc`,
      rating: `${basePath}?sort=rating`,
    };

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = 12;
    const skip = (page - 1) * limit;

    const nowMoment = moment();
    const now = nowMoment.toDate();

    const filter = {
      deleted: false,
      status: "active",
      discountFrom: { $lte: now },
      discountTo: { $gte: now },
      $or: [
        { discountPercent: { $gt: 0 } },
        { priceAdult: { $gt: 0 } },
        { priceChildren: { $gt: 0 } },
        { priceBaby: { $gt: 0 } },
      ],
    };

    // Cho phép lọc thêm theo tags nếu có query.tags (dùng chung box-filter)
    const { tags } = req.query;
    if (tags) {
      let tagArray = Array.isArray(tags) ? tags : [tags];
      tagArray = tagArray.filter((t) => t && typeof t === "string");
      if (tagArray.length > 0) {
        filter.tags = { $in: tagArray };
      }
    }

    let sortMongo = { discountTo: 1, discountFrom: -1, updatedAt: -1 };

    if (sort === "price_asc") {
      sortMongo = { priceNewAdult: 1, priceAdult: 1, discountTo: 1 };
    } else if (sort === "price_desc") {
      sortMongo = { priceNewAdult: -1, priceAdult: -1, discountTo: 1 };
    }

    const [totalRecord, tourListRaw] = await Promise.all([
      Tour.countDocuments(filter),
      Tour.find(filter).sort(sortMongo).skip(skip).limit(limit).lean(),
    ]);

    const totalPage = Math.max(Math.ceil(totalRecord / limit), 1);

    const tourList = tourListRaw.map((t) => {
      const clone = { ...t };

      const oldP = Number(clone.priceAdult || 0);
      const newP = Number(clone.priceNewAdult || 0);

      clone.discount =
        clone.discountPercent && clone.discountPercent > 0
          ? clone.discountPercent
          : oldP > 0
          ? Math.floor(((oldP - newP) / oldP) * 100)
          : 0;

      if (clone.departureDate) {
        clone.departureDateFormat = moment(clone.departureDate).format(
          "DD/MM/YYYY"
        );
      }

      // Danh sách ghế theo từng lịch khởi hành
      if (Array.isArray(clone.departures) && clone.departures.length > 0) {
        clone.departuresWithSeats = clone.departures
          .filter((d) => d && d.departureDate)
          .map((d) => ({
            dateFormatted: moment(d.departureDate).format("DD/MM/YYYY"),
            seatsTotal: d.seatsTotal ?? 0,
            seatsRemaining: d.seatsRemaining ?? 0,
          }));
      } else {
        clone.departuresWithSeats = [];
      }

      if (clone.discountFrom) {
        clone.discountFromFormat = moment(clone.discountFrom).format(
          "DD/MM/YYYY"
        );
      }
      if (clone.discountTo) {
        clone.discountToFormat = moment(clone.discountTo).format("DD/MM/YYYY");
        clone.discountExpireISO = moment(clone.discountTo)
          .endOf("day")
          .toISOString();
      }

      clone.seatsRemaining = Number(clone.seatsRemaining) || 0;

      return clone;
    });

    const rawIds = tourList.map((t) => t.companyId);
    const companyIds = [
      ...new Set(
        rawIds.filter((id) => id && mongoose.Types.ObjectId.isValid(id))
      ),
    ];

    let companyById = {};
    if (companyIds.length) {
      const companies = await Company.find({ _id: { $in: companyIds } })
        .select("name slug logo hotline address website status")
        .lean();
      companyById = Object.fromEntries(
        companies.map((c) => [String(c._id), c])
      );
    }

    for (const t of tourList) {
      const key = mongoose.Types.ObjectId.isValid(t.companyId)
        ? String(t.companyId)
        : null;
      t.company = key ? companyById[key] || null : null;
    }

    await attachRatings(tourList);

    if (sort === "rating") {
      tourList.sort(
        (a, b) => (Number(b.ratingAvg) || 0) - (Number(a.ratingAvg) || 0)
      );
    }

    const pagination = {
      page,
      limit,
      skip,
      totalRecord,
      totalPage,
    };

    return res.render("client/pages/tour-discount-list", {
      pageTitle: "Tour đang khuyến mãi",
      breadcrumb,
      tourList,
      pagination,
      sort,
      sortHrefs,
    });
  } catch (err) {
    console.error("tour.listDiscount (client) error:", err);
    const sort = req.query.sort || "default";
    const basePath = "/tour/discount";
    const sortHrefs = {
      priceAsc: `${basePath}?sort=price_asc`,
      priceDesc: `${basePath}?sort=price_desc`,
      rating: `${basePath}?sort=rating`,
    };

    return res.render("client/pages/tour-discount-list", {
      pageTitle: "Tour đang khuyến mãi",
      breadcrumb: [
        { name: "Trang chủ", slug: "/" },
        { name: "Tour đang khuyến mãi", slug: "/tour/discount" },
      ],
      tourList: [],
      pagination: {
        page: 1,
        limit: 12,
        skip: 0,
        totalRecord: 0,
        totalPage: 1,
      },
      sort,
      sortHrefs,
    });
  }
};

// ========= SO SÁNH TOUR =========
// GET /tour/compare?ids=id1,id2,id3
module.exports.compare = async (req, res) => {
  try {
    const { ids } = req.query;
    
    if (!ids) {
      return res.render("client/pages/tour-compare", {
        pageTitle: "So sánh tour du lịch",
        tours: [],
      });
    }

    // Parse tour IDs từ query string
    const tourIds = String(ids)
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id && mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));

    if (tourIds.length === 0) {
      return res.render("client/pages/tour-compare", {
        pageTitle: "So sánh tour du lịch",
        tours: [],
      });
    }

    // Lấy thông tin tour từ database
    const tours = await Tour.find({
      _id: { $in: tourIds },
      deleted: false,
      status: "active",
    })
      .populate("companyId", "name slug logo")
      .populate("departureCity", "name")
      .populate("locations.city", "name")
      .lean();

    // Sắp xếp theo thứ tự trong query
    const tourMap = new Map(tours.map((t) => [String(t._id), t]));
    const orderedTours = tourIds
      .map((id) => tourMap.get(String(id)))
      .filter(Boolean);

    // Gắn rating cho tours
    await attachRatings(orderedTours);

    // Gắn tên điểm khởi hành và normalize locations
    const cityIdSet = new Set();
    
    // Bước 1: Normalize locations và thu thập city IDs
    orderedTours.forEach((tour) => {
      if (tour.departureCity && tour.departureCity.name) {
        tour.departureCityName = tour.departureCity.name;
      }

      // Normalize locations giống như tour detail
      if (Array.isArray(tour.locations) && tour.locations.length > 0) {
        const normalizedLocations = [];
        tour.locations.forEach((loc) => {
          if (!loc) return;

          const cityIdRaw = loc.city?._id || loc.city || loc.cityId || null;
          const cityIdStr = cityIdRaw ? String(cityIdRaw) : null;

          // spots: mảng hoặc string nhiều dòng
          let spotsArr = [];
          if (Array.isArray(loc.spots)) {
            spotsArr = loc.spots;
          } else if (typeof loc.spots === "string") {
            spotsArr = loc.spots
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean);
          }

          if (cityIdStr && mongoose.Types.ObjectId.isValid(cityIdStr)) {
            cityIdSet.add(cityIdStr);
          }

          normalizedLocations.push({
            cityId: cityIdStr,
            cityName: loc.city?.name || loc.cityName || loc.cityLabel || null,
            spots: spotsArr,
          });
        });

        tour.locations = normalizedLocations;
      }
    });

    // Bước 2: Lấy tên city từ database nếu chưa có
    if (cityIdSet.size > 0) {
      const cityIds = Array.from(cityIdSet)
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));
      
      if (cityIds.length > 0) {
        const cityList = await City.find({ _id: { $in: cityIds } })
          .select("name")
          .lean();

        const cityNameMap = {};
        cityList.forEach((c) => {
          cityNameMap[String(c._id)] = c.name;
        });

        // Cập nhật cityName cho các location chưa có
        orderedTours.forEach((tour) => {
          if (tour.locations && Array.isArray(tour.locations)) {
            tour.locations.forEach((loc) => {
              if (!loc.cityName && loc.cityId && cityNameMap[loc.cityId]) {
                loc.cityName = cityNameMap[loc.cityId];
              }
            });
          }
        });
      }
    }

    // Format giá và thông tin khác
    orderedTours.forEach((tour) => {
      tour.priceAdultFormatted = Number(tour.priceAdult || 0).toLocaleString("vi-VN");
      tour.priceNewAdultFormatted = Number(tour.priceNewAdult || tour.priceAdult || 0).toLocaleString("vi-VN");
      tour.discount = tour.priceAdult && tour.priceNewAdult && tour.priceAdult > tour.priceNewAdult
        ? Math.round(((tour.priceAdult - tour.priceNewAdult) / tour.priceAdult) * 100)
        : 0;
      if (tour.departureDate) {
        tour.departureDateFormat = moment(tour.departureDate).format("DD/MM/YYYY");
      }

      // Tính departuresWithSeats để hiển thị số chỗ theo từng ngày khởi hành
      tour.departuresWithSeats =
        Array.isArray(tour.departures) && tour.departures.length > 0
          ? tour.departures
              .filter((d) => d && d.departureDate)
              .map((d) => ({
                dateFormatted: moment(d.departureDate).format("DD/MM/YYYY"),
                seatsTotal: d.seatsTotal ?? 0,
                seatsRemaining: d.seatsRemaining ?? 0,
              }))
          : [];
    });

    return res.render("client/pages/tour-compare", {
      pageTitle: "So sánh tour du lịch",
      tours: orderedTours,
    });
  } catch (err) {
    console.error("tour.compare error:", err);
    return res
      .status(500)
      .render("client/pages/500", { pageTitle: "Lỗi hệ thống" });
  }
};
