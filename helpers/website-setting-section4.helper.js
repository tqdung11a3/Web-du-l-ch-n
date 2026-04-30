const mongoose = require("mongoose");

/** Giới hạn số block Section 4 trên trang chủ */
const MAX_SECTION4_CATEGORIES = 20;

/**
 * @param {import("mongoose").Document | Record<string, unknown>|null|undefined} record
 * @returns {string[]}
 */
function normalizeSection4CategoryIds(record) {
  if (!record) return [];
  const raw = record.categoryIdsSection4;
  if (Array.isArray(raw) && raw.length) {
    const out = [
      ...new Set(
        raw
          .map((id) => (id != null ? String(id) : ""))
          .filter((id) => mongoose.Types.ObjectId.isValid(id))
      ),
    ];
    return out.slice(0, MAX_SECTION4_CATEGORIES);
  }
  const one = record.categoryIdSection4;
  if (one != null && mongoose.Types.ObjectId.isValid(String(one))) {
    return [String(one)];
  }
  return [];
}

module.exports = {
  normalizeSection4CategoryIds,
  MAX_SECTION4_CATEGORIES,
};
