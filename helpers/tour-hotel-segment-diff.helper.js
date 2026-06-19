// helpers/tour-hotel-segment-diff.helper.js
//
// So sánh cấu hình phòng theo hotelId khi company admin "Xác nhận lại"
// segment tour — chỉ KS thay đổi / mới / gỡ mới bị reset yêu cầu & hold.

const moment = require("moment");

const EFFECTIVE_LINK_STATUSES = new Set([
  "pending",
  "approved",
  "partially_approved",
]);

/**
 * Chuẩn hóa ngày về YYYY-MM-DD (UTC-neutral theo local calendar day).
 * @param {Date|string|number} d
 * @returns {string}
 */
function normalizeDateKey(d) {
  if (d == null || d === "") return "";
  const m = moment(d);
  if (!m.isValid()) return String(d).slice(0, 10);
  return m.format("YYYY-MM-DD");
}

/**
 * Một dòng trong "room plan" — khóa so sánh ổn định.
 * @typedef {{ roomTypeId: string, fromDate: string, toDate: string, assignedRooms: number, baseOccupancy: number }} RoomPlanEntry
 */

/**
 * @param {string} roomTypeId
 * @param {Date|string} fromDate
 * @param {Date|string} toDate
 * @param {number} assignedRooms
 * @param {number} [baseOccupancy]
 * @returns {RoomPlanEntry}
 */
function makePlanEntry(roomTypeId, fromDate, toDate, assignedRooms, baseOccupancy) {
  return {
    roomTypeId: String(roomTypeId || ""),
    fromDate: normalizeDateKey(fromDate),
    toDate: normalizeDateKey(toDate),
    assignedRooms: Math.max(0, Math.floor(Number(assignedRooms) || 0)),
    baseOccupancy: Math.max(1, Math.floor(Number(baseOccupancy) || 2)),
  };
}

/**
 * @param {RoomPlanEntry} a
 * @param {RoomPlanEntry} b
 * @returns {number}
 */
function comparePlanEntries(a, b) {
  const keys = ["roomTypeId", "fromDate", "toDate", "assignedRooms", "baseOccupancy"];
  for (const k of keys) {
    if (a[k] < b[k]) return -1;
    if (a[k] > b[k]) return 1;
  }
  return 0;
}

/**
 * @param {RoomPlanEntry[]} entries
 * @returns {string}
 */
function fingerprintPlan(entries) {
  const sorted = [...entries].sort(comparePlanEntries);
  return JSON.stringify(sorted);
}

/**
 * Gom room plan của một hotel từ tourSeg.segments.
 * @param {Array} segments
 * @param {string} hotelId
 * @returns {RoomPlanEntry[]}
 */
function buildRoomPlanFromSegments(segments, hotelId) {
  const hid = String(hotelId);
  const out = [];
  for (const seg of segments || []) {
    const checkIn = seg.fromDate;
    const checkOut = seg.toDate;
    for (const hotelEntry of seg.hotels || []) {
      if (String(hotelEntry.hotelId) !== hid) continue;
      for (const ra of hotelEntry.roomAllocations || []) {
        const assigned = Number(ra.assignedRooms) || 0;
        if (assigned <= 0) continue;
        out.push(
          makePlanEntry(
            ra.roomTypeId,
            checkIn,
            checkOut,
            assigned,
            ra.baseOccupancy
          )
        );
      }
    }
  }
  return out;
}

/**
 * @param {Array} requestedRooms — schema HotelLinkRequest.requestedRooms
 * @returns {RoomPlanEntry[]}
 */
function buildRoomPlanFromLinkRequest(requestedRooms) {
  const out = [];
  for (const rr of requestedRooms || []) {
    const assigned = Number(rr.assignedRooms) || 0;
    if (assigned <= 0) continue;
    out.push(
      makePlanEntry(
        rr.roomTypeId,
        rr.fromDate,
        rr.toDate,
        assigned,
        rr.baseOccupancy
      )
    );
  }
  return out;
}

/**
 * Tập hotelId có trong cấu hình segment hiện tại.
 * @param {Array} segments
 * @returns {Set<string>}
 */
function collectHotelIdsInSegments(segments) {
  const set = new Set();
  for (const seg of segments || []) {
    for (const h of seg.hotels || []) {
      if (h.hotelId) set.add(String(h.hotelId));
    }
  }
  return set;
}

/**
 * Lấy request mới nhất theo hotelId (createdAt giảm dần).
 * @param {Array<{ hotelId: *, status: string, requestedRooms: Array, createdAt?: Date, hotelName?: string }>} linkRequests
 * @returns {Map<string, object>}
 */
function pickLatestRequestPerHotelMap(linkRequests) {
  const sorted = [...(linkRequests || [])].sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return tb - ta;
  });
  const map = new Map();
  for (const r of sorted) {
    const key = String(r.hotelId);
    if (map.has(key)) continue;
    map.set(key, r);
  }
  return map;
}

/**
 * @param {RoomPlanEntry[]} a
 * @param {RoomPlanEntry[]} b
 * @returns {boolean}
 */
function roomPlansEqual(a, b) {
  return fingerprintPlan(a) === fingerprintPlan(b);
}

/**
 * Phân loại KS khi xác nhận lại segment.
 *
 * @param {{
 *   currentSegments: Array,
 *   linkRequests: Array,
 * }} input
 * @returns {{
 *   unchangedHotelIds: string[],
 *   changedHotelIds: string[],
 *   addedHotelIds: string[],
 *   removedHotelIds: string[],
 *   affectedHotelIds: string[],
 *   needsNewRequestHotelIds: string[],
 * }}
 */
function diffHotelsForConfirm({ currentSegments, linkRequests }) {
  const inConfig = collectHotelIdsInSegments(currentSegments);
  const latestMap = pickLatestRequestPerHotelMap(linkRequests);

  const unchangedHotelIds = [];
  const changedHotelIds = [];
  const addedHotelIds = [];
  const removedHotelIds = [];

  for (const hotelId of inConfig) {
    const latest = latestMap.get(hotelId);
    const currentPlan = buildRoomPlanFromSegments(currentSegments, hotelId);

    if (!latest || !EFFECTIVE_LINK_STATUSES.has(latest.status)) {
      addedHotelIds.push(hotelId);
      continue;
    }

    const baselinePlan = buildRoomPlanFromLinkRequest(latest.requestedRooms || []);
    if (roomPlansEqual(currentPlan, baselinePlan)) {
      unchangedHotelIds.push(hotelId);
    } else {
      changedHotelIds.push(hotelId);
    }
  }

  for (const [hotelId, latest] of latestMap) {
    if (inConfig.has(hotelId)) continue;
    if (!EFFECTIVE_LINK_STATUSES.has(latest.status)) continue;
    removedHotelIds.push(hotelId);
  }

  const affectedHotelIds = [
    ...new Set([...changedHotelIds, ...addedHotelIds, ...removedHotelIds]),
  ];
  const needsNewRequestHotelIds = [...new Set([...changedHotelIds, ...addedHotelIds])];

  return {
    unchangedHotelIds,
    changedHotelIds,
    addedHotelIds,
    removedHotelIds,
    affectedHotelIds,
    needsNewRequestHotelIds,
  };
}

module.exports = {
  normalizeDateKey,
  buildRoomPlanFromSegments,
  buildRoomPlanFromLinkRequest,
  collectHotelIdsInSegments,
  pickLatestRequestPerHotelMap,
  roomPlansEqual,
  fingerprintPlan,
  diffHotelsForConfirm,
  EFFECTIVE_LINK_STATUSES,
};
