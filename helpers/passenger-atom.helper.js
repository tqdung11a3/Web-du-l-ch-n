// helpers/passenger-atom.helper.js
//
// Quy đổi danh sách hành khách (passengers) thành các "atoms" cho thuật toán
// xếp ghép phòng. Mỗi atom là 1 cụm-bất-khả-tách: 1 người lớn + tất cả TE/EB
// có guardianIdx trỏ tới người lớn đó.
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

  const list = passengers.map((p, i) => ({
    idx: typeof p.idx === "number" ? p.idx : i,
    name: String(p.name || "").trim(),
    age: Math.max(0, Math.floor(Number(p.age) || 0)),
    type: p.type === "child" || p.type === "baby" ? p.type : "adult",
    gender: p.gender === "male" || p.gender === "female" ? p.gender : null,
    guardianIdx:
      p.guardianIdx === null || p.guardianIdx === undefined
        ? null
        : Math.floor(Number(p.guardianIdx)),
  }));

  // Validate adults
  const adults = list.filter((p) => p.type === "adult");
  for (const a of adults) {
    if (!a.gender) {
      throw new Error(
        `Hành khách "${a.name || "(chưa có tên)"}" là người lớn nhưng chưa khai giới tính.`
      );
    }
    if (a.guardianIdx !== null) {
      throw new Error(
        `Hành khách "${a.name || "(chưa có tên)"}" là người lớn không thể có người trông.`
      );
    }
  }

  // Map idx → adult cho lookup nhanh.
  const adultByIdx = new Map();
  for (const a of adults) adultByIdx.set(a.idx, a);

  // Validate kids/babies
  const kids = list.filter((p) => p.type === "child" || p.type === "baby");
  for (const k of kids) {
    if (k.guardianIdx === null) {
      throw new Error(
        `${k.type === "child" ? "Trẻ em" : "Em bé"} "${k.name || "(chưa có tên)"}" chưa chọn người lớn đi cùng.`
      );
    }
    if (!adultByIdx.has(k.guardianIdx)) {
      throw new Error(
        `${k.type === "child" ? "Trẻ em" : "Em bé"} "${k.name || "(chưa có tên)"}" có người trông không hợp lệ.`
      );
    }
  }

  // Build atoms: mỗi adult tạo 1 atom, kèm các kids guardianIdx === adult.idx.
  /** @type {Atom[]} */
  const atoms = adults.map((a) => {
    const members = [a, ...kids.filter((k) => k.guardianIdx === a.idx)];
    const effectiveSize = members.reduce(
      (sum, m) => sum + _weightForAge(m.age, m.type, ageBands),
      0
    );
    const labelKids = members
      .filter((m) => m.type !== "adult")
      .map((m) => `${m.type === "child" ? "TE" : "EB"} ${m.name || "?"}`)
      .join(", ");
    const label = labelKids
      ? `${a.name || "?"} (+ ${labelKids})`
      : a.name || "?";
    return {
      gender: a.gender,
      effectiveSize,
      members,
      anchorIdx: a.idx,
      label,
    };
  });

  return atoms;
}

/**
 * Tra weight cho 1 age dựa trên Hotel.ageBands. Nếu không match band nào,
 * fallback theo type:
 *   - adult → 1
 *   - child → 0.5
 *   - baby  → 0
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
      if (!isNaN(w)) return w;
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
  _weightForAge, // export để test
};
