// helpers/hotel-booking-pax.helper.js
//
// Tính số người lớn (NL) / trẻ em (TE) / em bé (EB) thực tế đã được phân vào
// một HotelBooking (Tour Hold) khi khách đặt tour, để lưu rõ ràng lên
// HotelBooking.adults / children / childrenDetails / babies / babiesDetails.
//
// Nguồn dữ liệu sự thật là Order.items[].passengers[]:
//   - private: lấy theo danh sách passengerIdxs gán vào từng phòng vật lý.
//   - shared:  lấy theo atomAnchorIdxs (NL neo) + các phụ thuộc (TE/EB có
//              guardianIdx trỏ về NL neo đó).

/** Đếm NL/TE/EB từ một danh sách passenger objects. */
function countPax(passengers) {
  const result = {
    adults: 0,
    children: 0,
    babies: 0,
    childrenDetails: [],
    babiesDetails: [],
  };
  if (!Array.isArray(passengers)) return result;
  for (const p of passengers) {
    if (!p) continue;
    if (p.type === "child") {
      result.children += 1;
      result.childrenDetails.push({ age: Number(p.age) || 0 });
    } else if (p.type === "baby") {
      result.babies += 1;
      result.babiesDetails.push({ age: Number(p.age) || 0 });
    } else {
      // mặc định adult
      result.adults += 1;
    }
  }
  return result;
}

/**
 * Lấy tập passenger thuộc về các atom (shared mode) trong 1 phòng cho 1 đơn.
 * = các NL neo (anchorIdxs) + các TE/EB có guardianIdx trỏ về 1 trong các NL đó.
 */
function passengersForAtoms(itemPassengers, anchorIdxs) {
  if (!Array.isArray(itemPassengers)) return [];
  const anchors = new Set(
    (Array.isArray(anchorIdxs) ? anchorIdxs : [])
      .map((n) => Number(n))
      .filter((n) => Number.isFinite(n))
  );
  if (anchors.size === 0) return [];
  // Người trông PHÒNG của 1 phụ thuộc:
  //  - em bé: ưu tiên roomGuardianIdx (người ở cùng phòng), fallback guardianIdx
  //  - trẻ em: dùng guardianIdx
  // (guardianIdx của em bé có thể là người trông GHẾ, khác người ở cùng phòng)
  const roomGuardianOf = (p) => {
    if (p.type === "baby") {
      return p.roomGuardianIdx !== null && p.roomGuardianIdx !== undefined
        ? Number(p.roomGuardianIdx)
        : Number(p.guardianIdx);
    }
    return Number(p.guardianIdx);
  };

  const out = [];
  for (const p of itemPassengers) {
    if (!p || typeof p.idx !== "number") continue;
    if (anchors.has(p.idx)) {
      out.push(p); // NL neo
    } else if (
      (p.type === "child" || p.type === "baby") &&
      anchors.has(roomGuardianOf(p))
    ) {
      out.push(p); // phụ thuộc đi cùng NL neo trong phòng
    }
  }
  return out;
}

/** Cộng dồn 2 kết quả pax (dùng khi nhiều đơn ghép chung 1 phòng). */
function mergePax(a, b) {
  return {
    adults: (a.adults || 0) + (b.adults || 0),
    children: (a.children || 0) + (b.children || 0),
    babies: (a.babies || 0) + (b.babies || 0),
    childrenDetails: [
      ...(a.childrenDetails || []),
      ...(b.childrenDetails || []),
    ],
    babiesDetails: [...(a.babiesDetails || []), ...(b.babiesDetails || [])],
  };
}

/** Chuyển pax thành object $set để cập nhật HotelBooking. */
function paxToHotelBookingSet(pax) {
  return {
    adults: pax.adults || 0,
    children: pax.children || 0,
    babies: pax.babies || 0,
    childrenDetails: Array.isArray(pax.childrenDetails)
      ? pax.childrenDetails
      : [],
    babiesDetails: Array.isArray(pax.babiesDetails) ? pax.babiesDetails : [],
  };
}

module.exports = {
  countPax,
  passengersForAtoms,
  mergePax,
  paxToHotelBookingSet,
};
