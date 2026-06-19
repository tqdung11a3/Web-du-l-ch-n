// helpers/shared-room-passengers.helper.js
// Resolve danh sách hành khách trong 1 phòng ở ghép từ atomLabels + passengers đơn.

const {
  passengerNeedsGuardian,
  isAnchorAdult,
} = require("./passenger-atom.helper");

function normalizePaxForGuardian(p) {
  return {
    ...p,
    age: Math.max(0, Math.floor(Number(p.age) || 0)),
    type: p.type === "child" || p.type === "baby" ? p.type : "adult",
  };
}

function passengersForRoomFromAnchorIdxs(passengers, anchorIdxs) {
  const list = (passengers || []).map(normalizePaxForGuardian);
  const anchorSet = {};
  (anchorIdxs || []).forEach((idx) => {
    if (typeof idx === "number") anchorSet[idx] = true;
  });
  const adultIdxInRoom = {};
  list.forEach((p) => {
    if (p.type === "adult" && anchorSet[p.idx]) adultIdxInRoom[p.idx] = true;
  });
  // Em bé dùng roomGuardianIdx (mới) để xác định phòng KS; fallback guardianIdx.
  const _babyRoomAnchor = (p) =>
    p.roomGuardianIdx !== null && p.roomGuardianIdx !== undefined
      ? p.roomGuardianIdx
      : p.guardianIdx;
  return list.filter((p) => {
    if (p.type === "adult") {
      if (anchorSet[p.idx]) return true;
      if (passengerNeedsGuardian(p)) {
        return (
          p.guardianIdx !== null &&
          p.guardianIdx !== undefined &&
          !!adultIdxInRoom[p.guardianIdx]
        );
      }
      return false;
    }
    if (p.type === "baby") {
      const anchor = _babyRoomAnchor(p);
      return (
        anchor !== null &&
        anchor !== undefined &&
        !!adultIdxInRoom[anchor]
      );
    }
    return (
      p.guardianIdx !== null &&
      p.guardianIdx !== undefined &&
      !!adultIdxInRoom[p.guardianIdx]
    );
  });
}

function deriveAnchorIdxFromAtomLabel(label, passengers) {
  const m = String(label || "").match(/^(.+?)(?:\s+\(\+|$)/);
  const nm = m
    ? m[1].trim().toLowerCase()
    : String(label || "").trim().toLowerCase();
  if (!nm) return null;
  const list = (passengers || []).map(normalizePaxForGuardian);
  const anchor = list.find(
    (p) =>
      p.type === "adult" &&
      String(p.name || "").trim().toLowerCase() === nm &&
      isAnchorAdult(p)
  );
  if (anchor) return anchor.idx;
  const anyAdult = list.find(
    (p) =>
      p.type === "adult" &&
      String(p.name || "").trim().toLowerCase() === nm
  );
  return anyAdult ? anyAdult.idx : null;
}

function buildPaxByName(passengers) {
  const paxByName = {};
  for (const p of passengers || []) {
    if (p.name) paxByName[String(p.name).trim().toLowerCase()] = p;
  }
  return paxByName;
}

function parseAtomLabelLegacy(label) {
  if (typeof label !== "string") return null;
  const m = label.match(/^(.+?)\s*\((NL|TE|EB)(?:·(Nam|Nữ|\?))?\)$/);
  if (!m) return { name: label, type: "adult", gender: null };
  const typeMap = { NL: "adult", TE: "child", EB: "baby" };
  const genderMap = { Nam: "male", "Nữ": "female" };
  return {
    name: m[1].trim(),
    type: typeMap[m[2]] || "adult",
    gender: m[3] ? genderMap[m[3]] || null : null,
  };
}

function expandSharedAtomLabel(label, paxByName) {
  if (typeof label !== "string" || !label.trim()) return [];
  const raw = String(label).trim();

  const parsedLegacy = parseAtomLabelLegacy(raw);
  if (parsedLegacy && parsedLegacy.name && parsedLegacy.name !== raw) {
    const full = paxByName[String(parsedLegacy.name).toLowerCase()];
    return [
      {
        name: parsedLegacy.name,
        type: parsedLegacy.type,
        gender: parsedLegacy.gender || (full ? full.gender : null),
        age: full ? full.age : undefined,
        idx: full ? full.idx : undefined,
      },
    ];
  }

  const m = raw.match(/^(.+?)(?:\s+\(\+\s*(.+?)\))?$/);
  if (!m) return [{ name: raw, type: "adult", gender: null, age: undefined }];

  const out = [];
  const adultName = (m[1] || "").trim();
  if (adultName) {
    const fullAdult = paxByName[adultName.toLowerCase()];
    out.push({
      name: adultName,
      type: "adult",
      gender: fullAdult ? fullAdult.gender || null : null,
      age: fullAdult ? fullAdult.age : undefined,
      idx: fullAdult ? fullAdult.idx : undefined,
    });
  }

  const depsRaw = m[2] ? String(m[2]).trim() : "";
  if (depsRaw) {
    const deps = depsRaw.split(/,\s*/).map((x) => x.trim()).filter(Boolean);
    for (const dep of deps) {
      const dm = dep.match(/^(TE|EB)\s+(.+)$/);
      if (dm) {
        const depType = dm[1] === "TE" ? "child" : "baby";
        const depName = String(dm[2] || "").trim();
        const fullDep = paxByName[depName.toLowerCase()];
        out.push({
          name: depName,
          type: depType,
          gender: fullDep ? fullDep.gender || null : null,
          age: fullDep ? fullDep.age : undefined,
          idx: fullDep ? fullDep.idx : undefined,
        });
        continue;
      }
      const dmAge = dep.match(/^(.+?)\s*\((\d+)t\)\s*$/i);
      if (dmAge) {
        const depName = String(dmAge[1] || "").trim();
        const fullDep = paxByName[depName.toLowerCase()];
        out.push({
          name: depName,
          type: fullDep ? fullDep.type : "adult",
          gender: fullDep ? fullDep.gender || null : null,
          age: fullDep
            ? fullDep.age
            : parseInt(dmAge[2], 10) || undefined,
          idx: fullDep ? fullDep.idx : undefined,
        });
        continue;
      }
      const fullByName = paxByName[dep.toLowerCase()];
      if (fullByName) {
        out.push({
          name: fullByName.name || dep,
          type: fullByName.type || "adult",
          gender: fullByName.gender || null,
          age: fullByName.age,
          idx: fullByName.idx,
        });
      }
    }
  }

  return out.filter((p) => p && p.name);
}

/**
 * @param {Array<{idx?:number,name?:string,type?:string,age?:number,gender?:string,guardianIdx?:number|null}>} passengers
 * @param {string[]} labels atomLabels từ TourSegment.assignments
 * @returns {Array<{name:string,type:string,age?:number,gender?:string|null}>}
 */
function resolvePassengersForAtomLabels(passengers, labels) {
  if (!Array.isArray(passengers) || passengers.length === 0) return [];
  const paxByName = buildPaxByName(passengers);
  const seen = new Set();
  const out = [];

  for (const lbl of labels || []) {
    const anchorIdx = deriveAnchorIdxFromAtomLabel(lbl, passengers);
    let batch = [];
    if (anchorIdx !== null) {
      batch = passengersForRoomFromAnchorIdxs(passengers, [anchorIdx]);
    } else {
      batch = expandSharedAtomLabel(lbl, paxByName);
    }
    for (const p of batch) {
      const key =
        typeof p.idx === "number"
          ? `i:${p.idx}`
          : `n:${String(p.name || "").toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        name: p.name || "",
        type: p.type || "adult",
        age: p.age,
        gender: p.gender || null,
      });
    }
  }

  return out;
}

const ROOM_STATUS_RANK = {
  confirmed: 0,
  pending: 0,
  checked_in: 1,
  checked_out: 2,
};

/**
 * Trạng thái hiển thị phòng ở ghép: lấy mức cao hơn giữa guestStatus (assignment)
 * và bookingStatus (HotelBooking) — admin có thể cập nhật một trong hai.
 */
function resolveSharedRoomDisplayStatus(guestStatus, bookingStatus) {
  const g = guestStatus || "confirmed";
  const b = bookingStatus || "confirmed";
  const gr = ROOM_STATUS_RANK[g] ?? 0;
  const br = ROOM_STATUS_RANK[b] ?? 0;
  return br > gr ? b : g;
}

module.exports = {
  resolvePassengersForAtomLabels,
  passengersForRoomFromAnchorIdxs,
  deriveAnchorIdxFromAtomLabel,
  resolveSharedRoomDisplayStatus,
};
