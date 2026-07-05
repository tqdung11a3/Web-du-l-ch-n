// helpers/tour-shared-room.helper.js
//
// Tập hợp các helper cho luồng "Ở ghép" tour:
//   - aggregateSharedDemand: cộng dồn (males, females) từ tất cả Order khác
//     trong cùng (tourSegmentId, hotelId, fromDate, toDate) đang còn hiệu lực
//     (paid hoặc hold-active).
//   - resolveRoomQuotaForSegmentHotel: lấy danh sách phòng thực có (theo loại)
//     mà admin đã cấu hình cho cặp (segment, hotel) trong khung thời gian.
//   - evaluateSharedFeasibility: ráp 2 thứ trên + canAllocateGenderRooms.

const Order = require("../models/order.model");
const TourSegment = require("../models/tour-segment.model");
const Hotel = require("../models/hotel.model");
const {
  canAllocateGenderRooms,
  canAllocateAtomicGroups,
  canAllocateAtomicGroupsAcrossHotels,
  assignAtomsToPhysicalRooms,
} = require("./shared-room-allocation.helper");
const HotelBooking = require("../models/hotel-booking.model");
const {
  buildAtomsFromPassengers,
  reweightAtomsForAgeBands,
  synthesizeLegacyAtoms,
  validateAtomsFitSharedRooms,
  SHARED_INSUFFICIENT_ADULTS_MESSAGE,
} = require("./passenger-atom.helper");

/**
 * Mỗi atom đoàn hiện tại (có TE/EB) phải nằm trọn trong 1 phòng tại ít nhất
 * một khách sạn ứng viên (multi-hotel). Trả về lỗi đầu tiên nếu không.
 */
function _validateCurrentAtomsAcrossHotels(currentAtoms, hotelsResolved) {
  for (const atom of currentAtoms || []) {
    const members = Array.isArray(atom.members) ? atom.members : [];
    const hasDependents = members.some(
      (m) => m.type === "child" || m.type === "baby"
    );
    if (!hasDependents) continue;

    let fitsSomewhere = false; // Ban đầu: atom chưa chứng minh vừa phòng ở KS nào.
    for (const h of hotelsResolved) {
      const [sized] = reweightAtomsForAgeBands([atom], h.ageBands || []); // Cùng atom, mỗi KS có ageBands khác → effectiveSize có thể khác.
      // Kiểm tra một atom với phòng còn trống của KS h:

      // effectiveSize <= maxCap (phòng lớn nhất còn trống)
      // Số TE/EB (dependents.length) ≤ maxDepSlots
      // Atom phải trọn một phòng — không tách trẻ sang phòng khác.
      
      const check = validateAtomsFitSharedRooms(
        [sized],
        h.rooms,
        h.ageBands || []
      );
      if (check.ok) {
        fitsSomewhere = true;
        break;
      }
    }
    if (!fitsSomewhere) {
      return {
        ok: false,
        reason: "insufficient_adults_for_children",
        message: SHARED_INSUFFICIENT_ADULTS_MESSAGE,
      };
    }
  }
  return { ok: true };
}

/**
 * Đếm tổng (males, females) đến từ các đơn-tour khác đang xếp ghép trong cùng
 * tour-segment + hotel + khung thời gian. Bỏ qua đơn cancelled/deleted, chỉ
 * cộng đơn `paid` hoặc còn `holdExpiresAt > now`.
 *
 * @param {Object} payload
 * @param {string} payload.tourSegmentId
 * @param {string} payload.hotelId
 * @param {string|Date} payload.fromDate (chuỗi YYYY-MM-DD hoặc Date)
 * @param {string|Date} payload.toDate
 * @param {string|null} [payload.excludeOrderId]
 * @returns {Promise<{males:number, females:number, contributingOrderIds:string[]}>}
 */
async function aggregateSharedDemand({
  tourSegmentId,
  hotelId,
  fromDate,
  toDate,
  excludeOrderId,
}) {
  const sFrom = _toDateKey(fromDate);
  const sTo = _toDateKey(toDate);
  const segIdStr = String(tourSegmentId || "");
  const hotelIdStr = String(hotelId || "");

  if (!segIdStr || !hotelIdStr || !sFrom || !sTo) {
    return { males: 0, females: 0, contributingOrderIds: [] };
  }

  const now = new Date();
  const filter = {
    deleted: { $ne: true },
    status: { $ne: "cancel" },
    "items.accommodationMode": "shared",
    "items.sharedRoomRequest.tourSegmentId": segIdStr,
    "items.sharedRoomRequest.hotelId": hotelIdStr,
  };
  if (excludeOrderId) {
    filter._id = { $ne: excludeOrderId };
  }

  const orders = await Order.find(filter)
    .select("paymentStatus isTemporaryHold holdExpiresAt items")
    .lean();

  let males = 0;
  let females = 0;
  const contributingOrderIds = [];
  for (const ord of orders) {
    const isPaid = ord.paymentStatus === "paid";
    const isActiveHold =
      ord.isTemporaryHold &&
      (!ord.holdExpiresAt || new Date(ord.holdExpiresAt) > now);
    if (!isPaid && !isActiveHold) continue;

    let contributedThisOrder = false;
    for (const it of ord.items || []) {
      if (it.accommodationMode !== "shared") continue;
      for (const r of it.sharedRoomRequest || []) {
        if (String(r.tourSegmentId) !== segIdStr) continue;
        if (String(r.hotelId) !== hotelIdStr) continue;
        if (_toDateKey(r.fromDate) !== sFrom) continue;
        if (_toDateKey(r.toDate) !== sTo) continue;
        males += Math.max(0, Number(r.males) || 0);
        females += Math.max(0, Number(r.females) || 0);
        contributedThisOrder = true;
      }
    }
    if (contributedThisOrder) contributingOrderIds.push(String(ord._id));
  }

  return { males, females, contributingOrderIds };
}

/**
 * Trả về quota phòng thực (theo loại) mà admin đã cấu hình cho cặp
 * (TourSegment, hotelId) trong sub-segment có (fromDate, toDate) khớp.
 *
 *   [ { capacity, count } ]
 *
 * Capacity ở đây = `baseOccupancy` của loại phòng (vì khi xếp ghép, ta
 * đếm "1 chỗ" = 1 đầu người lớn vào occupancy chuẩn).
 */

// admin cấp cho bao nhiêu phòng ?
async function resolveRoomQuotaForSegmentHotel({
  tourSegmentId,
  hotelId,
  fromDate,
  toDate,
}) {
  let seg;
  try {
    seg = await TourSegment.findById(tourSegmentId).lean();
  } catch (e) {
    // CastError → tourSegmentId không phải ObjectId hợp lệ.
    return [];
  }
  if (!seg) return [];
  const sFrom = _toDateKey(fromDate);
  const sTo = _toDateKey(toDate);
  const sub = (seg.segments || []).find(
    (s) => _toDateKey(s.fromDate) === sFrom && _toDateKey(s.toDate) === sTo
  );
  if (!sub) return [];
  const hotelEntry = (sub.hotels || []).find(
    (h) => String(h.hotelId) === String(hotelId)
  );
  if (!hotelEntry) return [];

  return (hotelEntry.roomAllocations || [])
    .filter((ra) => Number(ra.assignedRooms) > 0)
    .map((ra) => ({
      roomTypeId: String(ra.roomTypeId),
      roomTypeName: ra.roomTypeName || "",
      capacity: Math.max(1, Math.floor(Number(ra.baseOccupancy) || 2)),
      count: Math.floor(Number(ra.assignedRooms) || 0),
    }));
}

/**
 * Trả về phòng CÒN TRỐNG THỰC TẾ cho cặp (TourSegment, hotelId) tại khung
 * (fromDate, toDate) — đã trừ các phòng đang bị HotelBooking khác giữ
 * (status active, không kể bản ghi [Tour Hold]).
 *
 * Khác `resolveRoomQuotaForSegmentHotel` (chỉ trả raw quota từ assignedRooms),
 * hàm này phục vụ bước VALIDATE ở ghép — đảm bảo logic kiểm tra "phòng lớn
 * nhất / số chỗ còn lại" phản ánh đúng tình trạng phòng thực, không lấy
 * baseOccupancy của loại phòng đã book hết.
 *
 * @param {Object} payload
 * @param {string} payload.tourSegmentId
 * @param {string} payload.hotelId
 * @param {string|Date} payload.fromDate
 * @param {string|Date} payload.toDate
 * @param {string|null} [payload.excludeOrderCode] mã đơn đang edit (nếu có)
 *
 * @returns {Promise<{
 *   raw:       Array<{ roomTypeId:string, roomTypeName:string, capacity:number, count:number }>,
 *   available: Array<{ roomTypeId:string, roomTypeName:string, capacity:number, count:number }>,
 * }>}
 *   - `raw`: quota gốc admin cấu hình (assignedRooms).
 *   - `available`: quota sau khi trừ phòng đã có khách thật đặt.
 *   Caller dựa vào (raw.length, available.length) để phân biệt:
 *     - raw rỗng        → "no_quota"          (tour chưa cấu hình phòng).
 *     - available rỗng  → "no_capacity_left"  (cấu hình có, nhưng đã hết).
 */
async function resolveAvailableRoomQuotaForSegmentHotel({
  tourSegmentId,
  hotelId,
  fromDate,
  toDate,
  excludeOrderCode,
}) {
  const raw = await resolveRoomQuotaForSegmentHotel({
    tourSegmentId,
    hotelId,
    fromDate,
    toDate,
  });
  if (raw.length === 0) return { raw, available: [] };

  const booked = await countActiveBookedRoomsByType({
    tourSegmentId,
    hotelId,
    fromDate,
    toDate,
    excludeOrderCode,
  });

  // Trừ phòng đã book → ra phòng còn trống thực tế. Loại nào hết phòng thì
  // bị loại khỏi danh sách (không dùng baseOccupancy của nó để validate).
  //
  // Lưu ý trade-off (BR-01..06): cách trừ này KHÔNG cộng lại "slot trống"
  // trong các phòng partial-shared (vd 1 phòng 2 chỗ chỉ có 1 nữ). Trong
  // bước VALIDATE, ta chấp nhận tiếp cận bảo thủ để khớp với cảnh báo
  // hiển thị cho khách. Bước cuối cùng `assignSharedAtomsToRooms` vẫn xét
  // partial-shared qua `getPartialSharedRooms` khi tạo đơn thật.
  const available = raw
    .map((q) => {
      const usedCnt = booked[q.roomTypeId] || 0;
      const remaining = Math.max(0, q.count - usedCnt);
      return { ...q, count: remaining };
    })
    .filter((q) => q.count > 0);

  return { raw, available };
}

/**
 * Kiểm tra tính khả thi xếp ghép cho 1 yêu cầu hiện tại, trong bối cảnh đã có
 * các yêu cầu khác cùng (segment, hotel, khung) đang giữ chỗ/đã thanh toán.
 *
 * @param {Object} request
 * @param {string} request.tourSegmentId
 * @param {string} request.hotelId
 * @param {string} request.hotelName (chỉ để tạo message)
 * @param {string|Date} request.fromDate
 * @param {string|Date} request.toDate
 * @param {number} request.males
 * @param {number} request.females
 * @param {string|null} [request.excludeOrderId]
 *
 * @returns {Promise<{
 *   ok: boolean,
 *   reason?: 'no_quota'|'exceeds_total_capacity'|'cannot_split_by_gender',
 *   message?: string,
 *   totals?: { males:number, females:number },
 *   maxFeasible?: { males:number, females:number },
 * }>}
 */
async function evaluateSharedFeasibility(request) {
  const males = Math.max(0, Math.floor(Number(request.males) || 0));
  const females = Math.max(0, Math.floor(Number(request.females) || 0));
  const hotelName = request.hotelName || "khách sạn";

  const { raw, available } = await resolveAvailableRoomQuotaForSegmentHotel({
    tourSegmentId: request.tourSegmentId,
    hotelId: request.hotelId,
    fromDate: request.fromDate,
    toDate: request.toDate,
    excludeOrderCode: request.excludeOrderCode || null,
  });
  if (raw.length === 0) {
    return {
      ok: false,
      reason: "no_quota",
      message: `Tour chưa cấu hình phòng cho ${hotelName} trong khung này. Vui lòng liên hệ tổ chức.`,
    };
  }
  if (available.length === 0) {
    return {
      ok: false,
      reason: "no_capacity_left",
      message:
        `${hotelName} đã hết phòng trống cho khung lưu trú này. ` +
        `Vui lòng chọn khách sạn khác hoặc liên hệ công ty du lịch.`,
    };
  }

  // KHÔNG cộng dồn nhu cầu Order khác: phòng họ đã bị trừ khỏi `available`.
  const rooms = available;
  const totalMales = males;
  const totalFemales = females;

  const result = canAllocateGenderRooms({
    males: totalMales,
    females: totalFemales,
    rooms: rooms.map((r) => ({ capacity: r.capacity, count: r.count })),
  });

  if (result.ok) {
    return {
      ok: true,
      totals: { males: totalMales, females: totalFemales },
    };
  }

  const maxFeasible = result.maxFeasible || { males: 0, females: 0 };
  const allowedMales = Math.max(0, maxFeasible.males);
  const allowedFemales = Math.max(0, maxFeasible.females);

  const message =
    `Không đủ phòng trống ở ghép tại ${hotelName} cho ${males} nam và ${females} nữ. ` +
    `Số phòng còn trống chỉ đáp ứng tối đa ${allowedMales} nam và ${allowedFemales} nữ trong khung này.`;

  return {
    ok: false,
    reason: result.reason,
    message,
    totals: { males: totalMales, females: totalFemales },
    maxFeasible: { males: allowedMales, females: allowedFemales },
  };
}

// ── utils ────────────────────────────────────────────────────────────────────

function _toDateKey(d) {
  if (!d) return "";
  if (d instanceof Date) {
    if (isNaN(d.getTime())) return "";
    return d.toISOString().slice(0, 10);
  }
  const s = String(d);
  // Đã là YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // Thử parse
  const dt = new Date(s);
  if (isNaN(dt.getTime())) return "";
  return dt.toISOString().slice(0, 10);
}

// =============================================================================
// V2: ATOMIC FEASIBILITY (passenger detail)
// =============================================================================
//
// Phiên bản mới dùng `passengers[]` chi tiết để build atoms (1 NL + TE/EB của
// họ), sau đó gọi canAllocateAtomicGroups thay cho canAllocateGenderRooms.
// Đơn cũ (chỉ có males/females) được synthesize thành atoms size=1 để cộng dồn.
//
// Sử dụng: gọi từ controllers/client/order.controller.js createPost.

/**
 * Build atoms cộng dồn cho 1 cặp (segment, hotel, fromDate, toDate) từ tất cả
 * Order khác đang `paid` hoặc còn `holdExpiresAt > now`.
 *
 * @param {Object} payload (giống aggregateSharedDemand)
 * @param {Array}  ageBands hotel.ageBands (để build atoms từ passengers chi tiết)
 * @returns {Promise<{ atoms: import('./passenger-atom.helper').buildAtomsFromPassengers extends Function ? any[] : never, contributingOrderIds: string[] }>}
 */
async function aggregateSharedAtoms({
  tourSegmentId,
  hotelId,
  fromDate,
  toDate,
  excludeOrderId,
  ageBands,
}) {
  const sFrom = _toDateKey(fromDate);
  const sTo = _toDateKey(toDate);
  const segIdStr = String(tourSegmentId || "");
  const hotelIdStr = String(hotelId || "");

  if (!segIdStr || !hotelIdStr || !sFrom || !sTo) {
    return { atoms: [], contributingOrderIds: [] };
  }

  const now = new Date();
  const filter = {
    deleted: { $ne: true },
    status: { $ne: "cancel" },
    "items.accommodationMode": "shared",
    "items.sharedRoomRequest.tourSegmentId": segIdStr,
    "items.sharedRoomRequest.hotelId": hotelIdStr,
  };
  if (excludeOrderId) {
    filter._id = { $ne: excludeOrderId };
  }

  const orders = await Order.find(filter)
    .select("paymentStatus isTemporaryHold holdExpiresAt items")
    .lean();

  const allAtoms = [];
  const contributingOrderIds = [];

  for (const ord of orders) {
    const isPaid = ord.paymentStatus === "paid";
    const isActiveHold =
      ord.isTemporaryHold &&
      (!ord.holdExpiresAt || new Date(ord.holdExpiresAt) > now);
    if (!isPaid && !isActiveHold) continue;

    let contributedThisOrder = false;
    for (const it of ord.items || []) {
      if (it.accommodationMode !== "shared") continue;

      // Tìm sharedRoomRequest entry khớp segment+hotel+khung này.
      const matching = (it.sharedRoomRequest || []).filter(
        (r) =>
          String(r.tourSegmentId) === segIdStr &&
          String(r.hotelId) === hotelIdStr &&
          _toDateKey(r.fromDate) === sFrom &&
          _toDateKey(r.toDate) === sTo
      );
      if (matching.length === 0) continue;

      // Đơn mới có passengers chi tiết → build atoms thật.
      // Đơn cũ chỉ có males/females → synthesize 1 atom/người size=1.
      if (Array.isArray(it.passengers) && it.passengers.length > 0) {
        try {
          const atoms = buildAtomsFromPassengers(it.passengers, ageBands);
          for (const a of atoms) allAtoms.push({ ...a, _orderId: String(ord._id) });
          contributedThisOrder = true;
        } catch (e) {
          // Đơn có passengers lỗi format → fallback synthesize từ males/females
          // để không chặn đơn mới.
          for (const r of matching) {
            const atoms = synthesizeLegacyAtoms(r);
            for (const a of atoms) allAtoms.push({ ...a, _orderId: String(ord._id) });
            if (atoms.length > 0) contributedThisOrder = true;
          }
        }
      } else {
        for (const r of matching) {
          const atoms = synthesizeLegacyAtoms(r);
          for (const a of atoms) allAtoms.push({ ...a, _orderId: String(ord._id) });
          if (atoms.length > 0) contributedThisOrder = true;
        }
      }
    }
    if (contributedThisOrder) contributingOrderIds.push(String(ord._id));
  }

  return { atoms: allAtoms, contributingOrderIds };
}

/**
 * Lấy ageBands của hotel cụ thể để dùng cho weight tra theo tuổi.
 * Có cache đơn giản trong scope process tránh fetch lặp.
 */
const _ageBandCache = new Map();
async function _getHotelAgeBands(hotelId) {
  const key = String(hotelId);
  if (_ageBandCache.has(key)) return _ageBandCache.get(key);
  let bands = [];
  try {
    const h = await Hotel.findById(hotelId).select("ageBands").lean();
    bands = (h && Array.isArray(h.ageBands)) ? h.ageBands : [];
  } catch (e) {
    bands = [];
  }
  _ageBandCache.set(key, bands);
  // Hết hạn cache sau 1 phút để tránh stale khi admin sửa ageBands.
  setTimeout(() => _ageBandCache.delete(key), 60 * 1000);
  return bands;
}

/**
 * Đánh giá khả năng xếp ghép cho 1 yêu cầu hiện tại (đã có passengers chi
 * tiết) trong bối cảnh đã có các yêu cầu khác cùng (segment, hotel, khung).
 *
 * @param {Object} request
 * @param {string} request.tourSegmentId
 * @param {string} request.hotelId
 * @param {string} request.hotelName
 * @param {string|Date} request.fromDate
 * @param {string|Date} request.toDate
 * @param {Array} request.passengers   passengers của ĐOÀN HIỆN TẠI (cả đơn,
 *                                      không lặp lại theo segment)
 * @param {string|null} [request.excludeOrderId]
 *
 * @returns {Promise<{
 *   ok: boolean,
 *   reason?: 'no_quota'|'invalid_passengers'|'atom_too_large'|'exceeds_total_capacity'|'cannot_split_by_gender',
 *   message?: string,
 *   detail?: object,
 * }>}
 */
async function evaluateSharedFeasibilityV2(request) {
  const hotelName = request.hotelName || "khách sạn";

  const { raw, available } = await resolveAvailableRoomQuotaForSegmentHotel({
    tourSegmentId: request.tourSegmentId,
    hotelId: request.hotelId,
    fromDate: request.fromDate,
    toDate: request.toDate,
    excludeOrderCode: request.excludeOrderCode || null,
  });
  if (raw.length === 0) {
    return {
      ok: false,
      reason: "no_quota",
      message: `Tour chưa cấu hình phòng cho ${hotelName} trong khung này. Vui lòng liên hệ tổ chức.`,
    };
  }
  if (available.length === 0) {
    return {
      ok: false,
      reason: "no_capacity_left",
      message:
        `${hotelName} đã hết phòng trống cho khung lưu trú này. ` +
        `Vui lòng chọn khách sạn khác hoặc liên hệ công ty du lịch.`,
    };
  }

  const rooms = available;
  const ageBands = await _getHotelAgeBands(request.hotelId);

  // Build atoms cho đoàn hiện tại.
  let currentAtoms = [];
  try {
    currentAtoms = buildAtomsFromPassengers(request.passengers || [], ageBands);
  } catch (e) {
    return {
      ok: false,
      reason: "invalid_passengers",
      message: e.message || "Danh sách hành khách không hợp lệ.",
    };
  }

  const atomRoomCheck = validateAtomsFitSharedRooms(
    currentAtoms,
    rooms,
    ageBands
  );
  if (!atomRoomCheck.ok) {
    return {
      ok: false,
      reason: atomRoomCheck.reason,
      message: atomRoomCheck.message,
      detail: { maxRoomCapacity: atomRoomCheck.maxRoomCapacity },
    };
  }

  // KHÔNG cộng dồn atoms từ Order khác: phòng họ đã bị trừ khỏi `available`.
  // Cộng thêm sẽ double-count (rooms − rooms_họ_giữ, atoms + atoms_họ).
  const allAtoms = currentAtoms;

  const result = canAllocateAtomicGroups({
    atoms: allAtoms,
    rooms: rooms.map((r) => ({ capacity: r.capacity, count: r.count })),
  });

  if (result.ok) return { ok: true, detail: result.detail };

  const curSize = currentAtoms.reduce((s, a) => s + a.effectiveSize, 0);

  const hasChildren = currentAtoms.some((a) =>
    (a.members || []).some((m) => m.type === "child" || m.type === "baby")
  );
  let message;
  let reason = result.reason;
  if (result.reason === "atom_too_large") {
    const curAtomCheck = validateAtomsFitSharedRooms(
      currentAtoms,
      rooms,
      ageBands
    );
    if (!curAtomCheck.ok) {
      reason = curAtomCheck.reason;
      message = curAtomCheck.message;
    } else {
      message =
        `Có nhóm (1 người lớn + trẻ em đi cùng) tổng sức chứa quy đổi ${result.detail.largestAtom} ` +
        `vượt phòng lớn nhất còn trống ${result.detail.largestRoom} chỗ tại ${hotelName}. ` +
        `Bạn cần giảm số trẻ em đi cùng 1 người lớn hoặc chuyển sang ở riêng.`;
    }
  } else if (result.reason === "exceeds_total_capacity") {
    const totalCap = result.detail?.totalCapacity ?? 0;
    const suffix = hasChildren
      ? "Vui lòng giảm số người, chuyển sang ở riêng hoặc liên hệ công ty du lịch."
      : "Vui lòng giảm số người hoặc chọn lịch khởi hành khác.";
    message =
      `Không đủ chỗ ở ghép tại ${hotelName} — phòng còn trống chỉ chứa được ` +
      `tối đa ${totalCap} chỗ, trong khi đoàn bạn cần ${curSize} chỗ. ` +
      suffix;
  } else if (result.reason === "cannot_split_by_gender") {
    const suffix = hasChildren
      ? "Vui lòng điều chỉnh người trông trẻ hoặc chuyển sang ở riêng."
      : "Vui lòng chuyển sang ở riêng hoặc liên hệ công ty du lịch.";
    message =
      `Phòng còn trống tại ${hotelName} không thể chia theo giới tính phù hợp với đoàn bạn. ` +
      suffix;
  } else {
    message = `Phương án ở ghép hiện tại không khả thi tại ${hotelName}.`;
  }

  return {
    ok: false,
    reason,
    message,
    detail: result.detail,
  };
}

// =============================================================================
// V2-MULTI: SEGMENT-LEVEL POOLING ACROSS HOTELS (multi-hotel fallback)
// =============================================================================
//
// Khác V2: thay vì kiểm 1 hotel cố định, hàm dưới đây nhận DANH SÁCH hotels
// (theo thứ tự ưu tiên) thuộc cùng segment + khung. Atom của đoàn hiện tại
// có thể được phân phối sang nhiều hotel khác nhau nếu hotel ưu tiên cao
// không đủ chỗ. Mỗi atom vẫn nằm trọn trong 1 hotel + 1 phòng.
//
// Aggregate demand: gộp toàn bộ Order khác cùng segment + khung (KHÔNG lọc
// theo hotelId), nhưng phân nhóm atoms theo hotel mà chúng đã được gán
// (đơn mới đọc từ `hotelAllocations[]`, đơn cũ gắn hết vào `hotelId` trong
// sharedRoomRequest entry).

/**
 * Aggregate atoms từ TẤT CẢ Order khác trong cùng segment + khung, gom theo
 * `hotelId` chúng đã chiếm.
 *
 * @returns {Promise<{
 *   byHotel: Object<string, Array>,
 *   contributingOrderIds: string[],
 * }>}
 */
async function aggregateSharedAtomsBySegment({
  tourSegmentId,
  fromDate,
  toDate,
  excludeOrderId,
}) {
  const sFrom = _toDateKey(fromDate);
  const sTo = _toDateKey(toDate);
  const segIdStr = String(tourSegmentId || "");

  if (!segIdStr || !sFrom || !sTo) {
    return { byHotel: {}, contributingOrderIds: [] };
  }

  const now = new Date();
  const filter = {
    deleted: { $ne: true },
    status: { $ne: "cancel" },
    "items.accommodationMode": "shared",
    "items.sharedRoomRequest.tourSegmentId": segIdStr,
  };
  if (excludeOrderId) filter._id = { $ne: excludeOrderId };

  const orders = await Order.find(filter)
    .select("paymentStatus isTemporaryHold holdExpiresAt items")
    .lean();

  /** @type {Object<string, any[]>} */
  const byHotel = {};
  const contributingOrderIds = [];

  for (const ord of orders) {
    const isPaid = ord.paymentStatus === "paid";
    const isActiveHold =
      ord.isTemporaryHold &&
      (!ord.holdExpiresAt || new Date(ord.holdExpiresAt) > now);
    if (!isPaid && !isActiveHold) continue;

    let contributedThisOrder = false;

    for (const it of ord.items || []) {
      if (it.accommodationMode !== "shared") continue;
      const matchingReq = (it.sharedRoomRequest || []).filter(
        (r) =>
          String(r.tourSegmentId) === segIdStr &&
          _toDateKey(r.fromDate) === sFrom &&
          _toDateKey(r.toDate) === sTo
      );
      if (matchingReq.length === 0) continue;

      // Build atoms cho item (tạm dùng ageBands rỗng → fallback theo type;
      // sẽ reweight đúng theo hotel khi xếp).
      const hasPassengers =
        Array.isArray(it.passengers) && it.passengers.length > 0;
      let itemAtoms = [];
      if (hasPassengers) {
        try {
          itemAtoms = buildAtomsFromPassengers(it.passengers, []);
        } catch (e) {
          itemAtoms = [];
        }
      }

      for (const req of matchingReq) {
        const allocs =
          Array.isArray(req.hotelAllocations) && req.hotelAllocations.length > 0
            ? req.hotelAllocations
            : [
                {
                  hotelId: String(req.hotelId || ""),
                  hotelName: req.hotelName || "",
                  atomAnchorIdxs: null, // null = "tất cả atom của item này"
                  legacyMales: Number(req.males) || 0,
                  legacyFemales: Number(req.females) || 0,
                },
              ];

        for (const alloc of allocs) {
          const targetHotelId = String(alloc.hotelId || "");
          if (!targetHotelId) continue;

          let atomsHere = [];
          if (hasPassengers && itemAtoms.length > 0) {
            if (Array.isArray(alloc.atomAnchorIdxs)) {
              const idxSet = new Set(alloc.atomAnchorIdxs.map(Number));
              atomsHere = itemAtoms.filter((a) => idxSet.has(a.anchorIdx));
            } else {
              // Đơn mới-pre-multi-hotel: chỉ có 1 hotel chính → tất cả atom
              // gán hết vào hotel này, nhưng CHỈ một lần (entry đầu tiên).
              atomsHere = itemAtoms;
              // tránh double-count cho các req khác cùng item & frame
              itemAtoms = [];
            }
          } else {
            // Legacy đơn cũ chỉ có males/females.
            atomsHere = synthesizeLegacyAtoms({
              males: alloc.legacyMales || 0,
              females: alloc.legacyFemales || 0,
            });
          }

          if (atomsHere.length > 0) {
            if (!byHotel[targetHotelId]) byHotel[targetHotelId] = [];
            for (const a of atomsHere) {
              byHotel[targetHotelId].push({
                ...a,
                _orderId: String(ord._id),
              });
            }
            contributedThisOrder = true;
          }
        }
      }
    }
    if (contributedThisOrder) contributingOrderIds.push(String(ord._id));
  }

  return { byHotel, contributingOrderIds };
}

/**
 * Đánh giá khả thi xếp ghép cho 1 segment + khung khi đoàn có thể được phân
 * phối qua nhiều hotel theo thứ tự ưu tiên.
 *
 * @param {Object} request
 * @param {string} request.tourSegmentId
 * @param {string|Date} request.fromDate
 * @param {string|Date} request.toDate
 * @param {Array<{hotelId:string, hotelName?:string}>} request.hotels theo
 *        thứ tự ưu tiên (index 0 = hotel chính cấu hình của tour).
 * @param {Array}  request.passengers   passengers của ĐOÀN HIỆN TẠI
 * @param {string|null} [request.excludeOrderId]
 *
 * @returns {Promise<{
 *   ok: boolean,
 *   reason?: string,
 *   message?: string,
 *   allocations?: Array<{
 *     hotelId: string,
 *     hotelName: string,
 *     atomAnchorIdxs: number[],
 *     atomLabels: string[],
 *     totalEffectiveSize: number,
 *   }>,
 *   detail?: any,
 * }>}
 */

// Hàm này trả lời 1 câu hỏi duy nhất
// Đoàn khách này, nếu chọn ở ghép trong khung ngày X→Y, có nhét được vào phòng còn trống của tour không?

// Chưa đặt phòng thật, chưa tạo booking.
// Chỉ kiểm tra + mô phỏng xếp → trả ok: true/false và lời giải thích.
// Chỉ dùng khi khách chọn ở ghép, không dùng cho ở riêng.

// Trả lời "Đoàn khách ở ghép này có xếp được không? Nếu được — chia vào KS nào, ai vào KS nào?"
async function evaluateSharedFeasibilityV2Multi(request) {
  const incomingHotels = Array.isArray(request.hotels) ? request.hotels : [];
  if (incomingHotels.length === 0) {
    return {
      ok: false,
      reason: "no_hotels",
      message: `Tour chưa cấu hình khách sạn nào trong khung lưu trú này.`,
    };
  }

  // Resolve PHÒNG CÒN TRỐNG THỰC TẾ (đã trừ đơn khác đang giữ) cho từng
  // hotel ứng viên. Loại phòng đã hết → KHÔNG đưa vào maxCap / validate
  // (BR-02..04). Hotel còn 0 phòng → loại khỏi danh sách (BR-05).
  const hotelsResolved = [];
  let anyHasRawQuota = false;

  // Mỗi KS còn bao nhiêu phòng còn trống thực tế
  for (const h of incomingHotels) {

    // raw - Admin cấp bao nhiêu phòng 
    // available - Phòng còn trống thực tế
    const { raw, available } = await resolveAvailableRoomQuotaForSegmentHotel({
      tourSegmentId: request.tourSegmentId,
      hotelId: h.hotelId,
      fromDate: request.fromDate,
      toDate: request.toDate,
      excludeOrderCode: request.excludeOrderCode || null,
    });

    if (raw.length > 0) anyHasRawQuota = true;
    if (available.length === 0) continue;
    const ageBands = await _getHotelAgeBands(h.hotelId);
    hotelsResolved.push({
      hotelId: String(h.hotelId),
      hotelName: h.hotelName || "",
      ageBands,
      rooms: available.map((r) => ({ capacity: r.capacity, count: r.count })),
    });
  }


  // Không KS nào còn phòng
  if (hotelsResolved.length === 0) {
    // Phân biệt: chưa từng cấu hình quota nào vs cấu hình có nhưng book hết.
    if (!anyHasRawQuota) {
      return {
        ok: false,
        reason: "no_quota",
        message: `Tour chưa cấu hình phòng cho khách sạn nào trong khung này. Vui lòng liên hệ tổ chức.`,
      };
    }
    return {
      ok: false,
      reason: "no_capacity_left",
      message:
        "Tất cả khách sạn trong khung lưu trú này đã hết phòng trống để ở ghép. " +
        "Vui lòng chọn lịch khởi hành khác hoặc liên hệ công ty du lịch.",
    };
  }

  // Build atoms cho đoàn hiện tại (ageBands rỗng → reweight per hotel).
  let currentAtoms = [];
  try {

    // gom hành khách thành atoms
    currentAtoms = buildAtomsFromPassengers(request.passengers || [], []);
  } catch (e) {
    return {
      ok: false,
      reason: "invalid_passengers",
      message: e.message || "Danh sách hành khách không hợp lệ.",
    };
  }
  if (currentAtoms.length === 0) {
    // Không có atom (vd: 0 người lớn) → ok luôn.
    return { ok: true, allocations: [] };
  }

  // Kiểm tra xem các atom có khớp với các hotel không
  // Ví dụ: Bố + 3 trẻ, phòng lớn nhất còn 2 chỗ → fail (dù còn nhiều phòng khác)
  // Fail → message kiểu “trẻ em vượt quá khả năng phân bổ phòng”.
  const crossHotelAtomCheck = _validateCurrentAtomsAcrossHotels(
    currentAtoms,
    hotelsResolved
  );
  if (!crossHotelAtomCheck.ok) {
    return crossHotelAtomCheck;
  }

  // KHÔNG cộng dồn atoms từ Order khác nữa: phòng họ đang giữ đã bị trừ
  // khỏi `hotelsResolved.rooms` qua resolveAvailableRoomQuotaForSegmentHotel.
  // Nếu cộng thêm atoms ở đây sẽ bị double-count (vừa trừ phòng vừa trừ
  // người). Trade-off: bỏ qua tối ưu cross-shared-partial — bù lại logic
  // validate khớp đúng "phòng còn trống thực tế" như BR yêu cầu.
  const result = canAllocateAtomicGroupsAcrossHotels({
    currentAtoms,
    hotels: hotelsResolved,
    existingAtomsByHotel: {},
    reweightFn: reweightAtomsForAgeBands,
  });

  if (result.ok) {
    return {
      ok: true,
      allocations: result.allocations.map((a) => ({
        hotelId: a.hotelId,
        hotelName: a.hotelName,
        atomAnchorIdxs: a.atoms
          .map((x) => x.anchorIdx)
          .filter((idx) => typeof idx === "number" && idx >= 0),
        atomLabels: a.atoms.map((x) => x.label || ""),
        totalEffectiveSize: a.totalEffectiveSize,
      })),
    };
  }

  // Build message thân thiện — phân loại theo nguyên nhân thực sự.
  const hotelNames = hotelsResolved.map((h) => h.hotelName || "(?)").join(", ");
  let message;
  let reason = result.reason;

  // Tính tổng capacity còn trống (đã trừ booking) trên tất cả các hotel.
  const totalAvailableCap = hotelsResolved.reduce(
    (s, h) =>
      s + h.rooms.reduce((hs, r) => hs + r.capacity * r.count, 0),
    0
  );
  // Tổng "chỗ" (occupancy weight) đoàn hiện tại cần — dùng effectiveSize sau
  // reweight theo hotel đầu tiên (hoặc 1 mỗi atom nếu chỉ có NL).
  const totalNeeded = currentAtoms.reduce(
    (s, a) => s + Math.max(1, Number(a.effectiveSize) || 1),
    0
  );
  const hasChildren = currentAtoms.some((a) =>
    (a.members || []).some((m) => m.type === "child" || m.type === "baby")
  );
  const hotelLabel =
    hotelsResolved.length === 1
      ? `khách sạn (${hotelNames})`
      : `các khách sạn (${hotelNames})`;

  if (result.reason === "atom_too_large") {
    const crossCheck = _validateCurrentAtomsAcrossHotels(
      currentAtoms,
      hotelsResolved
    );
    if (!crossCheck.ok) {
      reason = crossCheck.reason;
      message = crossCheck.message;
    } else {
      const offending = result.detail?.largestAtomLabel || "?";
      message =
        `Nhóm "${offending}" có sức chứa quy đổi vượt phòng lớn nhất còn trống tại ` +
        `tất cả ${hotelLabel} trong khung này. ` +
        `Hãy giảm số trẻ em đi cùng người lớn này hoặc chuyển sang ở riêng.`;
    }
  } else if (result.reason === "no_hotels") {
    message = `Tour chưa cấu hình khách sạn nào trong khung lưu trú này.`;
  } else {
    // cannot_fit_anywhere: phân biệt các sub-case để đưa gợi ý phù hợp.
    const leftover = result.leftover || [];
    const placed = currentAtoms.length - leftover.length;
    const leftoverLabels = leftover.map((a) => a.label || "?").join(", ");

    if (totalNeeded > totalAvailableCap) {
      // Không đủ sức chứa tổng → vấn đề phòng trống, không phải giới tính.
      const suffix = hasChildren
        ? "Vui lòng giảm số người, chuyển sang ở riêng hoặc liên hệ công ty du lịch."
        : "Vui lòng giảm số người hoặc chọn lịch khởi hành khác.";
      message =
        `Phòng còn trống tại ${hotelLabel} chỉ chứa được tối đa ` +
        `${totalAvailableCap} chỗ trong khung này, trong khi đoàn bạn cần ${totalNeeded} chỗ. ` +
        suffix;
    } else if (placed > 0) {
      // Đủ tổng chỗ nhưng không xếp hết — thường do tách giới tính hoặc nhóm
      // gia đình lẻ không khớp phòng còn lại.
      const suffix = hasChildren
        ? "Vui lòng điều chỉnh người trông trẻ trong đoàn hoặc chuyển sang ở riêng."
        : "Phòng còn lại không đủ để chia theo giới tính cho đoàn bạn. " +
          "Vui lòng chuyển sang ở riêng hoặc liên hệ công ty du lịch.";
      message =
        `Đã xếp được ${placed}/${currentAtoms.length} nhóm vào ${hotelLabel}, ` +
        `nhưng vẫn còn ${leftover.length} nhóm chưa có chỗ (${leftoverLabels}). ` +
        suffix;
    } else {
      // Không xếp được nhóm nào — tổng cap đủ nhưng không chia được.
      const suffix = hasChildren
        ? "Vui lòng điều chỉnh người trông trẻ trong đoàn hoặc chuyển sang ở riêng."
        : "Phòng còn lại không thể chia theo giới tính phù hợp với đoàn. " +
          "Vui lòng chuyển sang ở riêng hoặc liên hệ công ty du lịch.";
      message =
        `Phòng còn trống tại ${hotelLabel} không thể xếp đoàn bạn ở ghép ` +
        `(${currentAtoms.length} nhóm). ` +
        suffix;
    }
  }

  return { ok: false, reason, message, detail: result.detail };
}

// =============================================================================
// AUTO-ASSIGN ATOMS → ROOM TYPES (per hotel) — phục vụ createPost
// =============================================================================
//
// Sau khi feasibility-V2-multi đã pass và biết "hotel nào ôm những atom nào"
// (qua `hotelAllocations[]`), bước cuối là quyết định chính xác mỗi atom được
// đặt vào loại phòng nào và ghi nhận thành các "phòng vật lý đã được giữ".
//
// Việc này giúp:
//   - Giữ phòng cụ thể (qua HotelBooking [Tour Booking]) → trang tour detail
//     tự động trừ phòng còn lại cho mode "ở riêng".
//   - Admin /admin/hotel/tour-assignments thấy ngay phòng nào dành cho khách
//     ở ghép, không cần phân thủ công.
//
// Lưu ý: hàm này chỉ tính TOÁN — không ghi DB. Ghi DB do controller làm.

/**
 * Đếm số phòng đang bị HotelBooking [Tour Booking] giữ (cùng segment, hotel,
 * khung thời gian, status active). Dùng để biết quota còn lại cho auto-assign
 * khách ở ghép.
 *
 * @returns {Promise<{ [roomTypeId:string]: number }>}
 */

// Đã có mấy phòng giữ ?
async function countActiveBookedRoomsByType({
  tourSegmentId,
  hotelId,
  fromDate,
  toDate,
  excludeOrderCode,
}) {
  const fromKey = _toDateKey(fromDate);
  const toKey = _toDateKey(toDate);
  if (!fromKey || !toKey || !hotelId || !tourSegmentId) return {};

  const now = new Date();
  // Lưu ý: bỏ qua các bản ghi "[Tour Hold]" (placeholder do admin tạo để giữ
  // quota cho tour) — đó là CHÍNH quota, không phải phòng đã có khách.
  // Chỉ đếm các HotelBooking thuộc về 1 đơn khách thật (orderCode).
  const query = {
    "hotel.hotelId": hotelId,
    tourSegmentId: String(tourSegmentId),
    status: { $in: ["pending", "confirmed", "checkedIn"] },
    orderCode: { $exists: true, $nin: [null, ""] },
    "guest.fullName": { $ne: "[Tour Hold]" },
    $or: [
      { isTemporaryHold: { $ne: true } },
      { holdExpiresAt: { $gt: now } },
      { holdExpiresAt: null },
    ],
  };
  // Khi edit đơn cũ → không tính phòng do chính đơn này giữ vào "đã book".
  if (excludeOrderCode) {
    query.orderCode = {
      $exists: true,
      $nin: [null, "", excludeOrderCode],
    };
  }
  const docs = await HotelBooking.find(query)
    .select("checkIn checkOut roomTypeId rooms")
    .lean();

  const out = {};
  for (const b of docs) {
    if (_toDateKey(b.checkIn) !== fromKey) continue;
    if (_toDateKey(b.checkOut) !== toKey) continue;
    const key = String(b.roomTypeId || "");
    if (!key) continue;
    out[key] = (out[key] || 0) + Math.max(1, Math.floor(Number(b.rooms) || 1));
  }
  return out;
}

/**
 * Tự động gán atoms vào loại phòng (per hotel). Trả về danh sách "room
 * assignments" — mỗi entry đại diện cho 1 phòng vật lý sẽ bị giữ chỗ.
 *
 * @param {{
 *   tourSegmentId: string,
 *   hotelId: string,
 *   hotelName?: string,
 *   ageBands: Array,
 *   fromDate: string|Date,
 *   toDate: string|Date,
 *   atoms: Array,
 * }} input
 *
 * @returns {Promise<{
 *   ok: boolean,
 *   reason?: string,
 *   message?: string,
 *   assignments: Array<{
 *     roomTypeId: string,
 *     roomTypeName: string,
 *     baseOccupancy: number,
 *     gender: 'male'|'female',
 *     atomAnchorIdxs: number[],
 *     atomLabels: string[],
 *     usedCapacity: number,
 *   }>,
 * }>}
 */

// Với đoàn ở ghép tại một KS, trong một khung ngày, các atom (nhóm NL + trẻ) được xếp vào loại phòng nào — mở phòng mới hay ghép phòng đang còn chỗ?
async function assignSharedAtomsToRooms({
  tourSegmentId,
  hotelId,
  hotelName,
  ageBands,
  fromDate,
  toDate,
  atoms,
}) {

  // 1. quota: danh sách phòng thực có (theo loại) mà admin đã cấu hình cho cặp (segment, hotel) trong khung thời gian.
  const quota = await resolveRoomQuotaForSegmentHotel({
    tourSegmentId,
    hotelId,
    fromDate,
    toDate,
  });
  if (!quota || quota.length === 0) {
    return {
      ok: false,
      reason: "no_quota",
      message: `Tour chưa cấu hình phòng cho ${hotelName || "khách sạn"}.`,
      assignments: [],
    };
  }

  // ── Lấy các TH (phòng vật lý) đang được giữ chỗ shared còn slot trống ──
  // Mục tiêu: nếu phòng X đã có 1 nữ ở (1/2 cap) → đơn nữ tiếp theo ưu tiên
  // ghép vào phòng X thay vì mở phòng vật lý mới.

  // 2. Trả về danh sách phòng cụ thể. 
  // Ý nghĩa: Phòng ở ghép đã có người, còn slot
  const partialShared = await getPartialSharedRooms({
    tourSegmentId,
    hotelId,
    fromDate,
    toDate,
  });

  // Trừ số phòng đang bị HotelBooking khác giữ → ra "physical rooms còn dùng được".
  // Lưu ý: countActiveBookedRoomsByType đếm CẢ partial shared (vì chúng có
  // orderCode + guest != [Tour Hold]), nên ở đây những phòng partial sẽ được
  // expose qua `partialShared` để FFD có thể join — không bị tính 2 lần do
  // assignAtomsToPhysicalRooms phân biệt preExistingOpenRooms vs physicalRooms.

  // 3. Object đếm theo loại phòng
  // Tất cả phòng đã bị đơn chiếm (kể cả partial + đầy)
  const booked = await countActiveBookedRoomsByType({
    tourSegmentId,
    hotelId,
    fromDate,
    toDate,
  });

  // 4. Trả về còn bao nhiêu phòng trống hoàn toàn
  const physicalRooms = [];
  for (const q of quota) {
    const usedCnt = booked[q.roomTypeId] || 0;
    const remaining = Math.max(0, q.count - usedCnt);
    for (let i = 0; i < remaining; i++) {
      physicalRooms.push({
        roomTypeId: q.roomTypeId,
        roomTypeName: q.roomTypeName,
        capacity: q.capacity,
      });
    }
  }

  // 5. Kiểm tra còn chỗ trống không ?
  if (physicalRooms.length === 0 && partialShared.length === 0) {
    return {
      ok: false,
      reason: "no_capacity_left",
      message: `Khách sạn ${hotelName || ""} không còn phòng trống để xếp ở ghép.`,
      assignments: [],
    };
  }

  // 6. Gọi thuật toán xếp
  const result = assignAtomsToPhysicalRooms({
    atoms,
    physicalRooms,
    preExistingOpenRooms: partialShared,
  });

  if (!result.ok) {
    return {
      ok: false,
      reason: "cannot_pack",
      message: `Không xếp được toàn bộ khách ở ghép vào ${
        hotelName || "khách sạn"
      } sau khi cập nhật phòng còn lại.`,
      assignments: [],
    };
  }

  // ── Safety net: cross-check kết quả FFD với FRESH DB state trước khi
  //   trả về. Tránh trường hợp partialShared bị tính sai (atomLabels không
  //   match, ageBands thay đổi, ...) khiến FFD nhồi atom mới vào phòng
  //   thực tế đã đầy/khác giới. Nếu phát hiện vi phạm → trả lỗi rõ ràng.
  for (const a of result.assignments) {
    // (a) Phòng mới (không reuse) — chỉ cần check trong phạm vi assignment.
    if (!a._reuseThId) {
      const localGenders = new Set(
        (a.atoms || []).map((x) => x.gender).filter(Boolean)
      );
      if (localGenders.size > 1) {
        return {
          ok: false,
          reason: "new_room_mixed_gender",
          message: `Phòng mới tại ${hotelName || "khách sạn"} chứa atoms khác giới — không hợp lệ. Vui lòng thử lại hoặc liên hệ tổ chức.`,
          assignments: [],
        };
      }
      const localUsed = (a.atoms || []).reduce(
        (s, x) => s + (Number(x.effectiveSize) || 0),
        0
      );
      if (localUsed > a.capacity) {
        return {
          ok: false,
          reason: "new_room_overcap",
          message: `Phòng mới tại ${hotelName || "khách sạn"} vượt sức chứa (${localUsed}/${a.capacity}). Vui lòng thử lại hoặc liên hệ tổ chức.`,
          assignments: [],
        };
      }
      continue;
    }

    // (b) Phòng reuse (cross-order) — phải tái-fetch state phòng đang mở
    //     để check tổng used + atoms mới + cùng giới.
    const partialEntry = (partialShared || []).find(
      (p) => String(p._thId) === String(a._reuseThId)
    );
    if (!partialEntry) {
      // _reuseThId trỏ vào 1 phòng không còn trong partialShared (đã đầy
      // hoặc bị filter mixedGender) — coi như inconsistent, từ chối.
      return {
        ok: false,
        reason: "reuse_stale",
        message: `Phòng ghép tại ${hotelName || "khách sạn"} đã thay đổi trạng thái trong khi xếp. Vui lòng đặt lại.`,
        assignments: [],
      };
    }
    const newUsed = (a.atoms || []).reduce(
      (s, x) => s + (Number(x.effectiveSize) || 0),
      0
    );
    if (partialEntry.used + newUsed > partialEntry.capacity) {
      return {
        ok: false,
        reason: "reuse_overcap",
        message:
          `Phòng ghép tại ${hotelName || "khách sạn"} không còn đủ chỗ ` +
          `(đã ${partialEntry.used}/${partialEntry.capacity}, cần thêm ${newUsed}). ` +
          `Vui lòng đặt lại hoặc chuyển sang ở riêng.`,
        assignments: [],
      };
    }
    const newGenders = new Set(
      (a.atoms || []).map((x) => x.gender).filter(Boolean)
    );
    if (newGenders.size > 1) {
      return {
        ok: false,
        reason: "reuse_mixed_gender_inside",
        message: `Phòng ghép tại ${hotelName || "khách sạn"} chứa atoms khác giới — không hợp lệ.`,
        assignments: [],
      };
    }
    const myGender = newGenders.size === 1 ? [...newGenders][0] : null;
    if (myGender && partialEntry.gender && myGender !== partialEntry.gender) {
      return {
        ok: false,
        reason: "reuse_mixed_gender",
        message:
          `Phòng ghép tại ${hotelName || "khách sạn"} đang là phòng ${
            partialEntry.gender === "male" ? "nam" : "nữ"
          }, không thể ghép thêm khách ${myGender === "male" ? "nam" : "nữ"}.`,
        assignments: [],
      };
    }
  }

  // 7. Chuẩn hóa kết quả
  const assignments = result.assignments.map((a) => ({
    roomTypeId: a.roomTypeId,
    roomTypeName: a.roomTypeName,
    baseOccupancy: a.capacity,
    gender: a.gender,
    atomAnchorIdxs: a.atoms.map((x) => x.anchorIdx),
    atomLabels: a.atoms.map((x) => x.label),
    usedCapacity: a.used,
    // _reuseThId: nếu có → controller phải gắn đơn này vào TH có _id này (phòng
    // ghép cross-order), KHÔNG chiếm TH mới. Nếu null → mở TH trống mới.
    _reuseThId: a._reuseThId || null,
  }));

  return { ok: true, assignments };
}

/**
 * Lấy các TH (Tour Hold HotelBooking) đang được dùng cho shared-mode còn slot
 * trống — phục vụ cho FFD ghép cross-order. Mỗi entry trả về tương đương 1
 * "phòng đang mở": cùng giới tính, còn `capacity - usedSize` chỗ.
 *
 * @param {{tourSegmentId:string, hotelId:string, fromDate:string|Date, toDate:string|Date}} input
 * @returns {Promise<Array<{
 *   _thId: string,
 *   roomTypeId: string,
 *   roomTypeName: string,
 *   capacity: number,
 *   gender: 'male'|'female',
 *   used: number,
 * }>>}
 */

// Trên KS này, trong khung ngày này, phòng vật lý nào đang ở ghép và còn chỗ trống để nhận thêm khách cùng giới tính?

// Phòng 301 (Standard, cap 2):

// Đơn A: 1 nữ đã xếp vào → used = 1
// Còn 1 chỗ cho nữ khác
// Đơn B (nữ) có thể ghép vào 301 thay vì mở phòng 302
// getPartialSharedRooms tìm các phòng kiểu đó và trả: [{ _thId: "301", roomTypeId: "301", roomTypeName: "Standard", capacity: 2, gender: "female", used: 1 }]

// Trong tour + KS + khung ngày này, phòng ở ghép nào đã có khách nhưng còn chỗ trống để đơn mới ghép thêm?
async function getPartialSharedRooms({
  tourSegmentId,
  hotelId,
  fromDate,
  toDate,
}) {
  const fromKey = _toDateKey(fromDate);
  const toKey = _toDateKey(toDate);
  if (!fromKey || !toKey || !hotelId || !tourSegmentId) return [];

  // 1) Lấy đầy đủ assignments của tour-segment (cùng tourId để match item).
  const seg = await TourSegment.findById(tourSegmentId)
    .select("assignments tourId")
    .lean();
  if (!seg || !Array.isArray(seg.assignments) || !seg.assignments.length) {
    return [];
  }

  // 2) Lấy tất cả TH HotelBooking thuộc segment+hotel+dates có roomId.
  const ths = await HotelBooking.find({
    tourSegmentId: String(tourSegmentId),
    "hotel.hotelId": hotelId,
    roomId: { $ne: null },
    status: { $nin: ["cancelled", "checked_out"] },
    checkIn: new Date(fromDate),
    checkOut: new Date(toDate),
  })
    .select("_id roomTypeId")
    .lean();
  const thById = {};
  for (const th of ths) thById[String(th._id)] = th;

  // 3) Build atoms cache (per orderId) để khi assignment có atomAnchorIdxs/
  //    atomLabels nhưng numPeople hoặc gender không khớp (do dữ liệu lưu cũ
  //    hoặc admin click bị bug), ta TÍNH LẠI từ passengers + ageBands hotel.
  //    `Order` đã được require ở đầu file.
  const _hotelAgeBands = await _getHotelAgeBands(hotelId);

  // ageBands của hotel có thể là dạng raw từ Mongo — chuẩn hoá về dạng helper
  // expect (countInOccupancy + occupancyWeight).
  const _normBands = (_hotelAgeBands || []).map((ab) => ({
    bandName: ab.bandName || "",
    minAge: typeof ab.minAge === "number" ? ab.minAge : 0,
    maxAge:
      ab.maxAge === null || ab.maxAge === undefined ? null : ab.maxAge,
    countInOccupancy: !!ab.countInOccupancy,
    occupancyWeight: ab.countInOccupancy ? ab.occupancyWeight ?? 1 : 0,
  }));

  // 1. Lấy tất cả assignments shared của tour-segment.
  const sharedAssigns = seg.assignments.filter(
    (a) => a && a.holdBookingId && a.accommodationMode === "shared" && thById[String(a.holdBookingId)]
  );
  const orderIds = [
    ...new Set(sharedAssigns.map((a) => String(a.orderId)).filter(Boolean)),
  ];
  const orderDocs = orderIds.length
    ? await Order.find({ _id: { $in: orderIds } }).select("items").lean()
    : [];
  const orderById = Object.fromEntries(orderDocs.map((o) => [String(o._id), o]));

  const atomsCache = {};
  const _getAtomsFor = (orderId) => {
    const k = String(orderId);
    if (atomsCache[k]) return atomsCache[k];
    const order = orderById[k];
    if (!order) {
      atomsCache[k] = [];
      return [];
    }
    const item = (order.items || []).find((it) => {
      if (String(it.tourId || "") !== String(seg.tourId || "")) {
        // tourId có thể không match (đơn cũ lưu khác struct) — fallback theo
        // accommodationMode + sharedRoomRequest chứa segment.
        return (
          it.accommodationMode === "shared" &&
          (it.sharedRoomRequest || []).some(
            (r) => String(r.tourSegmentId || "") === String(tourSegmentId)
          )
        );
      }
      return true;
    });
    const passengers = item?.passengers || [];
    if (!passengers.length) {
      atomsCache[k] = [];
      return [];
    }
    let atoms = [];
    try {
      atoms = buildAtomsFromPassengers(passengers, _normBands);
    } catch {
      atoms = [];
    }
    atomsCache[k] = atoms;
    return atoms;
  };

  function _resolveAssign(a) {
    const atoms = _getAtomsFor(a.orderId);
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
    const eff = picked.reduce(
      (s, x) => s + (Number(x.effectiveSize) || 0),
      0
    );
    const genderSet = new Set(picked.map((x) => x.gender).filter(Boolean));
    return {
      effectiveSize: eff,
      gender: genderSet.size === 1 ? [...genderSet][0] : null,
    };
  }

  // Group assignments theo holdBookingId; chỉ những TH có ít nhất 1
  //    assignment shared mới được coi là "đang mở".
  const grouped = {}; // thId → { entries[], roomTypeId, gender }
  for (const a of sharedAssigns) {
    const thId = String(a.holdBookingId);
    const th = thById[thId];

    // Recompute used + gender từ atom (ageBands hotel hiện tại). Fallback:
    // numPeople + gender lưu trong assignment (nếu không có atom info).
    const resolved = _resolveAssign(a);
    const usedAdd = resolved
      ? Math.max(0, resolved.effectiveSize)
      : Math.max(0, Number(a.numPeople) || 0);
    const genderAdd = resolved ? resolved.gender : a.gender || null;

    if (!grouped[thId]) {
      grouped[thId] = {
        thId,
        roomTypeId: String(th.roomTypeId || a.hotelId || ""),
        roomTypeName: a.roomTypeName || "",
        gender: genderAdd || null,
        usedSum: 0,
        mixedGender: false,
      };
    }

    // 2. Mỗi phòng đã dùng bao nhiêu chỗ ?
    grouped[thId].usedSum += usedAdd;
    if (!grouped[thId].gender && genderAdd) {
      grouped[thId].gender = genderAdd;
    } else if (
      grouped[thId].gender &&
      genderAdd &&
      grouped[thId].gender !== genderAdd
    ) {
      grouped[thId].mixedGender = true;
    }
  }

  // 3. Mỗi loại phòng được admin cấp bao nhiêu chỗ ?
  const quota = await resolveRoomQuotaForSegmentHotel({
    tourSegmentId,
    hotelId,
    fromDate,
    toDate,
  });
  const capByRoomType = {};
  for (const q of quota) capByRoomType[String(q.roomTypeId)] = q.capacity;

  const out = [];

  // 4. Lấy các phòng shared đã có người đang ở và còn chỗ trống để đơn mới ghép thêm.
  for (const thId of Object.keys(grouped)) {
    const g = grouped[thId];
    const cap = capByRoomType[String(g.roomTypeId)] || 0;
    if (cap <= 0) continue;
    // Mixed-gender room (do dữ liệu lỗi) — KHÔNG được dùng để ghép thêm.
    if (g.mixedGender) continue; // phòng ghép chứa atoms khác giới — không hợp lệ.
    if (!g.gender) continue; // không có gender → không thể ghép cùng giới
    const remaining = cap - g.usedSum; // số chỗ trống còn lại trong phòng.
    if (remaining <= 0) continue; // đầy thì bỏ
    out.push({
      _thId: thId,
      roomTypeId: g.roomTypeId,
      roomTypeName: g.roomTypeName,
      capacity: cap,
      gender: g.gender,
      used: g.usedSum,
    });
  }
  return out;
}

module.exports = {
  aggregateSharedDemand,
  resolveRoomQuotaForSegmentHotel,
  resolveAvailableRoomQuotaForSegmentHotel,
  evaluateSharedFeasibility,
  SHARED_INSUFFICIENT_ADULTS_MESSAGE,
  // V2 (passenger detail, single-hotel)
  aggregateSharedAtoms,
  evaluateSharedFeasibilityV2,
  // V2-Multi (passenger detail, multi-hotel pooling)
  aggregateSharedAtomsBySegment,
  evaluateSharedFeasibilityV2Multi,
  // Auto-assign cụ thể atoms → phòng vật lý
  countActiveBookedRoomsByType,
  assignSharedAtomsToRooms,
  getPartialSharedRooms,
};

// Phụ thuộc: helpers/shared-room-allocation.helper.js
// Kiểm thử nhanh: xem helpers/__tests__ (chưa tạo) hoặc node REPL.
//
// Một số ràng buộc thiết kế có ý đồ:
//   - Aggregate KHÔNG trừ Order hiện tại (excludeOrderId). Khi gọi từ
//     createPost, ta truyền `null` vì Order chưa được tạo. Ở luồng admin
//     edit (nếu sau này có), nhớ truyền `excludeOrderId`.
//   - Nếu admin đổi cấu hình `roomAllocations` của TourSegment sau khi đã có
//     đơn ở ghép, các đơn cũ KHÔNG được xếp lại tự động — hệ thống chỉ kiểm
//     tra cho đơn mới. Đây là chính sách "first-come-first-feasible".
