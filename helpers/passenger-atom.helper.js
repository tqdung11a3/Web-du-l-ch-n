// helpers/passenger-atom.helper.js
//
// Quy đổi danh sách hành khách (passengers) thành các "atoms" cho thuật toán
// xếp ghép phòng. Mỗi atom là 1 cụm-bất-khả-tách: 1 người lớn từ 18 tuổi +
// tất cả TE/EB và NL dưới 18 tuổi có guardianIdx trỏ tới người đó.
//
// Atom giữ luôn ràng buộc về giới tính (theo người lớn) và sức chứa quy đổi
// (Σ occupancyWeight của các thành viên theo Hotel.ageBands).
//
// Cách dùng:
//   const atoms = buildAtomsFromPassengers(passengers, hotelAgeBands);
//   // → [{ gender: "male"|"female", effectiveSize, members: [...], label }]

/**
 * @typedef {{
 *   idx:         number,
 *   name:        string,
 *   age:         number,
 *   type:        'adult'|'child'|'baby',
 *   gender:      'male'|'female'|null,
 *   guardianIdx: number|null,
 * }} Passenger
 *
 * @typedef {{
 *   minAge:           number,
 *   maxAge:           number|null,
 *   bandType:         'infant'|'child'|'adult'|'other',
 *   countInOccupancy: boolean,
 *   occupancyWeight:  0|0.5|1,
 * }} AgeBand
 *
 * @typedef {{
 *   gender:        'male'|'female',
 *   effectiveSize: number,
 *   members:       Passenger[],
 *   anchorIdx:     number,
 *   label:         string,
 * }} Atom
 */

// File này làm một việc chính: biến danh sách hành khách → atoms để xếp phòng ghép

/** Tuổi tối thiểu để làm người lớn đi cùng (anchor atom) khi ở ghép. */
const GUARDIAN_MIN_AGE = 18;

/**
 * Hành khách cần chọn người lớn đi cùng (TE, EB, hoặc NL tính giá NL nhưng < 18 tuổi).
 * @param {{ type: string, age: number }} p
 * @param {number} [minAge]
 */
function passengerNeedsGuardian(p, minAge = GUARDIAN_MIN_AGE) {
  if (p.type === "child" || p.type === "baby") return true;
  if (p.type === "adult") return p.age < minAge;
  return false;
}

/** Người lớn đủ tuổi làm anchor atom / người đi cùng (TE, NL trẻ). */
function isAnchorAdult(p, minAge = GUARDIAN_MIN_AGE) {
  return p.type === "adult" && p.age >= minAge;
}

/** Em bé ghế riêng không cần chọn người đi cùng. */
function babyNeedsGuardian(p) {
  if (p.type !== "baby") return passengerNeedsGuardian(p);
  if (p.babySeatType === "private") return false;
  return true;
}

/** Người lớn trong đoàn (mọi tuổi tính giá NL). */
function isAdultPassenger(p) {
  return !!(p && p.type === "adult");
}

function _atomLabelFromMembers(anchor, members) {
  const labelDeps = members
    .filter((m) => m.idx !== anchor.idx)
    .map((m) => {
      if (m.type === "child") return `TE ${m.name || "?"}`;
      if (m.type === "baby") return `EB ${m.name || "?"}`;
      return `${m.name || "?"} (${m.age}t)`;
    })
    .join(", ");
  return labelDeps ? `${anchor.name || "?"} (+ ${labelDeps})` : anchor.name || "?";
}

function _attachMemberToAtom(atom, member, ageBands) {
  if ((atom.members || []).some((m) => m.idx === member.idx)) return;
  atom.members.push(member);
  atom.effectiveSize = atom.members.reduce(
    (sum, m) => sum + _weightForAge(m.age, m.type, ageBands),
    0
  );
  const anchor = atom.members.find((m) => m.idx === atom.anchorIdx) || atom.members[0];
  atom.label = _atomLabelFromMembers(anchor, atom.members);
}

/**
 * Build atoms từ danh sách passengers.
 *
 * @param {Passenger[]} passengers
 * @param {AgeBand[]}   ageBands  Hotel.ageBands của hotel cụ thể (có thể rỗng)
 * @returns {Atom[]}
 * @throws {Error} nếu validation thất bại (TE/EB thiếu guardian, guardian sai)
 */
function buildAtomsFromPassengers(passengers, ageBands) {
  if (!Array.isArray(passengers) || passengers.length === 0) return [];

  const list = passengers.map((p, i) => {
    const guardianIdx =
      p.guardianIdx === null || p.guardianIdx === undefined
        ? null
        : Math.floor(Number(p.guardianIdx));
    // Em bé có thể có roomGuardianIdx riêng (NL ở cùng phòng KS, khác với
    // NL ngồi cùng trên tour). Khi xây atom ta DÙNG roomGuardianIdx.
    // Fallback về guardianIdx khi đơn cũ không có.
    const roomGuardianIdx =
      p.roomGuardianIdx === null || p.roomGuardianIdx === undefined
        ? null
        : Math.floor(Number(p.roomGuardianIdx));
    const type = p.type === "child" || p.type === "baby" ? p.type : "adult";
    return {
      idx: typeof p.idx === "number" ? p.idx : i,
      name: String(p.name || "").trim(),
      age: Math.max(0, Math.floor(Number(p.age) || 0)),
      type,
      gender: p.gender === "male" || p.gender === "female" ? p.gender : null,
      guardianIdx,
      // Atom anchor cho em bé: ưu tiên roomGuardianIdx, fallback guardianIdx
      roomGuardianIdx:
        type === "baby" && roomGuardianIdx !== null
          ? roomGuardianIdx
          : null,
      babySeatType:
        p.babySeatType === "private" || p.babySeatType === "shared"
          ? p.babySeatType
          : undefined,
    };
  });

  // Helper: em bé thuộc atom của ai? Ưu tiên roomGuardianIdx, fallback guardianIdx.
  const _babyAtomAnchorIdx = (p) =>
    p.type === "baby" && p.roomGuardianIdx !== null
      ? p.roomGuardianIdx
      : p.guardianIdx;

  // gom danh sách người lớn làm anchor atom
  const adults = list.filter((p) => p.type === "adult");
  const anchorAdults = [];

  // Kiểm tra người lớn đi cùng
  for (const a of adults) {
    if (!a.gender) {
      throw new Error(
        `Hành khách "${a.name || "(chưa có tên)"}" là người lớn nhưng chưa khai giới tính.`
      );
    }
    // Người lớn đủ 18 tuổi làm anchor atom
    if (isAnchorAdult(a)) {
      if (a.guardianIdx !== null) {
        throw new Error(
          `Hành khách "${a.name || "(chưa có tên)"}" từ ${GUARDIAN_MIN_AGE} tuổi trở lên không thể chọn người đi cùng.`
        );
      }
      anchorAdults.push(a);
    } else if (passengerNeedsGuardian(a)) {
      if (a.guardianIdx === null) {
        throw new Error(
          `Hành khách "${a.name || "(chưa có tên)"}" (${a.age} tuổi) chưa chọn người lớn đi cùng từ ${GUARDIAN_MIN_AGE} tuổi trở lên.`
        );
      }
    }
  }

  const anchorByIdx = new Map();
  for (const a of anchorAdults) anchorByIdx.set(a.idx, a);

  const adultByIdx = new Map(adults.map((a) => [a.idx, a]));

  // validate những người cần người lớn đi cùng
  const dependents = list.filter((p) => {
    if (p.type === "baby") return babyNeedsGuardian(p);
    return passengerNeedsGuardian(p);
  });

  for (const d of dependents) {
    if (d.guardianIdx === null) {
      const who =
        d.type === "child"
          ? "Trẻ em"
          : d.type === "baby"
          ? "Em bé"
          : "Hành khách";
      const msg =
        d.type === "baby"
          ? `${who} "${d.name || "(chưa có tên)"}" chưa chọn người lớn đi cùng.`
          : `${who} "${d.name || "(chưa có tên)"}" chưa chọn người lớn đi cùng từ ${GUARDIAN_MIN_AGE} tuổi trở lên.`;
      throw new Error(msg);
    }
    if (d.type === "baby") {
      // Em bé: kiểm tra anchor phòng KS (roomGuardianIdx) trước, fallback guardianIdx.
      const roomAnchor = _babyAtomAnchorIdx(d);
      if (roomAnchor === null || !adultByIdx.has(roomAnchor)) {
        throw new Error(
          `Em bé "${d.name || "(chưa có tên)"}" có người ở cùng phòng không hợp lệ (phải là người lớn trong đoàn).`
        );
      }
      continue;
    }
    if (!anchorByIdx.has(d.guardianIdx)) {
      const who =
        d.type === "child"
          ? "Trẻ em"
          : "Hành khách";
      throw new Error(
        `${who} "${d.name || "(chưa có tên)"}" có người đi cùng không hợp lệ (phải từ ${GUARDIAN_MIN_AGE} tuổi trở lên).`
      );
    }
  }

  // Build atoms: mỗi NL từ 18 tuổi là anchor; TE/EB và NL < 18 gắn qua guardianIdx.
  /** @type {Atom[]} */

  // Build atoms: Mỗi NL ≥ 18 → một atom
  const atoms = anchorAdults.map((a) => {

    // Cấu trúc members:

    // a — anchor (NL ≥ 18), luôn phần tử đầu.
    // ...list.filter(...) — mọi người khác gắn với anchor a.
    // Quy tắc filter:

    // p	Điều kiện gắn vào atom của a
    // Chính a
    // p.idx === a.idx → false, bỏ qua (đã có ở đầu)
    // Em bé
    // _babyAtomAnchorIdx(p) === a.idx (phòng KS, fallback tour)
    // TE / NL < 18
    // p.guardianIdx === a.idx
    const members = [
      a,
      ...list.filter((p) => {
        if (p.idx === a.idx) return false;
        if (p.type === "baby") {
          // Em bé luôn gắn vào atom theo roomGuardianIdx (fallback guardianIdx),
          // không phụ thuộc loại ghế tour. Ngay cả baby ghế riêng vẫn phải nằm
          // trong 1 phòng (atom) nào đó khi shared mode.
          return _babyAtomAnchorIdx(p) === a.idx;
        }
        return p.guardianIdx === a.idx;
      }),
    ];

    // Tính effectiveSize: tổng trọng số tuổi của các thành viên trong atom
    const effectiveSize = members.reduce(
      (sum, m) => sum + _weightForAge(m.age, m.type, ageBands),
      0
    );
    return {
      gender: a.gender,
      effectiveSize,
      members,
      anchorIdx: a.idx,
      label: _atomLabelFromMembers(a, members),
    };
  });

  return atoms;
}

/**
 * Tra weight cho 1 age dựa trên Hotel.ageBands.
 *
 * @param {number} age
 * @param {'adult'|'child'|'baby'} type
 * @param {AgeBand[]} ageBands
 * @returns {number}
 */
function _weightForAge(age, type, ageBands) {
  if (Array.isArray(ageBands) && ageBands.length > 0) {
    const band = ageBands.find((b) => {
      if (b.countInOccupancy === false) return false;
      const min = Number(b.minAge);
      const max = b.maxAge === null || b.maxAge === undefined ? Infinity : Number(b.maxAge);
      return age >= min && age <= max;
    });
    if (band) {
      const w = Number(band.occupancyWeight);
      if (!isNaN(w)) return w; // trọng số của band
    }
    // Có ageBands nhưng age không khớp band nào → countInOccupancy=false thì 0,
    // không thì fallback theo type.
    const offBand = ageBands.find((b) => {
      const min = Number(b.minAge);
      const max = b.maxAge === null || b.maxAge === undefined ? Infinity : Number(b.maxAge);
      return age >= min && age <= max;
    });
    if (offBand && offBand.countInOccupancy === false) return 0;
  }
  // Fallback an toàn theo type.
  if (type === "baby") return 0;
  if (type === "child") return 0.5;
  return 1;
}

/**
 * Tính lại `effectiveSize` cho danh sách atoms theo `ageBands` của hotel khác.
 * Dùng khi một atom được "thử" đặt tại nhiều khách sạn có ageBands khác nhau —
 * mỗi hotel có thể tính trọng số khác nhau cho cùng 1 độ tuổi/loại.
 *
 * - Atom có `members` (đơn mới) → recompute từ tuổi & type của từng người.
 * - Atom legacy không có members (synthesizeLegacyAtoms) → giữ effectiveSize.
 *
 * @param {Atom[]} atoms
 * @param {AgeBand[]} ageBands
 * @returns {Atom[]} mảng atoms mới (không mutate input)
 */
function reweightAtomsForAgeBands(atoms, ageBands) {
  if (!Array.isArray(atoms)) return [];
  return atoms.map((a) => {
    if (!a) return a;
    if (!Array.isArray(a.members) || a.members.length === 0) {
      // Legacy atom hoặc atom rỗng → giữ nguyên size cũ.
      return { ...a };
    }
    const newSize = a.members.reduce(
      (sum, m) => sum + _weightForAge(m.age, m.type, ageBands),
      0
    );
    return { ...a, effectiveSize: newSize };
  });
}

/**
 * Synthesize atoms từ định dạng cũ (chỉ có males/females count, không có
 * passengers chi tiết). Mỗi person → 1 atom riêng size=1.
 *
 * @param {{ males:number, females:number }} legacy
 * @returns {Atom[]}
 */
/** Thông báo chuẩn khi NL không đủ để phân bổ TE/EB ở ghép trong 1 phòng. */
const SHARED_INSUFFICIENT_ADULTS_MESSAGE =
  "Số lượng trẻ em đi cùng vượt quá khả năng phân bổ phòng ở ghép. " +
  "Với loại phòng hiện tại, mỗi phòng cần có ít nhất 1 người lớn đi kèm trẻ em. " +
  "Vui lòng bổ sung người lớn đi cùng hoặc liên hệ công ty du lịch để được hỗ trợ.";

/**
 * Số slot occupancy tối đa cho TE/EB trong 1 phòng (sau khi trừ 1 NL) theo
 * baseOccupancy và ageBands.
 */
function _maxDependentSlotsInRoom(maxCap, ageBands) {
  const cap = Math.max(1, Math.floor(Number(maxCap) || 2));
  const remaining = Math.max(0, cap - 1);
  if (remaining <= 0) return 0;
  let minChildW = 0.5;
  if (Array.isArray(ageBands) && ageBands.length > 0) {
    const childWeights = ageBands
      .filter((b) => b && b.countInOccupancy !== false)
      .map((b) => Number(b.occupancyWeight))
      .filter((w) => !isNaN(w) && w > 0);
    if (childWeights.length > 0) {
      minChildW = Math.min(...childWeights);
    }
  }
  return Math.floor(remaining / minChildW);
}

/**
 * Kiểm tra mỗi atom (1 NL + TE/EB đi cùng) có nằm trọn trong 1 phòng ở ghép
 * theo baseOccupancy hay không. Ở ghép không được tách 1 NL sang nhiều phòng
 * để "chia" trẻ — nếu nhóm vượt sức chứa 1 phòng → cần thêm NL.
 *
 * @param {Atom[]} atoms
 * @param {Array<{ capacity: number, count?: number }>} roomBuckets
 * @param {AgeBand[]} ageBands
 * @returns {{
 *   ok: boolean,
 *   reason?: 'insufficient_adults_for_children'|'atom_too_large',
 *   message?: string,
 *   offendingAtom?: Atom,
 *   maxRoomCapacity?: number,
 * }}
 */
function validateAtomsFitSharedRooms(atoms, roomBuckets, ageBands) {

  // buckets: phòng còn trống thực tế của hotel
  const buckets = (roomBuckets || []).filter(
    (r) => Math.floor(Number(r.capacity) || 0) > 0
  );

  // Không KS nào còn phòng
  if (buckets.length === 0) {
    return { ok: true };
  }

  // maxCap: phòng lớn nhất còn trống
  const maxCap = Math.max(
    ...buckets.map((r) => Math.max(1, Math.floor(Number(r.capacity) || 2)))
  );

  // maxDepSlots: số slot occupancy tối đa cho TE/EB trong 1 phòng (sau khi trừ 1 NL) theo baseOccupancy và ageBands
  const maxDepSlots = _maxDependentSlotsInRoom(maxCap, ageBands);

  for (const atom of atoms || []) {
    if (!atom) continue;
    const members = Array.isArray(atom.members) ? atom.members : [];
    const dependents = members.filter((m) => m.type === "child" || m.type === "baby");
    if (dependents.length === 0) continue;

    const adultMembers = members.filter((m) => m.type === "adult");
    const effectiveSize =
      members.length > 0
        ? members.reduce(
            (sum, m) => sum + _weightForAge(m.age, m.type, ageBands),
            0
          )
        : Math.max(0, Number(atom.effectiveSize) || 0);

    const tooLargeByWeight = effectiveSize > maxCap; // Tổng chỗ quy đổi cả nhóm > sức chứa phòng lớn nhất.
    const tooManyDependents = dependents.length > maxDepSlots; // Số TE/EB (đếm đầu) > slot còn lại sau 1 NL.

    if (!tooLargeByWeight && !tooManyDependents) continue;

    const reason =
      adultMembers.length <= 1
        ? "insufficient_adults_for_children"
        : "atom_too_large";

    return {
      ok: false,
      reason,
      message:
        reason === "insufficient_adults_for_children"
          ? SHARED_INSUFFICIENT_ADULTS_MESSAGE
          : `Nhóm "${atom.label || "?"}" vượt sức chứa phòng lớn nhất (${maxCap}) cho ở ghép. ` +
            `Hãy giảm số trẻ em đi cùng 1 người lớn hoặc chuyển sang ở riêng.`,
      offendingAtom: atom,
      maxRoomCapacity: maxCap,
    };
  }

  return { ok: true, maxRoomCapacity: maxCap };
}

function synthesizeLegacyAtoms({ males, females }) {
  const atoms = [];
  const m = Math.max(0, Math.floor(Number(males) || 0));
  const f = Math.max(0, Math.floor(Number(females) || 0));
  for (let i = 0; i < m; i++) {
    atoms.push({
      gender: "male",
      effectiveSize: 1,
      members: [],
      anchorIdx: -1,
      label: "(legacy male)",
    });
  }
  for (let i = 0; i < f; i++) {
    atoms.push({
      gender: "female",
      effectiveSize: 1,
      members: [],
      anchorIdx: -1,
      label: "(legacy female)",
    });
  }
  return atoms;
}

module.exports = {
  buildAtomsFromPassengers,
  reweightAtomsForAgeBands,
  synthesizeLegacyAtoms,
  validateAtomsFitSharedRooms,
  SHARED_INSUFFICIENT_ADULTS_MESSAGE,
  GUARDIAN_MIN_AGE,
  babyNeedsGuardian,
  isAdultPassenger,
  passengerNeedsGuardian,
  isAnchorAdult,
  _weightForAge, // export để test
};
