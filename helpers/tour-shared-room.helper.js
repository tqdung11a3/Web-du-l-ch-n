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
} = require("./passenger-atom.helper");

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

  const rooms = await resolveRoomQuotaForSegmentHotel({
    tourSegmentId: request.tourSegmentId,
    hotelId: request.hotelId,
    fromDate: request.fromDate,
    toDate: request.toDate,
  });
  if (rooms.length === 0) {
    return {
      ok: false,
      reason: "no_quota",
      message: `Tour chưa cấu hình phòng cho ${hotelName} trong khung này. Vui lòng liên hệ tổ chức.`,
    };
  }

  const aggregated = await aggregateSharedDemand({
    tourSegmentId: request.tourSegmentId,
    hotelId: request.hotelId,
    fromDate: request.fromDate,
    toDate: request.toDate,
    excludeOrderId: request.excludeOrderId || null,
  });

  const totalMales = aggregated.males + males;
  const totalFemales = aggregated.females + females;

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

  const otherMales = aggregated.males;
  const otherFemales = aggregated.females;
  const maxFeasible = result.maxFeasible || { males: 0, females: 0 };
  // Số chỗ tối đa còn nhận được cho khách HIỆN TẠI sau khi trừ phần đã giữ.
  const allowedMales = Math.max(0, maxFeasible.males - otherMales);
  const allowedFemales = Math.max(0, maxFeasible.females - otherFemales);

  let message;
  if (otherMales || otherFemales) {
    message =
      `Không đủ chỗ ở ghép tại ${hotelName}. ` +
      `Đã có ${otherMales} nam và ${otherFemales} nữ đăng ký ở ghép trước đó; ` +
      `bạn yêu cầu thêm ${males} nam và ${females} nữ — tổng ${totalMales} nam, ${totalFemales} nữ vượt khả năng phòng còn lại. ` +
      `Tối đa bạn có thể đăng ký thêm ${allowedMales} nam và ${allowedFemales} nữ.`;
  } else {
    message =
      `Không đủ chỗ ở ghép tại ${hotelName} cho ${males} nam và ${females} nữ. ` +
      `Số phòng cấu hình chỉ đáp ứng tối đa ${allowedMales} nam và ${allowedFemales} nữ trong khung này.`;
  }

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

  const rooms = await resolveRoomQuotaForSegmentHotel({
    tourSegmentId: request.tourSegmentId,
    hotelId: request.hotelId,
    fromDate: request.fromDate,
    toDate: request.toDate,
  });
  if (rooms.length === 0) {
    return {
      ok: false,
      reason: "no_quota",
      message: `Tour chưa cấu hình phòng cho ${hotelName} trong khung này. Vui lòng liên hệ tổ chức.`,
    };
  }

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

  // Aggregate atoms từ Order khác.
  const aggregated = await aggregateSharedAtoms({
    tourSegmentId: request.tourSegmentId,
    hotelId: request.hotelId,
    fromDate: request.fromDate,
    toDate: request.toDate,
    excludeOrderId: request.excludeOrderId || null,
    ageBands,
  });

  const allAtoms = [...aggregated.atoms, ...currentAtoms];

  const result = canAllocateAtomicGroups({
    atoms: allAtoms,
    rooms: rooms.map((r) => ({ capacity: r.capacity, count: r.count })),
  });

  if (result.ok) return { ok: true, detail: result.detail };

  // Build message thân thiện.
  const otherCount = aggregated.atoms.length;
  const otherSize = aggregated.atoms.reduce((s, a) => s + a.effectiveSize, 0);
  const curSize = currentAtoms.reduce((s, a) => s + a.effectiveSize, 0);

  let message;
  if (result.reason === "atom_too_large") {
    message =
      `Có nhóm gia đình (1 người lớn + trẻ em đi cùng) tổng sức chứa ${result.detail.largestAtom} ` +
      `vượt sức chứa phòng lớn nhất ${result.detail.largestRoom} của ${hotelName}. ` +
      `Bạn cần giảm số trẻ em đi cùng 1 người lớn hoặc chuyển sang ở riêng.`;
  } else if (result.reason === "exceeds_total_capacity") {
    if (otherCount > 0) {
      message =
        `Không đủ chỗ ở ghép tại ${hotelName}. ` +
        `Đã có ${otherCount} người (sức chứa ${otherSize}) đăng ký ở ghép trước đó; ` +
        `bạn yêu cầu thêm ${currentAtoms.length} nhóm (sức chứa ${curSize}). ` +
        `Tổng sức chứa cần (${otherSize + curSize}) vượt tổng phòng còn lại (${result.detail.totalCapacity}).`;
    } else {
      message =
        `Không đủ chỗ ở ghép tại ${hotelName} cho đoàn của bạn (sức chứa ${curSize}). ` +
        `Tổng phòng cấu hình chỉ đáp ứng tối đa ${result.detail.totalCapacity} người.`;
    }
  } else if (result.reason === "cannot_split_by_gender") {
    message =
      `Không thể tách ghép phòng theo giới tính tại ${hotelName} với cấu hình hiện tại. ` +
      (otherCount > 0
        ? `Đã có ${otherCount} người ở ghép trước đó nên các phòng còn lại không đủ chia nam/nữ. `
        : "") +
      `Bạn có thể điều chỉnh người trông trẻ trong đoàn hoặc chuyển sang ở riêng.`;
  } else {
    message = `Phương án ở ghép hiện tại không khả thi tại ${hotelName}.`;
  }

  return {
    ok: false,
    reason: result.reason,
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
async function evaluateSharedFeasibilityV2Multi(request) {
  const incomingHotels = Array.isArray(request.hotels) ? request.hotels : [];
  if (incomingHotels.length === 0) {
    return {
      ok: false,
      reason: "no_hotels",
      message: `Tour chưa cấu hình khách sạn nào trong khung lưu trú này.`,
    };
  }

  // Resolve room quota & ageBands cho từng hotel ứng viên.
  const hotelsResolved = [];
  for (const h of incomingHotels) {
    const rooms = await resolveRoomQuotaForSegmentHotel({
      tourSegmentId: request.tourSegmentId,
      hotelId: h.hotelId,
      fromDate: request.fromDate,
      toDate: request.toDate,
    });
    if (rooms.length === 0) continue; // hotel không có cấu hình phòng → bỏ
    const ageBands = await _getHotelAgeBands(h.hotelId);
    hotelsResolved.push({
      hotelId: String(h.hotelId),
      hotelName: h.hotelName || "",
      ageBands,
      rooms: rooms.map((r) => ({ capacity: r.capacity, count: r.count })),
    });
  }

  if (hotelsResolved.length === 0) {
    return {
      ok: false,
      reason: "no_quota",
      message: `Tour chưa cấu hình phòng cho khách sạn nào trong khung này. Vui lòng liên hệ tổ chức.`,
    };
  }

  // Build atoms cho đoàn hiện tại (ageBands rỗng → reweight per hotel).
  let currentAtoms = [];
  try {
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

  // Aggregate atoms hiện hữu theo hotel.
  const aggregated = await aggregateSharedAtomsBySegment({
    tourSegmentId: request.tourSegmentId,
    fromDate: request.fromDate,
    toDate: request.toDate,
    excludeOrderId: request.excludeOrderId || null,
  });

  const result = canAllocateAtomicGroupsAcrossHotels({
    currentAtoms,
    hotels: hotelsResolved,
    existingAtomsByHotel: aggregated.byHotel,
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

  // Build message thân thiện.
  const hotelNames = hotelsResolved.map((h) => h.hotelName || "(?)").join(", ");
  let message;
  if (result.reason === "atom_too_large") {
    const offending = result.detail?.largestAtomLabel || "?";
    message =
      `Nhóm "${offending}" có sức chứa quy đổi vượt phòng lớn nhất tại ` +
      `tất cả các khách sạn trong khung này (${hotelNames}). ` +
      `Hãy giảm số trẻ em đi cùng người lớn này hoặc chuyển sang ở riêng.`;
  } else if (result.reason === "no_hotels") {
    message = `Tour chưa cấu hình khách sạn nào trong khung lưu trú này.`;
  } else {
    const placed = (result.allocations || []).reduce(
      (s, a) => s + a.atoms.length,
      0
    );
    const leftover = result.leftover || [];
    const leftoverLabels = leftover.map((a) => a.label || "?").join(", ");
    if (placed > 0) {
      message =
        `Đã thử kết hợp ${hotelsResolved.length} khách sạn (${hotelNames}) ` +
        `nhưng vẫn còn ${leftover.length} nhóm chưa có chỗ (${leftoverLabels}). ` +
        `Vui lòng điều chỉnh người trông trẻ trong đoàn hoặc chuyển sang ở riêng.`;
    } else {
      message =
        `Không có khách sạn nào trong khung này còn đủ chỗ ở ghép cho đoàn của bạn. ` +
        `Vui lòng điều chỉnh số lượng/cấu hình hoặc chuyển sang ở riêng.`;
    }
  }

  return { ok: false, reason: result.reason, message, detail: result.detail };
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
async function countActiveBookedRoomsByType({
  tourSegmentId,
  hotelId,
  fromDate,
  toDate,
}) {
  const fromKey = _toDateKey(fromDate);
  const toKey = _toDateKey(toDate);
  if (!fromKey || !toKey || !hotelId || !tourSegmentId) return {};

  const now = new Date();
  // Lưu ý: bỏ qua các bản ghi "[Tour Hold]" (placeholder do admin tạo để giữ
  // quota cho tour) — đó là CHÍNH quota, không phải phòng đã có khách.
  // Chỉ đếm các HotelBooking thuộc về 1 đơn khách thật (orderCode).
  const docs = await HotelBooking.find({
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
  })
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
async function assignSharedAtomsToRooms({
  tourSegmentId,
  hotelId,
  hotelName,
  ageBands,
  fromDate,
  toDate,
  atoms,
}) {
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
  const booked = await countActiveBookedRoomsByType({
    tourSegmentId,
    hotelId,
    fromDate,
    toDate,
  });
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

  if (physicalRooms.length === 0 && partialShared.length === 0) {
    return {
      ok: false,
      reason: "no_capacity_left",
      message: `Khách sạn ${hotelName || ""} không còn phòng trống để xếp ở ghép.`,
      assignments: [],
    };
  }

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
async function getPartialSharedRooms({
  tourSegmentId,
  hotelId,
  fromDate,
  toDate,
}) {
  const fromKey = _toDateKey(fromDate);
  const toKey = _toDateKey(toDate);
  if (!fromKey || !toKey || !hotelId || !tourSegmentId) return [];

  // 1) Lấy đầy đủ assignments của tour-segment.
  const seg = await TourSegment.findById(tourSegmentId)
    .select("assignments")
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

  // 3) Group assignments theo holdBookingId; chỉ những TH có ít nhất 1
  //    assignment shared mới được coi là "đang mở".
  const grouped = {}; // thId → { entries[], roomTypeId, gender }
  for (const a of seg.assignments) {
    if (!a.holdBookingId) continue;
    if (a.accommodationMode !== "shared") continue;
    const thId = String(a.holdBookingId);
    const th = thById[thId];
    if (!th) continue; // TH không thuộc khung này — bỏ qua
    if (!grouped[thId]) {
      grouped[thId] = {
        thId,
        roomTypeId: String(th.roomTypeId || a.hotelId || ""),
        roomTypeName: a.roomTypeName || "",
        gender: a.gender || null,
        usedSum: 0,
      };
    }
    grouped[thId].usedSum += Math.max(0, Number(a.numPeople) || 0);
    if (!grouped[thId].gender && a.gender) grouped[thId].gender = a.gender;
  }

  // 4) Build kết quả — cần resolve capacity từ Hotel.roomTypes (qua quota).
  const quota = await resolveRoomQuotaForSegmentHotel({
    tourSegmentId,
    hotelId,
    fromDate,
    toDate,
  });
  const capByRoomType = {};
  for (const q of quota) capByRoomType[String(q.roomTypeId)] = q.capacity;

  const out = [];
  for (const thId of Object.keys(grouped)) {
    const g = grouped[thId];
    const cap = capByRoomType[String(g.roomTypeId)] || 0;
    if (cap <= 0) continue;
    if (!g.gender) continue; // không có gender → không thể ghép cùng giới
    const remaining = cap - g.usedSum;
    if (remaining <= 0) continue;
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
  evaluateSharedFeasibility,
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
