/**
 * Cấu trúc roomsData cho tìm kiếm / đặt phòng khách sạn:
 * [{ adults: [{ age }], children: [{ age }], babies: [{ age }] }]
 */

const AGE = {
  ADULT_MIN: 12,
  GUARDIAN_MIN: 18,
  CHILD_MIN: 3,
  CHILD_MAX: 12,
  BABY_MIN: 0,
  BABY_MAX: 2,
};

function _asAgeList(val, defaultAge) {
  if (typeof val === "number" && val > 0) {
    return Array.from({ length: val }, () => ({ age: defaultAge }));
  }
  if (Array.isArray(val)) {
    return val.map((item) => {
      if (item && typeof item === "object" && item.age !== undefined) {
        return { age: Number(item.age) };
      }
      return { age: Number(item) || defaultAge };
    });
  }
  return [];
}

/** Chuẩn hoá 1 phòng (hỗ trợ format cũ adults: number, children 0–17). */
function normalizeRoom(raw) {
  if (!raw || typeof raw !== "object") {
    return { adults: [{ age: AGE.GUARDIAN_MIN }], children: [], babies: [] };
  }

  let adults = _asAgeList(raw.adults, AGE.GUARDIAN_MIN);
  let children = _asAgeList(raw.children, 6);
  let babies = _asAgeList(raw.babies, 1);

  // Legacy: children 0–17 chưa tách babies
  if (!raw.babies && Array.isArray(raw.children) && raw.children.length > 0) {
    children = [];
    babies = [];
    raw.children.forEach((c) => {
      const age = Number(c?.age ?? c);
      if (age <= AGE.BABY_MAX) babies.push({ age });
      else if (age <= AGE.CHILD_MAX) children.push({ age });
      else adults.push({ age });
    });
  }

  if (
    adults.length === 0 &&
    children.length === 0 &&
    babies.length === 0
  ) {
    adults = [{ age: AGE.GUARDIAN_MIN }];
  }

  return { adults, children, babies };
}

function normalizeRoomsData(roomsData) {
  if (!Array.isArray(roomsData) || roomsData.length === 0) {
    return [{ adults: [{ age: AGE.GUARDIAN_MIN }], children: [], babies: [] }];
  }
  return roomsData.map(normalizeRoom);
}

function allGuestsInRoom(room) {
  const r = normalizeRoom(room);
  return [...r.adults, ...r.children, ...r.babies];
}

function countGuests(roomsData) {
  const rooms = normalizeRoomsData(roomsData);
  return rooms.reduce(
    (acc, room) => {
      acc.rooms += 1;
      acc.adults += room.adults.length;
      acc.children += room.children.length;
      acc.babies += room.babies.length;
      return acc;
    },
    { rooms: 0, adults: 0, children: 0, babies: 0 }
  );
}

function roomHasGuardian18(room) {
  return allGuestsInRoom(room).some(
    (g) => Number(g.age) >= AGE.GUARDIAN_MIN
  );
}

function validateGuestAge(type, age) {
  const n = Number(age);
  if (!Number.isFinite(n)) return false;
  if (type === "adults") return n >= AGE.ADULT_MIN;
  if (type === "children") return n >= AGE.CHILD_MIN && n <= AGE.CHILD_MAX;
  if (type === "babies") return n >= AGE.BABY_MIN && n <= AGE.BABY_MAX;
  return false;
}

function validateRoom(room, roomIndex = 0) {
  const r = normalizeRoom(room);
  const errors = [];
  const label = `Phòng ${roomIndex + 1}`;

  if (allGuestsInRoom(r).length === 0) {
    errors.push(`${label}: phải có ít nhất 1 khách.`);
    return errors;
  }

  r.adults.forEach((g, i) => {
    if (!validateGuestAge("adults", g.age)) {
      errors.push(
        `${label} — Người lớn ${i + 1}: tuổi phải từ ${AGE.ADULT_MIN} trở lên.`
      );
    }
  });
  r.children.forEach((g, i) => {
    if (!validateGuestAge("children", g.age)) {
      errors.push(
        `${label} — Trẻ em ${i + 1}: tuổi phải từ ${AGE.CHILD_MIN} đến ${AGE.CHILD_MAX}.`
      );
    }
  });
  r.babies.forEach((g, i) => {
    if (!validateGuestAge("babies", g.age)) {
      errors.push(
        `${label} — Em bé ${i + 1}: tuổi phải từ ${AGE.BABY_MIN} đến ${AGE.BABY_MAX}.`
      );
    }
  });

  if (!roomHasGuardian18(r)) {
    errors.push(
      `${label}: phải có ít nhất 1 khách từ ${AGE.GUARDIAN_MIN} tuổi trở lên.`
    );
  }

  return errors;
}

function validateRoomsData(roomsData) {
  const rooms = normalizeRoomsData(roomsData);
  return rooms.flatMap((room, i) => validateRoom(room, i));
}

/** Dữ liệu hiển thị phân bổ phòng trên hotel detail. */
function buildAllocationRoomsDisplay(roomsData) {
  return normalizeRoomsData(roomsData).map((room) => ({
    adults: room.adults,
    children: room.children,
    babies: room.babies,
    adultCount: room.adults.length,
    childCount: room.children.length,
    babyCount: room.babies.length,
  }));
}

function _formatGuestAges(guests) {
  if (!Array.isArray(guests) || guests.length === 0) return "";
  return guests.map((g) => `${g.age} tuổi`).join(", ");
}

/**
 * Chi tiết từng phòng cho admin (booking detail, quản lý phòng).
 * @param {Array} parsedRoomsData - mảng phòng đã parse từ roomsData
 * @param {{ onlyRoomIndex?: number }} opts - chỉ hiển thị 1 phòng (index 0-based, khi đã assign -R n)
 */
function buildAdminRoomsDetailsDisplay(parsedRoomsData, opts = {}) {
  if (!Array.isArray(parsedRoomsData) || parsedRoomsData.length === 0) {
    return [];
  }

  let slice = parsedRoomsData;
  let startIndex = 0;
  const onlyIdx = opts.onlyRoomIndex;
  if (
    onlyIdx !== undefined &&
    onlyIdx >= 0 &&
    onlyIdx < parsedRoomsData.length
  ) {
    slice = [parsedRoomsData[onlyIdx]];
    startIndex = onlyIdx;
  }

  return buildAllocationRoomsDisplay(slice).map((room, idx) => ({
    roomIndex: startIndex + idx + 1,
    adults: room.adultCount,
    children: room.childCount,
    babies: room.babyCount,
    adultsAges: _formatGuestAges(room.adults),
    childrenAges: _formatGuestAges(room.children) || "Không có",
    babiesAges: _formatGuestAges(room.babies) || "Không có",
  }));
}

module.exports = {
  AGE,
  normalizeRoom,
  normalizeRoomsData,
  allGuestsInRoom,
  countGuests,
  roomHasGuardian18,
  validateGuestAge,
  validateRoom,
  validateRoomsData,
  buildAllocationRoomsDisplay,
  buildAdminRoomsDetailsDisplay,
};
