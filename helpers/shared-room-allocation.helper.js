// helpers/shared-room-allocation.helper.js
//
// Bài toán "ở ghép" tour:
//   Có một tập phòng, mỗi loại phòng (capacity, count). Cần xếp `males` nam
//   và `females` nữ vào sao cho:
//     - Mỗi phòng chỉ chứa MỘT giới (toàn nam hoặc toàn nữ, hoặc rỗng).
//     - Tổng số nam ≤ Σ (capacity × số phòng phân cho nam)
//     - Tổng số nữ ≤ Σ (capacity × số phòng phân cho nữ)
//
// Đây là bài knapsack dạng đa-lựa-chọn nhỏ. Với mỗi loại phòng i (capacity=c_i,
// count=n_i) ta chọn m_i ∈ [0..n_i] phòng cho nam, còn lại (n_i - m_i) cho nữ.
//
// Vì số loại phòng và số phòng trong thực tế nhỏ (vài loại × vài chục phòng),
// một DP O(Σ n_i × maleCapacityRange) đủ nhanh và CHÍNH XÁC (không bị bỏ sót
// như greedy thuần). Cụ thể: enum tất cả tổng "capacity dành cho nam" có thể
// đạt được, kèm theo số phòng đã dùng cho nam ít nhất.
//
// Heuristic gợi ý plan: ưu tiên dùng phòng lớn cho giới đông, để ít chỗ trống.

/**
 * @typedef {{ capacity: number, count: number }} RoomBucket
 *
 * @param {{
 *   males:   number,
 *   females: number,
 *   rooms:   RoomBucket[],
 * }} input
 *
 * @returns {{
 *   ok: boolean,
 *   reason?: string,
 *   plan?: {
 *     malePlan:   Array<{ capacity: number, count: number, used: number }>,
 *     femalePlan: Array<{ capacity: number, count: number, used: number }>,
 *     totalMaleCapacity:   number,
 *     totalFemaleCapacity: number,
 *     emptySlots:          number,
 *   },
 *   maxFeasible?: { males: number, females: number },
 * }}
 */
function canAllocateGenderRooms({ males, females, rooms, _skipMaxFeasible }) {
  const safeMales = Math.max(0, Math.floor(Number(males) || 0));
  const safeFemales = Math.max(0, Math.floor(Number(females) || 0));
  const buckets = (rooms || [])
    .map((r) => ({
      capacity: Math.max(0, Math.floor(Number(r.capacity) || 0)),
      count: Math.max(0, Math.floor(Number(r.count) || 0)),
    }))
    .filter((r) => r.capacity > 0 && r.count > 0);

  if (safeMales === 0 && safeFemales === 0) {
    return {
      ok: true,
      plan: {
        malePlan: [],
        femalePlan: [],
        totalMaleCapacity: 0,
        totalFemaleCapacity: 0,
        emptySlots: 0,
      },
    };
  }

  const totalCapacity = buckets.reduce((s, b) => s + b.capacity * b.count, 0);
  if (safeMales + safeFemales > totalCapacity) {
    const maxFeasible = _skipMaxFeasible
      ? { males: 0, females: 0 }
      : computeMaxFeasible(safeMales, safeFemales, buckets);
    return {
      ok: false,
      reason: "exceeds_total_capacity",
      maxFeasible,
    };
  }

  // ── DP: enum tất cả "tổng capacity phân cho nam" có thể đạt được ──
  // Khoá map = string "capForMales:roomsForMales" để track unique state.
  // Để tiết kiệm bộ nhớ ta dùng 2 map chỉ-mục: cap → minRoomsUsedForMales
  // (đối với mỗi cap, ta chỉ cần biết số phòng tối thiểu dùng để đạt cap đó —
  // càng ít phòng càng còn nhiều phòng cho nữ).
  let prev = new Map();
  prev.set(0, 0);

  for (const b of buckets) {
    const next = new Map();
    for (const [cap, roomsUsed] of prev) {
      for (let m = 0; m <= b.count; m++) {
        const newCap = cap + m * b.capacity;
        const newRooms = roomsUsed + m;
        const cur = next.get(newCap);
        if (cur === undefined || newRooms < cur) {
          next.set(newCap, newRooms);
        }
      }
    }
    prev = next;
  }

  // Cần tìm 1 state thỏa: capForMales ≥ males ∧ remainingCap ≥ females
  // remainingCap = totalCapacity - capForMales
  let bestState = null;
  let bestPlanScore = -Infinity;
  for (const [capForMales, roomsForMales] of prev) {
    if (capForMales < safeMales) continue;
    const capForFemales = totalCapacity - capForMales;
    if (capForFemales < safeFemales) continue;

    // Ưu tiên ít chỗ trống → score = -(emptySlots).
    const empty = capForMales - safeMales + (capForFemales - safeFemales);
    const score = -empty;
    if (score > bestPlanScore) {
      bestPlanScore = score;
      bestState = { capForMales, roomsForMales };
    }
  }

  if (!bestState) {
    // Khôi phục giới hạn để client thấy đoàn lớn nhất còn xếp được. Truyền
    // _skipMaxFeasible để tránh đệ quy vô hạn (computeMaxFeasible cũng gọi
    // lại canAllocateGenderRooms).
    const maxFeasible = _skipMaxFeasible
      ? { males: 0, females: 0 }
      : computeMaxFeasible(safeMales, safeFemales, buckets);
    return {
      ok: false,
      reason: "cannot_split_by_gender",
      maxFeasible,
    };
  }

  // ── Tái dựng plan: backtrack đúng bộ (m_i) khớp với state đã chọn ──
  // Số bucket thực tế nhỏ (≤ 5), nên backtrack đầy đủ vẫn rẻ và đảm bảo
  // tìm được phân chia chính xác — tránh lỗi "greedy lấy thừa capacity".
  const malePerBucket = backtrackMaleBuckets(
    buckets,
    bestState.capForMales,
    bestState.roomsForMales
  );
  const malePlan = buckets
    .map((b, idx) => ({
      capacity: b.capacity,
      count: b.count,
      used: malePerBucket[idx] || 0,
    }))
    .sort((a, b) => b.capacity - a.capacity);
  const femalePlan = buckets
    .map((b, idx) => ({
      capacity: b.capacity,
      count: b.count,
      used: b.count - (malePerBucket[idx] || 0),
    }))
    .sort((a, b) => b.capacity - a.capacity);

  return {
    ok: true,
    plan: {
      malePlan: malePlan.filter((b) => b.used > 0),
      femalePlan: femalePlan.filter((b) => b.used > 0),
      totalMaleCapacity: bestState.capForMales,
      totalFemaleCapacity: totalCapacity - bestState.capForMales,
      emptySlots:
        bestState.capForMales -
        safeMales +
        (totalCapacity - bestState.capForMales - safeFemales),
    },
  };
}

/**
 * Backtrack: tìm bộ (m_0, m_1, ...) với m_i ∈ [0..buckets[i].count] sao cho
 *   Σ m_i × buckets[i].capacity = capTarget
 *   Σ m_i                       = roomsTarget
 * Trả về mảng cùng độ dài buckets, hoặc null nếu không tồn tại.
 */
function backtrackMaleBuckets(buckets, capTarget, roomsTarget) {
  const result = new Array(buckets.length).fill(0);
  function rec(idx, capLeft, roomsLeft) {
    if (idx === buckets.length) {
      return capLeft === 0 && roomsLeft === 0;
    }
    const b = buckets[idx];
    const maxM = Math.min(b.count, roomsLeft, Math.floor(capLeft / b.capacity));
    for (let m = 0; m <= maxM; m++) {
      result[idx] = m;
      if (rec(idx + 1, capLeft - m * b.capacity, roomsLeft - m)) return true;
    }
    result[idx] = 0;
    return false;
  }
  rec(0, capTarget, roomsTarget);
  return result;
}

/**
 * Tính (males, females) lớn nhất vẫn xếp được — dùng cho thông báo lỗi
 * thân thiện. Đơn giản: thử giảm dần males/females hiện tại 1 đơn vị cho tới
 * khi gặp state khả thi. Đắt hơn DP chính nhưng chỉ chạy ở nhánh fail.
 */
function computeMaxFeasible(males, females, buckets) {
  // Greedy giảm bên đông hơn — đủ tốt cho UX. _skipMaxFeasible: true để chặn
  // đệ quy.
  let m = males;
  let f = females;
  const limit = males + females;
  for (let i = 0; i < limit; i++) {
    const r = canAllocateGenderRooms({
      males: m,
      females: f,
      rooms: buckets,
      _skipMaxFeasible: true,
    });
    if (r.ok) return { males: m, females: f };
    if (m >= f) m = Math.max(0, m - 1);
    else f = Math.max(0, f - 1);
    if (m === 0 && f === 0) break;
  }
  return { males: 0, females: 0 };
}

// =============================================================================
// PHẦN MỞ RỘNG: ATOMIC GROUP PACKING (passenger detail)
// =============================================================================
//
// Bài toán mở rộng:
//   Mỗi "atom" là 1 cụm (1 người lớn + tất cả TE/EB của họ) — phải đặt cùng
//   1 phòng. Atom có:
//     - gender ("male" hoặc "female") theo người lớn
//     - effectiveSize = Σ occupancyWeight (NL=1, TE=0.5, EB=0 v.v. theo
//       Hotel.ageBands)
//
//   Cần phân các atoms cùng giới vào cùng phòng, tổng size mỗi phòng
//   ≤ baseOccupancy.
//
// Thuật toán:
//   1. Quick check: atom lớn nhất ≤ phòng lớn nhất; tổng size ≤ tổng capacity.
//   2. Enum mọi split (m_0,…,m_K) với m_i ∈ [0..count_i] phòng cho NAM, prune
//      sớm nếu tổng cap không đủ.
//   3. Với mỗi split: gọi canPackBins riêng cho nam và nữ.
//   4. canPackBins backtrack: sort atoms desc, place vào bin có capacity còn
//      lại ≥ size. Pruning bằng "không thử bin có cùng remaining đã thử ở
//      cùng level đệ quy".
//
// Số bucket ≤ 5, count_i ≤ 20, atom ≤ 30 → đủ nhanh trong ~< 100ms.

/**
 * @typedef {{
 *   gender:        'male'|'female',
 *   effectiveSize: number,
 *   label?:        string,
 * }} Atom
 *
 * @param {{ atoms: Atom[], rooms: RoomBucket[] }} input
 * @returns {{
 *   ok: boolean,
 *   reason?: 'atom_too_large'|'exceeds_total_capacity'|'cannot_split_by_gender',
 *   detail?: {
 *     totalSizeMale:   number,
 *     totalSizeFemale: number,
 *     totalCapacity:   number,
 *     largestAtom:     number,
 *     largestRoom:     number,
 *   },
 *   plan?: {
 *     malePlan:   Array<{ capacity:number, count:number, used:number }>,
 *     femalePlan: Array<{ capacity:number, count:number, used:number }>,
 *   },
 * }}
 */


// "Cho danh sách nhóm khách (atoms) và phòng còn trống theo loại — có xếp được không, nếu không trộn nam/nữ trong cùng phòng?"
//
// `partialRooms` (tuỳ chọn): các phòng ĐANG ghép dở của đơn khác — đã KHOÁ giới
// tính và chỉ còn `capacity` chỗ trống (remaining). Đơn hiện tại có thể ghép
// thêm vào các phòng này (cùng giới) trước khi mở phòng trống mới. Mỗi phần tử:
// { capacity: <số chỗ CÒN TRỐNG>, gender: 'male'|'female' }.
function canAllocateAtomicGroups({ atoms, rooms, partialRooms }) {

  // Tạo danh sách nhóm khách từ atoms
  const atomList = (atoms || [])
    .map((a) => ({
      gender: a.gender === "female" ? "female" : "male",
      effectiveSize: Math.max(0, Number(a.effectiveSize) || 0),
      label: a.label || "",
    }))
    .filter((a) => a.effectiveSize > 0);

  // Tạo danh sách phòng từ rooms (phòng TRỐNG hoàn toàn — chưa khoá giới tính)
  const buckets = (rooms || [])
    .map((r) => ({
      capacity: Math.max(0, Math.floor(Number(r.capacity) || 0)),
      count: Math.max(0, Math.floor(Number(r.count) || 0)),
    }))
    .filter((r) => r.capacity > 0 && r.count > 0);

  // Phòng partial: mỗi phòng là 1 bin CỐ ĐỊNH giới tính, chỉ chứa được thêm
  // `capacity` (remaining) chỗ. Tách sẵn theo giới để nối vào bin packing.
  const malePartialBins = [];
  const femalePartialBins = [];
  for (const p of partialRooms || []) {
    const rem = Math.max(0, Math.floor(Number(p && p.capacity) || 0)); // chỗ còn trống trong phòng đó (field capacity ở đây = remaining)
    if (rem <= 0) continue;
    if (p.gender === "female") femalePartialBins.push(rem);
    else if (p.gender === "male") malePartialBins.push(rem);
  }
  const malePartialCap = malePartialBins.reduce((s, c) => s + c, 0);
  const femalePartialCap = femalePartialBins.reduce((s, c) => s + c, 0);

  // Tính tổng size nhóm khách nam và nữ
  const males = atomList.filter((a) => a.gender === "male");
  const females = atomList.filter((a) => a.gender === "female");
  const totalSizeM = males.reduce((s, a) => s + a.effectiveSize, 0);
  const totalSizeF = females.reduce((s, a) => s + a.effectiveSize, 0);
  const emptyCapacity = buckets.reduce((s, b) => s + b.capacity * b.count, 0);
  const totalCapacity = emptyCapacity + malePartialCap + femalePartialCap;
  const largestAtom = Math.max(0, ...atomList.map((a) => a.effectiveSize));
  const largestRoom = Math.max(
    0,
    ...buckets.map((b) => b.capacity),
    ...malePartialBins,
    ...femalePartialBins
  );

  const detail = {
    totalSizeMale: totalSizeM,
    totalSizeFemale: totalSizeF,
    totalCapacity,
    largestAtom,
    largestRoom,
  };

  if (atomList.length === 0) {
    return { ok: true, detail, plan: { malePlan: [], femalePlan: [] } };
  }
  if (buckets.length === 0 && malePartialBins.length === 0 && femalePartialBins.length === 0) {
    return { ok: false, reason: "exceeds_total_capacity", detail };
  }
  if (largestAtom > largestRoom) {
    return { ok: false, reason: "atom_too_large", detail };
  }
  if (totalSizeM + totalSizeF > totalCapacity) {
    return { ok: false, reason: "exceeds_total_capacity", detail };
  }

  // Suffix-sum capacity để prune sớm khi enum split (chỉ tính phòng trống —
  // phần partial đã được cộng sẵn vào capM/capF khởi tạo).
  const suffixCap = new Array(buckets.length + 1).fill(0);
  for (let i = buckets.length - 1; i >= 0; i--) {
    suffixCap[i] = suffixCap[i + 1] + buckets[i].capacity * buckets[i].count; // Tổng capacity còn lại từ loại phòng i đến hết (để cắt nhánh sớm)
  }

  let foundPlan = null; // đã tìm được cách chia hợp lệ chưa
  const splitMale = new Array(buckets.length).fill(0); // loại phòng thứ i - bao nhiêu phòng dành cho nam, splitMale[i] = m nghĩa là: loại phòng thứ i, dành m phòng cho nam (phần còn lại cho nữ).

  // thử mọi cách chia phòng giữa nam và nữ, rồi kiểm tra từng atom có nhét vừa không

  // Với từng loại phòng, thử: 0 phòng cho nam, 1 phòng cho nam, … count phòng cho nam; phần còn lại cho nữ. Hết mọi loại → gọi canPackBins kiểm tra.
  function recSplit(idx, capM, capF) { // idx: loại phòng thứ i, capM: tổng chỗ đã phân cho nam, capF: tổng chỗ đã phân cho nữ

    if (foundPlan) return; // đã tìm được cách chia hợp lệ rồi thì không cần thử nữa
    if (capM + suffixCap[idx] < totalSizeM) return; // nếu tổng chỗ đã phân cho nam + tổng capacity còn lại từ loại phòng i đến hết < tổng size nhóm khách nam thì không thử nữa
    if (capF + suffixCap[idx] < totalSizeF) return; // nếu tổng chỗ đã phân cho nữ + tổng capacity còn lại từ loại phòng i đến hết < tổng size nhóm khách nữ thì không thử nữa

    if (idx === buckets.length) { // đã thử mọi loại phòng thì kiểm tra xem có nhét vừa không
      if (capM < totalSizeM || capF < totalSizeF) return;
      // Bin cho nam = phòng trống chia cho nam + phòng partial nam (remaining).
      const maleBins = _expandBins(buckets, splitMale).concat(malePartialBins); // chuyển thành danh sách capacity của phòng dành cho nam
      const femaleBins = _expandBins(
        buckets,
        buckets.map((b, i) => b.count - splitMale[i])
      ).concat(femalePartialBins); // chuyển thành danh sách capacity của phòng dành cho nữ

      // atom nam có nhét vừa maleBins không, atom nữ có nhét vừa femaleBins không
      if (canPackBins(males, maleBins) && canPackBins(females, femaleBins)) {
        foundPlan = {
          malePlan: buckets
            .map((b, i) => ({ capacity: b.capacity, count: b.count, used: splitMale[i] }))
            .filter((x) => x.used > 0),
          femalePlan: buckets
            .map((b, i) => ({
              capacity: b.capacity,
              count: b.count,
              used: b.count - splitMale[i],
            }))
            .filter((x) => x.used > 0),
        };
      }
      return;
    }

    const b = buckets[idx];
    // Thử chia theo thứ tự "cân bằng dần" để tăng cơ hội tìm sớm.
    for (let m = 0; m <= b.count; m++) {
      splitMale[idx] = m; // m: số phòng dành cho nam
      recSplit(
        idx + 1,
        capM + m * b.capacity,
        capF + (b.count - m) * b.capacity
      );
      if (foundPlan) return;
    }
    splitMale[idx] = 0;
  }

  // Khởi tạo capM/capF bằng tổng chỗ trống của phòng partial (đã khoá giới).
  recSplit(0, malePartialCap, femalePartialCap);

  if (foundPlan) return { ok: true, detail, plan: foundPlan };

  return { ok: false, reason: "cannot_split_by_gender", detail };
}

/**
 * Bin packing decision: có thể đặt mọi atom vào bins (mỗi bin có capacity
 * ≥ Σ size of atoms đặt vào nó)?
 *
 * @param {Atom[]} atoms
 * @param {number[]} bins  capacities of available bins
 * @returns {boolean}
 */

// "Cho danh sách nhóm khách (atoms) và danh sách capacity của phòng (bins) — có thể đặt mọi atom vào bins không?"
function canPackBins(atoms, bins) {
  if (!atoms || atoms.length === 0) return true;
  if (!bins || bins.length === 0) return false;

  const sorted = [...atoms].sort((a, b) => b.effectiveSize - a.effectiveSize);
  if (sorted[0].effectiveSize > Math.max(...bins)) return false;

  const remaining = bins.slice();

  function rec(i) { // i: index của atom hiện tại, mỗi i tương đương với 1 người
    if (i === sorted.length) return true;
    const size = sorted[i].effectiveSize; // size của atom thứ i, số chỗ cần cho atom hiện tại
    // Tránh thử lại bin có remaining giống nhau (cắt nhánh đối xứng).
    const tried = new Set();
    for (let j = 0; j < remaining.length; j++) { // j: index của phòng hiện tại, mỗi j tương đương với 1 phòng
      const cap = remaining[j]; // capacity của phòng thứ j, số chỗ còn trống của phòng hiện tại
      if (tried.has(cap)) continue; // nếu capacity của phòng hiện tại đã thử thì không thử nữa
      if (cap < size) continue; // nếu capacity của phòng hiện tại < size của atom hiện tại thì không thử nữa
      tried.add(cap); // đánh dấu capacity của phòng hiện tại đã thử
      remaining[j] = cap - size; // cập nhật số chỗ còn trống của phòng hiện tại
      if (rec(i + 1)) return true;
      remaining[j] = cap; // cập nhật lại số chỗ còn trống của phòng hiện tại
    }
    return false;
  }

  return rec(0); // bắt đầu từ atom đầu tiên
}

function _expandBins(buckets, perBucket) {
  const bins = [];
  for (let i = 0; i < buckets.length; i++) {
    const cnt = perBucket[i] || 0;
    for (let k = 0; k < cnt; k++) bins.push(buckets[i].capacity);
  }
  return bins;
}

// =============================================================================
// PHẦN MỞ RỘNG: MULTI-HOTEL ATOMIC ALLOCATION (segment-level pooling)
// =============================================================================
//
// Bài toán mở rộng từ canAllocateAtomicGroups:
//   1 segment có thể có nhiều khách sạn (theo thứ tự ưu tiên cấu hình).
//   Khi 1 khách sạn không đủ phòng cho atom, ta cho phép tràn sang hotel kế.
//   Mỗi atom phải nằm trọn trong 1 hotel + 1 phòng (không tách nhân khẩu).
//
// Đầu vào:
//   currentAtoms:        atoms của đoàn hiện tại — chưa được gán hotel.
//   hotels:              [{ hotelId, hotelName, ageBands, rooms }] theo thứ tự
//                        ưu tiên (index 0 = hotel chính).
//   existingAtomsByHotel:{ [hotelId]: Atom[] } các atom đã được giữ trước đó
//                        ứng với từng hotel (cùng segment + khung).
//   reweightAtomsForAgeBands: hàm DI (hoặc nội bộ) tính lại effectiveSize cho
//                        atoms theo ageBands của từng hotel.
//
// Thuật toán (greedy theo thứ tự hotel + verify bằng canAllocateAtomicGroups):
//   - Lặp qua từng hotel theo priority. Với mỗi hotel:
//       * Reweight atom (current + existing) theo ageBands của hotel này.
//       * Bắt đầu thử fit ALL `unplaced` (sort desc theo size tại hotel này).
//         Nếu canAllocateAtomicGroups(existing[h] + tryAtoms, rooms[h]).ok =
//         true → nhận hết tryAtoms vào hotel h, unplaced = [].
//       * Nếu không, thu nhỏ subset: bỏ atom NHỎ NHẤT (tại h) khỏi tryAtoms,
//         thử lại. Tiếp tục đến khi (a) tryAtoms rỗng, hoặc (b) fits.
//         "Bỏ atom nhỏ" để tối ưu tận dụng hotel ưu tiên (nhồi atom lớn vào
//         trước, atom nhỏ tràn sang hotel kế).
//   - Nếu cuối cùng còn atom chưa xếp → trả ok=false + leftover.

/**
 * @param {{
 *   currentAtoms: Atom[],
 *   hotels: Array<{
 *     hotelId: string,
 *     hotelName?: string,
 *     ageBands?: any[],
 *     rooms: RoomBucket[],
 *   }>,
 *   existingAtomsByHotel?: Object,
 *   reweightFn: (atoms:Atom[], ageBands:any[]) => Atom[],
 * }} input
 *
 * @returns {{
 *   ok: boolean,
 *   reason?: 'no_hotels'|'atom_too_large'|'cannot_fit_anywhere',
 *   allocations: Array<{
 *     hotelId: string,
 *     hotelName: string,
 *     atoms: Atom[],
 *     totalEffectiveSize: number,
 *   }>,
 *   leftover: Atom[],
 *   detail?: object,
 * }}
 */

// Với đoàn khách hiện tại (các nhóm atom), có xếp được vào các khách sạn ứng viên không — mà vẫn tuân thủ quy tắc ở ghép (cùng phòng chỉ 1 giới, không tách nhóm gia đình)?
function canAllocateAtomicGroupsAcrossHotels({
  currentAtoms,
  hotels,
  existingAtomsByHotel,
  partialRoomsByHotel,
  reweightFn,
}) {

  // Phần 1: Chuẩn bị đầu vào
  const atomsList = (currentAtoms || []).filter(Boolean);
  const hotelList = (hotels || []).filter((h) => h && h.hotelId);
  const existingMap = existingAtomsByHotel || {};
  const partialMap = partialRoomsByHotel || {};
  const reweight =
    typeof reweightFn === "function"
      ? reweightFn
      : (atoms /* , bands */) => atoms.map((a) => ({ ...a }));

  // phần 2: kiểm tra nhanh nếu không có khách sạn nào
  if (hotelList.length === 0) {
    return {
      ok: false,
      reason: "no_hotels",
      allocations: [],
      leftover: atomsList,
    };
  }
  if (atomsList.length === 0) {
    return { ok: true, allocations: [], leftover: [] };
  }

  // Đảm bảo mỗi atom có 1 _key duy nhất để theo dõi qua các hotel iterations.
  const taggedAtoms = atomsList.map((a, i) => ({
    ...a,
    _packKey: a._packKey != null ? a._packKey : `__a${i}`,
  }));

  // Quick fail: với MỌI hotel, atom lớn nhất có vượt phòng lớn nhất không?
  // Nếu mỗi hotel đều có ít nhất 1 phòng đủ chứa atom đó thì không sao —
  // ta chỉ fail khi không hotel nào chứa nổi atom lớn nhất.

  // phần 3: Kiểm tra xem có atom nào đó quá lớn không
  for (const a of taggedAtoms) {
    let canFitSomewhere = false;
    for (const h of hotelList) {
      const partialHere =
        partialMap[h.hotelId] || partialMap[String(h.hotelId)] || [];
      // phòng trống lớn nhất của hotel h
      const maxRoom = Math.max(
        (h.rooms || []).reduce(
          (m, r) => Math.max(m, Math.floor(r.capacity || 0)),
          0
        ),
        // partial room có chỗ còn trống nhiều nhất của hotel h
        ...partialHere.map((p) => Math.max(0, Math.floor(Number(p.capacity) || 0))) // quy đổi lại effectiveSize theo ageBands của hotel h
      );
      const sizedHere = reweight([a], h.ageBands || [])[0];
      if (sizedHere && sizedHere.effectiveSize <= maxRoom) {
        canFitSomewhere = true;
        break;
      }
    }
    if (!canFitSomewhere) {
      return {
        ok: false,
        reason: "atom_too_large",
        allocations: [],
        leftover: taggedAtoms,
        detail: { largestAtomLabel: a.label || "", anchorIdx: a.anchorIdx },
      };
    }
  }

  let unplaced = taggedAtoms.slice(); // các atom còn lại chưa xếp được
  const allocations = []; // các atom đã xếp được

  // Thử xếp atoms vào KS theo thứ tự ưu tiên; atom lớn vào KS trước; atom không fit → KS tiếp theo.
  for (const hotel of hotelList) {
    if (unplaced.length === 0) break; // xếp hết rồi thì đóng

    const ageBands = hotel.ageBands || [];
    const rooms = (hotel.rooms || []).map((r) => ({
      capacity: Math.max(0, Math.floor(Number(r.capacity) || 0)),
      count: Math.max(0, Math.floor(Number(r.count) || 0)),
    }));
    // Phòng partial (đã khoá giới, còn chỗ) của hotel này.
    const partialHere = (
      partialMap[hotel.hotelId] || partialMap[String(hotel.hotelId)] || []
    )
      .map((p) => ({
        capacity: Math.max(0, Math.floor(Number(p.capacity) || 0)),
        gender: p.gender === "female" ? "female" : "male",
      }))
      .filter((p) => p.capacity > 0);
    // Không còn phòng trống lẫn phòng partial → bỏ qua hotel này.
    if (rooms.length === 0 && partialHere.length === 0) continue;

    const existingHere = reweight(
      existingMap[hotel.hotelId] || existingMap[String(hotel.hotelId)] || [],
      ageBands
    );

    // Re-size unplaced theo ageBands của hotel này.
    const sizedUnplaced = reweight(unplaced, ageBands);
    // Sort desc theo effectiveSize tại hotel này — atom lớn ưu tiên nhồi vào
    // hotel ưu tiên cao trước.
    sizedUnplaced.sort((a, b) => b.effectiveSize - a.effectiveSize);

    // Thử fit từ "all" → giảm dần "atom nhỏ nhất" để tối đa hoá lượng atom
    // nhận được tại hotel ưu tiên cao này.
    let placedHere = null; // { atoms, plan }
    let take = sizedUnplaced.length; // thử nhét TẤT CẢ atom còn lại trước
    while (take > 0) {
      const trySubset = sizedUnplaced.slice(0, take); // // lấy `take` atom LỚN NHẤT
      const combined = [...existingHere, ...trySubset];
      const result = canAllocateAtomicGroups({
        atoms: combined,
        rooms,
        partialRooms: partialHere,
      });
      if (result.ok) {
        placedHere = {
          atoms: trySubset,
          plan: result.plan,
        };
        break;
      }
      take -= 1; // không xếp được → bỏ bớt 1 atom nhỏ nhất, thử lại
    }

    if (placedHere && placedHere.atoms.length > 0) {
      const totalSize = placedHere.atoms.reduce(
        (s, a) => s + (a.effectiveSize || 0),
        0
      );
      allocations.push({
        hotelId: String(hotel.hotelId),
        hotelName: hotel.hotelName || "",
        atoms: placedHere.atoms,
        totalEffectiveSize: totalSize,
        plan: placedHere.plan,
      });

      // Loại các atom đã placed khỏi `unplaced` (theo _packKey).
      const placedKeys = new Set(placedHere.atoms.map((a) => a._packKey));
      unplaced = unplaced.filter((a) => !placedKeys.has(a._packKey));
    }
    // Nếu placedHere null hoặc rỗng → hotel này không nhận được atom nào → tiếp.
  }

  if (unplaced.length === 0) {
    return { ok: true, allocations, leftover: [] };
  }
  return {
    ok: false,
    reason: "cannot_fit_anywhere",
    allocations,
    leftover: unplaced, // các atom còn lại chưa xếp được
  };
}

// =============================================================================
// AUTO-ASSIGN ATOMS → PHYSICAL ROOMS (mỗi phòng có roomTypeId)
// =============================================================================
//
// Trong khi canAllocateAtomicGroups chỉ trả lời "có khả thi không", hàm dưới
// đây trả về "ai vào phòng nào". Mỗi phòng là 1 instance vật lý có roomTypeId
// + capacity (= baseOccupancy). Atoms cùng giới được nhồi vào cùng phòng.
//
// Ưu tiên:
//   1. Chỉ ghép cùng giới (không trộn nam/nữ trong 1 phòng).
//   2. Tận dụng phòng có capacity nhỏ trước cho nhóm nhỏ → giảm chỗ trống.
//   3. Atom lớn được đặt vào phòng đủ lớn nhất sẵn có (FFD).
//
// Đầu vào:
//   atoms: [{ gender, effectiveSize, anchorIdx, label, members }]
//   physicalRooms: [{ roomTypeId, roomTypeName, capacity }]  — mỗi entry = 1
//                  phòng vật lý đã được "mở khoá" cho ta dùng.
//
// Output: { ok, assignments: [{ roomTypeId, roomTypeName, capacity, atoms }],
//          leftoverAtoms, leftoverRooms }

/**
 * @param {{
 *   atoms: Atom[],
 *   physicalRooms: Array<{
 *     roomTypeId: string,
 *     roomTypeName?: string,
 *     capacity: number,
 *   }>,
 *   preExistingOpenRooms?: Array<{
 *     _thId: string,
 *     roomTypeId: string,
 *     roomTypeName?: string,
 *     capacity: number,
 *     gender: 'male'|'female',
 *     used: number,
 *   }>,
 * }} input
 *
 * @returns {{
 *   ok: boolean,
 *   assignments: Array<{
 *     roomTypeId: string,
 *     roomTypeName: string,
 *     capacity: number,
 *     gender: 'male'|'female',
 *     atoms: Atom[],
 *     used: number,
 *     _reuseThId?: string|null,
 *   }>,
 *   leftoverAtoms: Atom[],
 *   leftoverRooms: Array<{roomTypeId:string, roomTypeName:string, capacity:number}>,
 * }}
 */

// Giải thích assignAtomsToPhysicalRooms (662–802)
// Đây là thuật toán xếp phòng cho ở ghép: nhận danh sách atom (nhóm NL + trẻ) và danh sách phòng có thể dùng, rồi quyết định atom nào vào phòng nào.

// Được gọi từ assignSharedAtomsToRooms — không đọc DB, chỉ tính toán thuần.

// Câu hỏi hàm trả lời
// Với các atom của đơn hiện tại, xếp sao cho:

// Mỗi atom trọn một phòng (không tách nhóm)
// Không trộn nam/nữ trong một phòng
// Ưu tiên ghép phòng đang còn chỗ (partial) trước khi mở phòng mới
// Tận dụng phòng nhỏ vừa đủ (best-fit) để giữ phòng lớn cho atom to sau

function assignAtomsToPhysicalRooms({
  atoms, // danh sách atom (nhóm NL + trẻ)
  physicalRooms, // Phòng vật lý chưa ai dùng
  preExistingOpenRooms, // Phòng đang ghép, còn slot
}) {

  // 1. atomList - danh sách nhóm khách
  const atomList = (atoms || [])
    .filter((a) => a && Number(a.effectiveSize) > 0)
    .map((a) => ({
      ...a,
      gender: a.gender === "female" ? "female" : "male",
      effectiveSize: Number(a.effectiveSize) || 0,
    }));

  // 1. roomPool - danh sách phòng vật lý chưa ai dùng
  const roomPool = (physicalRooms || [])
    .filter((r) => r && Number(r.capacity) > 0)
    .map((r, idx) => ({
      roomTypeId: String(r.roomTypeId || ""),
      roomTypeName: String(r.roomTypeName || ""),
      capacity: Math.floor(Number(r.capacity) || 0),
      _origIdx: idx,
    }));

  // Khởi tạo assignments với các "phòng đang mở" sẵn.
  // Đặc điểm: KHÔNG có atoms trong group này (atoms thuộc đơn khác), nhưng đã
  // chiếm `used` cap. Khi nhồi atom mới sẽ tăng `used`. Nếu cuối cùng không có
  // atom nào của đơn hiện tại được nhồi vào → loại khỏi assignments.

  const assignments = []; // danh sách phòng được xếp

  // 2. Đưa phòng partial vào bàn làm việc
  // Phòng 301 còn chỗ, để sẵn đây cho đơn mới thử nhét — atoms rỗng vì chưa xếp; used và _reuseThId đã có vì phòng thật và đơn cũ đã biết
  for (const r of preExistingOpenRooms || []) {
    if (!r || !r._thId) continue;
    const cap = Math.floor(Number(r.capacity) || 0); // sức chứa phòng
    if (cap <= 0) continue;
    const used0 = Math.max(0, Number(r.used) || 0); // số chỗ đã chiếm của phòng
    if (used0 >= cap) continue;
    if (r.gender !== "male" && r.gender !== "female") continue;

    // danh sách phòng đang được xem xét để xếp atom
    assignments.push({
      roomTypeId: String(r.roomTypeId || ""),
      roomTypeName: String(r.roomTypeName || ""),
      capacity: cap,
      gender: r.gender,
      atoms: [], // đơn mới chưa có ai
      used: used0, // đơn cũ đã chiếm
      _reuseThId: r._thId, // đánh dấu: ghép phòng cũ
      _reuseInitialUsed: used0, // đánh dấu: số chỗ đã chiếm của đơn cũ
    });
  }

  const leftoverAtoms = []; // mảng chứa atom không xếp được

  // 3. Tách theo giới và xử lý từng giới riêng — đảm bảo không bao giờ trộn.
  for (const gender of ["male", "female"]) {
    const groupAtoms = atomList
      .filter((a) => a.gender === gender)
      // Sắp xếp giảm dần theo effectiveSize để ưu tiên ghép phòng lớn cho atom lớn
      .sort((a, b) => b.effectiveSize - a.effectiveSize); // FFD desc

    for (const atom of groupAtoms) {
      // Tìm phòng đang mở (đã có atom cùng giới + còn capacity ≥ atom.size)
      // Ưu tiên phòng REUSE trước (cross-order share) để lấp đầy phòng đang dở
      // — sau đó mới đến phòng vừa được mở trong call này — và đều dùng best-fit
      // (remaining ít nhất).
      let bestReuseIdx = -1; // Chỉ số phòng reuse (phòng cũ còn chỗ) tốt nhất; -1 = chưa tìm được
      let bestReuseRemaining = Infinity; // Số chỗ trống còn lại của phòng reuse tốt nhất
      let bestOpenIdx = -1; // Chỉ số phòng mới tốt nhất; -1 = chưa tìm được
      let bestOpenRemaining = Infinity; // Số chỗ trống còn lại của phòng mới tốt nhất
      for (let i = 0; i < assignments.length; i++) {
        const a = assignments[i];
        if (a.gender !== gender) continue;

        // 3.1. Tìm phòng đang mở (đã có atom cùng giới + còn capacity ≥ atom.size)
        const remaining = a.capacity - a.used;
        if (remaining < atom.effectiveSize) continue;
        if (a._reuseThId) {
          if (remaining < bestReuseRemaining) {
            bestReuseRemaining = remaining;
            bestReuseIdx = i;
          }
        } else {
          if (remaining < bestOpenRemaining) {
            bestOpenRemaining = remaining;
            bestOpenIdx = i;
          }
        }
      }

      const chosenIdx = bestReuseIdx >= 0 ? bestReuseIdx : bestOpenIdx;
      if (chosenIdx >= 0) {
        const a = assignments[chosenIdx];
        a.atoms.push(atom); // thêm atom vào phòng đó
        a.used += atom.effectiveSize; // tăng chỗ đã dùng
        continue; // xong atom này, sang atom tiếp theo
      }

      // 3.2 Mở phòng mới. Ưu tiên phòng có capacity NHỎ NHẤT mà vẫn đủ chứa atom
      // → giữ lại phòng to cho atom to ở sau.
      let bestNewIdx = -1;
      let bestNewCap = Infinity;
      for (let j = 0; j < roomPool.length; j++) {
        const r = roomPool[j];
        if (r.capacity < atom.effectiveSize) continue;

        // tìm phòng nhỏ nhất còn đủ chỗ
        if (r.capacity < bestNewCap) {
          bestNewCap = r.capacity;
          bestNewIdx = j;
        }
      }
      if (bestNewIdx < 0) {
        // Không còn phòng nào chứa được atom này.
        leftoverAtoms.push(atom);
        continue;
      }
      const r = roomPool.splice(bestNewIdx, 1)[0];
      assignments.push({
        roomTypeId: r.roomTypeId,
        roomTypeName: r.roomTypeName,
        capacity: r.capacity,
        gender,
        atoms: [atom],
        used: atom.effectiveSize,
        _reuseThId: null,
      });
    }
  }

  // Loại bỏ các "reuse open room" không nhồi được atom nào của đơn hiện tại
  // (chúng chỉ là placeholder, không phải kết quả assignment cho đơn này).
  // Đồng thời điều chỉnh `used` về phần đóng góp của riêng đơn hiện tại
  // (numPeople = used - initialUsed), giúp controller lưu numPeople đúng theo
  // phần share của đơn này, không kể phần đã chiếm trước đó của đơn khác.
  const finalAssignments = [];
  for (const a of assignments) {
    if (a._reuseThId && a.atoms.length === 0) continue; // phòng đang mở, nhưng không nhồi được atom nào của đơn hiện tại → bỏ
    if (a._reuseThId) {
      const u0 = Number(a._reuseInitialUsed) || 0; // số chỗ đã chiếm của đơn cũ
      a.used = Math.max(0, a.used - u0); // số chỗ đơn mới chiếm trong phòng reuse đó
    }
    delete a._reuseInitialUsed;
    finalAssignments.push(a);
  }

  return {
    ok: leftoverAtoms.length === 0, // false nếu còn atom không xếp được
    assignments: finalAssignments, // danh sách phòng được xếp
    leftoverAtoms, // danh sách atom không xếp được
    leftoverRooms: roomPool.map(({ _origIdx, ...rest }) => rest), // danh sách phòng vật lý không dùng
  };
}

module.exports = {
  canAllocateGenderRooms,
  canAllocateAtomicGroups,
  canAllocateAtomicGroupsAcrossHotels,
  canPackBins,
  assignAtomsToPhysicalRooms,
};
