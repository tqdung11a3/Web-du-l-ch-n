// helpers/private-room-assignment.helper.js
//
// Validate phân bổ hành khách vào từng phòng vật lý cho mode "Ở riêng".
//
// Quy tắc nghiệp vụ:
//   - Mỗi adult/child phải nằm trong đúng 1 phòng/segment, không trùng giữa các phòng.
//   - Em bé (baby) là tùy chọn — cho phép bỏ trống.
//   - Σ occupancyWeight (theo Hotel.ageBands) trong từng phòng ≤ baseOccupancy.
//   - child/baby được gán phải ở cùng phòng với guardian (adult). Nếu chưa
//     gán guardian → fail.
//   - Tổng adult+child gán hết = quantityAdult + quantityChildren.
//
// Server-side dùng làm sanity check chống bypass UI. Đơn cũ không có
// roomAssignments / passengers → bỏ qua check (giữ backward compat).

const { _weightForAge } = require("./passenger-atom.helper");

/** Tuổi tối thiểu để được coi là người lớn đại diện phòng (ở riêng). */
const PRIVATE_ROOM_ADULT_MIN_AGE = 18;

const moment = require("moment");

/** Tổng số phòng trong một khung (fromDate → toDate). */
function _segmentKeyFromSelection(rs) {
  const from = rs.fromDate
    ? moment(rs.fromDate).format("YYYY-MM-DD")
    : String(rs.fromDate || "");
  const to = rs.toDate
    ? moment(rs.toDate).format("YYYY-MM-DD")
    : String(rs.toDate || "");
  return `${from}|${to}`;
}

/**
 * Số phòng tối đa trong một khung thời gian lưu trú (không cộng các khung).
 * Khách không ở đồng thời tất cả khung → NL tối thiểu = max theo khung.
 */
function maxPrivateRoomsInAnySegment(roomSelections) {
  const bySeg = new Map();
  for (const rs of roomSelections || []) {
    const key = _segmentKeyFromSelection(rs);
    const prev = bySeg.get(key) || 0;
    bySeg.set(
      key,
      prev + Math.max(0, Math.floor(Number(rs.selectedRooms) || 0))
    );
  }
  let maxRooms = 0;
  for (const n of bySeg.values()) {
    if (n > maxRooms) maxRooms = n;
  }
  return maxRooms;
}

/** @deprecated dùng maxPrivateRoomsInAnySegment — giữ tên cũ nếu có import */
function countPrivateSelectedRooms(roomSelections) {
  return maxPrivateRoomsInAnySegment(roomSelections);
}

/**
 * Thông báo khi thiếu người đủ 18 tuổi cho rule phân phòng (khác NL theo giá tour ≥12).
 */
function formatPrivateMinAdultsRequiredMessage(minRooms, adults18Count) {
  const n = Math.max(0, Math.floor(Number(minRooms) || 0));
  const c = Math.max(0, Math.floor(Number(adults18Count) || 0));
  return (
    `Khung thời gian có nhiều phòng nhất yêu cầu ${n} phòng. ` +
    `Mỗi phòng cần ít nhất 1 người từ ${PRIVATE_ROOM_ADULT_MIN_AGE} tuổi trở lên. ` +
    `Hiện tại, đoàn có ${c} người từ ${PRIVATE_ROOM_ADULT_MIN_AGE} tuổi trở lên. ` +
    `Vui lòng bổ sung người từ ${PRIVATE_ROOM_ADULT_MIN_AGE} tuổi trở lên hoặc điều chỉnh số lượng phòng/khách.`
  );
}

function countAdults18PlusInPassengers(passengers) {
  return (passengers || []).filter(
    (p) =>
      p.type === "adult" &&
      Math.max(0, Math.floor(Number(p.age) || 0)) >= PRIVATE_ROOM_ADULT_MIN_AGE
  ).length;
}

/**
 * Mỗi phòng trong từng khung cần ≥ 1 NL từ PRIVATE_ROOM_ADULT_MIN_AGE tuổi.
 * → quantityAdult ≥ số phòng nhiều nhất trong một khung (không cộng các khung).
 */
function validatePrivateMinAdultsForItem(item) {
  const errors = [];
  if (!item || item.accommodationMode !== "private") {
    return { ok: true, errors };
  }
  const minAdultsRequired = maxPrivateRoomsInAnySegment(item.roomSelections);
  if (minAdultsRequired <= 0) return { ok: true, errors };

  const passengers = Array.isArray(item.passengers) ? item.passengers : [];
  const adults18 = countAdults18PlusInPassengers(passengers);
  const qa = Math.max(0, Math.floor(Number(item.quantityAdult) || 0));

  if (qa < minAdultsRequired || adults18 < minAdultsRequired) {
    errors.push(
      formatPrivateMinAdultsRequiredMessage(minAdultsRequired, adults18)
    );
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Tính sức chứa quy đổi cho 1 passenger theo ageBands.
 * @param {{ age: number, type: string }} passenger
 * @param {Array} ageBands
 * @returns {number}
 */
function computeUsedCapacity(passenger, ageBands) {
  if (!passenger) return 0;
  const age = Math.max(0, Math.floor(Number(passenger.age) || 0));
  const type =
    passenger.type === "child" || passenger.type === "baby"
      ? passenger.type
      : "adult";
  return _weightForAge(age, type, ageBands || []);
}

/**
 * Resolve ageBands của 1 hotel trong segment (lấy từ `segmentHotels`).
 * @param {string} hotelId
 * @param {Array} segmentHotels  // [{ hotelId, ageBands, ... }]
 * @returns {Array}
 */
function _resolveAgeBands(hotelId, segmentHotels) {
  if (!Array.isArray(segmentHotels)) return [];
  const found = segmentHotels.find(
    (h) => String(h.hotelId) === String(hotelId)
  );
  return found && Array.isArray(found.ageBands) ? found.ageBands : [];
}

/**
 * Validate roomAssignments của 1 item private mode.
 *
 * @param {Object} params
 * @param {Object} params.item - phần tử trong order.items
 * @param {Map<string, Array>} [params.hotelsByTourSegmentId]
 *        // optional: tourSegmentId -> [{ hotelId, ageBands, ... }]
 *        // Nếu không truyền, sẽ best-effort tính sức chứa với ageBands rỗng
 *        // (fallback weight theo type).
 * @returns {{ ok: boolean, errors: string[] }}
 */
function validatePrivateAssignmentsForItem({ item, hotelsByTourSegmentId }) {
  const errors = [];
  if (!item || item.accommodationMode !== "private") {
    return { ok: true, errors };
  }
  const passengers = Array.isArray(item.passengers) ? item.passengers : [];
  const roomSelections = Array.isArray(item.roomSelections)
    ? item.roomSelections
    : [];

  // Đơn cũ: không có passengers/roomAssignments → skip (backward compat).
  const hasAnyAssignment = roomSelections.some(
    (rs) => Array.isArray(rs.roomAssignments) && rs.roomAssignments.length > 0
  );
  if (passengers.length === 0 || !hasAnyAssignment) {
    return { ok: true, errors };
  }

  const adults = Math.max(0, Math.floor(Number(item.quantityAdult) || 0));
  const children = Math.max(0, Math.floor(Number(item.quantityChildren) || 0));
  const requiredCount = adults + children;

  const passengersByIdx = new Map();
  passengers.forEach((p) => {
    if (typeof p.idx === "number") passengersByIdx.set(p.idx, p);
  });

  // Group selections theo segmentKey để check no-duplicate trong cùng segment.
  const segmentMap = new Map();
  roomSelections.forEach((rs) => {
    const segKey = `${rs.fromDate || ""}|${rs.toDate || ""}|${rs.tourSegmentId || ""}`;
    if (!segmentMap.has(segKey)) {
      segmentMap.set(segKey, {
        tourSegmentId: rs.tourSegmentId,
        fromDate: rs.fromDate,
        toDate: rs.toDate,
        selections: [],
      });
    }
    segmentMap.get(segKey).selections.push(rs);
  });

  segmentMap.forEach((seg) => {
    const segLabel =
      `${seg.fromDate || "?"} → ${seg.toDate || "?"}`;
    const idxToRoomKey = new Map();
    const assignedAdultsAndChildren = new Set();

    seg.selections.forEach((rs) => {
      const ageBands = _resolveAgeBands(
        rs.hotelId,
        hotelsByTourSegmentId
          ? hotelsByTourSegmentId.get(String(rs.tourSegmentId)) || []
          : []
      );
      const baseOccupancy = Math.max(
        1,
        Math.floor(Number(rs.baseOccupancy) || 1)
      );
      const selectedRooms = Math.max(
        0,
        Math.floor(Number(rs.selectedRooms) || 0)
      );
      const assignments = Array.isArray(rs.roomAssignments)
        ? rs.roomAssignments
        : [];

      // Số phòng vật lý phải khớp selectedRooms (hoặc <=, vì có thể bỏ trống).
      if (assignments.length > selectedRooms) {
        errors.push(
          `${segLabel} · ${rs.roomTypeName || "phòng"}: số nhóm phân bổ (${assignments.length}) vượt số phòng đã chọn (${selectedRooms}).`
        );
      }

      assignments.forEach((a, i) => {
        const roomKey = `${rs.tourSegmentId}|${rs.hotelId}|${rs.roomTypeId}|${i}`;
        const idxs = Array.isArray(a.passengerIdxs) ? a.passengerIdxs : [];
        let used = 0;
        idxs.forEach((idx) => {
          const p = passengersByIdx.get(idx);
          if (!p) {
            errors.push(
              `${segLabel} · phòng ${rs.roomTypeName} #${i + 1}: hành khách idx=${idx} không tồn tại trong danh sách.`
            );
            return;
          }
          if (idxToRoomKey.has(idx)) {
            errors.push(
              `${segLabel} · ${p.name || "Hành khách #" + (idx + 1)} bị gán vào nhiều phòng cùng khung.`
            );
          } else {
            idxToRoomKey.set(idx, roomKey);
          }
          used += computeUsedCapacity(p, ageBands);
          if (p.type !== "baby") assignedAdultsAndChildren.add(idx);
        });
        if (used > baseOccupancy + 1e-9) {
          errors.push(
            `${segLabel} · phòng ${rs.roomTypeName} #${i + 1} (${rs.hotelName || ""}): vượt sức chứa (${used.toFixed(2)} / ${baseOccupancy}).`
          );
        }
        if (idxs.length > 0) {
          const adultsInRoom = idxs
            .map((idx) => passengersByIdx.get(idx))
            .filter((p) => p && p.type === "adult");
          const hasAdult18Plus = adultsInRoom.some(
            (p) =>
              Math.max(0, Math.floor(Number(p.age) || 0)) >=
              PRIVATE_ROOM_ADULT_MIN_AGE
          );
          if (!hasAdult18Plus) {
            errors.push(
              `${segLabel} · phòng ${rs.roomTypeName} #${i + 1} (${rs.hotelName || ""}): ` +
                `phòng phải có ít nhất 1 người lớn từ ${PRIVATE_ROOM_ADULT_MIN_AGE} tuổi trở lên.`
            );
          }
        }
      });
    });

    if (assignedAdultsAndChildren.size < requiredCount) {
      errors.push(
        `${segLabel}: chưa gán đủ hành khách (đã gán ${assignedAdultsAndChildren.size}/${requiredCount} người lớn + trẻ em).`
      );
    }

    // Ở riêng (private) không có guardian — bỏ qua kiểm tra này.
  });

  return { ok: errors.length === 0, errors };
}

/**
 * Validate tất cả items trong order. Trả gộp errors.
 * @param {{ items: Array, hotelsByTourSegmentId?: Map<string, Array> }} params
 * @returns {{ ok: boolean, errors: string[] }}
 */
function validatePrivateAssignments({ items, hotelsByTourSegmentId }) {
  const errors = [];
  if (!Array.isArray(items)) return { ok: true, errors };
  for (const item of items) {
    const r = validatePrivateAssignmentsForItem({
      item,
      hotelsByTourSegmentId,
    });
    if (!r.ok) errors.push(...r.errors);
  }
  return { ok: errors.length === 0, errors };
}

module.exports = {
  PRIVATE_ROOM_ADULT_MIN_AGE,
  maxPrivateRoomsInAnySegment,
  countPrivateSelectedRooms,
  formatPrivateMinAdultsRequiredMessage,
  countAdults18PlusInPassengers,
  validatePrivateMinAdultsForItem,
  computeUsedCapacity,
  validatePrivateAssignmentsForItem,
  validatePrivateAssignments,
};
