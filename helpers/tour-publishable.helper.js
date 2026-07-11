// helpers/tour-publishable.helper.js
//
// Kiểm tra một tour đã đủ điều kiện hiển thị (status="active") ở client hay chưa.
//
// Điều kiện:
//   1. Tour phải có ít nhất 1 TourSegment (departure) khớp companyId, status != "cancelled".
//   2. Mỗi TourSegment phải có segments[] không rỗng và mỗi segment[].hotels[] phải có
//      ít nhất 1 mục với roomAllocations.length > 0.
//   3. Mọi HotelLinkRequest có tourSegmentId thuộc tập segment trên phải có
//      status ∈ {"approved", "partially_approved"}.
//
// Trả về { ok: boolean, reasons: string[] }.
// reasons[] là danh sách lý do (Việt ngữ, ngắn gọn) cho admin biết phải làm gì.

const moment = require("moment");

const TourSegment = require("../models/tour-segment.model");
const HotelLinkRequest = require("../models/hotel-link-request.model");

const fmtDate = (d) => (d ? moment(d).format("DD-MM-YYYY") : "");

/**
 * Giữ lại, với mỗi (tourSegmentId, hotelId), duy nhất link request mới nhất
 * (theo updatedAt, tie-break createdAt). Các bản cũ hơn đã bị thay thế bởi
 * cấu hình sau, không còn ý nghĩa nghiệp vụ nên được loại khỏi kiểm tra.
 */
function keepLatestPerSegmentHotel(list) {
  const keyOf = (r) => `${String(r.tourSegmentId)}|${String(r.hotelId)}`;
  const latest = new Map();
  for (const r of list) {
    const k = keyOf(r);
    const ts = new Date(r.updatedAt || r.createdAt || 0).getTime();
    const cur = latest.get(k);
    if (!cur || ts > cur.__ts) {
      latest.set(k, { ...r, __ts: ts });
    }
  }
  return [...latest.values()].map(({ __ts, ...rest }) => rest);
}

/**
 * @param {string|ObjectId} tourId
 * @param {string|ObjectId} companyId
 * @returns {Promise<{ ok: boolean, reasons: string[] }>}
 */
module.exports.canPublishTour = async (tourId, companyId) => {
  const reasons = [];

  if (!tourId || !companyId) {
    return { ok: false, reasons: ["Thiếu thông tin tour hoặc công ty."] };
  }

  // 1) Lấy các departure (TourSegment) còn hiệu lực
  const tourSegs = await TourSegment.find({
    tourId,
    companyId,
    status: { $ne: "cancelled" },
  })
    .select("_id departureDate segments")
    .lean();

  if (!tourSegs.length) {
    reasons.push("Tour chưa có lịch khởi hành nào được cấu hình.");
    return { ok: false, reasons };
  }

  // 2) Mỗi departure phải có segments[] và mỗi segment có ≥ 1 hotel với roomAllocations
  for (const ts of tourSegs) {
    const depLabel = fmtDate(ts.departureDate);
    const segs = Array.isArray(ts.segments) ? ts.segments : [];

    if (!segs.length) {
      reasons.push(
        `Lịch khởi hành ${depLabel} chưa có khung thời gian khách sạn nào.`
      );
      continue;
    }

    segs.forEach((seg, idx) => {
      const segLabel = `${fmtDate(seg.fromDate)} → ${fmtDate(seg.toDate)}`;
      const hotels = Array.isArray(seg.hotels) ? seg.hotels : [];
      const hasUsableHotel = hotels.some(
        (h) => Array.isArray(h.roomAllocations) && h.roomAllocations.length > 0
      );
      if (!hasUsableHotel) {
        reasons.push(
          `Lịch khởi hành ${depLabel} – khung ${segLabel} chưa gán khách sạn / phân bổ phòng.`
        );
      }
    });
  }

  // 3) Tất cả HotelLinkRequest cross-company phải approved
  const segIds = tourSegs.map((ts) => ts._id);
  const rawLinkReqs = segIds.length
    ? await HotelLinkRequest.find({ tourSegmentId: { $in: segIds } })
        .select(
          "status hotelId hotelName tourSegmentId departureDate createdAt updatedAt"
        )
        .lean()
    : [];

  // Chỉ xét bản mới nhất cho mỗi (tourSegment, hotel); các bản cũ (đã bị thay
  // thế / auto-đóng khi admin huỷ cấu hình rồi tạo lại) không còn ý nghĩa.
  const linkReqs = keepLatestPerSegmentHotel(rawLinkReqs);

  const okStatuses = new Set(["approved", "partially_approved"]);
  const pendingCount = linkReqs.filter((r) => r.status === "pending").length;
  const rejectedCount = linkReqs.filter((r) => r.status === "rejected").length;
  const cancelledCount = linkReqs.filter(
    (r) => r.status === "cancelled"
  ).length;
  const badStatusCount = linkReqs.filter((r) => !okStatuses.has(r.status))
    .length;

  if (pendingCount > 0) {
    reasons.push(
      `Còn ${pendingCount} yêu cầu liên kết khách sạn đang chờ công ty đối tác duyệt.`
    );
  }
  if (rejectedCount > 0) {
    reasons.push(
      `Có ${rejectedCount} yêu cầu liên kết khách sạn đã bị từ chối – cần xử lý lại.`
    );
  }
  if (cancelledCount > 0) {
    reasons.push(
      `Có ${cancelledCount} yêu cầu liên kết khách sạn đã bị huỷ – cần xử lý lại.`
    );
  }

  // Phòng trường hợp xuất hiện status mới ngoài enum đã liệt kê
  const otherBad =
    badStatusCount - pendingCount - rejectedCount - cancelledCount;
  if (otherBad > 0) {
    reasons.push(
      `Có ${otherBad} yêu cầu liên kết khách sạn ở trạng thái không hợp lệ.`
    );
  }

  return { ok: reasons.length === 0, reasons };
};

/**
 * Bulk version: kiểm tra nhiều tour cùng lúc, trả về Map<tourId, {ok, reasons}>.
 * Hữu ích cho trang danh sách tour để pre-compute publishableMap.
 *
 * @param {Array<string|ObjectId>} tourIds
 * @param {string|ObjectId} companyId
 * @returns {Promise<Object<string, { ok: boolean, reasons: string[] }>>}
 */
module.exports.canPublishToursBulk = async (tourIds, companyId) => {
  const result = {};
  if (!Array.isArray(tourIds) || tourIds.length === 0) return result;

  // Lấy tất cả TourSegment liên quan trong 1 query
  const tourSegs = await TourSegment.find({
    tourId: { $in: tourIds },
    companyId,
    status: { $ne: "cancelled" },
  })
    .select("_id tourId departureDate segments")
    .lean();

  // Group segments theo tourId
  const segsByTour = {};
  const allSegIds = [];
  for (const ts of tourSegs) {
    const tid = String(ts.tourId);
    if (!segsByTour[tid]) segsByTour[tid] = [];
    segsByTour[tid].push(ts);
    allSegIds.push(ts._id);
  }

  // Lấy tất cả link request liên quan trong 1 query
  const rawLinkReqs = allSegIds.length
    ? await HotelLinkRequest.find({ tourSegmentId: { $in: allSegIds } })
        .select("status tourSegmentId hotelId createdAt updatedAt")
        .lean()
    : [];

  // Chỉ giữ bản mới nhất cho mỗi (tourSegmentId, hotelId)
  const linkReqs = keepLatestPerSegmentHotel(rawLinkReqs);

  // Group link requests theo tourSegmentId, sau đó map qua tourId
  const reqsBySegId = {};
  for (const r of linkReqs) {
    const k = String(r.tourSegmentId);
    if (!reqsBySegId[k]) reqsBySegId[k] = [];
    reqsBySegId[k].push(r);
  }

  const okStatuses = new Set(["approved", "partially_approved"]);

  for (const tid of tourIds.map(String)) {
    const reasons = [];
    const segs = segsByTour[tid] || [];

    if (!segs.length) {
      reasons.push("Tour chưa có lịch khởi hành nào được cấu hình.");
      result[tid] = { ok: false, reasons };
      continue;
    }

    for (const ts of segs) {
      const depLabel = fmtDate(ts.departureDate);
      const innerSegs = Array.isArray(ts.segments) ? ts.segments : [];

      if (!innerSegs.length) {
        reasons.push(
          `Lịch khởi hành ${depLabel} chưa có khung thời gian khách sạn nào.`
        );
        continue;
      }

      innerSegs.forEach((seg) => {
        const segLabel = `${fmtDate(seg.fromDate)} → ${fmtDate(seg.toDate)}`;
        const hotels = Array.isArray(seg.hotels) ? seg.hotels : [];
        const hasUsableHotel = hotels.some(
          (h) =>
            Array.isArray(h.roomAllocations) && h.roomAllocations.length > 0
        );
        if (!hasUsableHotel) {
          reasons.push(
            `Lịch khởi hành ${depLabel} – khung ${segLabel} chưa gán khách sạn / phân bổ phòng.`
          );
        }
      });
    }

    // Gom link request của tất cả segment thuộc tour này
    const tourReqs = [];
    for (const ts of segs) {
      const k = String(ts._id);
      if (reqsBySegId[k]) tourReqs.push(...reqsBySegId[k]);
    }

    const pendingCount = tourReqs.filter((r) => r.status === "pending").length;
    const rejectedCount = tourReqs.filter(
      (r) => r.status === "rejected"
    ).length;
    const cancelledCount = tourReqs.filter(
      (r) => r.status === "cancelled"
    ).length;

    if (pendingCount > 0) {
      reasons.push(
        `Còn ${pendingCount} yêu cầu liên kết khách sạn đang chờ duyệt.`
      );
    }
    if (rejectedCount > 0) {
      reasons.push(
        `Có ${rejectedCount} yêu cầu liên kết khách sạn đã bị từ chối.`
      );
    }
    if (cancelledCount > 0) {
      reasons.push(
        `Có ${cancelledCount} yêu cầu liên kết khách sạn đã bị huỷ.`
      );
    }

    result[tid] = { ok: reasons.length === 0, reasons };
  }

  return result;
};
