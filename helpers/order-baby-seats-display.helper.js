/**
 * Dữ liệu hiển thị chỗ ngồi em bé trên order pending / success (server-side).
 * Logic mirror buildCartBabySeatsInfoHtml + buildCartPassengerExtraHtml (client cart).
 */

function _adultByIdx(passengers) {
  const map = {};
  (passengers || []).forEach((p) => {
    if (p.type === "adult") map[p.idx] = p;
  });
  return map;
}

function _babyNameAt(babies, seat, i) {
  const byIdx = babies.find((b) => b.idx === seat.babyIdx);
  if (byIdx && byIdx.name) return byIdx.name;
  if (babies[i] && babies[i].name) return babies[i].name;
  return `Em bé #${i + 1}`;
}

/** @returns {{ lines: Array<{kind, text, babyName?, guardianName?}>, feeTotal: number }} */
function buildBabySeatLines(item) {
  const qBaby = Number(item.quantityBaby || 0);
  if (qBaby <= 0) return { lines: [], feeTotal: 0 };

  const maxBabiesPerAdult = Number(item.maxBabiesPerAdult ?? 1);
  const passengers = Array.isArray(item.passengers) ? item.passengers : [];
  const babies = passengers.filter((p) => p.type === "baby");
  const adultByIdx = _adultByIdx(passengers);
  const bsArr = Array.isArray(item.babySeats) ? item.babySeats : [];
  const feeTotal = Number(item.babySeatFeeTotal || 0);
  const lines = [];

  if (maxBabiesPerAdult === 0) {
    lines.push({
      kind: "auto",
      text: "Tất cả em bé tự động chiếm 1 vị trí tour",
    });
  } else if (bsArr.length > 0) {
    bsArr.forEach((seat, i) => {
      const name = _babyNameAt(babies, seat, i);
      if (seat.seatType === "private") {
        lines.push({
          kind: "private",
          text: `${name}: ghế ngồi riêng`,
          babyName: name,
        });
      } else {
        const g =
          seat.guardianIdx !== null && seat.guardianIdx !== undefined
            ? adultByIdx[seat.guardianIdx]
            : null;
        const gName = g
          ? g.name || `Người lớn #${seat.guardianIdx + 1}`
          : null;
        lines.push({
          kind: "shared",
          text: gName
            ? `${name}: ngồi cùng ${gName}`
            : `${name}: ngồi cùng người lớn (chưa chọn)`,
          babyName: name,
          guardianName: gName,
        });
      }
    });
  } else if (item.babySeat) {
    lines.push({
      kind: "private",
      text: "Đặt chỗ ngồi riêng cho em bé",
    });
  }

  return { lines, feeTotal };
}

/** @returns {{ kind: 'shared'|'private'|'auto', label?: string, guardianName?: string, roomGuardianName?: string } | null} */
function getBabyPassengerSeatDisplay(item, passenger, adultByIdx) {
  if (passenger.type !== "baby") return null;

  const bsArr = Array.isArray(item.babySeats) ? item.babySeats : [];
  const bs = bsArr.find((b) => b.babyIdx === passenger.idx);
  const seatType = bs ? bs.seatType : passenger.babySeatType;

  // Người lớn ở cùng PHÒNG khách sạn (khác có thể với NL ngồi cùng tour).
  const rgid =
    passenger.roomGuardianIdx !== null &&
    passenger.roomGuardianIdx !== undefined
      ? passenger.roomGuardianIdx
      : null;
  const roomGuardianName =
    rgid !== null && adultByIdx[rgid]
      ? adultByIdx[rgid].name || `Người lớn #${rgid + 1}`
      : null;

  if (seatType === "private") {
    return {
      kind: "private",
      label: "Ghế ngồi riêng",
      roomGuardianName,
    };
  }

  const gid =
    bs && bs.guardianIdx !== null && bs.guardianIdx !== undefined
      ? bs.guardianIdx
      : passenger.guardianIdx;

  if (gid !== null && gid !== undefined && adultByIdx[gid]) {
    const gName = adultByIdx[gid].name || `Người lớn #${gid + 1}`;
    return {
      kind: "shared",
      label: "Ngồi cùng",
      guardianName: gName,
      roomGuardianName,
    };
  }

  if (Number(item.maxBabiesPerAdult ?? 1) === 0) {
    return {
      kind: "auto",
      label: "Tự động chiếm 1 vị trí tour",
      roomGuardianName,
    };
  }

  return roomGuardianName ? { kind: "shared", roomGuardianName } : null;
}

function enrichItemBabySeatsDisplay(item) {
  item.babySeatsDisplay = buildBabySeatLines(item);
  const passengers = Array.isArray(item.passengers) ? item.passengers : [];
  const adultByIdx = _adultByIdx(passengers);
  passengers.forEach((p) => {
    if (p.type === "baby") {
      p.babySeatDisplay = getBabyPassengerSeatDisplay(item, p, adultByIdx);
    }
  });
  return item;
}

module.exports = {
  buildBabySeatLines,
  getBabyPassengerSeatDisplay,
  enrichItemBabySeatsDisplay,
};
