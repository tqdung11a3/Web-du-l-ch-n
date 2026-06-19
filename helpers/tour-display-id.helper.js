/**
 * ID tour hiển thị trên UI admin: customId (nhập ở tour create/edit) nếu có,
 * không thì 6 ký tự cuối Mongo _id.
 */

function getTourDisplayId(tourOrMongoId, customId) {
  let mongoId = "";
  let custom = "";

  if (tourOrMongoId && typeof tourOrMongoId === "object") {
    custom = String(tourOrMongoId.customId || "").trim();
    mongoId = String(tourOrMongoId._id || "");
  } else {
    mongoId = String(tourOrMongoId || "");
    custom = String(customId || "").trim();
  }

  if (custom) return custom;
  if (!mongoId) return "—";
  return mongoId.length >= 6 ? mongoId.slice(-6) : mongoId;
}

/** Giống getTourDisplayId nhưng có prefix # (calendar legend / booking bar). */
function getTourDisplayIdHash(tourOrMongoId, customId) {
  const id = getTourDisplayId(tourOrMongoId, customId);
  return id === "—" ? "—" : `#${id}`;
}

function queryMatchesTourIdSearch(qCompact, tourOrMongoId, customId) {
  if (!qCompact) return false;

  let mongoId = "";
  let custom = "";

  if (tourOrMongoId && typeof tourOrMongoId === "object") {
    custom = String(tourOrMongoId.customId || "").trim();
    mongoId = String(tourOrMongoId._id || "").toLowerCase().replace(/\s/g, "");
  } else {
    mongoId = String(tourOrMongoId || "").toLowerCase().replace(/\s/g, "");
    custom = String(customId || "").trim();
  }

  const tokens = [];
  if (mongoId) {
    tokens.push(mongoId);
    if (mongoId.length >= 6) tokens.push(mongoId.slice(-6));
  }
  if (custom) {
    tokens.push(custom.toLowerCase().replace(/\s/g, ""));
  }

  for (const t of tokens) {
    if (!t) continue;
    if (
      t === qCompact ||
      t.includes(qCompact) ||
      qCompact.includes(t) ||
      (qCompact.length >= 6 && mongoId && mongoId.endsWith(qCompact))
    ) {
      return true;
    }
  }
  return false;
}

module.exports = {
  getTourDisplayId,
  getTourDisplayIdHash,
  queryMatchesTourIdSearch,
};
